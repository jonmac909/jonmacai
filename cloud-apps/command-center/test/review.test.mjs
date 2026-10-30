// Review stage (2026-10-30): todo/doing → qc → review (QC passed) → done (Jon approved), or back to
// doing with Jon's comment. Bots never set done.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleApi } from '../src/api.js';
import { sha256Hex, todayData } from '../src/bots.js';
import { buildProjects } from '../src/projects.js';
import { signSession, COOKIE } from '../src/auth.js';
import { taskModal } from '../public/js/modals.js';
import { render as renderProjects } from '../public/js/pages/projects.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TOK = { sponsors: `ccb_${'s'.repeat(43)}`, qc: `ccb_${'q'.repeat(43)}` };
const HOOKS = { sponsors: { url: 'https://hooks.example/sponsors', secret: 'whsec_sponsors-test' } };

async function setup() {
  const db = sqliteD1();
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  return { db, env: { DB: db, SESSION_SECRET: SECRET, WEBHOOKS: JSON.stringify(HOOKS) } };
}
async function call(env, method, path, { bot, body, jon, cc = true } = {}) {
  const h = new Headers();
  if (bot) h.set('Authorization', `Bearer ${TOK[bot]}`);
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); if (cc) h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}
function mockFetch(t) {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response(null, { status: 202 }); };
  t.after(() => { globalThis.fetch = real; });
  return sent;
}
const patch = (env, id, who, body) => call(env, 'PATCH', `/tasks/${id}`, { ...who, body });
const history = async (env, id) => (await call(env, 'GET', `/tasks/${id}`, { jon: true })).body.task.history.map((h) => [h.by, h.kind, h.detail]);

// A sponsors task in qc with one proof; `pass` has QC pass it (which moves it to review).
async function inQc(env, pass = false, link = 'https://jonmac.ai/review/r1') {
  const task = (await call(env, 'POST', '/tasks', { bot: 'sponsors', body: { title: 'Pitch deck', project: 'sponsors', status: 'doing' } })).body.task;
  const proof = (await call(env, 'POST', `/tasks/${task.id}/proofs`, { bot: 'sponsors', body: { kind: 'render', link } })).body.proof;
  await patch(env, task.id, { bot: 'sponsors' }, { status: 'qc' });
  if (pass) await call(env, 'POST', `/proofs/${proof.id}/check`, { bot: 'qc', body: { result: 'passed' } });
  return { task, proof };
}

test('QC passing a qc task moves it to review, with a history row; bots never set done', async () => {
  const { env } = await setup();
  const { task, proof } = await inQc(env);
  assert.equal((await patch(env, task.id, { bot: 'sponsors' }, { status: 'review' })).status, 409, 'review needs a QC-passed proof');
  const done = await patch(env, task.id, { bot: 'sponsors' }, { status: 'done' });
  assert.equal(done.status, 403);
  assert.match(done.body.error, /Jon approves/);

  const passed = await call(env, 'POST', `/proofs/${proof.id}/check`, { bot: 'qc', body: { result: 'passed' } });
  assert.deepEqual([passed.status, passed.body.task.status, passed.body.task.updatedBy, passed.body.task.doneAt], [200, 'review', 'qc', null]);
  assert.deepEqual((await history(env, task.id)).slice(-2), [['qc', 'check', 'proof passed'], ['qc', 'status', 'status qc → review (QC passed)']]);
  assert.equal((await patch(env, task.id, { bot: 'qc' }, { status: 'done' })).status, 403, 'not even QC');

  // A pass on a task that is not in qc leaves it where it is; with that proof the bot may set review itself.
  const other = (await call(env, 'POST', '/tasks', { bot: 'sponsors', body: { title: 'Other', status: 'doing' } })).body.task;
  assert.equal((await patch(env, other.id, { bot: 'sponsors' }, { status: 'review' })).status, 409, 'no proof at all');
  const p = (await call(env, 'POST', `/tasks/${other.id}/proofs`, { bot: 'sponsors', body: { kind: 'url', link: 'https://x.example/o' } })).body.proof;
  assert.equal((await call(env, 'POST', `/proofs/${p.id}/check`, { bot: 'qc', body: { result: 'passed' } })).body.task.status, 'doing');
  const self = await patch(env, other.id, { bot: 'sponsors' }, { status: 'review' });
  assert.deepEqual([self.status, self.body.task.status], [200, 'review']);
});

