import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { handleCron } from '../src/cron.js';
import { overlayContent } from '../src/content.js';
import { configuredPlatforms, fillDailyDrafts, fillFromEnv } from '../src/daily-drafts.js';
import { listDrafts, persistQueueDrafts, upsertDraft } from '../src/drafts.js';
import { upsertSnapshot } from '../src/db.js';
import { render as renderContent } from '../public/js/pages/content.js';
import { memD1 } from './memd1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-09-19T18:00:00Z'); // Vancouver 2026-09-19
const DAY = '2026-09-19';
const OUTLIERS = [
  { id: 'a', channel: 'Joshua Mayo', title: '4 AI UGC Side Hustles For 2026', views: 5_000_000, outlier_score: 133.2 },
  { id: 'b', channel: 'Quiet Channel', title: 'Ignore me talking', views: 10, outlier_score: 1.1 },
  { id: 'c', channel: 'Mr. Paid Social', title: 'How To Make Facebook AI UGC Ads In 2026', views: 233_000, outlier_score: 50.6 },
  { id: 'd', channel: 'Karolis', title: 'Best AI video generation tools this year', views: 16_000, outlier_score: 46.2 },
];
const PICKS = [{ id: 'm1', title: 'Veo workflow for product UGC', area: 'YouTube', text: 'Format notes only' }];
const SOURCES = { outliers: OUTLIERS, picks: PICKS, queued: [], video: { queue: [{ title: 'AI UGC remake cut' }] } };

