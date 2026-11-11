// Needs you (Jon, 2026-11-11): the grouped work list on Blockers, and its Drop / Not now writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { blockerRows, renderBlockers } from '../public/d3/js/blockers.js';
import { railCounts } from '../public/d3/js/rail.js';
import { needsGroups, groupOf, renderNeeds } from '../public/d3/js/needs.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-11T19:00:00Z');
const H = (h) => new Date(NOW - h * 3600000).toISOString();
const BOT = `ccb_${'s'.repeat(43)}`;
const id = (p, n) => `${p}_${String(n).padStart(16, '0')}`;
const T = { sponsorMoney: id('t', 1), video: id('t', 2), plain: id('t', 3), signin: id('t', 4), doing: id('t', 5) };
const Q = { a: id('q', 1), b: id('q', 2) };
const A = { pub: id('a', 1), pay: id('a', 2) };

async function withNow(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try { return await fn(); } finally { Date.now = real; }
}
const ins = (db, table, row) => {
  const keys = Object.keys(row);
  db.sqlite.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
};

async function setup() {
  const db = sqliteD1();
  await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(BOT), 'sponsors', H(100)).run();
  const t = (tid, title, owner, status, at, note = '') => ins(db, 'bot_tasks', { id: tid, title, owner, status, note, created_by: 'ana', updated_by: owner, created_at: at, updated_at: at });
  t(T.sponsorMoney, 'Acme deal - sign terms', 'sponsors', 'waiting_on_jon', H(3), 'Your move: OK the $5,000 terms');
  t(T.video, 'Kyoto homes - Naomi Takeda Japan', 'video-editor', 'waiting_on_jon', H(20), 'Your move: approve the video');
  t(T.plain, 'Pick a book name', 'home-guide-press', 'waiting_on_jon', H(30), 'Your move: pick one of two names');
  t(T.signin, 'HeyGen session', 'video-editor', 'waiting_on_jon', H(2), 'Your move: sign in to HeyGen');
  t(T.doing, 'Some build', 'developer', 'doing', H(1));
  ins(db, 'bot_questions', { id: Q.a, asked_by: 'ana', question: 'Which channel next?', task_id: T.doing, status: 'open', created_at: H(5), updated_at: H(5) });
  ins(db, 'bot_questions', { id: Q.b, asked_by: 'sponsors', question: 'Which sponsor first?', status: 'open', created_at: H(8), updated_at: H(8) });
  ins(db, 'bot_approvals', { id: A.pub, action: 'publish_draft', title: 'Publish the Kyoto video', requested_by: 'video-editor', task_id: T.doing, status: 'pending', created_at: H(4), updated_at: H(4) });
  ins(db, 'bot_approvals', { id: A.pay, action: 'send_invoice', title: 'Send invoice to Acme', requested_by: 'sponsors', status: 'pending', created_at: H(6), updated_at: H(6) });
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
const cookie = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
const d3Of = async (env) => withNow(NOW, async () => (await handleApi(new Request('https://jonmac.ai/dashboard/api/d3', { headers: { Cookie: await cookie() } }), env)).json());
const post = async (env, path, { bot = false, anon = false, noCC = false } = {}) => withNow(NOW, async () => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (bot) headers.set('Authorization', `Bearer ${BOT}`);
  else if (!anon) { headers.set('Cookie', await cookie()); if (!noCC) headers.set('X-CC', '1'); }
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, { method: 'POST', headers, body: '{}' }), env);
  return { status: r.status, body: await r.json() };
});
const youIds = (d3) => (blockerRows(null, d3) || []).filter((b) => b.you).map((b) => b.id).sort();

test('Needs you: every you-row lands in exactly one group, in Sign in, Money, Approve, Answer order', async () => {
  const { env } = await setup();
  const d3 = await d3Of(env);
  d3.d3.rail.youtube = { state: 'r', out: 1, connected: 3 };
  const rows = blockerRows(null, d3);
  const groups = needsGroups(rows);
  const all = groups.flatMap((g) => g.rows.map((b) => b.id));
  assert.equal(all.length, new Set(all).size);
  assert.deepEqual([...all].sort(), rows.filter((b) => b.you).map((b) => b.id).sort());
  const by = Object.fromEntries(groups.map((g) => [g.key, g.rows.map((b) => b.id)]));
  assert.deepEqual(groups.map((g) => g.key), ['sign', 'money', 'approve', 'answer']);
  assert.deepEqual([...by.sign].sort(), [`t:${T.signin}`, 'youtube'].sort());
  assert.deepEqual(by.money, [`t:${T.sponsorMoney}`, `a:${A.pay}`]); // sponsor item first
  assert.deepEqual(by.approve, [`t:${T.video}`, `a:${A.pub}`]); // videos, then oldest first
  assert.deepEqual(by.answer, [`q:${Q.b}`, `t:${T.plain}`, `q:${Q.a}`]); // sponsor question first, then oldest
  assert.equal(groupOf({ id: 'q:x', title: 'Approve this?' }), 'answer'); // questions are answered, not approved
  const html = renderBlockers(null, d3, {});
  assert.ok(html.indexOf('<h2>Needs you</h2>') < html.indexOf('<h2>Open blockers</h2>'));
  assert.match(html, new RegExp(`data-nact="a:${A.pub}"`));
  assert.match(html, new RegExp(`data-ndrop="${T.plain}"`));
  assert.match(html, new RegExp(`data-nlater="${Q.a}"`));
  assert.match(html, new RegExp(`href="#review" data-rvgo="q:${Q.a}">Answer`));
  assert.doesNotMatch(html, /data-ndrop="youtube"|data-nlater="youtube"/);
  assert.match(renderNeeds([], d3, {}), /Nothing needs you/);
  assert.equal(renderNeeds(null, d3, {}), '');
});