test('after a send-back, an old passed proof cannot move the task to review again; a done task never moves', async () => {
  const { env } = await setup();
  const { task, proof } = await inQc(env, true);
  const back = await patch(env, task.id, { jon: true }, { status: 'doing', comment: 'Tighten the intro' });
  assert.equal(back.body.task.status, 'doing');
  const skip = await patch(env, task.id, { bot: 'sponsors' }, { status: 'review' });
  assert.equal(skip.status, 409, 'the pass from before the send-back does not count');
  const p2 = (await call(env, 'POST', `/tasks/${task.id}/proofs`, { bot: 'sponsors', body: { kind: 'url', link: 'https://example.com/v2' } })).body.proof;
  await patch(env, task.id, { bot: 'sponsors' }, { status: 'qc' });
  const passed = await call(env, 'POST', `/proofs/${p2.id}/check`, { bot: 'qc', body: { result: 'passed' } });
  assert.equal(passed.body.task.status, 'review', 'a new pass after the send-back moves it on');
  await patch(env, task.id, { jon: true }, { status: 'done' });
  assert.equal((await patch(env, task.id, { bot: 'sponsors' }, { status: 'doing' })).status, 409, "bots can't undo Jon's approval");
  const late = await call(env, 'POST', `/proofs/${proof.id}/check`, { bot: 'qc', body: { result: 'failed' } });
  assert.equal(late.body.task.status, 'done', "a late QC fail doesn't reopen what Jon approved");
});

test('QC failing the last passed proof sends a review task back to doing', async () => {
  const { env } = await setup();
  const { task, proof } = await inQc(env, true);
  const failed = await call(env, 'POST', `/proofs/${proof.id}/check`, { bot: 'qc', body: { result: 'failed', note: 'wrong cut' } });
  assert.deepEqual([failed.body.task.status, failed.body.task.updatedBy], ['doing', 'qc']);
  assert.deepEqual((await history(env, task.id)).at(-1), ['qc', 'status', 'status review → doing (QC failed)']);
});

test('Jon approves a review task: done, done_at, by jon, "approved by Jon"; nothing else of a bot\'s', async () => {
  const { env } = await setup();
  const { task } = await inQc(env, true);
  assert.equal((await patch(env, task.id, { jon: true, cc: false }, { status: 'done' })).status, 403, 'X-CC required');
  const ok = await patch(env, task.id, { jon: true }, { status: 'done' });
  assert.deepEqual([ok.status, ok.body.task.status, ok.body.task.updatedBy, !!ok.body.task.doneAt], [200, 'done', 'jon', true]);
  assert.deepEqual((await history(env, task.id)).at(-1), ['jon', 'status', 'status review → done (approved by Jon)']);
  assert.equal((await patch(env, task.id, { jon: true }, { status: 'done' })).status, 409, 'once');

  const doing = (await call(env, 'POST', '/tasks', { bot: 'sponsors', body: { title: 'Not reviewed', status: 'doing' } })).body.task;
  const refused = await patch(env, doing.id, { jon: true }, { status: 'done' });
  assert.deepEqual([refused.status, refused.body.error, refused.body.task.status], [409, 'Task is doing; only a task in review can be approved', 'doing']);
  const { task: inqc } = await inQc(env);
  assert.equal((await patch(env, inqc.id, { jon: true }, { status: 'done' })).status, 409, 'not from qc either');
});

