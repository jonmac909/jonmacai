import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';
import { botsFrom, newToken, hashOf, parseArgs, tokenSql } from '../scripts/bot-tokens.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TOKENS = {
  developer: `ccb_${'d'.repeat(43)}`,
  qc: `ccb_${'q'.repeat(43)}`,
  sponsors: `ccb_${'s'.repeat(43)}`,
  'video-editor': `ccb_${'v'.repeat(43)}`,
};
const REVOKED = `ccb_${'x'.repeat(43)}`;

async function setup() {
  const db = sqliteD1();
  const add = async (token, bot, revoked = null) => db.prepare(
    'INSERT INTO bot_tokens (token_hash, bot, created_at, revoked_at) VALUES (?, ?, ?, ?)',
  ).bind(await sha256Hex(token), bot, '2026-10-29T00:00:00.000Z', revoked).run();
  for (const [bot, token] of Object.entries(TOKENS)) await add(token, bot);
  await add(REVOKED, 'inbox', '2026-10-29T01:00:00.000Z');
  return { db, env: { DB: db, SESSION_SECRET: SECRET, MACHINE_TOKEN_GPU1: 'gpu1-machine-token' } };
}

const jonCookie = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;

function call(env, method, path, { bot, token, body, cookie, cc = true } = {}) {
  const headers = new Headers();
  const t = token || (bot && TOKENS[bot]);
  if (t) headers.set('Authorization', `Bearer ${t}`);
  if (cookie) headers.set('Cookie', cookie);
  if (cookie && cc) headers.set('X-CC', '1');
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const init = { method, headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, init), env).then(async (r) => ({ status: r.status, body: await r.json() }));
}

test('v1 needs a valid, unrevoked bot token or Jon\'s session', async () => {
  const { env } = await setup();
  assert.equal((await call(env, 'GET', '/me')).status, 401);
  assert.equal((await call(env, 'GET', '/me', { token: `ccb_${'z'.repeat(43)}` })).status, 401);
  assert.equal((await call(env, 'GET', '/me', { token: REVOKED })).status, 401);
  assert.equal((await call(env, 'GET', '/me', { token: 'gpu1-machine-token' })).status, 401, 'machine tokens are not bot tokens');
  // A bad Bearer token is refused even with a valid session cookie alongside it.
  assert.equal((await call(env, 'GET', '/me', { token: 'nope', cookie: await jonCookie() })).status, 401);
  const me = await call(env, 'GET', '/me', { bot: 'sponsors' });
  assert.deepEqual([me.status, me.body.bot, me.body.jon], [200, 'sponsors', false]);
  const jon = await call(env, 'GET', '/me', { cookie: await jonCookie() });
  assert.deepEqual([jon.status, jon.body.bot, jon.body.jon], [200, null, true]);
});

test('existing machine-token endpoints are unchanged', async () => {
  const { env } = await setup();
  const claim = (token) => handleApi(new Request('https://jonmac.ai/dashboard/api/actions/claim', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ machine: 'gpu1' }) }), env);
  const r = await claim('gpu1-machine-token');
  assert.equal(r.status, 200);
  const bot = await claim(TOKENS.developer);
  assert.equal(bot.status, 401, 'bot tokens do not open machine endpoints');
});

