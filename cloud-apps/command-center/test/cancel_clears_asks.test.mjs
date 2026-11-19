// A cancelled card takes its asks with it (Jon, 2026-11-19): pending and approved approvals are cancelled, open questions
// close, one history line. Claimed (running) approvals and other cards' asks stay. Planted: a card with stale asks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const BOT = `ccb_${'d'.repeat(43)}`;
const AT = '2026-11-19T10:00:00.000Z';
const id = (p, n) => `${p}_${String(n).padStart(16, '0')}`;
const ins = (db, table, row) => {
  const keys = Object.keys(row);
  db.sqlite.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
};

// Card n with a pending, an approved and a claimed approval and an open question (ids n1..n4).
function card(db, n, status) {
  const t = id('t', n);
  ins(db, 'bot_tasks', { id: t, title: `Card ${n}`, owner: 'developer', status, note: '', created_by: 'ana', updated_by: 'developer', created_at: AT, updated_at: AT });
  const a = (k, s, extra = {}) => ins(db, 'bot_approvals', { id: id('a', n * 10 + k), action: 'ship_it', title: `ask ${n}.${k}`, requested_by: 'developer', task_id: t, status: s, created_at: AT, updated_at: AT, ...extra });
  a(1, 'pending');
  a(2, 'approved', { decided_by: 'jon', decided_at: AT });
  a(3, 'running', { decided_by: 'jon', decided_at: AT, claimed_by: 'developer', claimed_at: AT });
  ins(db, 'bot_questions', { id: id('q', n * 10 + 4), asked_by: 'developer', question: `q ${n}`, task_id: t, status: 'open', created_at: AT, updated_at: AT });
  return t;
}

async function setup() {
  const db = sqliteD1();
  await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(BOT), 'developer', AT).run();
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
async function call(env, method, path, { jon = false, body } = {}) {
  const h = new Headers({ 'Content-Type': 'application/json' });
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  else h.set('Authorization', `Bearer ${BOT}`);
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}
const appr = (db, n, k) => ({ ...db.sqlite.prepare('SELECT status, done_note FROM bot_approvals WHERE id = ?').get(id('a', n * 10 + k)) });
const quest = (db, n) => db.sqlite.prepare('SELECT status, closed_by, closed_at FROM bot_questions WHERE id = ?').get(id('q', n * 10 + 4));
const lines = (db, t) => db.sqlite.prepare("SELECT detail FROM bot_task_events WHERE task_id = ? AND detail LIKE 'card cancelled:%'").all(t).map((r) => r.detail);

test('bot cancel (dash.py task-update --status cancelled) withdraws the card\'s asks; another card keeps its own', async () => {
  const { db, env } = await setup();
  const A = card(db, 1, 'doing');
  const B = card(db, 2, 'doing');
  const r = await call(env, 'PATCH', `/tasks/${A}`, { body: { status: 'cancelled', note: 'not needed' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const pending = (await call(env, 'GET', '/approvals?status=pending')).body.approvals.map((x) => x.taskId);
  assert.ok(!pending.includes(A), 'no pending approval left on the cancelled card');
  assert.ok(pending.includes(B), 'card B keeps its pending approval');
  const open = (await call(env, 'GET', '/questions?status=open')).body.questions.map((x) => x.taskId);
  assert.ok(!open.includes(A), 'no open question left on the cancelled card');
  assert.ok(open.includes(B), 'card B keeps its open question');
  assert.deepEqual(appr(db, 1, 1), { status: 'cancelled', done_note: 'card cancelled' });
  assert.deepEqual(appr(db, 1, 2), { status: 'cancelled', done_note: 'card cancelled' }, 'approved but not claimed: withdrawn');
  assert.equal(appr(db, 1, 3).status, 'running', 'claimed approval untouched');
  assert.equal(quest(db, 1).status, 'closed');
  assert.equal(quest(db, 1).closed_by, 'developer');
  assert.ok(quest(db, 1).closed_at);
  assert.deepEqual(lines(db, A), ['card cancelled: withdrew 2 approvals, closed 1 questions']);
  assert.equal(appr(db, 2, 2).status, 'approved');
  assert.equal(quest(db, 2).status, 'open');
  assert.deepEqual(lines(db, B), []);
  // A second cancel of the same card changes nothing and adds no line.
  await call(env, 'PATCH', `/tasks/${A}`, { body: { status: 'cancelled', note: 'again' } });
  assert.equal(lines(db, A).length, 1);
});

test('Jon\'s Close card does the same; a card with no asks gets no extra history line', async () => {
  const { db, env } = await setup();
  const C = card(db, 3, 'review');
  const r = await call(env, 'PATCH', `/tasks/${C}`, { jon: true, body: { status: 'cancelled' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(appr(db, 3, 1).status, 'cancelled');
  assert.equal(appr(db, 3, 2).status, 'cancelled');
  assert.equal(appr(db, 3, 3).status, 'running');
  assert.equal(quest(db, 3).closed_by, 'jon');
  assert.deepEqual(lines(db, C), ['card cancelled: withdrew 2 approvals, closed 1 questions']);
  const E = id('t', 99);
  ins(db, 'bot_tasks', { id: E, title: 'Bare', owner: 'developer', status: 'doing', note: '', created_by: 'ana', updated_by: 'developer', created_at: AT, updated_at: AT });
  assert.equal((await call(env, 'PATCH', `/tasks/${E}`, { body: { status: 'cancelled', note: 'dup' } })).status, 200);
  assert.deepEqual(lines(db, E), []);
});

test('Review Discard withdraws approved asks too, and Undo puts each back as it was', async () => {
  const { db, env } = await setup();
  const D = card(db, 4, 'review');
  const d = await call(env, 'POST', '/review/discard', { jon: true, body: { item: `t:${D}` } });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(appr(db, 4, 1).status, 'cancelled');
  assert.equal(appr(db, 4, 2).status, 'cancelled');
  assert.equal(appr(db, 4, 3).status, 'running');
  assert.equal(quest(db, 4).status, 'closed');
  assert.equal(lines(db, D).length, 1);
  const u = await call(env, 'POST', '/review/undo', { jon: true, body: { item: `t:${D}` } });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(appr(db, 4, 1).status, 'pending');
  assert.deepEqual(appr(db, 4, 2), { status: 'approved', done_note: null });
  assert.equal(quest(db, 4).status, 'open');
});