test('Jon sends a review task back: the comment is stored and wakes the owner with sentBack; the task is doing', async (t) => {
  const sent = mockFetch(t);
  const { env } = await setup();
  const { task } = await inQc(env, true);
  for (const body of [{ status: 'doing' }, { status: 'doing', comment: '   ' }, { status: 'doing', comment: 'x'.repeat(4001) }]) {
    assert.equal((await patch(env, task.id, { jon: true }, body)).status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal(sent.length, 0);

  const back = await patch(env, task.id, { jon: true }, { status: 'doing', comment: '  Make the logo bigger  ' });
  assert.deepEqual([back.status, back.body.task.status, back.body.task.updatedBy, back.body.task.doneAt], [200, 'doing', 'jon', null]);
  assert.deepEqual([back.body.comment.author, back.body.comment.body, back.body.comment.wakeStatus], ['jon', 'Make the logo bigger', '202']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, HOOKS.sponsors.url);
  const event = JSON.parse(sent[0].init.body);
  assert.deepEqual([event.type, event.data.task, event.data.comment, event.data.commentId, event.data.sentBack], ['card_comment', task.id, 'Make the logo bigger', back.body.comment.id, true]);
  assert.equal(sent[0].init.headers['x-openbot-delivery-id'], back.body.comment.id);

  const read = (await call(env, 'GET', `/tasks/${task.id}`, { bot: 'sponsors' })).body.task;
  assert.deepEqual(read.comments.map((c) => [c.author, c.body, c.wakeStatus]), [['jon', 'Make the logo bigger', '202']]);
  assert.deepEqual((await history(env, task.id)).slice(-2), [['jon', 'status', 'status review → doing (sent back by Jon)'], ['jon', 'comment', 'commented']]);
  assert.equal((await patch(env, task.id, { jon: true }, { status: 'doing', comment: 'again' })).status, 409, 'only from review');
  assert.equal(sent.length, 1, 'a refused send-back wakes no one and stores nothing');
  assert.equal((await call(env, 'GET', `/tasks/${task.id}`, { jon: true })).body.task.comments.length, 1);

  // A plain comment still carries no sentBack.
  await call(env, 'POST', `/tasks/${task.id}/comments`, { jon: true, body: { body: 'thanks' } });
  assert.equal(JSON.parse(sent[1].init.body).data.sentBack, undefined);
});

test('deliverable: the newest QC-passed proof, else the newest proof; on GET /tasks/:id and the board data', async () => {
  const { db, env } = await setup();
  const { task, proof } = await inQc(env, false, 'https://jonmac.ai/review/v1');
  const get = async (id) => (await call(env, 'GET', `/tasks/${id}`, { jon: true })).body.task.deliverable;
  assert.deepEqual(await get(task.id), { link: 'https://jonmac.ai/review/v1', kind: 'render', web: true }, 'none passed: the newest');
  await call(env, 'POST', `/proofs/${proof.id}/check`, { bot: 'qc', body: { result: 'passed' } });
  await call(env, 'POST', `/tasks/${task.id}/proofs`, { bot: 'sponsors', body: { kind: 'pdf', link: 'D:\\out\\later.pdf' } });
  assert.deepEqual(await get(task.id), { link: 'https://jonmac.ai/review/v1', kind: 'render', web: true }, 'the passed one beats a newer pending one');
  const local = (await call(env, 'POST', '/tasks', { bot: 'sponsors', body: { title: 'Local', status: 'doing' } })).body.task;
  await call(env, 'POST', `/tasks/${local.id}/proofs`, { bot: 'sponsors', body: { kind: 'render', link: 'D:\\renders\\a.mp4' } });
  const none = (await call(env, 'POST', '/tasks', { bot: 'sponsors', body: { title: 'None' } })).body.task;
  assert.deepEqual([await get(local.id), await get(none.id)], [{ link: 'D:\\renders\\a.mp4', kind: 'render', web: false }, null]);

  const board = Object.fromEntries((await todayData(db, Date.now(), '2026-10')).tasks.map((x) => [x.id, x.deliverable]));
  assert.deepEqual(board, { [task.id]: await get(task.id), [local.id]: await get(local.id), [none.id]: null });
});

const row = (id, status, more = {}) => ({ id, title: `Task ${id}`, project: 'sponsors', owner: 'sponsors', status, createdAt: '2026-10-29T17:00:00Z', doneAt: null, proofLink: null, deliverable: null, ...more });

test('board: a Review column between QC and Done, counted as waiting on Jon; Review cards have Approve and Send back, no checkbox', () => {
  const NOW = Date.parse('2026-10-29T19:00:00Z');
  const out = { pages: { projects: {} } };
  const tasks = [
    row('t_r1', 'review', { title: 'Cut <ep 4>', deliverable: { link: 'https://jonmac.ai/review/4?a=1&b="2"', kind: 'render', web: true } }),
    row('t_r2', 'review', { deliverable: { link: 'D:\\renders\\<ep5>.mp4', kind: 'render', web: false } }),
    row('t_d1', 'done', { doneAt: '2026-10-29T10:00:00Z', deliverable: { link: 'javascript:alert(1)', kind: 'url', web: true }, proofLink: 'https://x.example/p' }),
    row('t_q1', 'qc', { deliverable: { link: 'https://x.example/q', kind: 'url', web: true }, proofLink: 'https://x.example/q' }),
  ];
  buildProjects(out, {}, { available: false }, { today: { tasks, questions: [], approvals: [], feeds: {} } }, NOW);
  const lane = out.pages.projects.projects[0];
  assert.deepEqual(lane.columns.map((c) => c.key), ['todo', 'doing', 'waiting_on_jon', 'qc', 'review', 'done']);
  assert.deepEqual([lane.columns[4].items.map((i) => i.id), lane.waiting], [['t_r1', 't_r2'], 2], 'review waits on Jon');
  assert.deepEqual([lane.columns[4].items[0].reviewUrl, lane.columns[5].items[0].reviewUrl], ['/dashboard/api/v1/tasks/t_r1', undefined]);

  const html = renderProjects(out.pages.projects, {}, 'sponsors');
  const col = (key) => html.match(new RegExp(`<section class="pjcol pjcol-${key}">.*?</section>`, 's'))[0];
  const review = col('review');
  assert.match(review, /<a class="pjdeliv" href="https:\/\/jonmac.ai\/review\/4\?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noopener">Watch video<\/a>/);
  assert.match(review, /<span class="pjdeliv">Local file: &lt;ep5&gt;\.mp4<\/span>/);
  assert.equal((review.match(/href=/g) || []).length, 1, 'a local path is never a link');
  assert.equal((review.match(/data-ttick="\/dashboard\/api\/v1\/tasks\/t_r\d" data-confirm="Approve &quot;[^"]*&quot;\? It moves to Done\.">Approve</g) || []).length, 2);
  assert.match(review, /data-confirm="Approve &quot;Cut &lt;ep 4&gt;&quot;\? It moves to Done\."/, 'escaped');
  assert.deepEqual([...review.matchAll(/data-sendback="([^"]+)">Send back</g)].map((m) => m[1]), ['t_r1', 't_r2']);
  assert.doesNotMatch(review, /<input|checkbox|<ep/);
  assert.equal((review.match(/<button type="button" class="pjx" data-tclose="\/dashboard\/api\/v1\/tasks\/t_r\d" data-title="[^"]*" aria-label="Close &quot;[^"]*&quot;"/g) || []).length, 2, 'Close on each card');
  const done = col('done');
  assert.doesNotMatch(done, /href="javascript|data-ttick|data-sendback|data-tclose|>Proof</, 'a non-http deliverable is text, and Done has no buttons');
  assert.match(done, /<span class="pjdeliv">Local file: javascript:alert\(1\)<\/span>/);
  assert.match(col('qc'), />Proof<\/a>/);
  assert.doesNotMatch(col('qc'), /pjdeliv/, 'the deliverable shows on Review and Done cards only');
});

test('card modal: deliverable on top, Approve and Send back in review; Done only on Jon\'s own open task', () => {
  const base = { id: 't_0123456789abcdef', title: 'Cut "4"', owner: 'sponsors', project: 'sponsors', proofs: [], history: [], comments: [], asks: [] };
  const html = taskModal({ ...base, status: 'review', deliverable: { link: 'https://jonmac.ai/review/4', kind: 'url', web: true } }, 'Sponsors');
  assert.match(html, /^<h2>Cut &quot;4&quot;<\/h2><p class="cmmeta">Florence · Ready for your review · Sponsors<\/p><section class="cmact"><h3>Your move<\/h3><div class="qopts"><a class="pjdeliv btn line" href="https:\/\/jonmac.ai\/review\/4" target="_blank" rel="noopener">Watch video<\/a>/);
  assert.match(html, /data-ttick="\/dashboard\/api\/v1\/tasks\/t_0123456789abcdef" data-confirm="Approve &quot;Cut &quot;4&quot;&quot;\? It moves to Done\.">Approve/);
  assert.match(html, /data-tback="\/dashboard\/api\/v1\/tasks\/t_0123456789abcdef">Send back/);
  assert.doesNotMatch(html, /type="checkbox"|>Done</);
  const local = taskModal({ ...base, status: 'done', deliverable: { link: 'D:\\a.mp4', kind: 'render', web: false } }, 'Sponsors');
  assert.match(local, /<p class="cmdeliv"><span class="pjdeliv">Local file: a\.mp4<\/span><\/p>/);
  assert.doesNotMatch(local, /href=|data-ttick|data-tback/);
  assert.doesNotMatch(taskModal({ ...base, status: 'doing', deliverable: { link: 'https://x.example', kind: 'url', web: true } }, 'Sponsors'), /cmdeliv|pjdeliv|Your move/, 'nothing for Jon to do while a bot works');
  const jon = { ...base, owner: 'jon' };
  assert.match(taskModal({ ...jon, status: 'waiting_on_jon' }, 'Sponsors'), /data-ttick[^>]*>Done</);
  for (const status of ['qc', 'done', 'cancelled']) assert.doesNotMatch(taskModal({ ...jon, status }, 'Sponsors'), /data-ttick/, status);
});

test('migration 0012 run twice moves bot tasks from done to review once, with one history row each', async () => {
  const { db } = await setup(); // the migrations already ran once, on empty tables
  const add = (id, owner, status, doneAt = null) => db.prepare(`INSERT INTO bot_tasks (id, title, owner, status, created_by, updated_by, created_at, updated_at, done_at)
    VALUES (?, 'x', ?, ?, 'ana', 'ana', '2026-10-20T10:00:00.000Z', '2026-10-20T10:00:00.000Z', ?)`).bind(id, owner, status, doneAt).run();
  await add('t_000000000000000a', 'sponsors', 'done', '2026-10-29T10:00:00.000Z');
  await add('t_000000000000000b', 'jon', 'done', '2026-10-29T10:00:00.000Z');
  await add('t_000000000000000c', 'sponsors', 'doing');
  await add('t_000000000000000d', 'sponsors', 'done', '2026-10-30T10:00:00.000Z'); // approved by Jon under the new flow
  await db.prepare(`INSERT INTO bot_task_events (id, task_id, at, "by", kind, detail) VALUES ('e_1', 't_000000000000000d', 'x', 'jon', 'status', 'status review → done (approved by Jon)')`).bind().run();
  const sql = readFileSync(new URL('../migrations/0012_review_stage.sql', import.meta.url), 'utf8');
  db.sqlite.exec(sql);
  db.sqlite.exec(sql);
  const { results: tasks } = await db.prepare('SELECT id, status, done_at, updated_by FROM bot_tasks ORDER BY id').all();
  assert.deepEqual(tasks.map((x) => [x.id.slice(-1), x.status, x.done_at, x.updated_by]), [
    ['a', 'review', '2026-10-29T10:00:00.000Z', 'developer'], ['b', 'done', '2026-10-29T10:00:00.000Z', 'ana'], ['c', 'doing', null, 'ana'], ['d', 'done', '2026-10-30T10:00:00.000Z', 'ana'],
  ]);
  const { results: events } = await db.prepare("SELECT * FROM bot_task_events WHERE \"by\" = 'developer'").all();
  assert.deepEqual(events.map((e) => [e.task_id, e.kind, e.detail]), [['t_000000000000000a', 'status', 'status done → review (Review stage added; was done 2026-10-29T10:00:00.000Z)']]);
  assert.match(events[0].id, /^e_[0-9a-f]{16}$/);
  assert.ok(Number.isFinite(Date.parse(events[0].at)));
});

test('Jon closes a card: any unfinished task, with or without a reason; a reason wakes the owner with closed; bots cannot reopen it', async (t) => {
  const sent = mockFetch(t);
  const { env } = await setup();
  const { task } = await inQc(env);
  assert.equal((await patch(env, task.id, { jon: true, cc: false }, { status: 'cancelled' })).status, 403, 'X-CC required');
  const closed = await patch(env, task.id, { jon: true }, { status: 'cancelled' });
  assert.deepEqual([closed.status, closed.body.task.status, closed.body.task.updatedBy, closed.body.comment], [200, 'cancelled', 'jon', undefined]);
  assert.equal(sent.length, 0, 'no reason, no wake');
  assert.deepEqual((await history(env, task.id)).at(-1), ['jon', 'status', 'status qc → cancelled (closed by Jon)']);
  assert.equal((await patch(env, task.id, { jon: true }, { status: 'cancelled' })).status, 409, 'already closed');
  for (const body of [{ status: 'doing' }, { note: 'still going' }]) {
    assert.equal((await patch(env, task.id, { bot: 'sponsors' }, body)).status, 409, `bots can't reopen: ${JSON.stringify(body)}`);
  }

  const { task: other } = await inQc(env, true); // in review, with an open question and a pending approval
  const q = (await call(env, 'POST', '/questions', { bot: 'sponsors', body: { question: 'Which cut?', task: other.id } })).body.question;
  const a = (await call(env, 'POST', '/approvals', { bot: 'sponsors', body: { action: 'send_pitches', title: 'Send 3 pitches', payload: { count: 3 }, task: other.id } })).body.approval;
  const why = await patch(env, other.id, { jon: true }, { status: 'cancelled', comment: ' Not needed any more ' });
  assert.deepEqual([why.status, why.body.task.status, why.body.comment.body], [200, 'cancelled', 'Not needed any more']);
  const event = JSON.parse(sent[0].init.body);
  assert.deepEqual([event.data.task, event.data.closed, event.data.sentBack], [other.id, true, undefined]);
  const asks = (await call(env, 'GET', `/tasks/${other.id}`, { jon: true })).body.task.asks;
  assert.deepEqual(asks, [], 'its question and approval closed with it');
  assert.equal((await call(env, 'GET', `/questions/${q.id}`, { bot: 'sponsors' })).body.question.status, 'closed');
  assert.equal((await call(env, 'GET', `/approvals/${a.id}`, { bot: 'sponsors' })).body.approval.status, 'cancelled');

  const { task: done } = await inQc(env, true);
  await patch(env, done.id, { jon: true }, { status: 'done' });
  assert.equal((await patch(env, done.id, { jon: true }, { status: 'cancelled' })).status, 409, 'done is final');
});

test('card modal: Close card on unfinished tasks only; Jon reads You; proof is a chip, a button and one line, the rest behind Details', () => {
  const base = { id: 't_0123456789abcdef', title: 'Cut "4"', owner: 'jon', note: '', proofs: [], history: [], comments: [], asks: [] };
  for (const status of ['todo', 'doing', 'waiting_on_jon', 'qc', 'review']) {
    assert.match(taskModal({ ...base, status }, 'Sponsors'), /data-tclose="\/dashboard\/api\/v1\/tasks\/t_0123456789abcdef" data-title="Cut &quot;4&quot;">Close card</, status);
  }
  for (const status of ['done', 'cancelled']) assert.doesNotMatch(taskModal({ ...base, status }, 'Sponsors'), /data-tclose/, status);
  assert.match(taskModal({ ...base, status: 'doing' }, 'Sponsors'), /<p class="cmmeta">You · Doing · Sponsors<\/p>/);

  const proofs = [
    { link: 'https://docs.google.com/document/d/x', kind: 'url', status: 'passed', note: '**What happened**\n- **Script** v2: hook rewritten\n- 3 beats', checkNote: 'All 12 references checked. Report: D:\\AgentTeam\\qc\\REPORT.md' },
    { link: 'D:\\AgentTeam\\renders\\cut.mp4', kind: 'render', status: 'pending', note: 'Short one' },
  ];
  const history = [{ at: '2026-10-30T10:00:00Z', by: 'sponsors', kind: 'owner', detail: 'owner sponsors → video-editor' }, { at: '2026-10-30T11:00:00Z', by: 'qc', kind: 'status', detail: 'status qc → review' }];
  const html = taskModal({ ...base, status: 'review', proofs, history }, 'Sponsors');
  assert.match(html, /<li><div class="cmrow"><span class="pill ok">QC passed<\/span><a class="btn line cmopen" [^>]*>Open doc<\/a><\/div><p class="cmsmall cmone"><strong>Script<\/strong> v2: hook rewritten<\/p><details class="cmdet"><summary>Details<\/summary>.*3 beats.*<strong>QC:<\/strong> All 12 references checked\. Report: REPORT\.md<\/div><\/details><\/li>/s);
  assert.match(html, /<span class="cmfile">Local file: cut\.mp4<\/span><\/div><p class="cmsmall cmone">Short one<\/p><\/li>/, 'one line, no Details');
  assert.doesNotMatch(html, /D:\\/, 'no local paths');
  assert.match(html, /owner Florence → Olivia .*In QC → Ready for your review/s, 'history in words');
});