test('Not now: the item leaves Needs you, Blockers and the rail count for 24 hours, then comes back', async () => {
  const { db, env } = await setup();
  const before = await d3Of(env);
  assert.equal(before.d3.notNow, 0);
  const r = await post(env, `/needs/${T.plain}/later`);
  assert.equal(r.status, 200);
  assert.ok(Math.abs(Date.parse(r.body.until) - Date.parse(new Date().toISOString()) - 24 * 3600000) < 60000); // the API clock is real time
  const after = await d3Of(env);
  assert.ok(!youIds(after).includes(`t:${T.plain}`));
  assert.equal(after.d3.notNow, 1);
  assert.equal(railCounts(null, after).blockers, railCounts(null, before).blockers - 1);
  assert.match(renderNeeds(blockerRows(null, after), after, {}), /1 put off/);
  // A question and an approval put off the same way; their linked card gets the history line.
  assert.equal((await post(env, `/needs/${Q.a}/later`)).status, 200);
  assert.ok(db.sqlite.prepare("SELECT 1 FROM bot_task_events WHERE task_id = ? AND kind = 'needs'").get(T.doing));
  // Time up: back on the list.
  db.sqlite.prepare('UPDATE needs_later SET until = ?').run(H(1));
  const later = await d3Of(env);
  assert.ok(youIds(later).includes(`t:${T.plain}`) && youIds(later).includes(`q:${Q.a}`));
  assert.equal(later.d3.notNow, 0);
  // Table missing: list unchanged, put-off count says No feed (null).
  db.sqlite.exec('DROP TABLE needs_later');
  const gone = await d3Of(env);
  assert.equal(gone.d3.notNow, null);
  assert.deepEqual(youIds(gone), youIds(before));
});

test('Drop: a card closes, a question closes, an approval is rejected; each is written on the card', async () => {
  const { db, env } = await setup();
  assert.equal((await post(env, `/needs/${T.plain}/drop`)).status, 200);
  assert.equal(db.sqlite.prepare('SELECT status FROM bot_tasks WHERE id = ?').get(T.plain).status, 'cancelled');
  assert.ok(db.sqlite.prepare("SELECT 1 FROM bot_task_events WHERE task_id = ? AND kind = 'status'").get(T.plain));
  assert.equal((await post(env, `/needs/${Q.a}/drop`)).status, 200);
  const q = db.sqlite.prepare('SELECT status, closed_by FROM bot_questions WHERE id = ?').get(Q.a);
  assert.deepEqual({ ...q }, { status: 'closed', closed_by: 'jon' });
  assert.equal((await post(env, `/needs/${Q.a}/drop`)).status, 409); // already closed
  assert.equal((await post(env, `/needs/${A.pub}/drop`)).status, 200);
  assert.equal(db.sqlite.prepare('SELECT status FROM bot_approvals WHERE id = ?').get(A.pub).status, 'rejected');
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM bot_task_events WHERE task_id = ? AND kind = 'needs'").get(T.doing).n, 2);
  const d3 = await d3Of(env);
  for (const x of [`t:${T.plain}`, `q:${Q.a}`, `a:${A.pub}`]) assert.ok(!youIds(d3).includes(x), x);
  assert.equal((await post(env, `/needs/${id('t', 99)}/drop`)).status, 404);
});

test('Drop and Not now are Jon only', async () => {
  const { db, env } = await setup();
  assert.equal((await post(env, `/needs/${T.plain}/drop`, { bot: true })).status, 403);
  assert.equal((await post(env, `/needs/${A.pay}/later`, { bot: true })).status, 403);
  for (const opt of [{ anon: true }, { noCC: true }]) {
    for (const v of ['drop', 'later']) {
      const s = (await post(env, `/needs/${T.plain}/${v}`, opt)).status;
      assert.ok(s === 401 || s === 403, `${JSON.stringify(opt)} ${v} -> ${s}`);
    }
  }
  assert.equal(db.sqlite.prepare('SELECT status FROM bot_tasks WHERE id = ?').get(T.plain).status, 'waiting_on_jon');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM needs_later').get().n, 0);
});

test('Not now: refuses a closed item, clears expired rows, says so when the table is missing', async () => {
  const { db, env } = await setup();
  db.sqlite.prepare("INSERT INTO needs_later (item, until, \"by\", at) VALUES ('t_old', ?, 'jon', ?)").run(H(400), H(424)); // the route reads the real clock
  assert.equal((await post(env, `/needs/${Q.a}/drop`)).status, 200);
  assert.equal((await post(env, `/needs/${Q.a}/later`)).status, 409);
  assert.equal((await post(env, `/needs/${Q.b}/later`)).status, 200);
  assert.deepEqual(db.sqlite.prepare('SELECT item FROM needs_later').all().map((r) => r.item), [Q.b]);
  db.sqlite.exec('DROP TABLE needs_later');
  const r = await post(env, `/needs/${A.pay}/later`);
  assert.equal(r.status, 503);
});
