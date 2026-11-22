// POST /v1/budget/refresh (card t_bc95ba79d31048c8): pull the MoneyClaw summary now, so the Budget page
// shows a bank import at once instead of after the next 10-minute cron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { upsertSnapshot } from '../src/db.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const BOT = `ccb_${'d'.repeat(43)}`;
const summary = (latestPostedDate) => ({
  success: true,
  budgetSimple: { today: '2026-11-22', month: '2026-11', latestPostedDate, groups: [{ key: 'business', periods: {} }, { key: 'personal', periods: {} }] },
});

async function setup() {
  const db = sqliteD1();
  await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at, revoked_at) VALUES (?, ?, ?, NULL)')
    .bind(await sha256Hex(BOT), 'developer', '2026-10-29T00:00:00.000Z').run();
  await upsertSnapshot(db, 'moneyclaw', JSON.stringify(summary('2026-11-18')), '2026-11-22T10:00:00.000Z', '2026-11-22T10:00:00.000Z');
  return { db, env: { DB: db, SESSION_SECRET: SECRET, MONEYCLAW_DASHBOARD_TOKEN: 'mc-token' } };
}

function call(env, method, path, { bot = true, cookie } = {}) {
  const headers = new Headers();
  if (bot) headers.set('Authorization', `Bearer ${BOT}`);
  if (cookie) { headers.set('Cookie', cookie); headers.set('X-CC', '1'); }
  return handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, { method, headers }), env)
    .then(async (r) => ({ status: r.status, body: await r.json() }));
}

function mockFetch(fn) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), auth: init?.headers?.authorization }); return fn(url, init); };
  return { seen, restore: () => { globalThis.fetch = real; } };
}

test('refresh: a newer MoneyClaw summary is stored at once and GET /budget shows it', async () => {
  const { env } = await setup();
  assert.equal((await call(env, 'GET', '/budget')).body.budget.latestPostedDate, '2026-11-18');
  const f = mockFetch(() => new Response(JSON.stringify(summary('2026-11-21')), { status: 200 }));
  try {
    const r = await call(env, 'POST', '/budget/refresh');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.latestPostedDate, '2026-11-21');
    assert.ok(r.body.collectedAt);
    assert.deepEqual(f.seen, [{ url: 'https://moneyclaw.jonmac.ai/api/internal/dashboard-summary', auth: 'Bearer mc-token' }]);
    // Jon's session may refresh too (from the page).
    const jon = await call(env, 'POST', '/budget/refresh', { bot: false, cookie: `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}` });
    assert.equal(jon.status, 200);
  } finally { f.restore(); }
  const g = await call(env, 'GET', '/budget');
  assert.equal(g.status, 200);
  assert.equal(g.body.budget.latestPostedDate, '2026-11-21');
});

test('refresh: a failing upstream is a non-ok error and the stored snapshot is untouched', async () => {
  const { env, db } = await setup();
  const before = await db.prepare("SELECT data, collected_at FROM snapshots WHERE source = 'moneyclaw'").first();
  for (const res of [() => new Response('down', { status: 500 }), () => new Response(JSON.stringify({ success: false }), { status: 200 }), () => { throw new Error('network'); }]) {
    const f = mockFetch(res);
    try {
      const r = await call(env, 'POST', '/budget/refresh');
      assert.equal(r.status, 502);
      assert.equal(r.body.ok, false);
      assert.ok(r.body.error);
    } finally { f.restore(); }
  }
  assert.deepEqual(await db.prepare("SELECT data, collected_at FROM snapshots WHERE source = 'moneyclaw'").first(), before);
  assert.equal((await call(env, 'GET', '/budget')).body.budget.latestPostedDate, '2026-11-18');
});

test('refresh: no MoneyClaw token is a 503, never a fake ok, and no fetch is made', async () => {
  const { env } = await setup();
  delete env.MONEYCLAW_DASHBOARD_TOKEN;
  const f = mockFetch(() => { throw new Error('must not fetch'); });
  try {
    const r = await call(env, 'POST', '/budget/refresh');
    assert.equal(r.status, 503);
    assert.equal(r.body.ok, false);
    assert.equal(f.seen.length, 0);
  } finally { f.restore(); }
});
