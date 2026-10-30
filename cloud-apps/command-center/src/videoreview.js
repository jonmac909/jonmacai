// Video review inside the dashboard (Jon, 2026-10-30). /dashboard/review/* and /dashboard/api/review/* are the
// jonmac.ai/review pages and API under Jon's dashboard sign-in, with no second passcode. This Worker checks his
// session (and X-CC on writes), then forwards to the review Worker over the REVIEW service binding with
// REVIEW_API_TOKEN and X-Review-Via: dashboard; the review Worker treats that as a signed-in reviewer, never as
// an agent. Video and voice notes stream straight through with their byte ranges. On top of that:
//   - each new comment wakes the video's task owner with card_comment (video-editor when no task links to it);
//   - Approve moves the linked task from Review to Done, and Send back moves it to Doing with the comments.
// A task links to a review video through its proof link, https://jonmac.ai/review/<slug> (bots/DASH.md).
import { readSession } from './auth.js';
import { postComment, tickTask, wakeOwner } from './bots.js';

const REVIEW_LINK = /^https:\/\/jonmac\.ai\/(?:dashboard\/)?review\/([a-z0-9-]+)\/?(?:[?#].*)?$/i;
const PUBLIC = 'https://jonmac.ai/review';
const MAX_BODY = 6 * 1024 * 1024; // a comment with a voice note (at most 5 MB)
export const NO_TASK_OWNER = 'video-editor';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const clock = (t) => {
  const s = Math.max(0, Math.floor(Number(t) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const kindOf = (buf) => {
  try { return JSON.parse(new TextDecoder().decode(buf)).kind ?? 'changes'; } catch { return null; }
};

export const reviewSlug = (link) => REVIEW_LINK.exec(String(link || ''))?.[1].toLowerCase() || null;

// The task a review video belongs to: one with that review page as proof, a task in review first, then the newest proof.
export async function linkedTask(db, slug) {
  const { results } = await db.prepare(`SELECT t.*, p.link AS review_link FROM bot_proofs p JOIN bot_tasks t ON t.id = p.task_id
    WHERE (p.link LIKE ? OR p.link LIKE ? OR p.link LIKE ? OR p.link LIKE ?) AND t.status != 'cancelled'
    ORDER BY t.status = 'review' DESC, p.created_at DESC LIMIT 20`).bind(...['', '/%', '?%', '#%'].map((end) => `%/review/${slug}${end}`)).all();
  return (results || []).find((r) => reviewSlug(r.review_link) === slug) || null;
}

const forward = (env, url, init = {}) => {
  const headers = new Headers(init.headers);
  headers.delete('Cookie'); // the dashboard session stays here
  headers.set('Authorization', `Bearer ${env.REVIEW_API_TOKEN}`);
  headers.set('X-Review-Via', 'dashboard');
  return env.REVIEW.fetch(new Request(url, { ...init, headers, redirect: 'manual' }));
};
const reviewJson = async (env, origin, path) => {
  const res = await forward(env, `${origin}${path}`);
  return res.ok ? res.json() : null;
};

export async function reviewProxy(request, env, ctx) {
  const url = new URL(request.url);
  if (!(await readSession(request, env))) {
    return /^\/dashboard\/review(\/[a-z0-9-]+)?\/?$/.test(url.pathname)
      ? Response.redirect(`${url.origin}/dashboard/`, 302) : json({ error: 'Sign in' }, 401);
  }
  const write = request.method !== 'GET' && request.method !== 'HEAD';
  if (write && request.headers.get('X-CC') !== '1') return json({ error: 'Missing header' }, 403);
  if (!env.REVIEW || !env.REVIEW_API_TOKEN) return json({ error: 'Video review is not connected' }, 503);
  if (write && Number(request.headers.get('Content-Length')) > MAX_BODY) return json({ error: 'Too large' }, 413);
  const body = write ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > MAX_BODY) return json({ error: 'Too large' }, 413);

  const target = new URL(url);
  target.pathname = url.pathname.slice('/dashboard'.length);
  // Send back on a video whose bot-owned task waits in Review: the card wake (moveTask) is the owner's one notice,
  // so the review Worker stores the submission as delivered and the GPU2 router skips it. Approve wakes no one
  // and Jon's own tasks wake no bot, so those stay with the router.
  const headers = new Headers(request.headers);
  headers.delete('X-Review-Delivered-To');
  const submitting = write ? /^\/api\/review\/([a-z0-9-]+)\/submit\/?$/.exec(target.pathname)?.[1] : null;
  if (submitting && kindOf(body) === 'changes') {
    const task = await linkedTask(env.DB, submitting);
    if (task?.status === 'review' && task.owner !== 'jon') headers.set('X-Review-Delivered-To', 'dashboard');
  }
  const res = await forward(env, target, { method: request.method, headers, body });
  const hook = write && res.ok ? /^\/api\/review\/([a-z0-9-]+)\/(comments|submit)\/?$/.exec(target.pathname) : null;
  if (!hook) return res;
  const out = await res.json();
  try {
    const now = new Date().toISOString();
    Object.assign(out, hook[2] === 'comments'
      ? await wakeForComment(env, ctx, url.origin, hook[1], out.comment, now)
      : await moveTask(env, ctx, url.origin, hook[1], out.submission, now));
  } catch (err) {
    console.error('video review tie-in', err);
    out.taskNote = 'Saved, but the dashboard could not be updated.';
  }
  return json(out, res.status);
}

// One review comment wakes the task owner through the card's own comment thread (the signed card_comment wake),
// or video-editor directly when no task links to the video yet. data.review carries the slug and comment id.
async function wakeForComment(env, ctx, origin, slug, comment, now) {
  const video = (await reviewJson(env, origin, `/api/review/${slug}`))?.video;
  const title = video ? `${video.title} ${video.version}` : slug;
  const has = [comment.audio_url && 'voice note', comment.drawing && 'drawing'].filter(Boolean);
  const text = `Review note at ${clock(comment.t)} on ${title}: ${comment.text || '(no text)'}${has.length ? ` [${has.join(', ')}]` : ''}\n${PUBLIC}/${slug}`;
  const review = { slug, commentId: comment.id, t: comment.t, time: clock(comment.t), text: comment.text, audio: !!comment.audio_url, drawing: !!comment.drawing };
  const task = await linkedTask(env.DB, slug);
  if (task) {
    await postComment(env.DB, env, ctx, { jon: true }, task, text, now, { review });
    return { wakes: task.owner === 'jon' ? null : task.owner };
  }
  const wake = wakeOwner(env, { id: null, title, project: null, owner: NO_TASK_OWNER }, { id: comment.id, body: text },
    ctx?.waitUntil ? [2000, 4000] : [], { review, url: `${PUBLIC}/${slug}` })
    .then((status) => { if (status !== '200' && status !== '202') console.error('review comment wake', status); return status; });
  if (ctx?.waitUntil) ctx.waitUntil(wake); else await wake;
  return { wakes: NO_TASK_OWNER };
}

// Approve or Send back on a linked task in Review: the same PATCH Jon makes from the board (tickTask).
async function moveTask(env, ctx, origin, slug, submission, now) {
  const task = await linkedTask(env.DB, slug);
  if (!task) return { taskNote: 'No dashboard task links to this video yet.' };
  if (task.status !== 'review') return { taskNote: `Its task is ${task.status.replace(/_/g, ' ')}, so it stays there.` };
  let patch = { status: 'done' };
  if (submission.kind === 'changes') {
    const list = await reviewJson(env, origin, `/api/review/${slug}/comments`);
    const sent = (list?.comments || []).filter((c) => c.submission_id === submission.id);
    const lines = sent.map((c) => `- ${clock(c.t)} ${c.text || (c.audio_url ? 'Voice note' : 'Drawing')}`
      + `${c.transcript ? ` (said: "${c.transcript}")` : c.audio_url && c.text ? ' [voice note]' : ''}${c.drawing && c.text ? ' [drawing]' : ''}`);
    const title = list?.video ? `${list.video.title} ${list.video.version}` : slug;
    const comment = [`Sent back from review: ${title}, ${sent.length} note${sent.length === 1 ? '' : 's'}.`, `${PUBLIC}/${slug}`, ...lines].join('\n');
    patch = { status: 'doing', comment: comment.length > 4000 ? `${comment.slice(0, 3999)}…` : comment };
  }
  const res = await tickTask(env.DB, env, ctx, task.id, patch, now, { review: { slug, submission: submission.id } });
  if (!res.ok) return { taskNote: (await res.json()).error };
  return { taskNote: patch.status === 'done' ? 'Its task moved to Done.' : 'Its task went back to Doing with these notes.' };
}
