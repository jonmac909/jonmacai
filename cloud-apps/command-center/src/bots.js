// Bot access API (dashboard plan step 1, 2026-10-29). Each bot writes one row at a time under
// /dashboard/api/v1 with its own Bearer token; bot_tokens keeps only the SHA-256 hash. Jon's side
// (answer a question, approve or reject, tick off a task owned by jon) needs the dashboard session
// and is never open to a bot.
import { readSession } from './auth.js';
import { CHANNELS, GROUPS, MULTIPLE_SQL, allChannels, realUtc } from './channels.js';
import { ymd } from './life.js';
import { PROJECTS } from './projects.js';
import { approvalItem, questionItem } from './today.js';
import { trackVideos } from './track.js';
import { MONTH_HABITS, WEEK_HABITS, monthKey, weekStart } from './periods.js';
import { upsertHabit } from './db.js';

// todo/doing → qc (proof) → review (QC passed it) → done (Jon approved it). Only Jon sets done, except the
// live-YouTube sync for a card whose video the server itself found public (liveDone) and an internal card
// closing itself once QC passed it (closeTask).
export const TASK_STATUSES = ['todo', 'doing', 'waiting_on_jon', 'qc', 'review', 'done', 'cancelled'];
const OPEN_STATUSES = ['todo', 'doing', 'waiting_on_jon'];
export const PROOF_KINDS = ['render', 'url', 'pdf', 'test'];
export const QC_BOT = 'qc';
const QUESTION_STATUSES = ['open', 'answered', 'closed'];
const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'running', 'done', 'cancelled'];
const RUN_STATUSES = ['running', 'ok', 'failed'];
const MAX_BODY = 256 * 1024;
const MAX_PAYLOAD = 4000;
const TOKEN_RE = /^ccb_[A-Za-z0-9_-]{32,128}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ACTION_RE = /^[a-z][a-z0-9_]{1,39}$/;
const ID_RE = /^[tpqarjvo]_[0-9a-f]{16}$/;
const PROJECT_SLUGS = PROJECTS.map((p) => p.slug);
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const enc = new TextEncoder();
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

class Bad extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The bot slug for a valid, unrevoked token, else null.
export async function botOf(request, db) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!db || !TOKEN_RE.test(token)) return null;
  const row = await db.prepare('SELECT bot FROM bot_tokens WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(await sha256Hex(token)).first();
  return row ? row.bot : null;
}

const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

function parseJson(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

async function readBody(request) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) throw new Bad(413, 'Body too large');
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Bad(413, 'Body too large');
  if (!raw.trim()) return {};
  let body;
  try { body = JSON.parse(raw); } catch { throw new Bad(400, 'Body must be JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Bad(400, 'Body must be a JSON object');
  return body;
}

function text(body, key, max, required = false) {
  const v = body[key];
  const s = v == null ? '' : typeof v === 'string' || typeof v === 'number' ? String(v).trim() : null;
  if (s === null) throw new Bad(400, `${key} must be text`);
  if (!s) {
    if (required) throw new Bad(400, `${key} is required`);
    return null;
  }
  if (s.length > max) throw new Bad(400, `${key} is longer than ${max} characters`);
  return s;
}

function oneOf(value, allowed, key) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!allowed.includes(s)) throw new Bad(400, `${key} must be one of: ${allowed.join(', ')}`);
  return s;
}

function statusList(raw, allowed) {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map((s) => oneOf(s, allowed, 'status'));
}

function limitOf(q) {
  const n = Number.parseInt(q.get('limit') || '100', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 100;
}

function isoOf(value, key, required = false) {
  if (value == null || value === '') {
    if (required) throw new Bad(400, `${key} is required`);
    return null;
  }
  const t = typeof value === 'string' && value.length <= 40 ? Date.parse(value) : NaN;
  if (!Number.isFinite(t)) throw new Bad(400, `${key} must be an ISO date and time`);
  return new Date(t).toISOString();
}

// Proof links are web links or file paths QC can open on GPU1; no other schemes.
function linkOf(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new Bad(400, 'link is required');
  if (s.length > 2000) throw new Bad(400, 'link is longer than 2000 characters');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new Bad(400, 'link has control characters');
  const ok = /^https?:\/\/[^\s/]+/i.test(s) || /^[A-Za-z]:[\\/]/.test(s) || /^\\\\[^\\]/.test(s) || /^\/(?!\/)/.test(s);
  if (!ok) throw new Bad(400, 'link must be an http(s) URL or a file path');
  return s;
}

function slugOf(value, key) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SLUG_RE.test(s)) throw new Bad(400, `${key} must be a bot name like video-editor`);
  return s;
}

async function knownBot(db, slug) {
  return !!(await db.prepare('SELECT 1 AS ok FROM bot_tokens WHERE bot = ? AND revoked_at IS NULL LIMIT 1').bind(slug).first());
}

async function ownerOf(db, who, value) {
  if (value === 'me') {
    if (!who.bot) throw new Bad(400, 'owner "me" needs a bot token');
    return who.bot;
  }
  const slug = slugOf(value, 'owner');
  if (slug === 'jon') return slug; // things only Jon can do; he ticks them done himself
  if (!(await knownBot(db, slug))) throw new Bad(400, `Unknown bot: ${slug}`);
  return slug;
}

// A project slug, or null for Unsorted ("unsorted" or empty).
function projectOf(value) {
  const s = value == null ? '' : String(value).trim().toLowerCase();
  if (!s || s === 'unsorted') return null;
  if (!PROJECT_SLUGS.includes(s)) throw new Bad(400, `project must be one of: ${PROJECT_SLUGS.join(', ')} (or unsorted)`);
  return s;
}

function projectFilter(where, args, q) {
  if (!q.get('project')) return;
  const p = projectOf(q.get('project'));
  if (p) { where.push('project = ?'); args.push(p); } else where.push('project IS NULL');
}

// Minutes of Jon's time: a whole number from 1 to 480, or null.
function minutesOf(body) {
  const n = numberOf(body, 'minutes', 1, 480);
  if (n != null && !Number.isInteger(n)) throw new Bad(400, 'minutes must be a whole number');
  return n;
}

function whoFilter(who, value, key) {
  if (value === 'me') {
    if (!who.bot) throw new Bad(400, `${key}=me needs a bot token`);
    return who.bot;
  }
  return slugOf(value, key);
}

function idOf(value) {
  if (!ID_RE.test(value)) throw new Bad(404, 'Not found');
  return value;
}

async function taskRow(db, id) {
  return db.prepare('SELECT * FROM bot_tasks WHERE id = ?').bind(id).first();
}

async function linkedTask(db, body) {
  const id = text(body, 'task', 40);
  if (!id) return null;
  if (!ID_RE.test(id) || !(await taskRow(db, id))) throw new Bad(400, `Unknown task: ${id}`);
  return id;
}