test('tasks: create, idempotent key, owner checks, list and update', async () => {
  const { env } = await setup();
  const made = await call(env, 'POST', '/tasks', { bot: 'developer', body: { title: '  Ship step 1 ', note: 'brief' } });
  assert.equal(made.status, 201);
  const t = made.body.task;
  assert.match(t.id, /^t_[0-9a-f]{16}$/);
  assert.deepEqual([t.title, t.owner, t.status, t.createdBy, t.updatedBy, t.doneAt], ['Ship step 1', 'developer', 'todo', 'developer', 'developer', null]);

  const forOther = await call(env, 'POST', '/tasks', { bot: 'developer', body: { title: 'Cut', owner: 'Video-Editor', key: 'cut-1' } });
  assert.deepEqual([forOther.status, forOther.body.task.owner], [201, 'video-editor']);
  const again = await call(env, 'POST', '/tasks', { bot: 'developer', body: { title: 'Cut (retry)', owner: 'video-editor', key: 'cut-1' } });
  assert.deepEqual([again.status, again.body.duplicate, again.body.task.id, again.body.task.title], [200, true, forOther.body.task.id, 'Cut']);
  const otherKey = await call(env, 'POST', '/tasks', { bot: 'sponsors', body: { title: 'Same key, other bot', key: 'cut-1' } });
  assert.equal(otherKey.status, 201, 'keys are per bot');

  assert.equal((await call(env, 'POST', '/tasks', { bot: 'developer', body: { title: 'x', owner: 'nobody' } })).status, 400);
  assert.equal((await call(env, 'POST', '/tasks', { bot: 'developer', body: { title: 'x', owner: 'inbox' } })).status, 400, 'revoked-only bot is unknown');
  assert.equal((await call(env, 'POST', '/tasks', { bot: 'developer', body: { title: 'x', status: 'done' } })).status, 400);
  assert.equal((await call(env, 'POST', '/tasks', { bot: 'developer', body: { title: 'x', status: 'later' } })).status, 400);
  assert.equal((await call(env, 'POST', '/tasks', { bot: 'developer', body: { title: '   ' } })).status, 400);
  assert.equal((await call(env, 'POST', '/tasks', { bot: 'developer', body: { title: 'x'.repeat(301) } })).status, 400);
  assert.equal((await call(env, 'POST', '/tasks', { bot: 'developer', body: '{bad' })).status, 400);
  assert.equal((await call(env, 'POST', '/tasks', { bot: 'developer', body: '[1]' })).status, 400);
  assert.equal((await call(env, 'POST', '/tasks', { cookie: await jonCookie(), body: { title: 'from Jon' } })).status, 403, 'creating is for bots');

  const upd = await call(env, 'PATCH', `/tasks/${t.id}`, { bot: 'qc', body: { status: 'doing', note: 'started' } });
  assert.deepEqual([upd.status, upd.body.task.status, upd.body.task.note, upd.body.task.updatedBy, upd.body.task.title], [200, 'doing', 'started', 'qc', 'Ship step 1']);
  assert.equal((await call(env, 'PATCH', `/tasks/${t.id}`, { bot: 'qc', body: {} })).status, 400);
  assert.equal((await call(env, 'PATCH', `/tasks/${t.id}`, { bot: 'qc', body: { owner: null } })).status, 400);
  assert.equal((await call(env, 'PATCH', '/tasks/t_0000000000000000', { bot: 'qc', body: { status: 'doing' } })).status, 404);
  assert.equal((await call(env, 'PATCH', '/tasks/not-an-id', { bot: 'qc', body: { status: 'doing' } })).status, 404);

  const mine = await call(env, 'GET', '/tasks?owner=me&status=doing,todo', { bot: 'developer' });
  assert.deepEqual(mine.body.tasks.map((x) => x.id), [t.id]);
  const ve = await call(env, 'GET', '/tasks?owner=video-editor', { cookie: await jonCookie() });
  assert.deepEqual(ve.body.tasks.map((x) => x.title), ['Cut']);
  assert.equal((await call(env, 'GET', '/tasks?owner=me', { cookie: await jonCookie() })).status, 400);
  assert.equal((await call(env, 'GET', '/tasks?status=nope', { bot: 'developer' })).status, 400);
  assert.equal((await call(env, 'GET', '/tasks?limit=1', { bot: 'developer' })).body.tasks.length, 1);
});

