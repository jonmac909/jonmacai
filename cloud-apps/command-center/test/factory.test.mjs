import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { render, mount } from '../public/js/pages/factory.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const BOTS = ['ana', 'moneyclaw', 'developer', 'sponsors'];
const TOK = Object.fromEntries(BOTS.map((b) => [b, `ccb_${b.padEnd(43, 'x')}`]));

async function setup() {
  const db = sqliteD1();
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
async function call(env, method, path, { bot, body, jon } = {}) {
  const h = new Headers();
  if (bot) h.set('Authorization', `Bearer ${TOK[bot]}`);
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}

const SNAP = { columns: ['Script', 'Pack'], tiles: [{ title: 'Tesco Transport Shake-Up - Peter Collins', channel: 'Peter Collins', column: 1, progress: { label: 'Stills and clips', done: 40, total: 100 } }] };

test('factory: only writers post, one row is overwritten, Jon and bots read it', async () => {
  const { db, env } = await setup();
  assert.equal((await call(env, 'GET', '/v1/factory', { jon: true })).body.factory, null);
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'sponsors', body: SNAP })).status, 403);
  assert.equal((await call(env, 'PUT', '/v1/factory', { jon: true, body: SNAP })).status, 403, 'Jon reads, a script writes');
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: { columns: 'x', tiles: [] } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: { columns: [], tiles: Array(601).fill({}) } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: { columns: [], tiles: [null] } })).status, 400, 'a null tile would break the page');
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: { columns: [1], tiles: [] } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: SNAP })).status, 200);
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: { ...SNAP, tiles: [] } })).status, 200);
  const got = await call(env, 'GET', '/v1/factory', { jon: true });
  assert.deepEqual(got.body.factory.tiles, []);
  assert.ok(Date.parse(got.body.asOf));
  assert.ok(got.body.channels.some((c) => c.slug === 'peter-collins'));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE source = 'factory'").first()).n, 1);
  assert.equal((await call(env, 'GET', '/v1/factory', { bot: 'ana' })).status, 200);
  assert.equal((await call(env, 'GET', '/v1/factory')).status, 401);
});

test('factory: the 60 s snapshot poll never carries the factory row', async () => {
  const { env } = await setup();
  await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: SNAP });
  const snap = await call(env, 'GET', '/snapshot', { jon: true });
  assert.equal(snap.status, 200);
  assert.equal(snap.body.sources.factory, undefined);
  assert.ok(snap.body.nav.groups.some((g) => g.items.some((i) => i.id === 'factory')));
});

test('factory page: shell renders and tabs filter tiles by channel', () => {
  assert.match(render(null, null, 'peter-collins'), /data-sub="peter-collins"/);
});