async function cookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${COOKIE}=${await signSession(SECRET, exp)}`;
}

function envWith(db, extra = {}) {
  return { SESSION_SECRET: SECRET, DB: db, CONTENT_PLATFORMS: 'X,LinkedIn', ...extra };
}

async function snap(env) {
  return handleApi(new Request('https://jonmac.ai/dashboard/api/snapshot', {
    headers: { cookie: await cookie() },
  }), env);
}

async function generate(env) {
  return handleApi(new Request('https://jonmac.ai/dashboard/api/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookie(), 'x-cc': '1' },
    body: JSON.stringify({ kind: 'content.generate_drafts' }),
  }), env);
}

function bodies(rows) {
  return rows.map((r) => r.body);
}

function slotKeys(rows) {
  return rows.map((r) => `${r.day}|${r.platform}|${r.slot}`).sort();
}

test('configuredPlatforms follows env and does not assume a count', () => {
  assert.deepEqual(configuredPlatforms({ CONTENT_PLATFORMS: 'TikTok, YouTube, X' }), ['TikTok', 'YouTube', 'X']);
  assert.equal(configuredPlatforms({ CONTENT_PLATFORMS: 'X,X,Instagram' }).length, 2);
  assert.ok(configuredPlatforms({}).length >= 1);
});

test('fill writes 3 distinct source-grounded drafts per configured platform', async () => {
  const db = memD1();
  const out = await fillDailyDrafts(db, { nowMs: NOW, platforms: ['X', 'LinkedIn'], sources: SOURCES });
  assert.equal(out.day, DAY);
  assert.equal(out.inserted, 6);
  const rows = await listDrafts(db, DAY);
  assert.equal(rows.length, 6);
  for (const p of ['X', 'LinkedIn']) {
    const mine = rows.filter((r) => r.platform === p).sort((a, b) => a.slot - b.slot);
    assert.equal(mine.length, 3);
    assert.deepEqual(mine.map((r) => r.slot), [1, 2, 3]);
    assert.equal(new Set(bodies(mine)).size, 3);
    assert.equal(mine[0].id, `d:${DAY}:${p.toLowerCase()}:1`);
    assert.ok(mine.every((r) => r.status === 'draft' && r.body.includes('4 AI UGC Side Hustles For 2026')));
    assert.ok(mine.every((r) => !/\$\d/.test(r.body) && !/I made/i.test(r.body) && !/revenue/i.test(r.body)));
  }
  assert.match(rows.find((r) => r.platform === 'X' && r.slot === 1).body, /X · hook/);
  assert.match(rows.find((r) => r.platform === 'LinkedIn' && r.slot === 2).body, /LinkedIn · how-to/);
});

test('fill count tracks configured platforms, not a hardcoded 4', async () => {
  const db = memD1();
  await fillDailyDrafts(db, { nowMs: NOW, platforms: ['TikTok', 'YouTube', 'Facebook', 'Instagram', 'X'], sources: SOURCES });
  assert.equal((await listDrafts(db, DAY)).length, 15);
});

test('second fill is idempotent even when sources change', async () => {
  const db = memD1();
  await fillDailyDrafts(db, { nowMs: NOW, platforms: ['X'], sources: SOURCES });
  const first = await listDrafts(db, DAY);
  const again = await fillDailyDrafts(db, {
    nowMs: NOW,
    platforms: ['X'],
    sources: { outliers: [{ id: 'z', channel: 'Other', title: 'Unrelated talking head', outlier_score: 9 }] },
  });
  assert.equal(again.inserted, 0);
  const second = await listDrafts(db, DAY);
  assert.deepEqual(second.map((r) => r.id).sort(), first.map((r) => r.id).sort());
  assert.deepEqual(bodies(second).sort(), bodies(first).sort());
});

test('concurrent fills do not duplicate slots', async () => {
  const db = memD1();
  const opts = { nowMs: NOW, platforms: ['X', 'Instagram'], sources: SOURCES };
  await Promise.all([fillDailyDrafts(db, opts), fillDailyDrafts(db, opts), fillDailyDrafts(db, opts)]);
  const rows = await listDrafts(db, DAY);
  assert.equal(rows.length, 6);
  assert.equal(new Set(slotKeys(rows)).size, 6);
});

test('fill never overwrites edited, approved, or discarded rows', async () => {
  const db = memD1();
  await fillDailyDrafts(db, { nowMs: NOW, platforms: ['X'], sources: SOURCES });
  const rows = (await listDrafts(db, DAY)).sort((a, b) => a.slot - b.slot);
  await upsertDraft(db, { ...rows[0], body: 'EDITED BY USER', first_line: 'EDITED BY USER', status: 'draft' });
  await upsertDraft(db, { ...rows[1], body: 'APPROVED COPY', first_line: 'APPROVED COPY', status: 'approved' });
  await upsertDraft(db, { ...rows[2], body: 'NOPE', first_line: 'NOPE', status: 'discarded' });
  await fillDailyDrafts(db, { nowMs: NOW, platforms: ['X'], sources: SOURCES });
  const all = await listDrafts(db);
  assert.equal(all.find((r) => r.slot === 1).body, 'EDITED BY USER');
  assert.equal(all.find((r) => r.slot === 2).body, 'APPROVED COPY');
  assert.equal(all.find((r) => r.slot === 2).status, 'approved');
  assert.equal(all.find((r) => r.slot === 3).body, 'NOPE');
  assert.equal(all.find((r) => r.slot === 3).status, 'discarded');
  assert.equal(all.filter((r) => r.day === DAY && r.platform === 'X').length, 3);
});

test('ingest occupying a slot is not replaced; remaining slots fill', async () => {
  const db = memD1();
  await persistQueueDrafts(db, { queued: [{ id: 'q1', platform: 'x', firstLine: 'queue hook already written' }] }, '2026-09-19T17:00:00Z');
  await fillDailyDrafts(db, { nowMs: NOW, platforms: ['X'], sources: SOURCES });
  const rows = (await listDrafts(db, DAY)).filter((r) => r.platform === 'X');
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.slot === 1).body, 'queue hook already written');
  assert.ok(rows.find((r) => r.slot === 2).body.includes('AI UGC'));
});

test('Vancouver winter midnight rolls over and keeps history', async () => {
  const db = memD1();
  const eve = Date.parse('2026-01-15T07:59:00Z');
  const next = Date.parse('2026-01-15T08:00:00Z');
  await fillDailyDrafts(db, { nowMs: eve, platforms: ['X'], sources: SOURCES });
  await fillDailyDrafts(db, { nowMs: next, platforms: ['X'], sources: SOURCES });
  const old = await listDrafts(db, '2026-01-14');
  const neu = await listDrafts(db, '2026-01-15');
  assert.equal(old.length, 3);
  assert.equal(neu.length, 3);
  assert.ok(old.every((r) => r.id.startsWith('d:2026-01-14:')));
  assert.ok(neu.every((r) => r.id.startsWith('d:2026-01-15:')));
});

test('Vancouver DST spring-forward midnight uses the new local day', async () => {
  const db = memD1();
  await fillDailyDrafts(db, { nowMs: Date.parse('2026-03-08T07:59:00Z'), platforms: ['X'], sources: SOURCES });
  await fillDailyDrafts(db, { nowMs: Date.parse('2026-03-08T10:00:00Z'), platforms: ['X'], sources: SOURCES });
  assert.equal((await listDrafts(db, '2026-03-07')).length, 3);
  assert.equal((await listDrafts(db, '2026-03-08')).length, 3);
});

test('no connected sources still writes useful operator-focus drafts, not empty slots', async () => {
  const db = memD1();
  await fillDailyDrafts(db, { nowMs: NOW, platforms: ['X'], sources: {} });
  const rows = await listDrafts(db, DAY);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.body.length > 80 && /operator focus/i.test(r.body)));
  assert.ok(rows.every((r) => r.body.includes('AI UGC')));
});

test('snapshot GET does not insert drafts', async () => {
  const env = envWith(memD1());
  await upsertSnapshot(env.DB, 'youtube', JSON.stringify({ outliers: OUTLIERS }), '2026-09-19T17:00:00Z', '2026-09-19T17:00:00Z');
  const res = await snap(env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal((body.pages.content.drafts?.rows || []).length, 0);
  assert.equal((await listDrafts(env.DB)).length, 0);
});

test('cron fill then snapshot GET shows persisted drafts', async () => {
  const env = envWith(memD1());
  await upsertSnapshot(env.DB, 'youtube', JSON.stringify({ outliers: OUTLIERS }), '2026-09-19T17:00:00Z', '2026-09-19T17:00:00Z');
  await upsertSnapshot(env.DB, 'mastermind', JSON.stringify({ picks: PICKS }), '2026-09-19T17:00:00Z', '2026-09-19T17:00:00Z');
  const orig = Date.now;
  Date.now = () => NOW;
  try {
    await handleCron(env);
    assert.equal((await listDrafts(env.DB, DAY)).length, 6);
    const body = await (await snap(env)).json();
    assert.equal(body.pages.content.drafts.rows.length, 6);
    assert.ok(body.pages.content.drafts.rows[0].body.includes('AI UGC'));
  } finally { Date.now = orig; }
});

test('explicit generate action fills; repeat is a no-op', async () => {
  const env = envWith(memD1());
  await upsertSnapshot(env.DB, 'youtube', JSON.stringify({ outliers: OUTLIERS }), '2026-09-19T17:00:00Z', '2026-09-19T17:00:00Z');
  const orig = Date.now;
  Date.now = () => NOW;
  try {
    const first = await generate(env);
    assert.equal(first.status, 200);
    const payload = await first.json();
    assert.equal(payload.status, 'done');
    assert.equal(env.DB.actions[0].target, 'worker');
    assert.equal((await listDrafts(env.DB, DAY)).length, 6);
    const second = await (await generate(env)).json();
    assert.match(String(second.result), /0 /);
    assert.equal((await listDrafts(env.DB, DAY)).length, 6);
  } finally { Date.now = orig; }
});

test('overlay generate action and edit payload keep slot and day', () => {
  const page = { tiles: [{}, {}, {}, {}], todayPlatforms: {}, heat: { days: [], rows: [] }, queue: { rows: [] }, ytWeek: { rows: [] }, bestPosts: { rows: [] } };
  overlayContent(page, {
    drafts: [{ id: 'd:2026-09-19:x:1', day: DAY, platform: 'X', slot: 1, body: 'hello draft', first_line: 'hello draft', status: 'draft' }],
    nowMs: NOW,
  });
  assert.equal(page.actions.some((a) => a.kind === 'content.generate_drafts'), true);
  assert.equal(page.drafts.rows[0].slot, 1);
  assert.equal(page.drafts.rows[0].day, DAY);
  const html = renderContent(page);
  assert.match(html, /&quot;slot&quot;:1/);
  assert.match(html, /&quot;day&quot;:&quot;2026-09-19&quot;/);
});

test('fillFromEnv reads snapshot sources and env platforms', async () => {
  const env = envWith(memD1(), { CONTENT_PLATFORMS: 'Facebook' });
  await upsertSnapshot(env.DB, 'youtube', JSON.stringify({ outliers: OUTLIERS }), '2026-09-19T17:00:00Z', '2026-09-19T17:00:00Z');
  const out = await fillFromEnv(env, NOW);
  assert.equal(out.inserted, 3);
  assert.deepEqual(out.platforms, ['Facebook']);
  const row = (await listDrafts(env.DB, DAY))[0];
  assert.match(row.body, /Facebook · /);
  assert.match(row.body, /4 AI UGC Side Hustles For 2026/);
});

test('content UI platforms match generator configured list', async () => {
  const env = envWith(memD1(), { CONTENT_PLATFORMS: 'TikTok,YouTube,X' });
  const body = await (await snap(env)).json();
  const labels = body.pages.content.todayPlatforms.rows.map((r) => r.label);
  assert.deepEqual(labels, configuredPlatforms(env));
  assert.deepEqual(labels, ['TikTok', 'YouTube', 'X']);
  assert.equal(body.pages.content.tiles[0].goal, '/ 9');
  const html = renderContent(body.pages.content);
  assert.match(html, /TikTok/);
  assert.doesNotMatch(html, /LinkedIn/);
});

test('snapshot shows draft storage error instead of an empty queue', async () => {
  const db = memD1();
  const orig = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = orig(sql);
    if (/FROM content_drafts/.test(String(sql))) {
      return {
        bind(...args) { return stmt.bind(...args); },
        async all() { throw new Error('D1 content_drafts unavailable'); },
        async run() { return stmt.run(); },
        async first() { return stmt.first(); },
      };
    }
    return stmt;
  };
  const env = envWith(db);
  const body = await (await snap(env)).json();
  assert.equal(body.pages.content.drafts.rows.length, 0);
  assert.match(body.pages.content.drafts.error, /D1 content_drafts unavailable/);
  assert.equal(body.pages.content.drafts.meta, 'Storage error');
  const html = renderContent(body.pages.content);
  assert.match(html, /D1 content_drafts unavailable/);
  assert.doesNotMatch(html, /No persisted drafts today/);
});