test('proof: kinds and links, QC-only checks, and qc/done need usable proof', async () => {
  const { env } = await setup();
  const { task } = (await call(env, 'POST', '/tasks', { bot: 'video-editor', body: { title: 'Render ep 4' } })).body;
  assert.equal((await call(env, 'PATCH', `/tasks/${task.id}`, { bot: 'video-editor', body: { status: 'qc' } })).status, 409);

  assert.equal((await call(env, 'POST', `/tasks/${task.id}/proofs`, { bot: 'video-editor', body: { kind: 'video', link: 'https://x.y/a' } })).status, 400);
  for (const link of ['javascript:alert(1)', 'data:text/html,hi', '//evil.example/x', 'ftp://x/y', 'notes.txt', 'https://a\nb']) {
    assert.equal((await call(env, 'POST', `/tasks/${task.id}/proofs`, { bot: 'video-editor', body: { kind: 'url', link } })).status, 400, link);
  }
  assert.equal((await call(env, 'POST', '/tasks/t_0000000000000000/proofs', { bot: 'video-editor', body: { kind: 'url', link: 'https://x.y' } })).status, 404);
  const p1 = await call(env, 'POST', `/tasks/${task.id}/proofs`, { bot: 'video-editor', body: { kind: 'render', link: 'D:\\renders\\ep 4.mp4', note: 'v1' } });
  assert.equal(p1.status, 201);
  assert.deepEqual([p1.body.proof.status, p1.body.proof.createdBy, p1.body.proof.link], ['pending', 'video-editor', 'D:\\renders\\ep 4.mp4']);

  const moved = await call(env, 'PATCH', `/tasks/${task.id}`, { bot: 'video-editor', body: { status: 'qc' } });
  assert.equal(moved.body.task.status, 'qc');

  const queue = await call(env, 'GET', '/proofs?status=pending', { bot: 'qc' });
  assert.deepEqual(queue.body.proofs.map((p) => p.id), [p1.body.proof.id]);

  assert.equal((await call(env, 'POST', `/proofs/${p1.body.proof.id}/check`, { bot: 'video-editor', body: { result: 'passed' } })).status, 403);
  assert.equal((await call(env, 'POST', `/proofs/${p1.body.proof.id}/check`, { cookie: await jonCookie(), body: { result: 'passed' } })).status, 403);
  assert.equal((await call(env, 'POST', `/proofs/${p1.body.proof.id}/check`, { bot: 'qc', body: { result: 'ok' } })).status, 400);
  assert.equal((await call(env, 'POST', '/proofs/p_0000000000000000/check', { bot: 'qc', body: { result: 'passed' } })).status, 404);
  assert.equal((await call(env, 'PATCH', `/tasks/${task.id}`, { bot: 'video-editor', body: { status: 'review' } })).status, 409, 'pending proof is not enough for review');
  const failed = await call(env, 'POST', `/proofs/${p1.body.proof.id}/check`, { bot: 'qc', body: { result: 'failed', note: 'audio drops at 3:10' } });
  assert.deepEqual([failed.status, failed.body.proof.status, failed.body.proof.checkedBy, failed.body.proof.checkNote], [200, 'failed', 'qc', 'audio drops at 3:10']);
  assert.deepEqual([failed.body.task.status, failed.body.task.updatedBy], ['doing', 'qc'], 'failing the only proof sends the task back to doing');

  assert.equal((await call(env, 'PATCH', `/tasks/${task.id}`, { bot: 'video-editor', body: { status: 'qc' } })).status, 409, 'only failed proof left');
  const p2 = (await call(env, 'POST', `/tasks/${task.id}/proofs`, { bot: 'video-editor', body: { kind: 'url', link: 'https://jonmac.ai/review/ep4-v2' } })).body.proof;
  assert.equal((await call(env, 'PATCH', `/tasks/${task.id}`, { bot: 'video-editor', body: { status: 'qc' } })).body.task.status, 'qc');
  const passed = await call(env, 'POST', `/proofs/${p2.id}/check`, { bot: 'qc', body: { result: 'passed' } });
  assert.equal(passed.body.task.status, 'review', 'passing moves a qc task to review');
  assert.equal((await call(env, 'PATCH', `/tasks/${task.id}`, { bot: 'qc', body: { status: 'done' } })).status, 403, 'only Jon sets done');
  const done = await call(env, 'PATCH', `/tasks/${task.id}`, { cookie: await jonCookie(), body: { status: 'done' } });
  assert.equal(done.body.task.status, 'done');
  assert.ok(done.body.task.doneAt);
  const refailed = await call(env, 'POST', `/proofs/${p2.id}/check`, { bot: 'qc', body: { result: 'failed', note: 'link 404s' } });
  assert.equal(refailed.body.task.status, 'done', "a late QC fail never reopens what Jon approved");

  const full = await call(env, 'GET', `/tasks/${task.id}`, { bot: 'sponsors' });
  assert.deepEqual(full.body.task.proofs.map((p) => [p.kind, p.status]), [['render', 'failed'], ['url', 'failed']]);

  const drop = (await call(env, 'POST', '/tasks', { bot: 'video-editor', body: { title: 'Test row' } })).body.task;
  assert.equal((await call(env, 'PATCH', `/tasks/${drop.id}`, { bot: 'video-editor', body: { status: 'cancelled' } })).status, 400, 'cancel needs a reason');
  const cancelled = await call(env, 'PATCH', `/tasks/${drop.id}`, { bot: 'video-editor', body: { status: 'cancelled', note: 'test row' } });
  assert.deepEqual([cancelled.status, cancelled.body.task.status, cancelled.body.task.note], [200, 'cancelled', 'test row']);
  assert.equal((await call(env, 'POST', '/tasks', { bot: 'video-editor', body: { title: 'x', status: 'cancelled' } })).status, 400);
});

