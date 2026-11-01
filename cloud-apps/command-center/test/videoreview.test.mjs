// Video review inside the dashboard (2026-10-30): /dashboard/review and /dashboard/api/review go to the review
// Worker (a fake one here) only with Jon's dashboard session; comments wake the task owner (video-editor when no
// task links), and Approve / Send back move the linked task in Review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../src/worker.js';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { linkedTask, reviewSlug, settleApproved } from '../src/videoreview.js';
import { handleCron } from '../src/cron.js';
import { signSession, COOKIE } from '../src/auth.js';
import { deliverableLink } from '../public/js/pages/projects.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const REVIEW_TOKEN = 'review-agent-token-0123456789abcdef';
const TOK = { 'video-editor': `ccb_${'v'.repeat(43)}`, qc: `ccb_${'q'.repeat(43)}` };
const HOOKS = {
  'video-editor': { url: 'https://hooks.example/video-editor', secret: 'whsec_video-editor-test' },
  ana: { url: 'https://hooks.example/ana', secret: 'whsec_ana-test' },
};
const SLUG = 'topview-2-v2';

// A stand-in review Worker: records what it is sent and answers like the real one.
function fakeReview() {
  const seen = [];
  const comments = [];
  const hooks = {};
  return {
    seen,
    comments,
    hooks,
    async fetch(request) {
      const url = new URL(request.url);
      const body = ['GET', 'HEAD'].includes(request.method) ? null : await request.text();
      seen.push({ method: request.method, path: url.pathname, headers: Object.fromEntries(request.headers), body });
      const video = { slug: SLUG, title: 'Topview video 2', version: 'v2' };
      if (url.pathname.startsWith('/review/media/')) {
        return new Response('ab', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-1/1000' } });
      }
      if (url.pathname === `/review/${SLUG}`) return new Response('<html>page</html>', { headers: { 'Content-Type': 'text/html' } });
      if (url.pathname === `/api/review/${SLUG}` && request.method === 'GET') return Response.json({ video });
      if (url.pathname === `/api/review/${SLUG}/comments` && request.method === 'GET') return Response.json({ video, comments });
      if (url.pathname === `/api/review/${SLUG}/comments` && request.method === 'POST') {
        const input = JSON.parse(body);
        const comment = {
          id: `rc-${comments.length + 1}`, slug: SLUG, t: input.t, text: input.text, submission_id: null,
          drawing: input.drawing || null, audio_url: input.audio ? `https://jonmac.ai/dashboard/api/review/${SLUG}/comments/x/audio` : null, transcript: null,
        };
        comments.push(comment);
        return Response.json({ comment }, { status: 201 });
      }
      if (url.pathname.endsWith('/requeue') && request.method === 'POST') return Response.json({ ok: true });
      if (url.pathname === '/api/review/videos') return Response.json({ videos: hooks.videos || [] });
      const perVideo = /^\/api\/review\/([a-z0-9-]+)\/submissions$/.exec(url.pathname);
      if (perVideo) return Response.json({ submissions: hooks.submissions?.[perVideo[1]] || [] });
      if (url.pathname === `/api/review/${SLUG}/submit`) {
        await hooks.onSubmit?.();
        const { kind } = JSON.parse(body);
        const submission = { id: `s-${kind}`, kind, comment_count: comments.length };
        if (kind === 'changes') for (const c of comments) c.submission_id = submission.id;
        return Response.json({ submission, status: kind === 'approve' ? 'approved' : 'changes_requested', duplicate: false }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    },
  };
}

async function setup({ review = fakeReview(), token = REVIEW_TOKEN } = {}) {
  const db = sqliteD1();
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  return { db, review, env: { DB: db, SESSION_SECRET: SECRET, WEBHOOKS: JSON.stringify(HOOKS), REVIEW: review, REVIEW_API_TOKEN: token, PREVIEW: '1' } };
}
const cookie = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;
async function hit(env, method, path, { jon = true, cc = true, body, headers = {} } = {}) {
  const h = new Headers(headers);
  if (jon) h.set('Cookie', await cookie());
  if (cc) h.set('X-CC', '1');
  if (body !== undefined) h.set('Content-Type', 'application/json');
  return worker.fetch(new Request(`https://jonmac.ai${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, {});
}
async function v1(env, method, path, { bot, body }) {
  const h = new Headers({ Authorization: `Bearer ${TOK[bot]}`, 'Content-Type': 'application/json' });
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, { method, headers: h, body: JSON.stringify(body) }), env);
  return r.json();
}
// A video-editor task whose QC-passed proof is the review page, moved on to review (or left in `stopAt`).
async function videoTask(env, stopAt = 'review', link = `https://jonmac.ai/review/${SLUG}`) {
  const { task } = await v1(env, 'POST', '/tasks', { bot: 'video-editor', body: { title: 'Topview video 2 - Viral View', project: 'viral-view', status: 'doing' } });
  const { proof } = await v1(env, 'POST', `/tasks/${task.id}/proofs`, { bot: 'video-editor', body: { kind: 'render', link } });
  if (stopAt === 'doing') return task;
  await v1(env, 'PATCH', `/tasks/${task.id}`, { bot: 'video-editor', body: { status: 'qc' } });
  if (stopAt === 'review') await v1(env, 'POST', `/proofs/${proof.id}/check`, { bot: 'qc', body: { result: 'passed' } });
  return task;
}
const taskRow = (db, id) => db.prepare('SELECT * FROM bot_tasks WHERE id = ?').bind(id).first();
function mockFetch(t) {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, init, data: JSON.parse(init.body) }); return new Response(null, { status: 202 }); };
  t.after(() => { globalThis.fetch = real; });
  return sent;
}

test('only Jon\'s dashboard session reaches the review Worker; it goes as a reviewer, with the token and no cookie', async (t) => {
  mockFetch(t);
  const { env, review } = await setup();
  // Signed out: pages go to the dashboard sign-in, everything else is 401. A bot token is not a session.
  const page = await hit(env, 'GET', `/dashboard/review/${SLUG}`, { jon: false });
  assert.deepEqual([page.status, page.headers.get('location')], [302, 'https://jonmac.ai/dashboard/']);
  for (const path of ['/dashboard/review/media/x/video.mp4', `/dashboard/api/review/${SLUG}/comments`, '/dashboard/api/review/videos']) {
    assert.equal((await hit(env, 'GET', path, { jon: false })).status, 401, path);
    assert.equal((await hit(env, 'GET', path, { jon: false, headers: { Authorization: `Bearer ${TOK['video-editor']}` } })).status, 401, `${path} with a bot token`);
    assert.equal((await hit(env, 'GET', path, { jon: false, headers: { Authorization: `Bearer ${REVIEW_TOKEN}` } })).status, 401, `${path} with the review token`);
  }
  const forged = `${COOKIE}=${Math.floor(Date.now() / 1000) + 3600}.${'0'.repeat(64)}`;
  assert.equal((await hit(env, 'GET', '/dashboard/api/review/videos', { jon: false, headers: { Cookie: forged } })).status, 401, 'a forged session');
  // Writes need X-CC as well.
  assert.equal((await hit(env, 'POST', `/dashboard/api/review/${SLUG}/comments`, { cc: false, body: { author: 'Jon', t: 1, text: 'x' } })).status, 403);
  assert.equal(review.seen.length, 0, 'nothing refused reached the review Worker');

  // Signed in: forwarded under /review with the agent token, X-Review-Via and no dashboard cookie.
  const media = await hit(env, 'GET', '/dashboard/review/media/topview-2-v2/video.mp4', { headers: { Range: 'bytes=0-1' } });
  assert.deepEqual([media.status, media.headers.get('content-range'), await media.text()], [206, 'bytes 0-1/1000', 'ab'], 'byte ranges stream through');
  assert.equal((await hit(env, 'GET', `/dashboard/review/${SLUG}`)).status, 200);
  const [m, p] = review.seen;
  assert.deepEqual([m.path, m.headers.range, m.headers.authorization, m.headers['x-review-via'], m.headers.cookie], [
    '/review/media/topview-2-v2/video.mp4', 'bytes=0-1', `Bearer ${REVIEW_TOKEN}`, 'dashboard', undefined]);
  assert.equal(p.path, `/review/${SLUG}`);
  assert.equal((await hit(env, 'POST', `/dashboard/api/review/${SLUG}/comments`, { headers: { 'Content-Length': String(7 * 1024 * 1024) }, body: { t: 1 } })).status, 413);

  const unwired = await setup({ token: '' });
  assert.equal((await hit(unwired.env, 'GET', '/dashboard/api/review/videos')).status, 503, 'no token: not connected');
});

test('a review comment wakes the linked task owner through the card thread, with the time and text', async (t) => {
  const sent = mockFetch(t);
  const { env, db, review } = await setup();
  const task = await videoTask(env);
  const res = await hit(env, 'POST', `/dashboard/api/review/${SLUG}/comments`, { body: { author: 'Jon', t: 65.4, text: 'Move the <logo> left', drawing: { v: 1, shapes: [] } } });
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.deepEqual([out.comment.id, out.wakes], ['rc-1', 'video-editor']);

  const card = await db.prepare('SELECT * FROM bot_task_comments WHERE task_id = ?').bind(task.id).all();
  assert.equal(card.results.length, 1);
  assert.equal(card.results[0].body, `Review note at 1:05 on Topview video 2 v2: Move the <logo> left [drawing]\nhttps://jonmac.ai/review/${SLUG}`);
  assert.equal(card.results[0].wake_status, '202');
  const wake = sent.find((s) => s.url === HOOKS['video-editor'].url);
  assert.equal(wake.data.type, 'card_comment');
  assert.deepEqual([wake.data.data.task, wake.data.data.comment, wake.data.data.review], [task.id, card.results[0].body,
    { slug: SLUG, commentId: 'rc-1', t: 65.4, time: '1:05', text: 'Move the <logo> left', audio: false, drawing: true }]);
  // Signed exactly like every card_comment: HMAC of "<ts>.<delivery id>.<body>".
  const h = wake.init.headers;
  const mac = createHmac('sha256', HOOKS['video-editor'].secret).update(`${h['x-openbot-timestamp']}.${h['x-openbot-delivery-id']}.${wake.init.body}`).digest('hex');
  assert.equal(h['x-openbot-signature'], `sha256=${mac}`);
  assert.equal(review.seen.filter((s) => s.method === 'POST').length, 1, 'the comment was saved once, in the review Worker');
});

test('with no task linked, a review comment wakes video-editor directly; a voice note says so', async (t) => {
  const sent = mockFetch(t);
  const { env, db } = await setup();
  const out = await (await hit(env, 'POST', `/dashboard/api/review/${SLUG}/comments`, { body: { author: 'Jon', t: 3, text: '', audio: true } })).json();
  assert.equal(out.wakes, 'video-editor');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, HOOKS['video-editor'].url);
  assert.equal(sent[0].init.headers['x-openbot-delivery-id'], 'rc-1', 'the review comment id: one wake per comment');
  assert.deepEqual([sent[0].data.data.task, sent[0].data.data.owner, sent[0].data.data.url, sent[0].data.data.review.audio],
    [null, 'video-editor', `https://jonmac.ai/review/${SLUG}`, true]);
  assert.match(sent[0].data.data.comment, /^Review note at 0:03 on Topview video 2 v2: \(no text\) \[voice note\]/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM bot_task_comments').first()).n, 0);
});

test('Approve on the review page moves the linked Review task to Done; Send back moves it to Doing with the notes', async (t) => {
  const sent = mockFetch(t);
  const { env, db, review: first } = await setup();
  const approved = await videoTask(env);
  const ok = await (await hit(env, 'POST', `/dashboard/api/review/${SLUG}/submit`, { body: { kind: 'approve' } })).json();
  assert.equal(ok.taskNote, 'Its task moved to Done.');
  const done = await taskRow(db, approved.id);
  assert.deepEqual([done.status, done.updated_by, !!done.done_at], ['done', 'jon', true]);
  const told = (r) => r.seen.filter((x) => x.path.endsWith('/submit')).map((x) => x.headers['x-review-delivered-to'] ?? null);
  assert.deepEqual(told(first), [null], 'Approve wakes no one, so the GPU2 router still sends its notice');

  const { env: env2, db: db2, review } = await setup();
  const back = await videoTask(env2);
  await hit(env2, 'POST', `/dashboard/api/review/${SLUG}/comments`, { body: { author: 'Jon', t: 12, text: 'Louder intro' } });
  review.comments.push({ id: 'rc-v', t: 75, text: '', audio_url: 'x', transcript: 'cut this bit', drawing: null, submission_id: null });
  sent.length = 0;
  const res = await (await hit(env2, 'POST', `/dashboard/api/review/${SLUG}/submit`, { body: { kind: 'changes' } })).json();
  assert.equal(res.taskNote, 'Its task went back to Doing with these notes.');
  assert.equal((await taskRow(db2, back.id)).status, 'doing');
  const last = (await db2.prepare('SELECT body FROM bot_task_comments WHERE task_id = ? ORDER BY created_at DESC, rowid DESC').bind(back.id).first()).body;
  assert.equal(last, `Sent back from review: Topview video 2 v2, 2 notes.\nhttps://jonmac.ai/review/${SLUG}\n- 0:12 Louder intro\n- 1:15 Voice note (said: "cut this bit")`);
  assert.deepEqual([sent[0].data.data.sentBack, sent[0].data.data.review], [true, { slug: SLUG, submission: 's-changes' }]);
  const history = await db2.prepare("SELECT detail FROM bot_task_events WHERE task_id = ? AND kind = 'status' ORDER BY at DESC, rowid DESC").bind(back.id).first();
  assert.equal(history.detail, 'status review → doing (sent back by Jon)');
  assert.equal(review.seen.filter((x) => x.path.endsWith('/requeue')).length, 0, 'a delivered card wake needs no requeue');
  assert.deepEqual(told(review), ['dashboard'], 'the card wake is the one notice: the review Worker stores it as delivered, so the GPU2 router skips it');

  // Jon's own task wakes no bot, and the browser can't claim the hand-off: both stay with the router.
  const { env: env3, db: db3, review: third } = await setup();
  const mine = await videoTask(env3);
  await db3.prepare("UPDATE bot_tasks SET owner = 'jon' WHERE id = ?").bind(mine.id).run();
  await hit(env3, 'POST', `/dashboard/api/review/${SLUG}/comments`, { body: { author: 'Jon', t: 3, text: 'x' } });
  await hit(env3, 'POST', `/dashboard/api/review/${SLUG}/submit`, { body: { kind: 'changes' }, headers: { 'X-Review-Delivered-To': 'dashboard' } });
  assert.deepEqual(told(third), [null]);
});

test('a Send back the card could not announce goes back to the GPU2 router', async (t) => {
  mockFetch(t);
  const { env, db, review } = await setup();
  const task = await videoTask(env);
  await hit(env, 'POST', `/dashboard/api/review/${SLUG}/comments`, { body: { author: 'Jon', t: 2, text: 'x' } });
  review.hooks.onSubmit = () => db.prepare("UPDATE bot_tasks SET status = 'doing' WHERE id = ?").bind(task.id).run(); // the bot moved it meanwhile
  const res = await (await hit(env, 'POST', `/dashboard/api/review/${SLUG}/submit`, { body: { kind: 'changes' } })).json();
  assert.equal(res.taskNote, 'Its task is doing, so it stays there.');
  const back = review.seen.filter((x) => x.path.endsWith('/requeue'));
  assert.deepEqual(back.map((x) => [x.path, x.headers.authorization, x.headers['x-review-via']]),
    [['/api/review/submissions/s-changes/requeue', `Bearer ${REVIEW_TOKEN}`, undefined]]);
});

test('a task not in Review, or no task, stays put; the review is still saved', async (t) => {
  mockFetch(t);
  const { env, db } = await setup();
  const none = await (await hit(env, 'POST', `/dashboard/api/review/${SLUG}/submit`, { body: { kind: 'approve' } })).json();
  assert.deepEqual([none.status, none.taskNote], ['approved', 'No dashboard task links to this video yet.']);
  const doing = await videoTask(env, 'doing');
  const kept = await (await hit(env, 'POST', `/dashboard/api/review/${SLUG}/submit`, { body: { kind: 'approve' } })).json();
  assert.equal(kept.taskNote, 'Its task is doing, so it stays there.');
  assert.equal((await taskRow(db, doing.id)).status, 'doing');
});

test('the cron moves a Review card only for a newer Approve on its newest proof and the newest version', async (t) => {
  mockFetch(t);
  const { env, db, review } = await setup();
  const task = await videoTask(env);
  const qc = await videoTask(env, 'qc', 'https://jonmac.ai/review/other-v1');
  const status = async (id) => (await taskRow(db, id)).status;
  const video = (slug, state, created_at = '2026-11-01T10:00:00.000Z') => ({ slug, status: state, created_at });
  const approve = (created_at) => [{ kind: 'approve', created_at }];
  const later = new Date(Date.now() + 60000).toISOString();

  review.hooks.videos = [video(SLUG, 'approved'), video('other-v1', 'approved')];
  await settleApproved(env);
  assert.equal(await status(task.id), 'review', 'the status button alone moves nothing');

  review.hooks.submissions = { [SLUG]: approve('2026-01-01T00:00:00.000Z'), 'other-v1': approve(later) };
  await settleApproved(env);
  assert.equal(await status(task.id), 'review', 'an Approve older than the proof was for earlier work');

  review.hooks.submissions[SLUG] = approve(later);
  review.hooks.videos[0].status = 'changes_requested';
  await settleApproved(env);
  assert.equal(await status(task.id), 'review', 'Approve then Send back: the Send back wins');

  review.hooks.videos[0].status = 'approved';
  review.hooks.videos.push(video('topview-2-v3', 'needs_review', '2026-11-01T11:00:00.000Z'));
  await settleApproved(env);
  assert.equal(await status(task.id), 'review', 'a newer version is still waiting for Jon');
  review.hooks.videos.pop();

  await db.prepare("UPDATE bot_proofs SET created_at = '2026-01-01T00:00:00.000Z' WHERE task_id = ?").bind(task.id).run();
  const { proof } = await v1(env, 'POST', `/tasks/${qc.id}/proofs`, { bot: 'video-editor', body: { kind: 'render', link: 'https://example.com/other.png' } });
  await db.prepare('UPDATE bot_proofs SET task_id = ? WHERE id = ?').bind(task.id, proof.id).run();
  await settleApproved(env);
  assert.equal(await status(task.id), 'review', 'a newer proof on the card is new work Jon has not seen');
  await db.prepare('DELETE FROM bot_proofs WHERE id = ?').bind(proof.id).run();

  await handleCron(env);
  const done = await taskRow(db, task.id);
  assert.deepEqual([done.status, done.updated_by, !!done.done_at], ['done', 'jon', true], 'the 10-minute cron runs it');
  assert.equal(await status(qc.id), 'qc', 'a card in QC waits until it reaches Review');
  const read = review.seen.find((x) => x.path === '/api/review/videos');
  assert.deepEqual([read.headers.authorization, read.headers['x-review-via']], [`Bearer ${REVIEW_TOKEN}`, undefined], 'it reads as an agent');
  await settleApproved({ ...env, REVIEW: undefined });
});

test('the review link convention: proof links (and only exact slugs) tie a task to a video; cards open the dashboard page', async () => {
  const { env, db } = await setup();
  for (const [link, slug] of [[`https://jonmac.ai/review/${SLUG}`, SLUG], [`https://jonmac.ai/review/${SLUG}?k=abc`, SLUG], [`https://jonmac.ai/dashboard/review/${SLUG}/`, SLUG],
    ['https://jonmac.ai/review/Topview-2-V2#c', SLUG], ['https://jonmac.ai/review', null], ['https://evil.example/review/x', null], ['D:\\renders\\x.mp4', null]]) {
    assert.equal(reviewSlug(link), slug, link);
  }
  const longer = await videoTask(env, 'review', `https://jonmac.ai/review/${SLUG}-extra`);
  assert.equal(await linkedTask(db, SLUG), null, 'a longer slug is another video');
  const task = await videoTask(env, 'doing');
  assert.equal((await linkedTask(db, SLUG)).id, task.id);
  assert.notEqual(longer.id, task.id);

  // Zane #1, 2026-11-01: a Coding card citing the page outranked the video's own card and took Jon's note.
  const { task: tool } = await v1(env, 'POST', '/tasks', { bot: 'video-editor', body: { title: 'Review pages tool', project: 'coding', status: 'doing' } });
  const { proof: cited } = await v1(env, 'POST', `/tasks/${tool.id}/proofs`, { bot: 'video-editor', body: { kind: 'url', link: `https://jonmac.ai/dashboard/review/${SLUG}` } });
  await v1(env, 'PATCH', `/tasks/${tool.id}`, { bot: 'video-editor', body: { status: 'qc' } });
  await v1(env, 'POST', `/proofs/${cited.id}/check`, { bot: 'qc', body: { result: 'passed' } });
  assert.equal((await taskRow(db, tool.id)).status, 'review');
  assert.equal((await linkedTask(db, SLUG)).id, task.id, 'the video card, though the Coding card is newer and in Review');
  await db.prepare('DELETE FROM bot_proofs WHERE task_id = ?').bind(task.id).run();
  assert.equal(await linkedTask(db, SLUG), null, 'a Coding card alone is not the video card');

  assert.equal(deliverableLink({ link: `https://jonmac.ai/review/${SLUG}?k=x`, kind: 'render' }),
    `<a class="pjdeliv" href="/dashboard/review/${SLUG}" target="_blank" rel="noopener">Open review</a>`);
  assert.match(deliverableLink({ link: 'https://jonmac.ai/other', kind: 'url' }), /href="https:\/\/jonmac.ai\/other"/);
});
