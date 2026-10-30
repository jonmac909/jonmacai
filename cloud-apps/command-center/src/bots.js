// Bot access API (dashboard plan step 1, 2026-10-29). Each bot writes one row at a time under
// /dashboard/api/v1 with its own Bearer token; bot_tokens keeps only the SHA-256 hash. Jon's side
// (answer a question, approve or reject, tick off a task owned by jon) needs the dashboard session
// and is never open to a bot.
import { readSession } from './auth.js';
import { ymd } from './life.js';
import { PROJECTS } from './projects.js';

export const TASK_STATUSES = ['todo', 'doing', 'waiting_on_jon', 'qc', 'done', 'cancelled'];
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
const ID_RE = /^[tpqar]_[0-9a-f]{16}$/;
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
  project: r.project ?? null, minutes: r.minutes ?? null, due: r.due ?? null,
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
async function logEvent(db, taskId, at, by, kind, detail) {
  try {
    await db.prepare('INSERT INTO bot_task_events (id, task_id, at, "by", kind, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('e'), taskId, at, by, kind, detail).run();
  } catch (err) {
    console.error('task history', err);
  }
}

// Done means proof: qc needs a proof QC hasn't failed, done needs one QC passed.
async function hasProof(db, taskId, status) {
  const sql = status === 'done'
    ? "SELECT 1 AS ok FROM bot_proofs WHERE task_id = ? AND status = 'passed' LIMIT 1"
    : "SELECT 1 AS ok FROM bot_proofs WHERE task_id = ? AND status != 'failed' LIMIT 1";
  return !!(await db.prepare(sql).bind(taskId).first());
}

async function updateTask(db, who, id, body, now) {
  const row = await taskRow(db, id);
  if (!row) throw new Bad(404, 'Task not found');
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
  if ('status' in body) {
    const status = next.status = oneOf(body.status, TASK_STATUSES, 'status');
    if (status !== row.status) {
      if (status === 'qc' && !(await hasProof(db, id, 'qc'))) throw new Bad(409, 'Add proof before moving a task to qc');
      if (status === 'done' && !(await hasProof(db, id, 'done'))) throw new Bad(409, 'A task is done only when QC has passed one of its proofs');
      if (status === 'cancelled' && !text(body, 'note', 4000)) throw new Bad(400, 'Say why in note when cancelling a task');
    }
    sets.push('status = ?', 'done_at = ?');
    args.push(status, status === 'done' ? (row.status === 'done' ? row.done_at : now) : null);
  }
  if (!sets.length) throw new Bad(400, 'Nothing to change: send title, owner, status, note, project, minutes or due');
  // Re-check the proof inside the UPDATE so a QC fail landing in between can't be skipped.
  const moving = 'status' in body && body.status !== row.status ? String(body.status).trim().toLowerCase() : '';
  const guard = moving === 'done' ? " AND EXISTS (SELECT 1 FROM bot_proofs WHERE task_id = bot_tasks.id AND status = 'passed')"
    : moving === 'qc' ? " AND EXISTS (SELECT 1 FROM bot_proofs WHERE task_id = bot_tasks.id AND status != 'failed')" : '';
  const r = await db.prepare(`UPDATE bot_tasks SET ${sets.join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?${guard}`)
    .bind(...args, who.bot, now, id).run();
  if (guard && !changed(r)) throw new Bad(409, 'QC failed the proof just now; add new proof first');
  for (const [key, value] of Object.entries(next)) {
    if ((row[key] ?? null) !== value) await logEvent(db, id, now, who.bot, key, `${key} ${row[key] ?? 'none'} → ${value ?? 'none'}`);
  }
  return json({ ok: true, task: taskOut(await taskRow(db, id)) });
}

// Jon ticks off a task only he can do (owner jon): done without proof, and nothing else.
async function tickTask(db, id, body, now) {
  oneOf(body.status, ['done'], 'status');
  const r = await db.prepare(
    "UPDATE bot_tasks SET status = 'done', done_at = ?, updated_by = 'jon', updated_at = ? WHERE id = ? AND owner = 'jon' AND status IN ('todo', 'doing', 'waiting_on_jon')",
  ).bind(now, now, id).run();
  const row = await taskRow(db, id);
  if (!row) throw new Bad(404, 'Task not found');
  if (row.owner !== 'jon') throw new Bad(403, 'Jon can only tick tasks owned by jon');
  if (!changed(r)) return json({ ok: false, error: `Task is already ${row.status}`, task: taskOut(row) }, 409);
  await logEvent(db, id, now, 'jon', 'tick', 'ticked done');
  return json({ ok: true, task: taskOut(row) });
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
  return json({ ok: true, task: { ...taskOut(row), proofs: proofs.map(proofOut), comments: comments.map(commentOut), history: historyOf(row, proofs, events) } });
}

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
const WAKE_PAUSES = [2000, 4000]; // ms before each retry of a 503 or an unreachable routine, as in hook.py

async function addComment(db, env, ctx, who, taskId, body, now) {
  const task = await taskRow(db, taskId);
  if (!task) throw new Bad(404, 'Task not found');
  const comment = {
    id: newId('c'), task_id: taskId, author: who.jon ? 'jon' : who.bot, body: text(body, 'body', 4000, true), created_at: now,
    wake_status: who.jon && task.owner === 'jon' ? JON_OWNS : null, // Jon's note on his own card wakes no one
  };
  await db.prepare('INSERT INTO bot_task_comments (id, task_id, author, body, created_at, wake_status) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(comment.id, taskId, comment.author, comment.body, now, comment.wake_status).run();
  await logEvent(db, taskId, now, comment.author, 'comment', 'commented');
  if (who.jon && task.owner !== 'jon') {
    // In the Worker the wake runs after the reply and retries; without ctx (tests) it is one awaited try.
    const wake = wakeOwner(env, task, comment, ctx?.waitUntil ? WAKE_PAUSES : []).then(async (status) => {
      await db.prepare('UPDATE bot_task_comments SET wake_status = ? WHERE id = ?').bind(status, comment.id).run();
      return status;
    });
    if (ctx?.waitUntil) ctx.waitUntil(wake.catch(() => console.error('card_comment: wake result not saved')));
    else comment.wake_status = await wake.catch(() => null);
  }
  return json({ ok: true, comment: commentOut(comment) }, 201);
}

// POST card_comment to the owner's OpenBot routine, signed exactly like bots/hook.py. An owner without
// a complete route (url and secret) goes to Ana with data.forOwner. Returns the final HTTP status as
// text, "unreachable" or "not configured"; never throws, and never logs the URL or secret.
async function wakeOwner(env, task, comment, pauses) {
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
      url: `https://jonmac.ai/dashboard/#projects/${task.project || 'unsorted'}`, ...(route === task.owner ? {} : { forOwner: task.owner }),
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
  if (who.bot !== QC_BOT) throw new Bad(403, 'Only QC can pass or fail proof');
  const result = oneOf(body.result, ['passed', 'failed'], 'result');
  const note = text(body, 'note', 4000);
  const r = await db.prepare('UPDATE bot_proofs SET status = ?, checked_by = ?, checked_at = ?, check_note = ? WHERE id = ?')
    .bind(result, who.bot, now, note, id).run();
  if (!changed(r)) throw new Bad(404, 'Proof not found');
  const row = await db.prepare('SELECT * FROM bot_proofs WHERE id = ?').bind(id).first();
  await logEvent(db, row.task_id, now, who.bot, 'check', `proof ${result}`);
  // A failed check takes a qc or done task back to doing when no proof still supports it.
  let task = await taskRow(db, row.task_id);
  if (result === 'failed' && task && (task.status === 'qc' || task.status === 'done') && !(await hasProof(db, task.id, task.status))) {
    const was = task.status;
    await db.prepare("UPDATE bot_tasks SET status = 'doing', done_at = NULL, updated_by = ?, updated_at = ? WHERE id = ? AND status = ?")
      .bind(who.bot, now, task.id, task.status).run();
    task = await taskRow(db, task.id);
    if (task.status !== was) await logEvent(db, task.id, now, who.bot, 'status', `status ${was} → ${task.status}`);
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
  if (row.asked_by !== who.bot) throw new Bad(403, 'Only the bot that asked can close this question');
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
  return json({ ok: true, feed: feedOut(await db.prepare('SELECT * FROM bot_feed_entries WHERE id = ?').bind(id).first()) }, 201);
}

async function getFeed(db, name) {
  feedSpec(name);
  const row = await latestFeed(db, name);
  return json({ ok: true, feed: row ? feedOut(row) : null });
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
    // The Projects board: open and QC tasks plus the last 7 days of done ones, each with its newest web proof link.
    tryRead(db.prepare(`SELECT t.*, (SELECT p.link FROM bot_proofs p WHERE p.task_id = t.id AND (p.link LIKE 'http://%' OR p.link LIKE 'https://%')
      ORDER BY p.created_at DESC LIMIT 1) AS proof_link FROM bot_tasks t
      WHERE t.status IN ('todo', 'doing', 'waiting_on_jon', 'qc') OR (t.status = 'done' AND t.done_at >= ?) ORDER BY t.updated_at DESC LIMIT 500`).bind(since).all()),
    tryRead(latestFeed(db, 'daily_checklists')),
    tryRead(db.prepare('SELECT * FROM bot_daily_ticks WHERE day = ?').bind(ymd(nowMs)).all()), // today's ticks only
  ]);
  // A feed is null when its table could not be read, undefined when nothing was posted yet.
  const feed = (row) => (row === FAILED ? null : row ? feedOut(row) : undefined);
  return {
    questions: q === FAILED ? null : (q.results || []).map(questionOut),
    approvals: a === FAILED ? null : (a.results || []).map(approvalOut),
    feeds: { morning_summary: feed(summary), calendar_today: feed(calendar), claude_usage: feed(usage), ebook_sales: feed(ebooks), daily_checklists: feed(daily) },
    tasks: tasks === FAILED ? null : (tasks.results || []).map((r) => ({ ...taskOut(r), proofLink: r.proof_link ?? null })),
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
  const id = rawId ? idOf(rawId) : null;
  const body = method === 'POST' || method === 'PATCH' ? await readBody(request) : {};

  switch (`${method} ${kind || ''}${rawId ? '/:id' : ''}${verb ? `/${verb}` : ''}`) {
    case 'GET me': return json({ ok: true, bot: who.bot || null, jon: !!who.jon });
    case 'GET tasks': return listTasks(db, who, q);
    case 'POST tasks': needBot(who); return createTask(db, who, body, now);
    case 'GET tasks/:id': return getTask(db, id);
    case 'PATCH tasks/:id': return who.jon ? tickTask(db, id, body, now) : updateTask(db, who, id, body, now);
    case 'POST tasks/:id/proofs': needBot(who); return addProof(db, who, id, body, now);
    case 'POST tasks/:id/comments': return addComment(db, env, ctx, who, id, body, now);
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
    case 'GET runs': return listRuns(db, who, q);
    case 'POST runs': needBot(who); return reportRun(db, who, body, now);
    case 'GET daily': return listDaily(db, q);
    case 'POST daily': needBot(who); return tickDaily(db, who, body, now);
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
    if (/no such table/i.test(String(err?.message))) return json({ ok: false, error: 'Bot tables are not set up yet' }, 503);
    console.error('v1 api error', err);
    return json({ ok: false, error: 'Server error' }, 500);
  }
}