test('questions: bots ask, only Jon answers (once), the asker reads and closes', async () => {
  const { env } = await setup();
  const { task } = (await call(env, 'POST', '/tasks', { bot: 'sponsors', body: { title: 'Pitch list' } })).body;
  assert.equal((await call(env, 'POST', '/questions', { bot: 'sponsors', body: { question: 'Which?', options: Array.from({ length: 11 }, (_, i) => `o${i}`) } })).status, 400);
  assert.equal((await call(env, 'POST', '/questions', { bot: 'sponsors', body: { question: 'Which?', options: 'A,B' } })).status, 400);
  assert.equal((await call(env, 'POST', '/questions', { bot: 'sponsors', body: { question: 'Which?', task: 't_0000000000000000' } })).status, 400);
  const asked = await call(env, 'POST', '/questions', {
    bot: 'sponsors', body: { question: 'Send the 20 pitches today?', options: ['Yes', ' ', 'No', 'Yes'], context: 'list attached', task: task.id, key: 'k1' },
  });
  assert.equal(asked.status, 201);
  const q = asked.body.question;
  assert.deepEqual([q.status, q.askedBy, q.options, q.taskId], ['open', 'sponsors', ['Yes', 'No'], task.id]);
  assert.equal((await call(env, 'POST', '/questions', { bot: 'sponsors', body: { question: 'dup', key: 'k1' } })).body.question.id, q.id);

  assert.equal((await call(env, 'POST', `/questions/${q.id}/answer`, { bot: 'sponsors', body: { answer: 'Yes' } })).status, 403, 'a bot cannot answer for Jon');
  const ck = await jonCookie();
  assert.equal((await call(env, 'POST', `/questions/${q.id}/answer`, { cookie: ck, cc: false, body: { answer: 'Yes' } })).status, 403, 'X-CC required');
  assert.equal((await call(env, 'POST', `/questions/${q.id}/answer`, { cookie: ck, body: { answer: ' ' } })).status, 400);
  assert.equal((await call(env, 'POST', '/questions/q_0000000000000000/answer', { cookie: ck, body: { answer: 'Yes' } })).status, 404);
  const ans = await call(env, 'POST', `/questions/${q.id}/answer`, { cookie: ck, body: { answer: 'Yes' } });
  assert.deepEqual([ans.status, ans.body.question.status, ans.body.question.answer, ans.body.question.answeredBy], [200, 'answered', 'Yes', 'jon']);
  const twice = await call(env, 'POST', `/questions/${q.id}/answer`, { cookie: ck, body: { answer: 'No' } });
  assert.deepEqual([twice.status, twice.body.question.answer], [409, 'Yes']);

  const read = await call(env, 'GET', `/questions/${q.id}`, { bot: 'sponsors' });
  assert.equal(read.body.question.answer, 'Yes');
  const answered = await call(env, 'GET', '/questions?asked_by=me&status=answered', { bot: 'sponsors' });
  assert.deepEqual(answered.body.questions.map((x) => x.id), [q.id]);

  assert.equal((await call(env, 'POST', `/questions/${q.id}/close`, { bot: 'developer' })).status, 403);
  const closed = await call(env, 'POST', `/questions/${q.id}/close`, { bot: 'sponsors' });
  assert.deepEqual([closed.status, closed.body.question.status, closed.body.question.closedBy, closed.body.question.answer], [200, 'closed', 'sponsors', 'Yes']);
  assert.equal((await call(env, 'POST', `/questions/${q.id}/close`, { bot: 'sponsors' })).status, 200, 'closing twice is harmless');

  const open = await call(env, 'POST', '/questions', { bot: 'sponsors', body: { question: 'Withdrawn?' } });
  await call(env, 'POST', `/questions/${open.body.question.id}/close`, { bot: 'sponsors' });
  assert.equal((await call(env, 'POST', `/questions/${open.body.question.id}/answer`, { cookie: ck, body: { answer: 'late' } })).status, 409);
});

