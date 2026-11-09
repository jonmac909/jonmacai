// Review page -> dashboard card (Jon, 2026-11-09: approvals on jonmac.ai/review never reached the team). The review Worker
// (cloud-apps/review) calls these over its DASHBOARD service binding, with the REVIEW_API_TOKEN this Worker already holds
// for /dashboard/review:
//   POST /dashboard/api/review-hook/submission  Jon's Approve or Submit changes: a comment from Jon on the video's card,
//        which wakes its owner like any comment of his (postComment, card_comment), plus one history line.
//   GET  /dashboard/api/review-hook/qc          the review pages a QC-passed proof links to, for Jon's review list.
// The card: the task id the publisher stored, else the card titled like the video ("<title> - <channel>"; case,
// punctuation and the channel suffix ignored), else the card whose proof is that review page (linkedTask).
import { logEvent, postComment, wakeOwner } from './bots.js';
import { NO_TASK_OWNER, linkedTask } from './videoreview.js';

const PUBLIC = 'https://jonmac.ai/review';
const TASK_ID = /^t_[0-9a-f]{16}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const REVIEW_PAGE = /jonmac\.ai\/(?:dashboard\/)?review\/(?:media\/)?([a-z0-9-]+)(?:[/?#]|$)/i;
const LATE_MS = 10 * 60 * 1000;
const enc = new TextEncoder();
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const clock = (t) => {
  const s = Math.max(0, Math.floor(Number(t) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const day = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric' }).format(new Date(iso));

async function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const [x, y] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const words = (s) => String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const bare = (title) => String(title || '').trim().replace(/\s*\(\s*v\d+\s*\)$/i, '').replace(/\s+v\d+$/i, '');
// "Why X - Rosa's Clean Home (v4)" -> ["why x", "rosas clean home"]: the name, then the channel suffix.
export function titleParts(title) {
  const t = bare(title);
  const i = t.lastIndexOf(' - ');
  return i > 0 ? [words(t.slice(0, i)), words(t.slice(i + 3))] : [words(t), ''];
}

// Two channel suffixes name the same channel: equal, one missing, or one a whole-word start of the other
// ("dale whitaker" and "dale whitaker pitbulls"). Another channel's card with the same video name never matches.
const sameChannel = (a, b) => !a || !b || a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
// The card with the video's name on its channel: the exact channel suffix first, then open before done, then the newest.
export function cardByTitle(title, tasks) {
  const [name, channel] = titleParts(title);
  if (!name) return null;
  const rank = (t) => [titleParts(t.title)[1] === channel ? 0 : 1, t.status === 'done' ? 1 : 0];
  return tasks.filter((t) => t.status !== 'cancelled' && t.project !== 'coding' && titleParts(t.title)[0] === name && sameChannel(titleParts(t.title)[1], channel))
    .sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return x[0] - y[0] || x[1] - y[1] || String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    })[0] || null;
}

export async function findCard(db, { task_id: id, slug, title }) {
  if (TASK_ID.test(id || '')) {
    const row = await db.prepare('SELECT id, title, owner, status, project, updated_at FROM bot_tasks WHERE id = ?').bind(id).first();
    if (row && row.status !== 'cancelled') return { task: row, by: 'task_id' };
  }
  const { results } = await db.prepare("SELECT id, title, owner, status, project, updated_at FROM bot_tasks WHERE status != 'cancelled' AND project IS NOT 'coding'").all();
  const named = cardByTitle(title, results || []);
  if (named) return { task: named, by: 'title' };
  const linked = await linkedTask(db, slug);
  return linked ? { task: linked, by: 'proof' } : { task: null, by: null };
}

// What Jon reads on the card, and the owner in its wake.
export function commentOf(p, now) {
  const what = `${p.version} of "${bare(p.title)}"`;
  const late = p.at && Date.parse(now) - Date.parse(p.at) > LATE_MS ? ` (${p.kind === 'approve' ? 'approved' : 'sent'} ${day(p.at)}, posted late)` : '';
  if (p.kind === 'approve') {
    return `Jon approved ${what} on the review page${late}. That version is final: upload it, and don't post a newer one unless he asks for changes.\n${PUBLIC}/${p.slug}`;
  }
  const notes = p.comments.map((c) => `- ${clock(c.t)} ${c.text || (c.voice ? 'Voice note' : 'Drawing')}`
    + `${c.transcript ? ` (said: "${c.transcript}")` : c.voice && c.text ? ' [voice note]' : ''}${c.drawing && c.text ? ' [drawing]' : ''}`);
  const text = [`Jon asked for changes on ${what} on the review page${late}, ${notes.length} note${notes.length === 1 ? '' : 's'}.`, `${PUBLIC}/${p.slug}`, ...notes].join('\n');
  return text.length > 4000 ? `${text.slice(0, 3999)}…` : text;
}

const historyOf = (p) => (p.kind === 'approve' ? `approved ${p.version} on the review page`
  : `changes asked on ${p.version} on the review page (${p.comments.length} note${p.comments.length === 1 ? '' : 's'})`);

function payloadOf(body) {
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  if (!body || typeof body !== 'object' || !['approve', 'changes'].includes(body.kind) || !SLUG.test(body.slug || '')) return null;
  const comments = Array.isArray(body.comments) ? body.comments.slice(0, 200).map((c) => ({
    t: Number(c?.t) || 0, text: str(c?.text, 4000), transcript: str(c?.transcript, 2000), voice: !!c?.voice, drawing: !!c?.drawing,
  })) : [];
  const at = typeof body.at === 'string' && !Number.isNaN(Date.parse(body.at)) ? new Date(body.at).toISOString() : null;
  return { kind: body.kind, slug: body.slug, title: str(body.title, 300) || body.slug, version: str(body.version, 40) || 'this version',
    task_id: str(body.task_id, 40), submission_id: str(body.submission_id, 80), comments, at, backfill: body.backfill === true };
}

async function submission(request, env, ctx) {
  let p = null;
  try { p = payloadOf(await request.json()); } catch { /* answered below */ }
  if (!p) return json({ ok: false, error: 'Send JSON with kind (approve or changes), slug, title and version' }, 400);
  const now = new Date().toISOString();
  const { task, by } = await findCard(env.DB, p);
  // The backfill only fills in cards that are still open, and wakes no one for a video without a card.
  if (p.backfill && (!task || task.status === 'done')) return json({ ok: true, result: task ? 'skipped' : 'no_card', task, matched_by: by });
  const body = commentOf(p, now);
  const review = { slug: p.slug, kind: p.kind, submission: p.submission_id || null };
  if (!task) { // like a review comment on a video no card links to yet (videoreview.js wakeForComment)
    const wake = wakeOwner(env, { id: null, title: p.title, project: null, owner: NO_TASK_OWNER }, { id: p.submission_id || `review-${p.slug}-${now}`, body },
      ctx?.waitUntil ? [2000, 4000] : [], { review, url: `${PUBLIC}/${p.slug}` })
      .then((status) => { if (status !== '200' && status !== '202') console.error('review hook wake', status); return status; });
    if (ctx?.waitUntil) ctx.waitUntil(wake); else await wake;
    return json({ ok: true, result: 'no_card', task: null, matched_by: null, wakes: NO_TASK_OWNER });
  }
  await postComment(env.DB, env, ctx, { jon: true }, task, body, now, { review });
  await logEvent(env.DB, task.id, now, 'jon', 'review', historyOf(p));
  return json({ ok: true, result: 'posted', task: { id: task.id, title: task.title, owner: task.owner, status: task.status }, matched_by: by,
    wakes: task.owner === 'jon' ? null : task.owner });
}

async function qcPassed(env) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT p.link FROM bot_proofs p JOIN bot_tasks t ON t.id = p.task_id
    WHERE p.status = 'passed' AND p.link LIKE '%/review/%' AND t.status != 'cancelled' AND t.project IS NOT 'coding'`).all();
  const slugs = new Set((results || []).map((r) => REVIEW_PAGE.exec(r.link || '')?.[1]?.toLowerCase()).filter((s) => s && s !== 'media'));
  return json({ ok: true, slugs: [...slugs] });
}

export async function reviewHook(request, env, ctx) {
  if (!env.DB || !env.REVIEW_API_TOKEN || env.REVIEW_API_TOKEN.length < 8) return json({ ok: false, error: 'Not configured' }, 503);
  const auth = request.headers.get('Authorization') || '';
  if (!(await sameSecret(auth.startsWith('Bearer ') ? auth.slice(7).trim() : '', env.REVIEW_API_TOKEN))) return json({ ok: false, error: 'Unauthorized' }, 401);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path === '/dashboard/api/review-hook/submission' && request.method === 'POST') return submission(request, env, ctx);
  if (path === '/dashboard/api/review-hook/qc' && request.method === 'GET') return qcPassed(env);
  return json({ ok: false, error: 'Not found' }, 404);
}