const taskOut = (r) => ({
  id: r.id, title: r.title, owner: r.owner, status: r.status, note: r.note ?? null,
  project: r.project ?? null, minutes: r.minutes ?? null, due: r.due ?? null, stage: r.stage ?? null, stageSince: r.stage_since ?? null,
  createdBy: r.created_by, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at ?? null,
});
const proofOut = (r) => ({
  id: r.id, taskId: r.task_id, kind: r.kind, link: r.link, note: r.note ?? null, status: r.status,
  createdBy: r.created_by, createdAt: r.created_at, checkedBy: r.checked_by ?? null, checkedAt: r.checked_at ?? null,
  checkNote: r.check_note ?? null,
});
const questionOut = (r) => ({
  id: r.id, askedBy: r.asked_by, question: r.question, context: r.context ?? null, options: parseJson(r.options, []),
  taskId: r.task_id ?? null, project: r.project ?? null, minutes: r.minutes ?? null,
  status: r.status, answer: r.answer ?? null, answeredBy: r.answered_by ?? null,
  answeredAt: r.answered_at ?? null, closedBy: r.closed_by ?? null, closedAt: r.closed_at ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const approvalOut = (r) => ({
  id: r.id, action: r.action, title: r.title, payload: parseJson(r.payload, {}), taskId: r.task_id ?? null,
  project: r.project ?? null, minutes: r.minutes ?? null,
  requestedBy: r.requested_by, status: r.status, decidedBy: r.decided_by ?? null, decidedAt: r.decided_at ?? null,
  decisionNote: r.decision_note ?? null, claimedBy: r.claimed_by ?? null, claimedAt: r.claimed_at ?? null,
  doneBy: r.done_by ?? null, doneAt: r.done_at ?? null, doneNote: r.done_note ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const runOut = (r) => ({
  id: r.id, bot: r.bot, startedAt: r.started_at, endedAt: r.ended_at ?? null, status: r.status,
  tokens: r.tokens ?? null, error: r.error ?? null, taskId: r.task_id ?? null, note: r.note ?? null, createdAt: r.created_at,
});

async function list(db, table, where, args, order, limit) {
  const sql = `SELECT * FROM ${table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`;
  const { results } = await db.prepare(sql).bind(...args, limit).all();
  return results || [];
}

function inList(where, args, column, values) {
  if (!values.length) return;
  where.push(`${column} IN (${values.map(() => '?').join(', ')})`);
  args.push(...values);
}

// Insert once per (writer, key): a retried create with the same key returns the first row.
async function insertOnce(db, table, writerColumn, writer, key, id, sql, args) {
  await db.prepare(`${sql} ON CONFLICT DO NOTHING`).bind(...args).run();
  const row = key
    ? await db.prepare(`SELECT * FROM ${table} WHERE ${writerColumn} = ? AND idem_key = ?`).bind(writer, key).first()
    : await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) throw new Error(`${table} insert failed`);
  return { row, duplicate: row.id !== id };
}

// ---- tasks ----

async function createTask(db, who, body, now) {
  const title = text(body, 'title', 300, true);
  const owner = body.owner == null || body.owner === '' ? who.bot : await ownerOf(db, who, body.owner);
  const status = body.status == null ? 'todo' : oneOf(body.status, TASK_STATUSES, 'status');
  if (!OPEN_STATUSES.includes(status)) throw new Bad(400, `A new task starts as ${OPEN_STATUSES.join(', ')}`);
  const note = text(body, 'note', 4000);
  const project = projectOf(body.project);
  const minutes = minutesOf(body);
  const due = matchOf(body, 'due', DAY_RE, '2026-10-29');
  const key = text(body, 'key', 200);
  const id = newId('t');
  const { row, duplicate } = await insertOnce(db, 'bot_tasks', 'created_by', who.bot, key, id,
    `INSERT INTO bot_tasks (id, title, owner, status, note, project, minutes, due, created_by, updated_by, idem_key, created_at, updated_at, done_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [id, title, owner, status, note, project, minutes, due, who.bot, who.bot, key, now, now]);
  if (!duplicate) await logEvent(db, id, now, who.bot, 'created', 'created');
  return json({ ok: true, duplicate, task: taskOut(row) }, duplicate ? 200 : 201);
}

// One history row. Best effort: the change it records is already saved, and failing here would make
// the bot retry (and, for proofs, add a copy).
export async function logEvent(db, taskId, at, by, kind, detail) {
  try {
    await db.prepare('INSERT INTO bot_task_events (id, task_id, at, "by", kind, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('e'), taskId, at, by, kind, detail).run();
  } catch (err) {
    console.error('task history', err);
  }
}

// Done means proof: qc needs a proof QC hasn't failed, review and done need one QC passed.
// A proof that supports a review: QC passed it after Jon last sent the task back (an older pass doesn't count).
const PASSED_SINCE_SENT_BACK = "SELECT 1 FROM bot_proofs p WHERE p.task_id = bot_tasks.id AND p.status = 'passed' AND p.checked_at > "
  + "COALESCE((SELECT MAX(e.at) FROM bot_task_events e WHERE e.task_id = bot_tasks.id AND e.detail LIKE '%(sent back by Jon)'), '')";

async function hasProof(db, taskId, status) {
  const sql = status === 'qc'
    ? "SELECT 1 AS ok FROM bot_proofs WHERE task_id = ? AND status != 'failed' LIMIT 1"
    : status === 'review'
      ? `SELECT 1 AS ok FROM bot_tasks WHERE id = ? AND EXISTS (${PASSED_SINCE_SENT_BACK})`
      : "SELECT 1 AS ok FROM bot_proofs WHERE task_id = ? AND status = 'passed' LIMIT 1";
  return !!(await db.prepare(sql).bind(taskId).first());
}

const CLOSED = 'Jon closed this task. Add a new task if there is more to do';

async function updateTask(db, who, id, body, now) {
  const row = await taskRow(db, id);
  if (!row) throw new Bad(404, 'Task not found');
  if (row.status === 'cancelled' && row.updated_by === 'jon') throw new Bad(409, CLOSED);
  const sets = [];
  const args = [];
  const next = {}; // the history-tracked columns this call sets
  if ('title' in body) { sets.push('title = ?'); args.push(text(body, 'title', 300, true)); }
  if ('owner' in body) {
    const owner = await ownerOf(db, who, body.owner);
    // Jon's tick skips the proof rule, so a task can't move into or out of Jon's hands; create it as his.
    if (owner !== row.owner && (owner === 'jon' || row.owner === 'jon')) {
      throw new Bad(400, 'A task cannot be moved to or from jon; create a new task with owner jon');
    }
    sets.push('owner = ?');
    args.push(next.owner = owner);
  }
  if ('note' in body) { sets.push('note = ?'); args.push(text(body, 'note', 4000)); }
  if ('project' in body) { sets.push('project = ?'); args.push(next.project = projectOf(body.project)); }
  if ('minutes' in body) { sets.push('minutes = ?'); args.push(minutesOf(body)); }
  if ('due' in body) { sets.push('due = ?'); args.push(next.due = matchOf(body, 'due', DAY_RE, '2026-10-29')); }
  // Stage of a staged card (lowercase, e.g. "script", "sponsor review"); '' or null clears it. stage_since moves only
  // when the stage changes, so setting the same stage again keeps how long the card has been in it.
  if ('stage' in body) {
    const stage = text(body, 'stage', 40)?.toLowerCase().replace(/\s+/g, ' ') ?? null;
    if (stage && !/^[a-z0-9][a-z0-9 -]*$/.test(stage)) throw new Bad(400, 'stage: letters, digits, spaces and - only');
    if (stage !== (row.stage ?? null)) { sets.push('stage = ?', 'stage_since = ?'); args.push(next.stage = stage, stage ? now : null); }
  }
  if ('status' in body) {
    const status = next.status = oneOf(body.status, TASK_STATUSES, 'status');
    if (status === 'done') throw new Bad(403, 'Bots cannot set done: Jon approves a task from review to done on the dashboard');
    // 2. Jon's approval is final for bots: a done task never moves again (a new task is the way to reopen work).
    if (row.status === 'done' && status !== 'done') throw new Bad(409, 'Jon approved this task; it is done. Add a new task for more work');
    if (status !== row.status) {
      if (status === 'qc' && !(await hasProof(db, id, 'qc'))) throw new Bad(409, 'Add proof before moving a task to qc');
      if (status === 'review' && !(await hasProof(db, id, 'review'))) throw new Bad(409, 'A task goes to review only when QC has passed one of its proofs (since Jon last sent it back)');
      if (status === 'cancelled' && !text(body, 'note', 4000)) throw new Bad(400, 'Say why in note when cancelling a task');
    }
    sets.push('status = ?', 'done_at = NULL');
    args.push(status);
  }
  if (!sets.length && 'stage' in body) return json({ ok: true, task: taskOut(row) }); // the same stage again: nothing to do
  if (!sets.length) throw new Bad(400, 'Nothing to change: send title, owner, status, note, project, minutes, due or stage');
  // Re-check the proof inside the UPDATE so a QC fail landing in between can't be skipped.
  const moving = 'status' in body && body.status !== row.status ? String(body.status).trim().toLowerCase() : '';
  const guard = moving === 'review' ? ` AND EXISTS (${PASSED_SINCE_SENT_BACK})`
    : moving === 'qc' ? " AND EXISTS (SELECT 1 FROM bot_proofs WHERE task_id = bot_tasks.id AND status != 'failed')" : '';
  const r = await db.prepare(`UPDATE bot_tasks SET ${sets.join(', ')}, updated_by = ?, updated_at = ? WHERE id = ? AND NOT (status = 'cancelled' AND updated_by IS 'jon')${guard}`)
    .bind(...args, who.bot, now, id).run();
  if (!changed(r)) {
    const latest = await taskRow(db, id);
    throw new Bad(409, latest.status === 'cancelled' && latest.updated_by === 'jon' ? CLOSED : 'QC failed the proof just now; add new proof first');
  }
  for (const [key, value] of Object.entries(next)) {
    if ((row[key] ?? null) !== value) await logEvent(db, id, now, who.bot, key, `${key} ${row[key] ?? 'none'} → ${value ?? 'none'}`);
  }
  return json({ ok: true, task: taskOut(await taskRow(db, id)) });
}

// Jon's PATCH. {status: done} ticks off an open task only he can do (owner jon, no proof), or approves
// a task in review. {status: doing, comment} sends a task in review back to its owner: the comment is
// saved and wakes the owner like any comment of his, with data.sentBack. {status: cancelled, comment?}
// closes any unfinished card (Close card); a reason reaches the owner the same way, with data.closed,
// and bots can't reopen the card. `extra` goes with the wake, e.g. the review video. Nothing else.
export async function tickTask(db, env, ctx, id, body, now, extra = {}) {
  const status = oneOf(body.status, ['done', 'doing', 'cancelled'], 'status');
  const close = status === 'cancelled';
  const comment = status === 'doing' ? text(body, 'comment', 4000, true) : close ? text(body, 'comment', 4000) : null;
  const task = await taskRow(db, id);
  if (!task) throw new Bad(404, 'Task not found');
  const tick = status === 'done' && task.owner === 'jon' && task.status !== 'review';
  const from = close ? [...OPEN_STATUSES, 'qc', 'review'] : tick ? OPEN_STATUSES : ['review'];
  const r = await db.prepare(`UPDATE bot_tasks SET status = ?, done_at = ?, updated_by = 'jon', updated_at = ? WHERE id = ? AND status IN (${from.map(() => '?').join(', ')})`)
    .bind(status, status === 'done' ? now : null, now, id, ...from).run();
  const row = await taskRow(db, id);
  if (!changed(r)) {
    const error = tick || close ? `Task is already ${row.status}` : `Task is ${row.status.replace(/_/g, ' ')}; only a task in review can be ${comment ? 'sent back' : 'approved'}`;
    return json({ ok: false, error, task: taskOut(row) }, 409);
  }
  await logEvent(db, id, now, 'jon', tick ? 'tick' : 'status', tick ? 'ticked done'
    : close ? `status ${task.status} → cancelled (closed by Jon)` : `status review → ${status} (${comment ? 'sent back' : 'approved'} by Jon)`);
  if (close) { // its open asks go with it, so nothing approves or answers work on a closed card
    await db.prepare("UPDATE bot_questions SET status = 'closed', closed_by = 'jon', closed_at = ?, updated_at = ? WHERE task_id = ? AND status = 'open'").bind(now, now, id).run();
    await db.prepare("UPDATE bot_approvals SET status = 'cancelled', done_by = 'jon', done_at = ?, done_note = 'card closed', updated_at = ? WHERE task_id = ? AND status = 'pending'").bind(now, now, id).run();
  }
  if (!comment) return json({ ok: true, task: taskOut(row) });
  const c = await postComment(db, env, ctx, { jon: true }, row, comment, now, { ...(close ? { closed: true } : { sentBack: true }), ...extra });
  return json({ ok: true, task: taskOut(row), comment: commentOut(c) });
}

// ---- live on YouTube (Jon, 2026-11-09): "the daily YouTube sync moves its card to Done" ----

// The bot that runs the team's scripts (yt_live_sync.py). Apart from this path, only Jon sets done.
const LIVE_SYNC_BOTS = ['developer'];
const WATCH_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];

// The video id of an https youtube.com/watch?v= or youtu.be/ link, else null. No other link counts as live proof.
export function watchIdOf(value) {
  if (typeof value !== 'string' || value.length > 300) return null;
  let u;
  try { u = new URL(value.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const id = u.hostname === 'youtu.be' ? u.pathname.slice(1)
    : WATCH_HOSTS.includes(u.hostname) && u.pathname === '/watch' ? u.searchParams.get('v') : null;
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

// YouTube's oEmbed answers with no sign-in only for a video anyone can open: 200 with its title. Private, deleted
// or missing: 401, 403 or 404. shortcut: an unlisted video answers 200 too; the sync only sends ids from a channel's public feed.
async function publicVideo(id) {
  const link = `https://www.youtube.com/watch?v=${id}`;
  let r;
  try {
    r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link)}`, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  } catch {
    throw new Bad(502, 'Could not reach YouTube to check the video; try again later');
  }
  if ([400, 401, 403, 404].includes(r.status)) throw new Bad(422, `YouTube says video ${id} is not public (HTTP ${r.status})`);
  const data = r.status === 200 ? await r.json().catch(() => null) : null;
  if (typeof data?.title !== 'string') throw new Bad(502, `YouTube's check of video ${id} failed (HTTP ${r.status}); try again later`);
  return { id, link, title: data.title.slice(0, 300), author: typeof data.author_name === 'string' ? data.author_name.slice(0, 100) : null };
}

// POST tasks/:id/live {link}: the sync found this card's video live. The server checks the video is public itself,
// then saves the watch link as passed proof and moves the card to done in one batch. A done or cancelled card stays.
async function liveDone(db, who, id, body, now) {
  if (!LIVE_SYNC_BOTS.includes(who.bot)) throw new Bad(403, `Only ${LIVE_SYNC_BOTS.join(', ')} can mark a live video done`);
  const videoId = watchIdOf(body.link);
  if (!videoId) throw new Bad(400, 'link must be an https://www.youtube.com/watch?v=… or https://youtu.be/… link');
  const task = await taskRow(db, id);
  if (!task) throw new Bad(404, 'Task not found');
  if (['done', 'cancelled'].includes(task.status)) throw new Bad(409, `Task is already ${task.status}`);
  const video = await publicVideo(videoId);
  const open = "id = ? AND status NOT IN ('done', 'cancelled')";
  const proofId = newId('p');
  const [, moved] = await db.batch([
    db.prepare(`INSERT INTO bot_proofs (id, task_id, kind, link, note, status, created_by, created_at, checked_by, checked_at, check_note)
      SELECT ?, id, 'url', ?, ?, 'passed', ?, ?, ?, ?, ? FROM bot_tasks WHERE ${open}`)
      .bind(proofId, video.link, `Live on YouTube: ${video.title}`, who.bot, now, who.bot, now, 'Public on YouTube (the dashboard checked it)', id),
    db.prepare(`UPDATE bot_tasks SET status = 'done', done_at = ?, updated_by = ?, updated_at = ? WHERE ${open}`).bind(now, who.bot, now, id),
  ]);
  if (!changed(moved)) throw new Bad(409, `Task is already ${(await taskRow(db, id))?.status ?? 'gone'}`);
  await logEvent(db, id, now, who.bot, 'proof', 'proof added (url)');
  await logEvent(db, id, now, who.bot, 'status', `status ${task.status} → done (live on YouTube)`);
  const proof = await db.prepare('SELECT * FROM bot_proofs WHERE id = ?').bind(proofId).first();
  return json({ ok: true, task: taskOut(await taskRow(db, id)), proof: proofOut(proof), video });
}

// ---- internal cards close themselves (Jon, 2026-11-11): "internal tool and dashboard cards close by themselves once
// QC passes and the change is live". Only video, sponsor and money cards wait for Jon. ----

// Ana, and the dispatcher, which calls as ana (DASH_BOT=ana): its other dash.py calls use developer, the bot whose
// own cards this would close, so developer stays refused.
const CLOSE_BOTS = ['ana'];
const JON_PROJECTS = ['sponsors', 'accounting'];
const JON_OWNERS = ['jon', 'sponsors', 'accounting', 'video-editor', 'jon-mac-youtube', 'hgp-scripts', 'home-guide-press'];
// ALLOWLIST: only a card whose project is one of these internal tool/dashboard/code projects may close. Anything else
// (video, money, an unlisted or empty project) waits for Jon.
const INTERNAL_PROJECTS = ['coding'];
// The stages of the video and sponsor-video card types (D:\AgentTeam	ools\card_stages.json); the card's Type itself
// lives only in its progress file, so the stage is what the server can see.
const VIDEO_STAGES = ['brief', 'script', 'pack', 'edit', 'publish', 'sponsor review'];
const IN_LIST = (values) => values.map((v) => `'${v}'`).join(', ');
const norm = (v) => String(v ?? '').toLowerCase().trim();
// The card's newest proof is QC-passed, after Jon last sent it back. datetime() drops milliseconds and Z so
// "10:00:01Z" and "10:00:01.500Z" compare as the same second.
const NEWEST_PASSED = "EXISTS (SELECT 1 FROM bot_proofs p WHERE p.id = (SELECT n.id FROM bot_proofs n WHERE n.task_id = bot_tasks.id "
  + "ORDER BY datetime(n.created_at) DESC, n.created_at DESC, n.rowid DESC LIMIT 1) AND p.status = 'passed' AND datetime(p.checked_at) > "
  + "COALESCE((SELECT MAX(datetime(e.at)) FROM bot_task_events e WHERE e.task_id = bot_tasks.id AND e.detail LIKE '%(sent back by Jon)'), ''))";
const CLOSABLE = `status = 'review' AND ${NEWEST_PASSED} AND lower(trim(COALESCE(project, ''))) IN (${IN_LIST(INTERNAL_PROJECTS)})`
  + ` AND lower(trim(COALESCE(project, ''))) NOT IN (${IN_LIST(JON_PROJECTS)})`
  + ` AND lower(trim(COALESCE(owner, ''))) NOT IN (${IN_LIST(JON_OWNERS)}) AND lower(trim(COALESCE(stage, ''))) NOT IN (${IN_LIST(VIDEO_STAGES)})`;

// POST tasks/:id/close {note?}: review -> done for an internal card whose newest proof QC passed. Everything else is refused.
async function closeTask(db, who, id, body, now) {
  if (!CLOSE_BOTS.includes(who.bot)) throw new Bad(403, `Only ${CLOSE_BOTS.join(', ')} can close a card; Jon approves the rest`);
  const note = text(body, 'note', 500);
  const task = await taskRow(db, id);
  if (!task) throw new Bad(404, 'Task not found');
  if (task.status !== 'review') throw new Bad(409, `Task is ${task.status.replace(/_/g, ' ')}; only a card in review can be closed`);
  if (!INTERNAL_PROJECTS.includes(norm(task.project)) || JON_PROJECTS.includes(norm(task.project)) || JON_OWNERS.includes(norm(task.owner)) || VIDEO_STAGES.includes(norm(task.stage))) {
    throw new Bad(403, 'Video, sponsor and money cards wait for Jon to approve them');
  }
  // The whole rule again inside the UPDATE, so a QC fail or a change landing in between can't be skipped.
  const r = await db.prepare(`UPDATE bot_tasks SET status = 'done', done_at = ?, updated_by = ?, updated_at = ? WHERE id = ? AND ${CLOSABLE}`)
    .bind(now, who.bot, now, id).run();
  if (!changed(r)) throw new Bad(409, "The card's newest proof has not passed QC; it stays in review");
  await logEvent(db, id, now, who.bot, 'status', `status review → done (auto-closed: QC passed and live${note ? `. ${note}` : ''})`);
  return json({ ok: true, task: taskOut(await taskRow(db, id)) });
}

async function listTasks(db, who, q) {
  const where = [];
  const args = [];
  if (q.get('owner')) { where.push('owner = ?'); args.push(whoFilter(who, q.get('owner'), 'owner')); }
  projectFilter(where, args, q);
  inList(where, args, 'status', statusList(q.get('status'), TASK_STATUSES));
  const rows = await list(db, 'bot_tasks', where, args, 'updated_at DESC', limitOf(q));
  return json({ ok: true, tasks: rows.map(taskOut) });
}

async function getTask(db, id) {
  const row = await taskRow(db, id);
  if (!row) throw new Bad(404, 'Task not found');
  const rows = async (sql) => (await db.prepare(sql).bind(id).all()).results || [];
  const proofs = await rows('SELECT * FROM bot_proofs WHERE task_id = ? ORDER BY created_at');
  const comments = await rows('SELECT * FROM bot_task_comments WHERE task_id = ? ORDER BY created_at, rowid');
  const events = await rows('SELECT * FROM bot_task_events WHERE task_id = ? ORDER BY at, rowid');
  // What Jon can do about this card right now: its open questions and pending approvals, as the board shows them.
  const approvals = await rows("SELECT * FROM bot_approvals WHERE task_id = ? AND status = 'pending' ORDER BY created_at");
  const questions = await rows("SELECT * FROM bot_questions WHERE task_id = ? AND status = 'open' ORDER BY created_at");
  const asks = [...approvals.map((r) => approvalItem(approvalOut(r))), ...questions.map((r) => questionItem(questionOut(r)))];
  const deliverable = deliverableOf(proofs.findLast((p) => p.status === 'passed') || proofs.at(-1));
  return json({ ok: true, task: { ...taskOut(row), deliverable, proofs: proofs.map(proofOut), comments: comments.map(commentOut), history: historyOf(row, proofs, events), asks } });
}

// What Jon opens on a Review or Done card: the newest QC-passed proof, else the newest proof.
// Only an http(s) link is `web` (clickable); a file path on GPU1 shows as text.
// status lets the page hold back a review link QC hasn't passed (the QC gate, public/js/pages/projects.js deliverableLink).
const deliverableOf = (p) => (p?.link ? { link: p.link, kind: p.kind, web: /^https?:\/\//i.test(p.link), ...(p.status ? { status: p.status } : {}) } : null);

// Tasks from before history began have no "created" row: start theirs with one, plus the proofs
// added before their first recorded event.
function historyOf(task, proofs, events) {
  const out = events.map((e) => ({ at: e.at, by: e.by, kind: e.kind, detail: e.detail ?? null }));
  if (events.some((e) => e.kind === 'created')) return out;
  const first = events[0]?.at;
  return [
    { at: task.created_at, by: task.created_by, kind: 'created', detail: 'created' },
    ...proofs.filter((p) => !first || p.created_at < first).map((p) => ({ at: p.created_at, by: p.created_by, kind: 'proof', detail: `proof added (${p.kind})` })),
    ...out,
  ];
}

// ---- comments: Jon writes on a card and wakes its owner; the owner bot answers in the thread ----

const commentOut = (r) => ({ id: r.id, taskId: r.task_id, author: r.author, body: r.body, createdAt: r.created_at, wakeStatus: r.wake_status ?? null });
const JON_OWNS = 'owner is Jon';
const WAKE_PAUSES = [2000, 4000]; // ms before each retry of a 503 or an unreachable routine

async function addComment(db, env, ctx, who, taskId, body, now) {
  const task = await taskRow(db, taskId);
  if (!task) throw new Bad(404, 'Task not found');
  const comment = await postComment(db, env, ctx, who, task, text(body, 'body', 4000, true), now);
  return json({ ok: true, comment: commentOut(comment) }, 201);
}

// Saves one comment on the task; Jon's wakes its owner with card_comment, `extra` added to its data.
export async function postComment(db, env, ctx, who, task, body, now, extra = {}) {
  const comment = {
    id: newId('c'), task_id: task.id, author: who.jon ? 'jon' : who.bot, body, created_at: now,
    wake_status: who.jon && task.owner === 'jon' ? JON_OWNS : null, // Jon's note on his own card wakes no one
  };
  await db.prepare('INSERT INTO bot_task_comments (id, task_id, author, body, created_at, wake_status) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(comment.id, task.id, comment.author, comment.body, now, comment.wake_status).run();
  await logEvent(db, task.id, now, comment.author, 'comment', 'commented');
  if (who.jon && task.owner !== 'jon') {
    // In the Worker the wake runs after the reply and retries; without ctx (tests) it is one awaited try.
    const wake = wakeOwner(env, task, comment, ctx?.waitUntil ? WAKE_PAUSES : [], extra).then(async (status) => {
      await db.prepare('UPDATE bot_task_comments SET wake_status = ? WHERE id = ?').bind(status, comment.id).run();
      return status;
    });
    if (ctx?.waitUntil) ctx.waitUntil(wake.catch(() => console.error('card_comment: wake result not saved')));
    else comment.wake_status = await wake.catch(() => null);
  }
  return comment;
}

// POST card_comment to the owner's OpenBot routine, signed exactly like bots/hook.py. An owner without
// a complete route (url and secret) goes to Ana with data.forOwner. Returns the final HTTP status as
// text, "unreachable" or "not configured"; never throws, and never logs the URL or secret.
export async function wakeOwner(env, task, comment, pauses, extra) {
  let hooks = null;
  try { hooks = JSON.parse(env.WEBHOOKS || 'null'); } catch { /* treated as not configured */ }
  const usable = (r) => typeof hooks?.[r]?.url === 'string' && typeof hooks[r].secret === 'string' && !!hooks[r].url && !!hooks[r].secret;
  const route = usable(task.owner) ? task.owner : 'ana';
  if (!usable(route)) return 'not configured';
  const cfg = hooks[route];
  const body = JSON.stringify({
    type: 'card_comment',
    occurredAt: new Date().toISOString(),
    data: {
      task: task.id, title: task.title, project: task.project ?? null, owner: task.owner, comment: comment.body, commentId: comment.id, by: 'jon',
      url: `https://jonmac.ai/dashboard/#projects/${task.project || 'unsorted'}`, ...extra, ...(route === task.owner ? {} : { forOwner: task.owner }),
    },
  });
  // Every try uses the comment id as the delivery id, so the routine runs once however many arrive.
  for (let i = 0; ; i++) {
    let status;
    try {
      const ts = String(Math.floor(Date.now() / 1000));
      const key = await crypto.subtle.importKey('raw', enc.encode(cfg.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${comment.id}.${body}`)));
      const res = await fetch(cfg.url, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json', 'x-openbot-timestamp': ts, 'x-openbot-delivery-id': comment.id,
          'x-openbot-signature': `sha256=${[...sig].map((b) => b.toString(16).padStart(2, '0')).join('')}`,
        },
      });
      status = String(res.status);
    } catch {
      status = 'unreachable';
    }
    if ((status !== '503' && status !== 'unreachable') || i >= pauses.length) return status;
    await new Promise((r) => setTimeout(r, pauses[i]));
  }
}

// ---- proofs ----

async function addProof(db, who, taskId, body, now) {
  if (!(await taskRow(db, taskId))) throw new Bad(404, 'Task not found');
  const kind = oneOf(body.kind, PROOF_KINDS, 'kind');
  const link = linkOf(body.link);
  const note = text(body, 'note', 4000);
  const id = newId('p');
  await db.prepare(
    `INSERT INTO bot_proofs (id, task_id, kind, link, note, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).bind(id, taskId, kind, link, note, who.bot, now).run();
  await logEvent(db, taskId, now, who.bot, 'proof', `proof added (${kind})`);
  const row = await db.prepare('SELECT * FROM bot_proofs WHERE id = ?').bind(id).first();
  return json({ ok: true, proof: proofOut(row) }, 201);
}

async function checkProof(db, who, id, body, now) {
  // QC rules on proof. Ana may also rule on a proof QC posted itself, which nobody else could check.
  if (who.bot !== QC_BOT) {
    const own = who.bot === 'ana' ? await db.prepare('SELECT created_by FROM bot_proofs WHERE id = ?').bind(id).first() : null;
    if (own?.created_by !== QC_BOT) throw new Bad(403, 'Only QC can pass or fail proof (Ana only for proof QC posted)');
  }
  const result = oneOf(body.result, ['passed', 'failed'], 'result');
  const note = text(body, 'note', 4000);
  const r = await db.prepare('UPDATE bot_proofs SET status = ?, checked_by = ?, checked_at = ?, check_note = ? WHERE id = ?')
    .bind(result, who.bot, now, note, id).run();
  if (!changed(r)) throw new Bad(404, 'Proof not found');
  const row = await db.prepare('SELECT * FROM bot_proofs WHERE id = ?').bind(id).first();
  await logEvent(db, row.task_id, now, who.bot, 'check', `proof ${result}`);
  let task = await taskRow(db, row.task_id);
  // A pass moves a task waiting in qc on to review, for Jon to approve.
  if (result === 'passed' && task?.status === 'qc') {
    const moved = await db.prepare("UPDATE bot_tasks SET status = 'review', updated_by = ?, updated_at = ? WHERE id = ? AND status = 'qc'")
      .bind(who.bot, now, task.id).run();
    if (changed(moved)) await logEvent(db, task.id, now, who.bot, 'status', 'status qc → review (QC passed)');
    task = await taskRow(db, task.id);
  }
  // A failed check takes a qc or review task back to doing when no proof still supports it. Done is Jon's
  // decision and stays done; a late fail there only shows on the proof.
  if (result === 'failed' && task && ['qc', 'review'].includes(task.status) && !(await hasProof(db, task.id, task.status))) {
    const was = task.status;
    const back = await db.prepare("UPDATE bot_tasks SET status = 'doing', updated_by = ?, updated_at = ? WHERE id = ? AND status = ?")
      .bind(who.bot, now, task.id, was).run();
    if (changed(back)) await logEvent(db, task.id, now, who.bot, 'status', `status ${was} → doing (QC failed)`);
    task = await taskRow(db, task.id);
  }
  return json({ ok: true, proof: proofOut(row), task: task ? taskOut(task) : null });
}

async function listProofs(db, q) {
  const where = [];
  const args = [];
  if (q.get('task')) { where.push('task_id = ?'); args.push(idOf(q.get('task'))); }
  inList(where, args, 'status', statusList(q.get('status'), ['pending', 'passed', 'failed']));
  const rows = await list(db, 'bot_proofs', where, args, 'created_at DESC', limitOf(q));
  return json({ ok: true, proofs: rows.map(proofOut) });
}

// ---- questions ----

function optionsOf(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Bad(400, 'options must be a list of answers');
  const out = [];
  for (const v of value) {
    const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    if (!s) continue;
    if (s.length > 200) throw new Bad(400, 'each option must be 200 characters or fewer');
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > 10) throw new Bad(400, 'at most 10 options');
  return out;
}

async function questionRow(db, id) {
  return db.prepare('SELECT * FROM bot_questions WHERE id = ?').bind(id).first();
}

async function askQuestion(db, who, body, now) {
  const question = text(body, 'question', 2000, true);
  const options = optionsOf(body.options);
  const context = text(body, 'context', 8000);
  const task = await linkedTask(db, body);
  const project = projectOf(body.project);
  const minutes = minutesOf(body);
  const key = text(body, 'key', 200);
  const id = newId('q');
  const { row, duplicate } = await insertOnce(db, 'bot_questions', 'asked_by', who.bot, key, id,
    `INSERT INTO bot_questions (id, asked_by, question, context, options, task_id, project, minutes, status, idem_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    [id, who.bot, question, context, JSON.stringify(options), task, project, minutes, key, now, now]);
  return json({ ok: true, duplicate, question: questionOut(row) }, duplicate ? 200 : 201);
}

async function listQuestions(db, who, q) {
  const where = [];
  const args = [];
  if (q.get('asked_by')) { where.push('asked_by = ?'); args.push(whoFilter(who, q.get('asked_by'), 'asked_by')); }
  projectFilter(where, args, q);
  inList(where, args, 'status', statusList(q.get('status'), QUESTION_STATUSES));
  const rows = await list(db, 'bot_questions', where, args, 'created_at DESC', limitOf(q));
  return json({ ok: true, questions: rows.map(questionOut) });
}

async function closeQuestion(db, who, id, now) {
  const row = await questionRow(db, id);
  if (!row) throw new Bad(404, 'Question not found');
  // Ana clears stale questions too, e.g. ones a retired bot left open (Jon via Ana, 2026-11-08)
  if (row.asked_by !== who.bot && who.bot !== 'ana') throw new Bad(403, 'Only the bot that asked, or Ana, can close this question');
  if (row.status !== 'closed') {
    await db.prepare("UPDATE bot_questions SET status = 'closed', closed_by = ?, closed_at = ?, updated_at = ? WHERE id = ? AND status != 'closed'")
      .bind(who.bot, now, now, id).run();
  }
  return json({ ok: true, question: questionOut(await questionRow(db, id)) });
}

// First answer wins; Jon only.
async function answerQuestion(db, id, body, now) {
  const answer = text(body, 'answer', 4000, true);
  const r = await db.prepare(
    "UPDATE bot_questions SET status = 'answered', answer = ?, answered_by = 'jon', answered_at = ?, updated_at = ? WHERE id = ? AND status = 'open'",
  ).bind(answer, now, now, id).run();
  const row = await questionRow(db, id);
  if (!row) throw new Bad(404, 'Question not found');
  if (!changed(r)) return json({ ok: false, error: `Question is already ${row.status}`, question: questionOut(row) }, 409);
  return json({ ok: true, question: questionOut(row) });
}

// ---- approvals ----

function payloadOf(value) {
  if (value == null) return '{}';
  if (typeof value !== 'object' || Array.isArray(value)) throw new Bad(400, 'payload must be a JSON object');
  // Jon must be able to read all of it before approving, so it is capped at what the page shows.
  if (JSON.stringify(value, null, 2).length > MAX_PAYLOAD) {
    throw new Bad(400, `payload is longer than ${MAX_PAYLOAD} characters as formatted JSON; put long lists in a file and send its path`);
  }
  return JSON.stringify(value);
}

async function approvalRow(db, id) {
  return db.prepare('SELECT * FROM bot_approvals WHERE id = ?').bind(id).first();
}

async function requestApproval(db, who, body, now) {
  const action = String(body.action ?? '').trim();
  if (!ACTION_RE.test(action)) throw new Bad(400, 'action must be snake_case, like send_pitches');
  const title = text(body, 'title', 300, true);
  const payload = payloadOf(body.payload);
  const task = await linkedTask(db, body);
  const project = projectOf(body.project);
  const minutes = minutesOf(body);
  const key = text(body, 'key', 200);
  const id = newId('a');
  const { row, duplicate } = await insertOnce(db, 'bot_approvals', 'requested_by', who.bot, key, id,
    `INSERT INTO bot_approvals (id, action, title, payload, task_id, project, minutes, requested_by, status, idem_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [id, action, title, payload, task, project, minutes, who.bot, key, now, now]);
  return json({ ok: true, duplicate, approval: approvalOut(row) }, duplicate ? 200 : 201);
}

async function listApprovals(db, who, q) {
  const where = [];
  const args = [];
  if (q.get('action')) {
    const action = q.get('action');
    if (!ACTION_RE.test(action)) throw new Bad(400, 'action must be snake_case, like send_pitches');
    where.push('action = ?');
    args.push(action);
  }
  if (q.get('requested_by')) { where.push('requested_by = ?'); args.push(whoFilter(who, q.get('requested_by'), 'requested_by')); }
  projectFilter(where, args, q);
  inList(where, args, 'status', statusList(q.get('status'), APPROVAL_STATUSES));
  const rows = await list(db, 'bot_approvals', where, args, 'created_at DESC', limitOf(q));
  return json({ ok: true, approvals: rows.map(approvalOut) });
}

async function moveApproval(db, id, fromStatuses, sql, args, gone) {
  const r = await db.prepare(`${sql} WHERE id = ? AND status IN (${fromStatuses.map(() => '?').join(', ')})`)
    .bind(...args, id, ...fromStatuses).run();
  const row = await approvalRow(db, id);
  if (!row) throw new Bad(404, 'Approval not found');
  if (!changed(r)) return json({ ok: false, error: gone(row.status), approval: approvalOut(row) }, 409);
  return json({ ok: true, approval: approvalOut(row) });
}

async function ownApproval(db, who, id, verb) {
  const row = await approvalRow(db, id);
  if (!row) throw new Bad(404, 'Approval not found');
  if (row.requested_by !== who.bot) throw new Bad(403, `Only the bot that asked can ${verb} this approval`);
}

// Carrying out an approval: claim (approved → running, one claimer wins), then done, or release
// to try again later. Nothing can run before Jon approves, and only the bot that asked runs it.
async function claimApproval(db, who, id, now) {
  await ownApproval(db, who, id, 'claim');
  return moveApproval(db, id, ['approved'],
    "UPDATE bot_approvals SET status = 'running', claimed_by = ?, claimed_at = ?, updated_at = ?",
    [who.bot, now, now], (s) => `Approval is ${s}, not approved`);
}

async function finishApproval(db, who, id, body, now) {
  await ownApproval(db, who, id, 'finish');
  const note = text(body, 'note', 4000);
  return moveApproval(db, id, ['running'],
    "UPDATE bot_approvals SET status = 'done', done_by = ?, done_at = ?, done_note = ?, updated_at = ?",
    [who.bot, now, note, now], (s) => `Approval is ${s}; claim it before marking it done`);
}

async function releaseApproval(db, who, id, body, now) {
  await ownApproval(db, who, id, 'release');
  const note = text(body, 'note', 4000);
  return moveApproval(db, id, ['running'],
    "UPDATE bot_approvals SET status = 'approved', claimed_by = NULL, claimed_at = NULL, done_note = ?, updated_at = ?",
    [note, now], (s) => `Approval is ${s}, not running`);
}

async function cancelApproval(db, who, id, body, now) {
  await ownApproval(db, who, id, 'cancel');
  const note = text(body, 'note', 4000);
  return moveApproval(db, id, ['pending', 'approved'],
    "UPDATE bot_approvals SET status = 'cancelled', done_by = ?, done_at = ?, done_note = ?, updated_at = ?",
    [who.bot, now, note, now], (s) => `Approval is already ${s}`);
}

async function decideApproval(db, id, body, now) {
  const decision = oneOf(body.decision, ['approve', 'reject'], 'decision');
  const note = text(body, 'note', 4000);
  return moveApproval(db, id, ['pending'],
    'UPDATE bot_approvals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ?',
    [decision === 'approve' ? 'approved' : 'rejected', 'jon', now, note, now], (s) => `Approval is already ${s}`);
}

// ---- Needs you (Jon, 2026-11-11): Drop or Not now on a row of his work list ----
// Drop: a card closes as Close card does, a question closes, an approval is rejected. Not now: the item leaves the list
// (and the rail count and Blockers) for 24 hours. Each one is written on the linked card's history.
const LATER_MS = 24 * 3600000;
async function needsAct(db, env, ctx, id, verb, now) {
  const kind = id[0];
  const row = kind === 't' ? await taskRow(db, id) : kind === 'q' ? await questionRow(db, id) : kind === 'a' ? await approvalRow(db, id) : null;
  if (!row) throw new Bad(404, 'Not found');
  const card = kind === 't' ? id : row.task_id || null;
  if (verb === 'later') {
    const open = kind === 't' ? !['done', 'cancelled'].includes(row.status) : row.status === (kind === 'q' ? 'open' : 'pending');
    if (!open) throw new Bad(409, `Already ${row.status}`);
    const until = new Date(Date.parse(now) + LATER_MS).toISOString();
    try {
      await db.prepare('DELETE FROM needs_later WHERE until <= ?').bind(now).run(); // expired rows
      await db.prepare('INSERT INTO needs_later (item, until, "by", at) VALUES (?, ?, \'jon\', ?) ON CONFLICT(item) DO UPDATE SET until = excluded.until, at = excluded.at')
        .bind(id, until, now).run();
    } catch (e) {
      if (/no such table/i.test(String(e?.message))) throw new Bad(503, "Not now isn't set up yet");
      throw e;
    }
    if (card) await logEvent(db, card, now, 'jon', 'needs', `not now until ${until} (Needs you)`);
    return json({ ok: true, item: id, until });
  }
  if (kind === 't') return tickTask(db, env, ctx, id, { status: 'cancelled' }, now); // logs "closed by Jon"
  let res;
  if (kind === 'q') {
    const r = await db.prepare("UPDATE bot_questions SET status = 'closed', closed_by = 'jon', closed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'")
      .bind(now, now, id).run();
    const after = await questionRow(db, id);
    res = changed(r) ? json({ ok: true, question: questionOut(after) }) : json({ ok: false, error: `Question is already ${after.status}`, question: questionOut(after) }, 409);
  } else {
    res = await decideApproval(db, id, { decision: 'reject', note: 'dropped by Jon' }, now);
  }
  if (res.ok && card) await logEvent(db, card, now, 'jon', 'needs', `${kind === 'q' ? 'question' : 'approval'} dropped by Jon (Needs you): ${String(kind === 'q' ? row.question : row.title).slice(0, 120)}`);
  return res;
}

// ---- runs ----

async function reportRun(db, who, body, now) {
  if (body.bot != null && body.bot !== who.bot) throw new Bad(403, 'A bot can only report its own runs');
  const status = oneOf(body.status, RUN_STATUSES, 'status');
  const started = isoOf(body.started, 'started') || now;
  const ended = isoOf(body.ended, 'ended');
  if (ended && ended < started) throw new Bad(400, 'ended is before started');
  let tokens = null;
  if (body.tokens != null && body.tokens !== '') {
    tokens = Number(body.tokens);
    if (!Number.isInteger(tokens) || tokens < 0 || tokens > 1e12) throw new Bad(400, 'tokens must be a whole number');
  }
  const error = text(body, 'error', 4000);
  const note = text(body, 'note', 1000);
  const task = await linkedTask(db, body);
  const id = newId('r');
  await db.prepare(
    `INSERT INTO bot_runs (id, bot, started_at, ended_at, status, tokens, error, task_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, who.bot, started, ended, status, tokens, error, task, note, now).run();
  const row = await db.prepare('SELECT * FROM bot_runs WHERE id = ?').bind(id).first();
  return json({ ok: true, run: runOut(row) }, 201);
}

async function listRuns(db, who, q) {
  const where = [];
  const args = [];
  if (q.get('bot')) { where.push('bot = ?'); args.push(whoFilter(who, q.get('bot'), 'bot')); }
  inList(where, args, 'status', statusList(q.get('status'), RUN_STATUSES));
  if (q.get('since')) { where.push('started_at >= ?'); args.push(isoOf(q.get('since'), 'since')); }
  const rows = await list(db, 'bot_runs', where, args, 'started_at DESC', limitOf(q));
  return json({ ok: true, runs: rows.map(runOut) });
}

function changed(result) {
  return Number(result?.meta?.changes || 0) > 0;
}

// ---- feeds (step 2): small documents for the Today page, append-only, newest wins ----

function numberOf(body, key, min, max, required = false) {
  const v = body[key];
  if (v == null || v === '') {
    if (required) throw new Bad(400, `${key} is required`);
    return null;
  }
  const n = Number(v);
  if (typeof v === 'boolean' || !Number.isFinite(n) || n < min || n > max) throw new Bad(400, `${key} must be a number from ${min} to ${max}`);
  return n;
}

function matchOf(body, key, re, hint, required = false) {
  const s = text(body, key, 40, required);
  if (s && !re.test(s)) throw new Bad(400, `${key} must look like ${hint}`);
  return s;
}

export const FEEDS = {
  morning_summary: {
    writers: ['ana'],
    parse: (b) => ({ text: text(b, 'text', 8000, true), date: matchOf(b, 'date', /^\d{4}-\d{2}-\d{2}$/, '2026-10-29') }),
  },
  calendar_today: {
    writers: ['ana'],
    parse: (b) => {
      if (!Array.isArray(b.events) || b.events.length > 60) throw new Bad(400, 'events must be a list of at most 60 events');
      const events = b.events.map((e) => {
        if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Bad(400, 'each event must be {start, end, title, calendar?}');
        const calendar = text(e, 'calendar', 100);
        return { start: text(e, 'start', 40, true), end: text(e, 'end', 40, true), title: text(e, 'title', 300, true), ...(calendar ? { calendar } : {}) };
      });
      return { date: matchOf(b, 'date', DAY_RE, '2026-10-29', true), events };
    },
  },
  claude_usage: {
    writers: ['ana'],
    parse: (b) => ({ weekPct: numberOf(b, 'weekPct', 0, 1000, true), resetsAt: isoOf(b.resetsAt, 'resetsAt'), note: text(b, 'note', 500) }),
  },
  ebook_sales: {
    writers: ['home-guide-press', 'accounting'],
    parse: (b) => {
      const orders = numberOf(b, 'orders', 0, 1e7);
      if (orders != null && !Number.isInteger(orders)) throw new Bad(400, 'orders must be a whole number');
      return { month: matchOf(b, 'month', /^\d{4}-(0[1-9]|1[0-2])$/, '2026-10', true), usd: numberOf(b, 'usd', 0, 1e9, true), orders, note: text(b, 'note', 500) };
    },
  },
  // The dispatcher's live state (tools/dash_live_feed.py, every 2 min): beat, weekly limit, running runs,
  // tokens, ok/failed runs and fails per bot today, approved videos waiting. Only 2 days are kept.
  dispatch_live: {
    writers: ['developer', 'ana'],
    keepDays: 2,
    parse: (b) => {
      const list = (k, max, src = b) => {
        const v = src[k] ?? [];
        if (!Array.isArray(v) || v.length > max) throw new Bad(400, `${k} must be a list of at most ${max}`);
        if (!v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) throw new Bad(400, `each ${k} item must be an object`);
        return v.map((x) => Object.fromEntries(Object.entries(x).slice(0, 8).map(([key, val]) => [key, typeof val === 'number' ? val : String(val ?? '').slice(0, 200)])));
      };
      const map = (k, f) => {
        const v = b[k] ?? {};
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 40) throw new Bad(400, `${k} must be {bot: …} with at most 40 bots`);
        return Object.fromEntries(Object.entries(v).map(([bot, x]) => [bot.slice(0, 40), f(x)]));
      };
      const whole = (x) => { const n = Number(x); if (!Number.isInteger(n) || n < 0 || n > 1e12) throw new Bad(400, 'counts must be whole numbers'); return n; };
      const w = b.week;
      const week = w && typeof w === 'object' ? { pct: numberOf(w, 'pct', 0, 1000, true), resets: text(w, 'resets', 80), at: isoOf(w.at, 'week.at') } : null;
      const a = b.approved;
      const approved = a && typeof a === 'object' ? { count: whole(a.count), items: list('items', 40, a) } : null;
      const h = b.heygen; // HeyGen submits today from the shared submit log
      const heygen = h && typeof h === 'object' && !Array.isArray(h) ? { accepted: whole(h.accepted ?? 0), refused: whole(h.refused ?? 0), failed: whole(h.failed ?? 0), last: h.last == null ? null : String(h.last).slice(0, 40) } : null;
      return {
        at: isoOf(b.at, 'at'), beat: b.beat ? isoOf(b.beat, 'beat') : null, week,
        running: list('running', 60), fails: list('fails', 80),
        tokens: map('tokens', whole), runs: map('runs', (x) => ({ ok: whole(x?.ok ?? 0), failed: whole(x?.failed ?? 0) })),
        approved, heygen,
      };
    },
  },
  // The video program's board (a pusher on GPU1, as often as every 5 s: dash.py feed-put video_line --data-file
  // board.json), shown on Dashboard 3's Factory page. Shapes are checked (400 when wrong); long text and long lists are
  // cut, never refused: 60 jobs, 20 steps and 20 stages a job, the newest 20 events, 300 characters a string. Only the newest entry is
  // ever read, so only the last 30 minutes are kept.
  video_line: {
    writers: ['developer', 'ana'],
    keepMinutes: 30,
    parse: (b) => {
      const obj = (v, k) => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Bad(400, `${k} must be an object`); return v; };
      const arr = (v, k) => { if (!Array.isArray(v)) throw new Bad(400, `${k} must be a list`); return v; };
      const str = (v, k) => {
        if (v == null) return '';
        if (typeof v !== 'string' && typeof v !== 'number') throw new Bad(400, `${k} must be text`);
        return String(v).slice(0, 300);
      };
      const whole = (v, k) => {
        if (v == null) return 0;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1e6) throw new Bad(400, `${k} must be a whole number`);
        return v;
      };
      const when = (v, k) => (v == null || v === '' ? null : isoOf(v, k));
      // A step's own sub-steps, in the order the work happens (the Factory page draws a column for each). Unlike the
      // rest of the board nothing here is cut: a part that is not right is a 400, so no sub-step goes missing quietly.
      const PART_STATUS = ['todo', 'running', 'done', 'failed', 'waiting'];
      const part = (p, k) => {
        obj(p, k);
        if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40) throw new Bad(400, `${k}.name must be text of 1 to 40 characters`);
        if (!PART_STATUS.includes(p.status)) throw new Bad(400, `${k}.status must be one of ${PART_STATUS.join(', ')}`);
        if (p.note != null && (typeof p.note !== 'string' || p.note.length > 300)) throw new Bad(400, `${k}.note must be text of at most 300 characters`);
        // Optional live progress of the part: done of total (whole numbers), when it started, and how many seconds it
        // took once it ended. Kept only when sent; a wrong type is a 400 like the rest of the part.
        const count = (key) => {
          if (p[key] == null) return {};
          if (typeof p[key] !== 'number' || !Number.isInteger(p[key]) || p[key] < 0 || p[key] > 1e9) throw new Bad(400, `${k}.${key} must be a whole number, 0 or more`);
          return { [key]: p[key] };
        };
        if (p.started != null && typeof p.started !== 'string') throw new Bad(400, `${k}.started must be an ISO date and time or null`);
        const started = when(p.started, `${k}.started`);
        if (p.seconds != null && (typeof p.seconds !== 'number' || !Number.isFinite(p.seconds) || p.seconds < 0 || p.seconds > 1e9)) throw new Bad(400, `${k}.seconds must be a number, 0 or more, or null`);
        return { name: p.name.trim(), status: p.status, note: p.note ?? '', ...count('done'), ...count('total'), ...(started ? { started } : {}), ...(p.seconds != null ? { seconds: p.seconds } : {}) };
      };
      // The channels the Factory page groups the videos under, in this order (a channel with no video still shows).
      // Strict like parts: a channel that is not right is a 400.
      const channels = (v) => {
        if (arr(v, 'channels').length > 20) throw new Bad(400, 'channels must have at most 20 entries');
        const seen = new Set();
        return v.map((c, n) => {
          const k = `channels[${n}]`;
          obj(c, k);
          const one = (key, max) => {
            if (typeof c[key] !== 'string' || !c[key].trim() || c[key].length > max) throw new Bad(400, `${k}.${key} must be text of 1 to ${max} characters`);
            return c[key].trim();
          };
          const id = one('id', 40);
          if (seen.has(id)) throw new Bad(400, `${k}.id is listed twice`);
          seen.add(id);
          if (c.note != null && (typeof c.note !== 'string' || c.note.length > 200)) throw new Bad(400, `${k}.note must be text of at most 200 characters`);
          return { id, label: one('label', 60), ...(c.note?.trim() ? { note: c.note.trim() } : {}) };
        });
      };
      const parts = (v, k) => {
        if (arr(v, k).length > 30) throw new Bad(400, `${k} must have at most 30 entries`);
        return v.map((p, n) => part(p, `${k}[${n}]`));
      };
      // A link a stage may carry: only a page or a file under jonmac.ai's own review pages. '' for anything else.
      const lookUrl = (v, k) => {
        if (v == null || v === '') return '';
        if (typeof v !== 'string') throw new Bad(400, `${k} must be text`);
        return /^https:\/\/jonmac\.ai\/review\/[a-z0-9][a-z0-9-]{0,79}(\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,79})?$/.test(v) ? v : '';
      };
      const step = (s, k) => {
        obj(s, k);
        if (s.minutes != null && (typeof s.minutes !== 'number' || !Number.isFinite(s.minutes) || s.minutes < 0 || s.minutes > 1e6)) throw new Bad(400, `${k}.minutes must be a number or null`);
        if (!str(s.name, `${k}.name`)) throw new Bad(400, `${k}.name is required`);
        return {
          name: str(s.name), ...(s.label != null ? { label: str(s.label, `${k}.label`).slice(0, 40) } : {}),
          status: str(s.status, `${k}.status`), tries: whole(s.tries, `${k}.tries`), minutes: s.minutes ?? null,
          started: when(s.started, `${k}.started`), ended: when(s.ended, `${k}.ended`),
          note: str(s.note, `${k}.note`), fix: str(s.fix, `${k}.fix`), doing: str(s.doing, `${k}.doing`),
          // Optional progress inside a running step ("8 of 11 checks"): kept only when the step sends it.
          ...(s.done != null ? { done: whole(s.done, `${k}.done`) } : {}), ...(s.total != null ? { total: whole(s.total, `${k}.total`) } : {}),
          ...(s.parts != null ? { parts: parts(s.parts, `${k}.parts`) } : {}),
          // What a stage made, for the page to show: its text (a video's title) and a link (its thumbnail), kept only when sent.
          ...(s.text != null && str(s.text, `${k}.text`) ? { text: str(s.text).slice(0, 160) } : {}),
          ...(lookUrl(s.url, `${k}.url`) ? { url: lookUrl(s.url, `${k}.url`) } : {}),
        };
      };
      const totalMin = (v, k) => {
        if (v == null) return null;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e7) throw new Bad(400, `${k} must be a number or null`);
        return v;
      };
      const reviewUrl = (v, k) => {
        if (v == null || v === '') return '';
        if (typeof v !== 'string') throw new Bad(400, `${k} must be text`);
        return /^https:\/\/jonmac\.ai\/review\/[a-z0-9][a-z0-9-]{0,79}$/.test(v) ? v : '';
      };
      const job = (j, i) => {
        const k = `jobs[${i}]`;
        obj(j, k);
        if (!str(j.id, `${k}.id`)) throw new Bad(400, `${k}.id is required`);
        if (!str(j.state, `${k}.state`)) throw new Bad(400, `${k}.state is required`);
        const np = j.needs_person == null ? null : obj(j.needs_person, `${k}.needs_person`);
        return {
          id: str(j.id), channel: str(j.channel, `${k}.channel`), pipeline: str(j.pipeline, `${k}.pipeline`), created: when(j.created, `${k}.created`),
          state: str(j.state), step: str(j.step, `${k}.step`), minutes_in_state: str(j.minutes_in_state, `${k}.minutes_in_state`), note: str(j.note, `${k}.note`),
          steps_done: whole(j.steps_done, `${k}.steps_done`), steps_total: whole(j.steps_total, `${k}.steps_total`),
          needs_person: np && { step: str(np.step, `${k}.needs_person.step`), why: str(np.why, `${k}.needs_person.why`), look_at: str(np.look_at, `${k}.needs_person.look_at`), since: str(np.since, `${k}.needs_person.since`) },
          final: str(j.final, `${k}.final`),
          steps: arr(j.steps ?? [], `${k}.steps`).slice(0, 20).map((s, n) => step(s, `${k}.steps[${n}]`)),
          // The page's own columns: the steps folded into a few stages (Outlier, Script, QC, ...), each shaped as a step
          // with a `label`. Kept only when sent; the page then draws the stages and not the steps.
          ...(j.stages != null ? { stages: arr(j.stages, `${k}.stages`).slice(0, 20).map((s, n) => step(s, `${k}.stages[${n}]`)) } : {}),
          // The whole time the video took: `started` to `ended` (null while it is still being made) and those minutes.
          started: when(j.started, `${k}.started`), ended: when(j.ended, `${k}.ended`),
          total_minutes: totalMin(j.total_minutes, `${k}.total_minutes`),
          // The video's review page. Only a jonmac.ai review address is kept: the page makes a link of it.
          ...(reviewUrl(j.review_url, `${k}.review_url`) ? { review_url: reviewUrl(j.review_url, `${k}.review_url`) } : {}),
        };
      };
      if (b.scheduler_running != null && typeof b.scheduler_running !== 'boolean') throw new Bad(400, 'scheduler_running must be true, false or null');
      const c = obj(b.counts ?? {}, 'counts');
      return {
        updated: isoOf(b.updated, 'updated', true),
        scheduler_running: b.scheduler_running ?? null,
        channels: b.channels == null ? null : channels(b.channels),
        counts: Object.fromEntries(['jobs', 'done', 'running', 'needs_person'].map((k) => [k, whole(c[k], `counts.${k}`)])),
        jobs: arr(b.jobs, 'jobs').slice(0, 60).map(job),
        events: arr(b.events ?? [], 'events').slice(-20).map((e) => { if (typeof e !== 'string') throw new Bad(400, 'each event must be text'); return e.slice(0, 300); }),
        unreadable_jobs: arr(b.unreadable_jobs ?? [], 'unreadable_jobs').slice(0, 60).map((x) => (typeof x === 'string' ? x : JSON.stringify(x) ?? '').slice(0, 300)),
      };
    },
  },
  // Each project's daily items, from D:\AgentTeam\rules\facts\daily-checklists.md (dash.py daily-sync).
  daily_checklists: {
    writers: ['ana', 'developer'],
    parse: (b) => {
      const all = b.projects;
      if (!all || typeof all !== 'object' || Array.isArray(all)) throw new Bad(400, 'projects must be {slug: [item, …]}');
      const projects = {};
      for (const [slug, items] of Object.entries(all)) {
        if (!PROJECT_SLUGS.includes(slug)) throw new Bad(400, `Unknown project ${slug}; use ${PROJECT_SLUGS.join(', ')}`);
        if (!Array.isArray(items) || items.length > 12) throw new Bad(400, `${slug} must be a list of at most 12 items`);
        projects[slug] = items.map((v) => {
          const s = typeof v === 'string' ? v.trim() : '';
          if (!s || s.length > 200) throw new Bad(400, `each ${slug} item must be text of 1 to 200 characters`);
          return s;
        });
        if (new Set(projects[slug].map(fold)).size < items.length) throw new Bad(400, `${slug} lists the same item twice`);
      }
      return { projects };
    },
  },
};

function feedSpec(name) {
  const spec = Object.hasOwn(FEEDS, name) ? FEEDS[name] : null;
  if (!spec) throw new Bad(404, `Unknown feed. Feeds: ${Object.keys(FEEDS).join(', ')}`);
  return spec;
}

// How long a feed's entries are kept, in milliseconds: its keepMinutes, else its keepDays; 0 keeps everything.
export const feedKeepMs = (spec) => (spec?.keepMinutes ? spec.keepMinutes * 60000 : spec?.keepDays ? spec.keepDays * 86400000 : 0);

const feedOut = (r) => ({ id: r.id, name: r.name, bot: r.bot, data: parseJson(r.data, {}), createdAt: r.created_at });

async function latestFeed(db, name) {
  return db.prepare('SELECT * FROM bot_feed_entries WHERE name = ? ORDER BY created_at DESC LIMIT 1').bind(name).first();
}

async function putFeed(db, who, name, body, now) {
  const spec = feedSpec(name);
  if (!spec.writers.includes(who.bot)) throw new Bad(403, `Only ${spec.writers.join(' or ')} can post ${name}`);
  const data = Object.fromEntries(Object.entries(spec.parse(body)).filter(([, v]) => v != null));
  const id = newId('f');
  await db.prepare('INSERT INTO bot_feed_entries (id, name, bot, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, name, who.bot, JSON.stringify(data), now).run();
  const keep = feedKeepMs(spec);
  if (keep) {
    const cut = new Date(Date.parse(now) - keep).toISOString();
    await db.prepare('DELETE FROM bot_feed_entries WHERE name = ? AND created_at < ?').bind(name, cut).run();
  }
  return json({ ok: true, feed: feedOut(await db.prepare('SELECT * FROM bot_feed_entries WHERE id = ?').bind(id).first()) }, 201);
}

async function getFeed(db, name) {
  feedSpec(name);
  const row = await latestFeed(db, name);
  return json({ ok: true, feed: row ? feedOut(row) : null });
}

// ---- Factory (Jon, 2026-11-05): the live production board. One row, overwritten by a plain script on GPU1
// (tools/factory_publish.py: no bot, no model, no tokens); the page only fetches it. ----

const FACTORY_WRITERS = ['moneyclaw', 'ana', 'developer'];

async function putFactory(db, who, body, now) {
  needBot(who);
  if (!FACTORY_WRITERS.includes(who.bot)) throw new Bad(403, `Only ${FACTORY_WRITERS.join(', ')} can post the factory`);
  if (!Array.isArray(body.columns) || body.columns.length > 20) throw new Bad(400, 'columns must be a list of at most 20');
  if (!Array.isArray(body.tiles) || body.tiles.length > 600) throw new Bad(400, 'tiles must be a list of at most 600');
  if (!body.columns.every((c) => typeof c === 'string')) throw new Bad(400, 'columns must be names');
  if (!body.tiles.every((t) => t && typeof t === 'object' && !Array.isArray(t))) throw new Bad(400, 'every tile must be an object');
  await db.prepare("INSERT OR REPLACE INTO snapshots (source, data, collected_at, received_at) VALUES ('factory', ?, ?, ?)")
    .bind(JSON.stringify(body), now, now).run();
  return json({ ok: true, asOf: now });
}

async function getFactory(db) {
  const row = await db.prepare("SELECT data, collected_at FROM snapshots WHERE source = 'factory'").first();
  let extra = [];
  try { extra = (await db.prepare('SELECT slug, label, grp FROM yt_channels').all()).results || []; } catch { extra = []; }
  return json({ ok: true, factory: row ? parseJson(row.data, null) : null, asOf: row ? row.collected_at : null, channels: allChannels(extra) });
}

// ---- Weekly and Monthly pages (Jon, 2026-11-05): one counts row posted by tools/factory_publish.py (a plain script,
// no model, no bot wake), and Jon's own habit ticks for the current week and month. ----

const PERIOD_WRITERS = ['moneyclaw', 'ana', 'developer'];

async function putPeriods(db, who, body, now) {
  needBot(who);
  if (!PERIOD_WRITERS.includes(who.bot)) throw new Bad(403, `Only ${PERIOD_WRITERS.join(', ')} can post the weekly counts`);
  if (!/^\d{4}-\d\d-\d\d$/.test(String(body.weekStart || ''))) throw new Bad(400, 'weekStart must be the Monday date, YYYY-MM-DD');
  if (!Array.isArray(body.groups) || body.groups.length > 12) throw new Bad(400, 'groups must be a list of at most 12');
  for (const g of body.groups) {
    if (typeof g?.title !== 'string' || !Array.isArray(g.rows) || g.rows.length > 60) throw new Bad(400, 'each group needs a title and at most 60 rows');
    for (const r of g.rows) {
      if (typeof r?.label !== 'string' || !Number.isFinite(r.target) || !Number.isFinite(r.done)) throw new Bad(400, 'each row needs label, target and done');
    }
  }
  if (body.report != null) {
    const r = body.report;
    const okRow = (x) => x && typeof x.label === 'string' && Number.isFinite(x.planned) && Number.isFinite(x.done);
    const okWeek = (w) => w && /^\d{4}-\d\d-\d\d$/.test(String(w.weekStart || '')) && Number.isFinite(Date.parse(w.weekStart)) && Array.isArray(w.rows) && w.rows.length <= 12 && w.rows.every(okRow);
    const okCarry = (c) => c && typeof c.title === 'string' && Number.isFinite(c.slipped);
    if (typeof r !== 'object' || !Array.isArray(r.weeks) || r.weeks.length > 12 || !Array.isArray(r.carry) || r.carry.length > 200) throw new Bad(400, 'report needs weeks (at most 12) and carry (at most 200)');
    if (!r.weeks.every(okWeek)) throw new Bad(400, 'each report week needs weekStart and at most 12 rows with label, planned and done');
    if (!r.carry.every(okCarry)) throw new Bad(400, 'each carried-over item needs a title and weeks slipped');
  }
  await db.prepare("INSERT OR REPLACE INTO snapshots (source, data, collected_at, received_at) VALUES ('periods', ?, ?, ?)")
    .bind(JSON.stringify(body), now, now).run();
  return json({ ok: true, asOf: now });
}

async function getPeriods(db, now) {
  const row = await db.prepare("SELECT data, collected_at FROM snapshots WHERE source = 'periods'").first();
  const t = Date.parse(now);
  const week = weekStart(t);
  const month = monthKey(t);
  const { results } = await db.prepare("SELECT kind, done FROM habits WHERE (day = ? AND kind LIKE 'wk:%') OR (day = ? AND kind LIKE 'mo:%')").bind(week, month).all();
  const ticked = new Set((results || []).filter((h) => Number(h.done)).map((h) => h.kind));
  const mark = (prefix, list) => list.map((h) => ({ ...h, done: ticked.has(`${prefix}:${h.key}`) }));
  return json({ ok: true, week, month, weekly: row ? parseJson(row.data, null) : null, asOf: row ? row.collected_at : null,
    weekHabits: mark('wk', WEEK_HABITS), monthHabits: mark('mo', MONTH_HABITS) });
}

async function tickPeriod(db, who, body, now) {
  needJon(who);
  const week = body.scope === 'week';
  const list = week ? WEEK_HABITS : body.scope === 'month' ? MONTH_HABITS : null;
  if (!list || !list.some((h) => h.key === body.key) || typeof body.done !== 'boolean') throw new Bad(400, 'scope (week or month), key and done are required');
  const day = week ? weekStart(Date.parse(now)) : monthKey(Date.parse(now));
  await upsertHabit(db, day, `${week ? 'wk' : 'mo'}:${body.key}`, body.done ? 1 : 0, '');
  return json({ ok: true, day });
}

// ---- daily checklists: the owning bot ticks an item for today (Vancouver) with a proof link ----

const DAILY_TICKERS = {
  sponsors: ['sponsors'],
  'jon-mac': ['jon-mac-youtube', 'video-editor'],
  jonmacai: ['jon-mac-youtube', 'video-editor'],
  'viral-view': ['viral-view'],
  'home-guide-press': ['home-guide-press'],
  'short-form': ['short-form'],
  accounting: ['accounting'],
  coding: ['developer'],
};
const fold = (s) => s.trim().toLowerCase();
const tickOut = (r) => ({ day: r.day, project: r.project, item: r.item, bot: r.bot, link: r.link, note: r.note ?? null, createdAt: r.created_at });

async function tickDaily(db, who, body, now) {
  const project = oneOf(body.project, PROJECT_SLUGS, 'project');
  const tickers = DAILY_TICKERS[project] || [];
  if (!tickers.includes(who.bot)) throw new Bad(403, `Only ${tickers.join(' or ') || 'its owning bot'} can tick ${project}`);
  const items = parseJson((await latestFeed(db, 'daily_checklists'))?.data, {}).projects?.[project] || [];
  const want = text(body, 'item', 200, true);
  // The item's text (any case), else its 1-based number in the list.
  const item = items.find((x) => fold(x) === fold(want)) ?? (/^\d+$/.test(want) ? items[Number(want) - 1] : undefined);
  if (!item) throw new Bad(400, `item must be one of ${project}'s daily items: ${items.map((x, i) => `${i + 1}. ${x}`).join(' ') || 'none yet'}`);
  const link = linkOf(body.link);
  const note = text(body, 'note', 4000);
  const day = ymd(Date.parse(now));
  // A bot may re-tick its own item (new proof); on a shared tab it can't overwrite another bot's tick.
  await db.prepare(`INSERT INTO bot_daily_ticks (id, day, project, item, bot, link, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (day, project, item) DO UPDATE SET link = excluded.link, note = excluded.note, created_at = excluded.created_at
    WHERE bot_daily_ticks.bot = excluded.bot`)
    .bind(newId('d'), day, project, item, who.bot, link, note, now).run();
  const row = await db.prepare('SELECT * FROM bot_daily_ticks WHERE day = ? AND project = ? AND item = ?').bind(day, project, item).first();
  if (row.bot !== who.bot) throw new Bad(409, `${row.bot} already ticked "${item}" today`);
  return json({ ok: true, tick: tickOut(row) });
}

async function listDaily(db, q) {
  const day = q.get('day') || ymd(Date.now());
  if (!DAY_RE.test(day)) throw new Bad(400, 'day must look like 2026-10-29');
  const { results } = await db.prepare('SELECT * FROM bot_daily_ticks WHERE day = ? ORDER BY project, created_at').bind(day).all();
  return json({ ok: true, day, ticks: (results || []).map(tickOut) });
}

// ---- activity (the Feed page, 2026-10-30): every update from every bot, newest first ----

// One row per update: who did it, whose item it is (`owner`, for the bot filter) and the task it is on.
// Comments and proofs come from their own tables (body, link), so their history rows are skipped.
// D1 allows at most 5 terms in a compound SELECT, so the seven sources are read as two unions and merged.
// shortcut: each page reads all five tables; add created_at indexes or a date floor past ~50k rows.
const ACTIVITY = [`SELECT id, at, "by" AS who, kind, task_id AS task, detail AS body, NULL AS link, NULL AS item, NULL AS whose, 0 AS pending
    FROM bot_task_events WHERE kind NOT IN ('comment', 'proof')
  UNION ALL SELECT id, created_at, author, 'comment', task_id, body, NULL, NULL, NULL, 0 FROM bot_task_comments
  UNION ALL SELECT id, created_at, created_by, 'proof', task_id, kind, link, NULL, NULL, 0 FROM bot_proofs
  UNION ALL SELECT id, created_at, asked_by, 'question', task_id, NULL, NULL, question, asked_by, status = 'open' FROM bot_questions`,
`SELECT id, answered_at AS at, answered_by AS who, 'answer' AS kind, task_id AS task, answer AS body, NULL AS link, question AS item, asked_by AS whose, 0 AS pending
    FROM bot_questions WHERE answered_at IS NOT NULL
  UNION ALL SELECT id, created_at, requested_by, 'approval', task_id, NULL, NULL, title, requested_by, status = 'pending' FROM bot_approvals
  UNION ALL SELECT id, decided_at, decided_by, 'decision', task_id, CASE status WHEN 'rejected' THEN 'rejected' ELSE 'approved' END
    || COALESCE(': ' || decision_note, ''), NULL, title, requested_by, 0 FROM bot_approvals WHERE decided_at IS NOT NULL`,
].map((part) => `SELECT x.id, x.at, x.who, x.kind, x.task, x.body, x.link, x.pending,
  COALESCE(x.item, t.title) AS title, COALESCE(x.whose, t.owner) AS owner FROM (${part}) x LEFT JOIN bot_tasks t ON t.id = x.task`);
const newestFirst = (a, b) => (a.at === b.at ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.at < b.at ? 1 : -1);
const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([a-z]_[0-9a-f]{16})$/;

async function listActivity(db, q) {
  const where = [];
  const args = [];
  if (q.get('bot')) {
    const bot = slugOf(q.get('bot'), 'bot');
    where.push('(x.who = ? OR COALESCE(x.whose, t.owner) = ?)');
    args.push(bot, bot);
  }
  if (q.get('before')) {
    const m = CURSOR_RE.exec(q.get('before'));
    if (!m) throw new Bad(400, 'before must be the next value from the previous page');
    where.push('(x.at < ? OR (x.at = ? AND x.id < ?))');
    args.push(m[1], m[1], m[2]);
  }
  const limit = Math.min(limitOf(q), 300);
  const tail = `${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY x.at DESC, x.id DESC LIMIT ?`;
  const parts = await Promise.all(ACTIVITY.map((sql) => db.prepare(sql + tail).bind(...args, limit).all()));
  const rows = parts.flatMap((r) => r.results || []).sort(newestFirst).slice(0, limit);
  const items = rows.map((r) => ({
    id: r.id, at: r.at, who: r.who, owner: r.owner ?? null, kind: r.kind, taskId: r.task ?? null,
    title: r.title ?? null, body: r.body ?? null, link: r.link ?? null, pending: !!r.pending,
  }));
  const last = rows.at(-1);
  return json({ ok: true, items, next: rows.length === limit ? `${last.at}|${last.id}` : null });
}

// ---- journal (2026-10-30): Jon's own links and ideas for later. Jon only; bot tokens get 403 ----

const TAG_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const journalOut = (r) => ({
  id: r.id, title: r.title, link: r.link ?? null, note: r.note ?? null, tags: parseJson(r.tags, []), createdAt: r.created_at, updatedAt: r.updated_at,
});
const journalRow = (db, id) => db.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(id).first();

// Tags as a list or one string ("ideas, yt #later"): lowercase words, no repeats, at most 10.
function tagsOf(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : null;
  if (!list || list.some((v) => typeof v !== 'string')) throw new Bad(400, 'tags must be a list of words');
  const out = [];
  for (const v of list) {
    const s = v.trim().replace(/^#/, '').toLowerCase();
    if (!s) continue;
    if (!TAG_RE.test(s)) throw new Bad(400, 'each tag is one word of letters, digits or dashes, up to 30 characters');
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > 10) throw new Bad(400, 'at most 10 tags');
  return out;
}

async function addJournal(db, body, now) {
  const link = webLinkOf(body);
  const title = text(body, 'title', 300) || (link ? new URL(link).hostname.replace(/^www\./, '') : null);
  if (!title) throw new Bad(400, 'Write something or paste a link');
  const id = newId('j');
  await db.prepare('INSERT INTO journal_entries (id, title, link, note, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, title, link, text(body, 'note', 4000), JSON.stringify(tagsOf(body.tags)), now, now).run();
  return json({ ok: true, entry: journalOut(await journalRow(db, id)) }, 201);
}

async function editJournal(db, id, body, now) {
  const sets = [];
  const args = [];
  if ('title' in body) { sets.push('title = ?'); args.push(text(body, 'title', 300, true)); }
  if ('link' in body) { sets.push('link = ?'); args.push(webLinkOf(body)); }
  if ('note' in body) { sets.push('note = ?'); args.push(text(body, 'note', 4000)); }
  if ('tags' in body) { sets.push('tags = ?'); args.push(JSON.stringify(tagsOf(body.tags))); }
  if (!sets.length) throw new Bad(400, 'Nothing to change: send title, link, note or tags');
  const r = await db.prepare(`UPDATE journal_entries SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...args, now, id).run();
  if (!changed(r)) throw new Bad(404, 'Entry not found');
  return json({ ok: true, entry: journalOut(await journalRow(db, id)) });
}

async function deleteJournal(db, id) {
  if (!changed(await db.prepare('DELETE FROM journal_entries WHERE id = ?').bind(id).run())) throw new Bad(404, 'Entry not found');
  return json({ ok: true });
}

async function listJournal(db, q) {
  const { results } = await db.prepare('SELECT * FROM journal_entries ORDER BY created_at DESC, rowid DESC LIMIT ?').bind(limitOf(q)).all();
  return json({ ok: true, entries: (results || []).map(journalOut) });
}

// ---- channels (2026-10-30): schedules, calendar videos and outliers for the Calendar and Content pages ----

// Sydney, Scarlett and Elle feed the pages; Developer and Ana fix them. Jon only toggles "selected".
export const CHANNEL_WRITERS = ['jon-mac-youtube', 'viral-view', 'home-guide-press', 'developer', 'ana'];
export const CALENDAR_STATUSES = ['idea', 'planned', 'scripted', 'recording', 'editing', 'qc', 'review', 'scheduled', 'published'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // posting time, PT
// Indy (yt-strategy) researches outliers into Content files, so it may run content-import only (Jon, 2026-11-04).
const IMPORTERS = [...CHANNEL_WRITERS, 'yt-strategy'];

function needChannelWriter(who, writers = CHANNEL_WRITERS) {
  if (!writers.includes(who.bot)) throw new Bad(403, `Only ${writers.join(', ')} can write ${writers === IMPORTERS ? 'outliers' : 'channels, calendar and outliers'}`);
}

// The fixed list plus the channels dash.py registered; the fixed list alone before migration 0022.
async function channelList(db) {
  try {
    return allChannels((await db.prepare('SELECT slug, label, grp FROM yt_channels WHERE label IS NOT NULL').all()).results);
  } catch (err) {
    if (!/no such column/i.test(String(err?.message))) throw err; // only a missing migration falls back
    return CHANNELS;
  }
}
const channelOf = async (db, value) => oneOf(value, (await channelList(db)).map((c) => c.slug), 'channel');

// dash.py calendar-import and content-import register each CSV's channel (the file name) first, so a new
// clone imports without a code change. A fixed channel stays as it is.
const CHANNEL_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
async function registerChannel(db, who, body, now) {
  needChannelWriter(who, IMPORTERS);
  const slug = matchOf(body, 'slug', CHANNEL_SLUG_RE, 'diane-kowalski', true);
  const fixed = CHANNELS.find((c) => c.slug === slug);
  if (fixed) return json({ ok: true, channel: fixed, added: false });
  const label = text(body, 'label', 80) || slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const group = body.group == null ? 'Home Guide Press' : GROUPS.find((g) => g.toLowerCase() === String(body.group).trim().toLowerCase());
  if (!group) throw new Bad(400, `group must be one of: ${GROUPS.join(', ')}`);
  const before = await db.prepare('SELECT label FROM yt_channels WHERE slug = ?').bind(slug).first();
  await db.prepare(`INSERT INTO yt_channels (slug, label, grp, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (slug) DO UPDATE SET label = COALESCE(yt_channels.label, excluded.label), grp = COALESCE(yt_channels.grp, excluded.grp)`)
    .bind(slug, label, group, who.bot, now).run();
  const row = await db.prepare('SELECT label, grp FROM yt_channels WHERE slug = ?').bind(slug).first();
  return json({ ok: true, channel: { slug, label: row.label, group: row.grp }, added: !before?.label });
}

// A web link only (the pages show these as links, buttons and images): http(s) with a host, no spaces or
// control characters. "" clears an optional one.
function webLinkOf(body, key = 'link', required = false) {
  const s = text(body, key, 2000, required);
  if (!s) return null;
  let url = null;
  try { url = new URL(s); } catch { /* refused below */ }
  // eslint-disable-next-line no-control-regex
  if (!url?.hostname || !/^https?:\/\/[^\s/?#]+\S*$/i.test(s) || /[\s\u0000-\u001f\u007f]/.test(s)) throw new Bad(400, `${key} must be an http(s) link`);
  return s;
}

// csv: keys belong to the CSV imports (PUT calendar|outliers/<channel>), which replace those rows.
function keyOf(body) {
  const key = text(body, 'key', 200);
  if (key?.toLowerCase().startsWith('csv:')) throw new Bad(400, 'key must not start with csv: (the CSV imports use those)');
  return key;
}

// A YouTube video's id, so youtu.be/x and youtube.com/watch?v=x match; any other link is its own key.
const YOUTUBE_LINK_RE = /^https?:\/\/(?:[\w-]+\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|video\/)|youtube-nocookie\.com\/embed\/|youtu\.be\/)([\w-]{11})(?![\w-])/i;
const videoKey = (link) => String(link).match(YOUTUBE_LINK_RE)?.[1] || link;
const YOUTUBE_ID_RE = /^[\w-]{11}$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

const finished = (status) => ['qc', 'review', 'scheduled', 'published'].includes(status);

// The row's own upload: as given, else from its link once the video is finished. Earlier rows link their source video.
function youtubeIdOf(body, status, link) {
  const given = matchOf(body, 'youtube_id', YOUTUBE_ID_RE, 'dQw4w9WgXcQ');
  if (given) return given;
  return finished(status) ? String(link).match(YOUTUBE_LINK_RE)?.[1] ?? null : null;
}

function countOf(body, key, min) {
  const n = numberOf(body, key, min, 1e12, true);
  if (!Number.isInteger(n)) throw new Bad(400, `${key} must be a whole number`);
  return n;
}

const calendarOut = (r) => ({
  id: r.id, channel: r.channel, title: r.title, date: r.day, time: r.time_pt ?? null, status: r.status, link: r.link ?? null, youtubeId: r.youtube_id ?? null,
  createdBy: r.created_by, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at,
});
const outlierOut = (r) => ({
  id: r.id, channel: r.channel, title: r.title, source: r.source ?? null, link: r.link, thumb: r.thumb ?? null, views: r.views, avg: r.avg_views,
  multiple: Math.round((r.views / r.avg_views) * 100) / 100, published: r.published, selected: !!r.selected,
  selectedBy: r.selected_by ?? null, selectedAt: r.selected_at ?? null, createdBy: r.created_by, createdAt: r.created_at,
});

async function listChannels(db) {
  const { results } = await db.prepare('SELECT * FROM yt_channels').all();
  const rows = new Map((results || []).map((r) => [r.slug, r]));
  return json({ ok: true, channels: allChannels(results).map((c) => ({ ...c, schedule: rows.get(c.slug)?.schedule ?? null, landing: rows.get(c.slug)?.landing ?? null })) });
}

async function setChannel(db, who, slug, body, now) {
  needChannelWriter(who);
  const channel = await channelOf(db, slug);
  const fields = ['schedule', 'landing'].filter((k) => k in body);
  if (!fields.length) throw new Bad(400, 'schedule or landing is required ("" clears it)');
  const values = fields.map((k) => (k === 'landing' ? webLinkOf(body, k) : text(body, k, 200)));
  await db.prepare(`INSERT INTO yt_channels (slug, ${fields.join(', ')}, updated_by, updated_at) VALUES (?, ${fields.map(() => '?').join(', ')}, ?, ?)
    ON CONFLICT (slug) DO UPDATE SET ${fields.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(channel, ...values, who.bot, now).run();
  const { schedule, landing = null } = await db.prepare('SELECT * FROM yt_channels WHERE slug = ?').bind(channel).first(); // no landing before migration 0017
  return json({ ok: true, channel: { ...(await channelList(db)).find((c) => c.slug === channel), schedule, landing } });
}

// A video's tracked link (yt_links) hangs off its calendar id. Covers every video in the channel that has none.
const addLinks = (db, channel, now) => db.prepare(`INSERT OR IGNORE INTO yt_links (code, video_id, channel, created_at)
  SELECT lower(hex(randomblob(5))), id, channel, ? FROM yt_calendar WHERE channel = ?`).bind(now, channel);

async function addCalendar(db, who, body, now) {
  needChannelWriter(who);
  const channel = await channelOf(db, body.channel);
  const title = text(body, 'title', 300, true);
  const day = matchOf(body, 'date', DAY_RE, '2026-11-03', true);
  const time = matchOf(body, 'time', TIME_RE, '09:00') || null;
  const status = oneOf(body.status ?? 'planned', CALENDAR_STATUSES, 'status');
  const link = webLinkOf(body, 'link');
  const youtubeId = youtubeIdOf(body, status, link);
  const key = keyOf(body);
  const id = newId('v');
  const { row, duplicate } = await insertOnce(db, 'yt_calendar', 'created_by', who.bot, key, id,
    `INSERT INTO yt_calendar (id, channel, title, day, time_pt, status, link, youtube_id, created_by, updated_by, idem_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, channel, title, day, time, status, link, youtubeId, who.bot, who.bot, key, now, now]);
  await addLinks(db, channel, now).run();
  return json({ ok: true, duplicate, video: calendarOut(row) }, duplicate ? 200 : 201);
}

async function updateCalendar(db, who, id, body, now) {
  needChannelWriter(who);
  const sets = [];
  const args = [];
  if ('title' in body) { sets.push('title = ?'); args.push(text(body, 'title', 300, true)); }
  if ('date' in body) { sets.push('day = ?'); args.push(matchOf(body, 'date', DAY_RE, '2026-11-03', true)); }
  if ('time' in body) { sets.push('time_pt = ?'); args.push(matchOf(body, 'time', TIME_RE, '09:00') || null); }
  if ('status' in body) { sets.push('status = ?'); args.push(oneOf(body.status, CALENDAR_STATUSES, 'status')); }
  if ('link' in body) { sets.push('link = ?'); args.push(webLinkOf(body, 'link')); }
  if ('youtube_id' in body) { sets.push('youtube_id = ?'); args.push(matchOf(body, 'youtube_id', YOUTUBE_ID_RE, 'dQw4w9WgXcQ') || null); }
  if (!sets.length) throw new Bad(400, 'Nothing to change: send title, date, time, status, link or youtube_id');
  const before = await db.prepare('SELECT * FROM yt_calendar WHERE id = ?').bind(id).first();
  if (!before) throw new Bad(404, 'Calendar video not found');
  const found = 'youtube_id' in body || before.youtube_id ? null : youtubeIdOf({}, body.status ?? before.status, 'link' in body ? body.link : before.link);
  if (found) { sets.push('youtube_id = ?'); args.push(found); } // one write, so it can't half land
  await db.prepare(`UPDATE yt_calendar SET ${sets.join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`).bind(...args, who.bot, now, id).run();
  return json({ ok: true, video: calendarOut(await db.prepare('SELECT * FROM yt_calendar WHERE id = ?').bind(id).first()) });
}

// The earlier row each imported row continues, so a video keeps its calendar id, tracked link and clicks, and its
// YouTube ID if the row has none. In order: the same YouTube ID across every row; the same title among rows left over,
// never onto a different video's ID; a lone leftover video and a lone unmatched finished row on one date (a retitle).
// That last one may be a different video put on that date, so it keeps the link but no ID: a real retitle that keeps
// its YouTube link in the CSV already matched by ID. A repeated title also needs the same date, a title repeated on a
// date the same time, and if that repeats too it passes on no ID. A new row before QC only takes a video's ID and
// link on its date: a new idea can reuse the title of a video since renamed.
// No other link can match: many rows share one project or doc link.
// shortcut: a video retitled and moved with no YouTube ID, moved while its title repeats, or dropped and re-added gets a new link and the old one keeps redirecting; fine until descriptions carry links at scale.
function continued(old, rows) {
  const free = new Set(old);
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const claim = (hit) => { if (hit) free.delete(hit); return hit ?? null; };
  const out = rows.map((r) => {
    const hit = r.youtubeId ? claim([...free].find((o) => o.youtube_id === r.youtubeId)) : null;
    return hit && { id: hit.id, youtubeId: r.youtubeId };
  });
  rows.forEach((r, i) => {
    if (out[i]) return;
    const titled = [rows, old].map((list) => list.filter((x) => same(x.title, r.title)));
    const onDay = (x) => x.day === r.day;
    const repeated = titled.some((list) => list.length > 1);
    const crowded = titled.some((list) => list.filter(onDay).length > 1);
    const hit = claim([...free].find((o) => same(o.title, r.title) && (!repeated || onDay(o)) && (!crowded || o.time === r.time)
      && !(o.youtube_id && r.youtubeId) && (!o.youtube_id || onDay(o) || finished(r.status))));
    const held = titled.some((list) => list.filter((x) => onDay(x) && x.time === r.time).length > 1);
    if (hit) out[i] = { id: hit.id, youtubeId: r.youtubeId ?? (held ? null : hit.youtube_id ?? null) };
  });
  rows.forEach((r, i) => {
    if (out[i] || r.youtubeId || !finished(r.status)) return;
    const left = [...free].filter((o) => o.youtube_id && o.day === r.day);
    if (left.length === 1 && rows.filter((x, j) => !out[j] && x.day === r.day).length === 1) {
      out[i] = { id: claim(left[0]).id, youtubeId: null };
    }
  });
  return out.map((o, i) => o ?? { id: newId('v'), youtubeId: rows[i].youtubeId });
}

// An owner's CSV schedule for one channel (dash.py calendar-import): its rows replace the channel's
// earlier CSV rows in one batch. Videos added one by one (POST calendar) stay.
async function putCalendar(db, who, slug, body, now) {
  needChannelWriter(who);
  const channel = await channelOf(db, slug);
  if (!Array.isArray(body.videos) || body.videos.length > 500) throw new Bad(400, 'videos must be a list of at most 500');
  const { results: old } = await db.prepare("SELECT id, title, day, time_pt AS time, youtube_id FROM yt_calendar WHERE channel = ? AND idem_key LIKE 'csv:%'").bind(channel).all();
  const rows = body.videos.map((v, i) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Bad(400, `videos[${i}] must be {date, time?, title, status, link?, youtube_id?}`);
    try {
      const status = oneOf(v.status, CALENDAR_STATUSES, 'status');
      const link = webLinkOf(v, 'link');
      return { title: text(v, 'title', 300, true), day: matchOf(v, 'date', DAY_RE, '2026-11-03', true), time: matchOf(v, 'time', TIME_RE, '09:00') || null,
        status, link, youtubeId: youtubeIdOf(v, status, link) };
    } catch (err) {
      throw err instanceof Bad ? new Bad(400, `videos[${i}]: ${err.message}`) : err;
    }
  });
  const seen = new Set();
  rows.forEach((r, i) => { // one row per video: an ID, else a title at a date and time, can't name two
    const key = r.youtubeId ?? `${r.title.toLowerCase()} on ${r.day}${r.time ? ` at ${r.time}` : ''}`;
    if (seen.has(key)) throw new Bad(400, `videos[${i}]: ${key} is already on another row`);
    seen.add(key);
  });
  // json_each: D1 binds at most 100 values and an import has 500 rows. The unique index still catches a race.
  const taken = await db.prepare(`SELECT channel, title, day, youtube_id FROM yt_calendar WHERE youtube_id IN (SELECT value FROM json_each(?1))
    AND (channel <> ?2 OR COALESCE(idem_key, '') NOT LIKE 'csv:%')`).bind(JSON.stringify(rows.flatMap((r) => r.youtubeId ?? [])), channel).first();
  if (taken) throw new Bad(409, `YouTube ID ${taken.youtube_id} is already on "${taken.title}" (${taken.day}) in channel ${taken.channel}. Take it off one of the two rows, then import again.`);
  const ids = continued(old, rows);
  const insert = db.prepare(`INSERT INTO yt_calendar (id, channel, title, day, time_pt, status, link, youtube_id, created_by, updated_by, idem_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const [gone] = await db.batch([db.prepare("DELETE FROM yt_calendar WHERE channel = ? AND idem_key LIKE 'csv:%'").bind(channel),
    ...rows.map((r, i) => insert.bind(ids[i].id, channel, r.title, r.day, r.time, r.status, r.link, ids[i].youtubeId, who.bot, who.bot, `csv:${channel}:${i}`, now, now)),
    addLinks(db, channel, now)]);
  return json({ ok: true, channel, replaced: gone?.meta?.changes ?? 0, videos: rows.length });
}

async function listCalendar(db, q) {
  const where = [];
  const args = [];
  if (q.get('channel')) { where.push('channel = ?'); args.push(await channelOf(db, q.get('channel'))); }
  for (const [key, op] of [['from', '>='], ['to', '<=']]) {
    if (!q.get(key)) continue;
    if (!DAY_RE.test(q.get(key))) throw new Bad(400, `${key} must look like 2026-11-03`);
    where.push(`day ${op} ?`);
    args.push(q.get(key));
  }
  const rows = await list(db, 'yt_calendar', where, args, 'day, created_at', limitOf(q));
  return json({ ok: true, videos: rows.map(calendarOut) });
}

// A video's own landing page, over its channel's. "" goes back to the channel's.
async function setLinkLanding(db, who, code, body) {
  needChannelWriter(who);
  if (!('landing' in body)) throw new Bad(400, 'landing is required ("" goes back to the channel\'s)');
  const landing = webLinkOf(body, 'landing');
  if (!changed(await db.prepare('UPDATE yt_links SET landing = ? WHERE code = ?').bind(landing, code).run())) throw new Bad(404, 'Link not found');
  return json({ ok: true, code, landing });
}

// What the YouTube Studio script reads, by YouTube video, all or none. A field left out keeps its value; null clears it.
const STATS_FIELDS = {
  impressions: (s) => countOf(s, 'impressions', 0),
  ctr: (s) => numberOf(s, 'ctr', 0, 100, true),
  views: (s) => countOf(s, 'views', 0),
  subs: (s) => countOf(s, 'subs', -1e12), // Studio's net subscribers per video: losses can outnumber gains
  avd: (s) => numberOf(s, 'avd', 0, 86400 * 7, true), // Studio's average view duration, seconds
  scheduled_at: (s) => {
    if (!UTC_RE.test(s.scheduled_at) || !realUtc(s.scheduled_at)) throw new Bad(400, 'scheduled_at must be a real UTC date from 2005 on, like 2026-11-03T17:00:00Z');
    return new Date(s.scheduled_at).toISOString();
  },
  scheduled_date: (s) => {
    const day = matchOf(s, 'scheduled_date', DAY_RE, '2026-11-03', true);
    if (!realUtc(`${day}T12:00:00Z`)) throw new Bad(400, 'scheduled_date must be a real date from 2005 on, like 2026-11-03');
    return day;
  },
  status: (s) => oneOf(s.status, ['scheduled', 'live', 'private', 'unlisted'], 'status'),
};

async function postLinkStats(db, who, body, now) {
  needChannelWriter(who);
  if (!Array.isArray(body.stats) || !body.stats.length || body.stats.length > 500) throw new Bad(400, 'stats must be a list of 1 to 500');
  const rows = body.stats.map((s, i) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Bad(400, `stats[${i}] must be {youtube_id, impressions?, ctr?, views?, subs?, avd?, scheduled_at?, scheduled_date?, status?}`);
    try {
      const id = matchOf(s, 'youtube_id', YOUTUBE_ID_RE, 'dQw4w9WgXcQ', true);
      const fields = Object.keys(STATS_FIELDS).filter((k) => k in s);
      if (!fields.length) throw new Bad(400, 'send impressions, ctr, views, subs, avd, scheduled_at, scheduled_date or status');
      const values = fields.map((k) => (s[k] === null ? null : STATS_FIELDS[k](s)));
      return { id, statement: db.prepare(`INSERT INTO yt_stats (youtube_id, ${fields.join(', ')}, updated_at) VALUES (?, ${fields.map(() => '?').join(', ')}, ?)
        ON CONFLICT (youtube_id) DO UPDATE SET ${fields.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_at = excluded.updated_at`).bind(id, ...values, now) };
    } catch (err) {
      throw err instanceof Bad ? new Bad(400, `stats[${i}]: ${err.message}`) : err;
    }
  });
  await db.batch(rows.map((r) => r.statement));
  const { results } = await db.prepare('SELECT DISTINCT youtube_id FROM yt_calendar WHERE youtube_id IS NOT NULL').all();
  const known = new Set((results || []).map((r) => r.youtube_id));
  return json({ ok: true, saved: rows.length, notOnCalendar: rows.map((r) => r.id).filter((id) => !known.has(id)) });
}

async function addOutlier(db, who, body, now) {
  needChannelWriter(who);
  const channel = await channelOf(db, body.channel);
  const title = text(body, 'title', 300, true);
  const link = webLinkOf(body, 'link', true);
  const thumb = webLinkOf(body, 'thumb');
  const views = countOf(body, 'views', 0);
  const avg = countOf(body, 'avg', 1);
  const published = matchOf(body, 'published', DAY_RE, '2026-10-27', true);
  const source = text(body, 'source', 200) || null;
  const key = keyOf(body);
  const id = newId('o');
  const { row, duplicate } = await insertOnce(db, 'yt_outliers', 'created_by', who.bot, key, id,
    `INSERT INTO yt_outliers (id, channel, title, source, link, thumb, views, avg_views, published, created_by, idem_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, channel, title, source, link, thumb, views, avg, published, who.bot, key, now]);
  return json({ ok: true, duplicate, outlier: outlierOut(row) }, duplicate ? 200 : 201);
}

// Bots set it with dash.py, Jon toggles it on the Content page. Setting the same value again changes nothing.
async function selectOutlier(db, who, id, body, now) {
  if (!who.jon) needChannelWriter(who);
  if (typeof body.selected !== 'boolean') throw new Bad(400, 'selected must be true or false');
  const on = body.selected ? 1 : 0;
  await db.prepare('UPDATE yt_outliers SET selected = ?, selected_by = ?, selected_at = ? WHERE id = ? AND selected != ?')
    .bind(on, who.jon ? 'jon' : who.bot, now, id, on).run();
  const row = await db.prepare('SELECT * FROM yt_outliers WHERE id = ?').bind(id).first();
  if (!row) throw new Bad(404, 'Outlier not found');
  return json({ ok: true, outlier: outlierOut(row) });
}

// An owner's Content CSV for one channel (dash.py content-import): its rows replace the channel's earlier
// CSV rows in one batch. Where Jon toggled Select on the same video, his choice stays over the CSV's.
async function putOutliers(db, who, slug, body, now) {
  needChannelWriter(who, IMPORTERS);
  const channel = await channelOf(db, slug);
  if (!Array.isArray(body.outliers) || body.outliers.length > 500) throw new Bad(400, 'outliers must be a list of at most 500');
  const { results } = await db.prepare("SELECT link, selected, selected_at FROM yt_outliers WHERE channel = ? AND selected_by = 'jon'").bind(channel).all();
  const jon = new Map((results || []).map((r) => [videoKey(r.link), r]));
  const rows = body.outliers.map((o, i) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Bad(400, `outliers[${i}] must be {title, link, views, avg, published, ...}`);
    try {
      const link = webLinkOf(o, 'link', true);
      if (o.selected !== undefined && typeof o.selected !== 'boolean') throw new Bad(400, 'selected must be true or false');
      const mine = jon.get(videoKey(link));
      const on = mine ? mine.selected : o.selected ? 1 : 0;
      return [newId('o'), channel, text(o, 'title', 300, true), text(o, 'source', 200) || null, link, webLinkOf(o, 'thumb'),
        countOf(o, 'views', 0), countOf(o, 'avg', 1), matchOf(o, 'published', DAY_RE, '2026-10-27', true),
        on, mine ? 'jon' : on ? who.bot : null, mine ? mine.selected_at : on ? now : null, who.bot, `csv:${channel}:${i}`, now];
    } catch (err) {
      throw err instanceof Bad ? new Bad(400, `outliers[${i}]: ${err.message}`) : err;
    }
  });
  const insert = db.prepare(`INSERT INTO yt_outliers (id, channel, title, source, link, thumb, views, avg_views, published, selected, selected_by,
    selected_at, created_by, idem_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const [gone] = await db.batch([db.prepare("DELETE FROM yt_outliers WHERE channel = ? AND idem_key LIKE 'csv:%'").bind(channel),
    ...rows.map((r) => insert.bind(...r))]);
  return json({ ok: true, channel, replaced: gone?.meta?.changes ?? 0, outliers: rows.length });
}

async function listOutliers(db, q) {
  const where = [];
  const args = [];
  if (q.get('channel')) { where.push('channel = ?'); args.push(await channelOf(db, q.get('channel'))); }
  if (q.get('selected')) { where.push('selected = ?'); args.push(oneOf(q.get('selected'), ['1', '0'], 'selected') === '1' ? 1 : 0); }
  const rows = await list(db, 'yt_outliers', where, args, MULTIPLE_SQL, limitOf(q));
  return json({ ok: true, outliers: rows.map(outlierOut) });
}

const FAILED = Symbol('failed');
async function tryRead(work) {
  try { return await work; } catch (err) { console.error('todayData', err); return FAILED; }
}

// What the Today page needs from the bot tables. Each part is null on its own when its table is
// missing, so one unapplied migration can't hide the rest. `month` picks the ebook_sales entry.
export async function todayData(db, nowMs, month) {
  if (!db) return null;
  const since = new Date(nowMs - 7 * 86400000).toISOString();
  const [q, a, summary, usage, ebooks, runs, calendar, tasks, daily, ticks] = await Promise.all([
    tryRead(db.prepare("SELECT * FROM bot_questions WHERE status = 'open' ORDER BY created_at LIMIT 200").all()),
    tryRead(db.prepare("SELECT * FROM bot_approvals WHERE status = 'pending' ORDER BY created_at LIMIT 200").all()),
    tryRead(latestFeed(db, 'morning_summary')),
    tryRead(latestFeed(db, 'claude_usage')),
    tryRead(db.prepare("SELECT * FROM bot_feed_entries WHERE name = 'ebook_sales' AND json_extract(data, '$.month') = ? ORDER BY created_at DESC LIMIT 1").bind(month).first()),
    tryRead(db.prepare('SELECT COALESCE(SUM(tokens), 0) AS tokens, COUNT(*) AS runs FROM bot_runs WHERE started_at >= ?').bind(since).first()),
    tryRead(latestFeed(db, 'calendar_today')),
    // The Projects board: open, QC and review tasks plus the last 7 days of done ones, each with its newest
    // web proof link and its deliverable (picked as in deliverableOf).
    tryRead(db.prepare(`SELECT t.*, (SELECT p.link FROM bot_proofs p WHERE p.task_id = t.id AND (p.link LIKE 'http://%' OR p.link LIKE 'https://%')
      ORDER BY p.created_at DESC LIMIT 1) AS proof_link,
      (SELECT json_object('link', p.link, 'kind', p.kind, 'status', p.status) FROM bot_proofs p WHERE p.task_id = t.id
      ORDER BY p.status = 'passed' DESC, p.created_at DESC, p.rowid DESC LIMIT 1) AS deliverable FROM bot_tasks t
      WHERE t.status IN ('todo', 'doing', 'waiting_on_jon', 'qc', 'review') OR (t.status = 'done' AND t.done_at >= ?) ORDER BY t.updated_at DESC LIMIT 500`).bind(since).all()),
    tryRead(latestFeed(db, 'daily_checklists')),
    tryRead(db.prepare('SELECT * FROM bot_daily_ticks WHERE day = ?').bind(ymd(nowMs)).all()), // today's ticks only
  ]);
  // A feed is null when its table could not be read, undefined when nothing was posted yet.
  const feed = (row) => (row === FAILED ? null : row ? feedOut(row) : undefined);
  return {
    questions: q === FAILED ? null : (q.results || []).map(questionOut),
    approvals: a === FAILED ? null : (a.results || []).map(approvalOut),
    feeds: { morning_summary: feed(summary), calendar_today: feed(calendar), claude_usage: feed(usage), ebook_sales: feed(ebooks), daily_checklists: feed(daily) },
    tasks: tasks === FAILED ? null : (tasks.results || []).map((r) => ({ ...taskOut(r), proofLink: r.proof_link ?? null, deliverable: deliverableOf(parseJson(r.deliverable, null)) })),
    dailyTicks: ticks === FAILED ? null : (ticks.results || []).map(tickOut),
    runs7d: runs === FAILED || !runs ? null : { tokens: Number(runs.tokens) || 0, runs: Number(runs.runs) || 0, since },
  };
}

// ---- router ----

function needBot(who) {
  if (!who.bot) throw new Bad(403, 'This needs a bot token');
}

function needJon(who) {
  if (!who.jon) throw new Bad(403, 'Only Jon can do this, from the dashboard');
}

async function whoIs(request, env) {
  if (request.headers.get('Authorization')) {
    const bot = await botOf(request, env.DB);
    return bot ? { bot } : null;
  }
  return (await readSession(request, env)) ? { jon: true } : null;
}

async function route(request, db, who, rest, env, ctx) {
  const method = request.method;
  if (who.jon && method !== 'GET' && request.headers.get('X-CC') !== '1') throw new Bad(403, 'Missing header');
  const q = new URL(request.url).searchParams;
  const seg = rest.split('/').filter(Boolean);
  if (seg.length > 3) throw new Bad(404, 'Not found');
  const [kind, rawId, verb] = seg;
  const now = new Date().toISOString();
  if (kind === 'feeds' && rawId && !verb) {
    if (method === 'GET') return getFeed(db, rawId);
    if (method === 'PUT') { needBot(who); return putFeed(db, who, rawId, await readBody(request), now); }
    throw new Bad(404, 'Not found');
  }
  if (kind === 'channels' && !verb) {
    if (method === 'GET' && !rawId) return listChannels(db);
    if (method === 'POST' && !rawId) return registerChannel(db, who, await readBody(request), now);
    if (method === 'PUT' && rawId) return setChannel(db, who, rawId, await readBody(request), now);
    throw new Bad(404, 'Not found');
  }
  if (kind === 'links') {
    if (method === 'GET' && !rawId) {
      const channel = q.get('channel') ? await channelOf(db, q.get('channel')) : null;
      return json({ ok: true, links: (await trackVideos(db, new URL(request.url).origin, channel)).filter((v) => v.linked) });
    }
    if (method === 'POST' && rawId === 'stats' && !verb) return postLinkStats(db, who, await readBody(request), now);
    if (method === 'PUT' && rawId && !verb) return setLinkLanding(db, who, rawId, await readBody(request));
    throw new Bad(404, 'Not found');
  }
  if (kind === 'periods' && !verb) {
    if (method === 'GET' && !rawId) return getPeriods(db, now);
    if (method === 'PUT' && !rawId) return putPeriods(db, who, await readBody(request), now);
    if (method === 'POST' && rawId === 'tick') return tickPeriod(db, who, await readBody(request), now);
    throw new Bad(404, 'Not found');
  }
  if (kind === 'factory' && !rawId && !verb) {
    if (method === 'GET') return getFactory(db);
    if (method === 'PUT') return putFactory(db, who, await readBody(request), now);
    throw new Bad(404, 'Not found');
  }
  if (kind === 'calendar' && method === 'PUT' && rawId && !verb) return putCalendar(db, who, rawId, await readBody(request), now);
  if (kind === 'outliers' && method === 'PUT' && rawId && !verb) return putOutliers(db, who, rawId, await readBody(request), now);
  const id = rawId ? idOf(rawId) : null;
  const body = method === 'POST' || method === 'PATCH' ? await readBody(request) : {};

  switch (`${method} ${kind || ''}${rawId ? '/:id' : ''}${verb ? `/${verb}` : ''}`) {
    case 'GET me': return json({ ok: true, bot: who.bot || null, jon: !!who.jon });
    case 'GET tasks': return listTasks(db, who, q);
    case 'POST tasks': needBot(who); return createTask(db, who, body, now);
    case 'GET tasks/:id': return getTask(db, id);
    case 'PATCH tasks/:id': return who.jon ? tickTask(db, env, ctx, id, body, now) : updateTask(db, who, id, body, now);
    case 'POST tasks/:id/proofs': needBot(who); return addProof(db, who, id, body, now);
    case 'POST tasks/:id/comments': return addComment(db, env, ctx, who, id, body, now);
    case 'POST tasks/:id/live': needBot(who); return liveDone(db, who, id, body, now);
    case 'POST tasks/:id/close': needBot(who); return closeTask(db, who, id, body, now);
    case 'GET proofs': return listProofs(db, q);
    case 'POST proofs/:id/check': needBot(who); return checkProof(db, who, id, body, now);
    case 'GET questions': return listQuestions(db, who, q);
    case 'POST questions': needBot(who); return askQuestion(db, who, body, now);
    case 'GET questions/:id': {
      const row = await questionRow(db, id);
      if (!row) throw new Bad(404, 'Question not found');
      return json({ ok: true, question: questionOut(row) });
    }
    case 'POST questions/:id/close': needBot(who); return closeQuestion(db, who, id, now);
    case 'POST questions/:id/answer': needJon(who); return answerQuestion(db, id, body, now);
    case 'GET approvals': return listApprovals(db, who, q);
    case 'POST approvals': needBot(who); return requestApproval(db, who, body, now);
    case 'GET approvals/:id': {
      const row = await approvalRow(db, id);
      if (!row) throw new Bad(404, 'Approval not found');
      return json({ ok: true, approval: approvalOut(row) });
    }
    case 'POST approvals/:id/claim': needBot(who); return claimApproval(db, who, id, now);
    case 'POST approvals/:id/done': needBot(who); return finishApproval(db, who, id, body, now);
    case 'POST approvals/:id/release': needBot(who); return releaseApproval(db, who, id, body, now);
    case 'POST approvals/:id/cancel': needBot(who); return cancelApproval(db, who, id, body, now);
    case 'POST approvals/:id/decide': needJon(who); return decideApproval(db, id, body, now);
    case 'POST needs/:id/drop': needJon(who); return needsAct(db, env, ctx, id, 'drop', now);
    case 'POST needs/:id/later': needJon(who); return needsAct(db, env, ctx, id, 'later', now);
    case 'GET runs': return listRuns(db, who, q);
    case 'POST runs': needBot(who); return reportRun(db, who, body, now);
    case 'GET daily': return listDaily(db, q);
    case 'POST daily': needBot(who); return tickDaily(db, who, body, now);
    case 'GET activity': return listActivity(db, q);
    case 'GET journal': needJon(who); return listJournal(db, q);
    case 'POST journal': needJon(who); return addJournal(db, body, now);
    case 'PATCH journal/:id': needJon(who); return editJournal(db, id, body, now);
    case 'DELETE journal/:id': needJon(who); return deleteJournal(db, id);
    case 'GET calendar': return listCalendar(db, q);
    case 'POST calendar': return addCalendar(db, who, body, now);
    case 'PATCH calendar/:id': return updateCalendar(db, who, id, body, now);
    case 'GET outliers': return listOutliers(db, q);
    case 'POST outliers': return addOutlier(db, who, body, now);
    case 'POST outliers/:id/select': return selectOutlier(db, who, id, body, now);
    default: return json({ ok: false, error: 'Not found' }, 404);
  }
}

// `rest` is the path after /dashboard/api/v1, e.g. "/tasks/t_0123456789abcdef".
export async function handleV1(request, env, rest, ctx) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Database unavailable' }, 503);
  try {
    const who = await whoIs(request, env);
    if (!who) return json({ ok: false, error: 'Unauthorized' }, 401);
    return await route(request, db, who, rest, env, ctx);
  } catch (err) {
    if (err instanceof Bad) return json({ ok: false, error: err.message }, err.status);
    if (/no such (table|column)|has no column named/i.test(String(err?.message))) return json({ ok: false, error: 'Bot tables are not set up yet' }, 503);
    // The unique index, directly or through insertOnce's ON CONFLICT DO NOTHING. A batch rolls back whole.
    if (/UNIQUE constraint failed: yt_calendar\.youtube_id|yt_calendar insert failed/.test(String(err?.message))) return json({ ok: false, error: 'That YouTube ID is already on another Calendar row' }, 409);
    console.error('v1 api error', err);
    return json({ ok: false, error: 'Server error' }, 500);
  }
}