test('approvals: nothing is done before Jon approves; bots never decide', async () => {
  const { env } = await setup();
  assert.equal((await call(env, 'POST', '/approvals', { bot: 'sponsors', body: { action: 'Send Pitches', title: 'x' } })).status, 400);
  assert.equal((await call(env, 'POST', '/approvals', { bot: 'sponsors', body: { action: 'send_pitches', title: 'x', payload: [1] } })).status, 400);
  assert.equal((await call(env, 'POST', '/approvals', { bot: 'sponsors', body: { action: 'send_pitches', title: 'x', payload: { blob: 'y'.repeat(70000) } } })).status, 400);
  const req = await call(env, 'POST', '/approvals', {
    bot: 'sponsors', body: { action: 'send_pitches', title: 'Send 20 pitches', payload: { count: 20, list: 'D:\\x.csv' }, key: 'pitch-1029' },
  });
  assert.equal(req.status, 201);
  const a = req.body.approval;
  assert.deepEqual([a.status, a.requestedBy, a.payload], ['pending', 'sponsors', { count: 20, list: 'D:\\x.csv' }]);
  assert.equal((await call(env, 'POST', '/approvals', { bot: 'sponsors', body: { action: 'send_pitches', title: 'again', key: 'pitch-1029' } })).body.approval.id, a.id);

  const early = await call(env, 'POST', `/approvals/${a.id}/claim`, { bot: 'sponsors' });
  assert.deepEqual([early.status, early.body.approval.status], [409, 'pending']);
  assert.equal((await call(env, 'POST', `/approvals/${a.id}/done`, { bot: 'sponsors' })).status, 409);
  assert.equal((await call(env, 'POST', `/approvals/${a.id}/decide`, { bot: 'sponsors', body: { decision: 'approve' } })).status, 403);
  assert.equal((await call(env, 'POST', `/approvals/${a.id}/decide`, { bot: 'qc', body: { decision: 'approve' } })).status, 403);
  assert.equal((await call(env, 'GET', '/approvals?status=approved', { bot: 'sponsors' })).body.approvals.length, 0);

  const ck = await jonCookie();
  assert.equal((await call(env, 'POST', `/approvals/${a.id}/decide`, { cookie: ck, cc: false, body: { decision: 'approve' } })).status, 403);
  assert.equal((await call(env, 'POST', `/approvals/${a.id}/decide`, { cookie: ck, body: { decision: 'maybe' } })).status, 400);
  const ok = await call(env, 'POST', `/approvals/${a.id}/decide`, { cookie: ck, body: { decision: 'approve', note: 'go' } });
  assert.deepEqual([ok.status, ok.body.approval.status, ok.body.approval.decidedBy], [200, 'approved', 'jon']);
  assert.equal((await call(env, 'POST', `/approvals/${a.id}/decide`, { cookie: ck, body: { decision: 'reject' } })).status, 409);

  const ready = await call(env, 'GET', '/approvals?status=approved&action=send_pitches&requested_by=me', { bot: 'sponsors' });
  assert.deepEqual(ready.body.approvals.map((x) => x.id), [a.id]);
  assert.equal((await call(env, 'POST', `/approvals/${a.id}/done`, { bot: 'sponsors' })).status, 409, 'claim first');
  assert.equal((await call(env, 'POST', `/approvals/${a.id}/claim`, { bot: 'developer' })).status, 403, 'only the bot that asked carries it out');
  const claims = await Promise.all([1, 2, 3].map(() => call(env, 'POST', `/approvals/${a.id}/claim`, { bot: 'sponsors' })));
  assert.deepEqual(claims.map((c) => c.status).sort(), [200, 409, 409], 'one claimer wins');
  const won = claims.find((c) => c.status === 200).body.approval;
  assert.deepEqual([won.status, won.claimedBy], ['running', 'sponsors']);
  assert.equal((await call(env, 'POST', `/approvals/${a.id}/cancel`, { bot: 'sponsors' })).status, 409, 'running cannot be cancelled');
  const released = await call(env, 'POST', `/approvals/${a.id}/release`, { bot: 'sponsors', body: { note: 'SMTP down' } });
  assert.deepEqual([released.body.approval.status, released.body.approval.claimedBy], ['approved', null]);
  await call(env, 'POST', `/approvals/${a.id}/claim`, { bot: 'sponsors' });
  assert.equal((await call(env, 'POST', `/approvals/${a.id}/done`, { bot: 'developer' })).status, 403);
  const done = await call(env, 'POST', `/approvals/${a.id}/done`, { bot: 'sponsors', body: { note: 'sent 20' } });
  assert.deepEqual([done.status, done.body.approval.status, done.body.approval.doneBy, done.body.approval.doneNote], [200, 'done', 'sponsors', 'sent 20']);
  assert.equal((await call(env, 'POST', `/approvals/${a.id}/done`, { bot: 'sponsors' })).status, 409, 'done once');
  assert.equal((await call(env, 'POST', `/approvals/${a.id}/release`, { bot: 'sponsors' })).status, 409);
  assert.equal((await call(env, 'GET', '/approvals?status=approved', { bot: 'sponsors' })).body.approvals.length, 0);

  const other = (await call(env, 'POST', '/approvals', { bot: 'sponsors', body: { action: 'publish_draft', title: 'Publish ep 4' } })).body.approval;
  assert.equal((await call(env, 'POST', `/approvals/${other.id}/cancel`, { bot: 'developer' })).status, 403);
  const cancelled = await call(env, 'POST', `/approvals/${other.id}/cancel`, { bot: 'sponsors', body: { note: 'test row' } });
  assert.deepEqual([cancelled.status, cancelled.body.approval.status], [200, 'cancelled']);
  assert.equal((await call(env, 'POST', `/approvals/${other.id}/decide`, { cookie: ck, body: { decision: 'approve' } })).status, 409);
  assert.equal((await call(env, 'POST', `/approvals/${other.id}/done`, { bot: 'sponsors' })).status, 409);
  assert.equal((await call(env, 'POST', '/approvals/a_0000000000000000/done', { bot: 'sponsors' })).status, 404);
});

test('runs: a bot reports only its own runs', async () => {
  const { env } = await setup();
  const r = await call(env, 'POST', '/runs', {
    bot: 'developer', body: { started: '2026-10-29T10:00:00-07:00', ended: '2026-10-29T10:20:00-07:00', status: 'ok', tokens: 120000 },
  });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.run.bot, r.body.run.startedAt, r.body.run.tokens], ['developer', '2026-10-29T17:00:00.000Z', 120000]);
  assert.equal((await call(env, 'POST', '/runs', { bot: 'developer', body: { bot: 'qc', status: 'ok' } })).status, 403);
  assert.equal((await call(env, 'POST', '/runs', { bot: 'developer', body: { status: 'great' } })).status, 400);
  assert.equal((await call(env, 'POST', '/runs', { bot: 'developer', body: { status: 'ok', tokens: -1 } })).status, 400);
  assert.equal((await call(env, 'POST', '/runs', { bot: 'developer', body: { status: 'ok', tokens: 1.5 } })).status, 400);
  assert.equal((await call(env, 'POST', '/runs', { bot: 'developer', body: { status: 'ok', started: 'yesterday' } })).status, 400);
  assert.equal((await call(env, 'POST', '/runs', {
    bot: 'developer', body: { status: 'failed', started: '2026-10-29T10:00:00Z', ended: '2026-10-29T09:00:00Z' },
  })).status, 400);
  await call(env, 'POST', '/runs', { bot: 'qc', body: { status: 'failed', error: 'render missing' } });
  const mine = await call(env, 'GET', '/runs?bot=me', { bot: 'developer' });
  assert.deepEqual(mine.body.runs.map((x) => x.bot), ['developer']);
  const failed = await call(env, 'GET', '/runs?status=failed', { cookie: await jonCookie() });
  assert.deepEqual(failed.body.runs.map((x) => [x.bot, x.error]), [['qc', 'render missing']]);
});

test('unknown routes, large bodies and missing tables', async () => {
  const { env } = await setup();
  assert.equal((await call(env, 'GET', '/nope', { bot: 'developer' })).status, 404);
  assert.equal((await call(env, 'DELETE', '/tasks', { bot: 'developer' })).status, 404);
  assert.equal((await call(env, 'GET', '/tasks/t_0000000000000000/proofs/x', { bot: 'developer' })).status, 404);
  assert.equal((await call(env, 'POST', '/tasks', { bot: 'developer', body: JSON.stringify({ title: 'x', note: 'y'.repeat(300 * 1024) }) })).status, 413);

  const bare = { prepare: () => ({ bind() { return this; }, async first() { throw new Error('D1_ERROR: no such table: bot_tokens'); } }) };
  const r = await call({ DB: bare }, 'GET', '/me', { bot: 'developer' });
  assert.deepEqual([r.status, r.body.error], [503, 'Bot tables are not set up yet']);
});

test('token script: slugs come from BOTS.md rules files; issued tokens pass the API check', async () => {
  const md = [
    '| Bot | Rules file | OpenBot workspace |', '| --- | --- | --- |',
    '| Ana | areas/ana.md | C:\\a |', '| Viral View | areas/viral-view.md | C:\\b |', '| Ana again | areas/ana.md | C:\\c |',
  ].join('\n');
  assert.deepEqual(botsFrom(md), [{ name: 'Ana', slug: 'ana' }, { name: 'Viral View', slug: 'viral-view' }]);
  const token = newToken();
  assert.match(token, /^ccb_[A-Za-z0-9_-]{43}$/);
  assert.equal(hashOf(token), await sha256Hex(token));
  const db = sqliteD1();
  for (const sql of tokenSql('viral-view', hashOf(token), '2026-10-29T00:00:00.000Z')) db.sqlite.exec(sql);
  assert.equal((await call({ DB: db }, 'GET', '/me', { token })).body.bot, 'viral-view');
  // Rotation: registering a new token file revokes the old hash.
  const next = newToken();
  for (const sql of tokenSql('viral-view', hashOf(next), '2026-10-29T01:00:00.000Z')) db.sqlite.exec(sql);
  assert.equal((await call({ DB: db }, 'GET', '/me', { token })).status, 401);
  assert.equal((await call({ DB: db }, 'GET', '/me', { token: next })).body.bot, 'viral-view');
  for (const sql of tokenSql('viral-view', hashOf(next), '2026-10-29T02:00:00.000Z')) db.sqlite.exec(sql);
  assert.equal((await call({ DB: db }, 'GET', '/me', { token: next })).status, 200, 're-running keeps the current token');

  assert.equal(parseArgs(['--env=preview']).env, 'preview');
  assert.equal(parseArgs(['--env', 'preview', '--dry-run'])['dry-run'], true);
  assert.equal(parseArgs(['--rotate', 'qc']).rotate, 'qc');
  assert.throws(() => parseArgs(['--env=prod']));
  assert.throws(() => parseArgs(['--enviro', 'preview']));
  assert.throws(() => parseArgs(['preview']));
  assert.throws(() => parseArgs(['--env']));
  assert.throws(() => parseArgs(['--rotate', 'qc', '--env', 'preview']));
  assert.throws(() => parseArgs(['--out', 'C:\\tmp\\t']));
  assert.equal(parseArgs(['--out', 'C:\\tmp\\t', '--dry-run']).out, 'C:\\tmp\\t');
});

test('workers.dev answers only on the preview Worker', async () => {
  const req = () => new Request('https://jonmac-command-center-preview.example.workers.dev/dashboard/api/v1/me');
  const prod = await worker.fetch(req(), { DB: sqliteD1() }, {});
  assert.equal(prod.status, 404);
  assert.equal(await prod.text(), 'Not found');
  const preview = await worker.fetch(req(), { DB: sqliteD1(), PREVIEW: '1' }, {});
  assert.equal(preview.status, 401, 'reaches the API, which then asks for a token');
});
