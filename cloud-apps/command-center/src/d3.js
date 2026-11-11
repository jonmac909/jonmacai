// Dashboard 3 (docs/dashboard-3.md): the rail's status lines, the Goals numbers /dashboard/api/d2 doesn't carry, and the
// Team and Blockers pages' card data.
// View only: it reads D1 and writes nothing. Every part is null on its own when its table can't be read, and the page
// shows "No feed" or "No data" for a null, never a made-up number.
import TEAM from './d3-team.json' with { type: 'json' };
import { plain, statusOf } from './d2.js';
import { DATE_NIGHT_TARGET, WORKOUT_TARGET } from './life.js';
import { vanYmd, weekStart } from './periods.js';
import { agoLabel, monthWindow, plainApproval, sourceOf, vanMidnight } from './today.js';

const DAY = 86400000;
const OPEN = "('todo', 'doing', 'waiting_on_jon', 'qc', 'review')";
// Questions kept out of Jon's queue, as in d2.js: bot health goes to Ana, MoneyClaw's known charges to the expenses review.
const hidden = (key) => /^team-guard/.test(key || '') || /^cw:/.test(key || '');
// A YouTube sync that failed on Google sign-in (src/youtube.js), not on quota or the network.
const LOGIN_OUT = /connect this channel again|token refresh/i;
const NO_FEED = { state: 'none', text: 'No feed' };

const parse = (raw) => {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
};
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dayOf = (iso) => (Number.isFinite(Date.parse(iso)) ? vanYmd(Date.parse(iso)) : null);
const midnight = (ymd) => vanMidnight(...ymd.split('-').map(Number));
const clamp = (x) => Math.min(1, Math.max(0, x));

export async function d3Data(env, nowMs) {
  const db = env.DB;
  const win = monthWindow(nowMs);
  const first = `${win.key}-01`;
  const ws = weekStart(nowMs);
  const from = new Date(win.start).toISOString();
  const q = async (sql, ...args) => {
    if (!db) return null;
    try { return (await db.prepare(sql).bind(...args).all()).results || []; } catch (err) { console.error('d3', err); return null; }
  };
  const today0 = new Date(midnight(vanYmd(nowMs))).toISOString();
  const [youtube, review, approvals, questions, usage, lastUsage, open, proofs, habits, calendar, charges,
    tasks, finished, stuck, failsToday, runs, runBots, later] = await Promise.all([
    q('SELECT channel, sync_error FROM yt_api'),
    // Review cards with their newest proof link (a passed one first), as the card modal picks its deliverable.
    q(`SELECT t.id, t.title, t.owner, t.project, t.due, t.note, t.updated_at AS at,
      (SELECT p.link FROM bot_proofs p WHERE p.task_id = t.id ORDER BY p.status = 'passed' DESC, p.created_at DESC, p.rowid DESC LIMIT 1) AS link
      FROM bot_tasks t WHERE t.status = 'review' ORDER BY t.updated_at LIMIT 500`),
    q("SELECT id, title, action, payload, requested_by, task_id, created_at AS at FROM bot_approvals WHERE status = 'pending' ORDER BY created_at LIMIT 500"),
    q("SELECT id, question, context, options, asked_by, task_id, created_at AS at, idem_key FROM bot_questions WHERE status = 'open' ORDER BY created_at LIMIT 500"),
    q("SELECT data, created_at FROM bot_feed_entries WHERE name = 'claude_usage' AND created_at >= ? ORDER BY created_at DESC LIMIT 2000", new Date(win.start - 7 * DAY).toISOString()),
    q("SELECT data, created_at FROM bot_feed_entries WHERE name = 'claude_usage' ORDER BY created_at DESC LIMIT 1"),
    q(`SELECT project, COUNT(*) AS n FROM bot_tasks WHERE status IN ${OPEN} GROUP BY project`),
    // Every QC verdict on a render, for the cards with a render this month; the first verdict per card decides "first try".
    q(`SELECT task_id, status, created_at FROM bot_proofs WHERE kind = 'render' AND status IN ('passed', 'failed')
      AND task_id IN (SELECT task_id FROM bot_proofs WHERE kind = 'render' AND created_at >= ?) ORDER BY created_at, rowid LIMIT 5000`, from),
    q("SELECT day, kind, done FROM habits WHERE kind IN ('workout', 'date_night') AND day >= ?", ws < first ? ws : first),
    q("SELECT data FROM snapshots WHERE source = 'calendar'"),
    q("SELECT status FROM bot_questions WHERE idem_key LIKE 'cw:%' AND (status = 'open' OR updated_at >= ?)", from),
    // Team and Blockers: open cards, cards moved to Review or Done today, Stuck cards, QC fails today, runs.
    q(`SELECT id, title, owner, status, note, due, updated_at, stage, stage_since FROM bot_tasks WHERE status IN ${OPEN} ORDER BY updated_at DESC LIMIT 3000`),
    // Driven from the cards updated today (a status move updates the card), so events are read by (task_id, at) only.
    q(`SELECT e.task_id, e.at, t.owner, t.title FROM bot_tasks t CROSS JOIN bot_task_events e ON e.task_id = t.id AND e.at >= ?
      WHERE t.status IN ('todo','doing','waiting_on_jon','qc','review','done','cancelled') AND t.updated_at >= ? AND e.kind = 'status' AND (e.detail LIKE '%→ review%' OR e.detail LIKE '%→ done%') ORDER BY e.at DESC LIMIT 500`, today0, today0),
    q(`SELECT p.task_id, COUNT(*) AS n, MAX(COALESCE(p.checked_at, p.created_at)) AS last FROM bot_proofs p JOIN bot_tasks t ON t.id = p.task_id
      WHERE p.status = 'failed' AND t.status NOT IN ('done', 'cancelled') GROUP BY p.task_id HAVING COUNT(*) >= 2`),
    q(`SELECT p.task_id, t.owner FROM bot_proofs p JOIN bot_tasks t ON t.id = p.task_id
      WHERE p.status = 'failed' AND COALESCE(p.checked_at, p.created_at) >= ? LIMIT 1000`, today0),
    q('SELECT bot, status, started_at, tokens FROM bot_runs WHERE started_at >= ? ORDER BY started_at LIMIT 2000', new Date(nowMs - DAY).toISOString()),
    // Bots that post runs: only runs from the last 30 days, newest first, bounded.
    q('SELECT DISTINCT bot FROM (SELECT bot FROM bot_runs WHERE started_at >= ? ORDER BY started_at DESC LIMIT 5000)', new Date(nowMs - 30 * DAY).toISOString()),
    // Needs you "Not now": items Jon put off, still within their 24 hours.
    q('SELECT item FROM needs_later WHERE until > ? LIMIT 2000', new Date(nowMs).toISOString()),
  ]);
  return {
    youtube, review, approvals, questions, usage, lastUsage: lastUsage && (lastUsage[0] || undefined), open, proofs, habits, calendar: calendar && parse(calendar[0]?.data), charges,
    tasks, finished, stuck, failsToday, runs, runBots, later, today0, nowMs,
  };
}

// ---- the rail's four lines: { state: 'g' | 'y' | 'r' | 'none', text } ----
function tokensLine(last, nowMs) {
  if (!last) return { ...NO_FEED }; // table unreadable (null) or nothing posted yet
  const d = parse(last.data);
  const pct = Number(d.weekPct);
  const src = sourceOf("Ana's Claude usage check", last.created_at, nowMs);
  if (!Number.isFinite(pct)) return { ...NO_FEED };
  const reset = Date.parse(d.resetsAt);
  if (Number.isFinite(reset) && reset <= nowMs) return { state: 'none', text: 'Tokens: no report this week', pct: null, source: src };
  const p = Math.round(pct);
  const state = p >= 90 ? 'r' : p >= 75 ? 'y' : 'g';
  return { state, text: p >= 100 ? 'Token limit hit' : `Tokens ${p}% used`, pct: p, source: src };
}

function youtubeLine(rows) {
  if (!rows) return { ...NO_FEED };
  if (!rows.length) return { state: 'none', text: 'YouTube not connected' };
  const out = rows.filter((r) => LOGIN_OUT.test(r.sync_error || ''));
  return out.length
    ? { state: 'r', text: `YouTube login out (${out.length} of ${rows.length})`, out: out.length, connected: rows.length }
    : { state: 'g', text: 'YouTube login ok', out: 0, connected: rows.length };
}

// Jon's review queue: video and other cards in Review, pending approvals and open questions (bot health and known charges left out).
function reviewOf(D) {
  if (!D.review || !D.approvals || !D.questions) return null;
  const qs = D.questions.filter((x) => !hidden(x.idem_key));
  const all = [...D.review, ...D.approvals, ...qs].map((x) => Date.parse(x.at)).filter(Number.isFinite);
  const oldest = all.length ? Math.min(...all) : null;
  return {
    count: D.review.length + D.approvals.length + qs.length, cards: D.review.length, approvals: D.approvals.length, questions: qs.length,
    oldestAt: oldest == null ? null : new Date(oldest).toISOString(),
    oldestLabel: oldest == null ? '' : agoLabel(Math.max(0, D.nowMs - oldest)).replace(/ ago$/, ''),
  };
}

// ---- Review page: one queue item per card in Review, pending approval and open question, oldest first ----
// Each item carries only the existing write it uses: PATCH /v1/tasks/:id (Approve = done, Send back = doing + comment),
// POST /v1/approvals/:id/decide, POST /v1/questions/:id/answer. Links: web or same-site paths only, never local files.
const API = '/dashboard/api/v1';
const webLink = (h) => (/^(https?:\/\/|\/(?![/\\]))/i.test(String(h || '')) ? String(h) : '');
const shortDue = (due) => {
  const d = String(due || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${d}T12:00:00Z`)) : '';
};
function queueOf(D) {
  if (!D.review || !D.approvals || !D.questions) return null;
  const nowMs = D.nowMs;
  const byId = new Map((D.tasks || []).map((t) => [t.id, t]));
  const waited = (at) => since(at, nowMs);
  const items = [];
  for (const t of D.review) {
    const link = webLink(t.link);
    const video = /\/dashboard\/review\//i.test(link) || /\b(video|render)\b/i.test(t.title || '');
    const due = shortDue(t.due);
    items.push({
      id: `t:${t.id}`, type: video ? 'video' : 'card', kind: video ? 'Video' : 'Card in Review', name: t.title, head: t.title, at: t.at,
      sub: [ownerName(t.owner), due && `due ${due}`, `waiting ${waited(t.at)}`].filter(Boolean).join(' · '),
      facts: [['Owner', ownerName(t.owner) || '–'], ['Project', t.project || '–'], ['Due', due || '–'], ['Waiting', waited(t.at)]].map(([l, v]) => ({ l, v })),
      body: noteText(t.note), link, linkLabel: /\/dashboard\/review\//i.test(link) ? 'Open the review page' : 'Open the proof',
      act: { type: 'card', url: `${API}/tasks/${t.id}` },
    });
  }
  for (const a of D.approvals) {
    const p = plainApproval(a.action, parse(a.payload));
    const t = a.task_id && byId.get(a.task_id);
    items.push({
      id: `a:${a.id}`, type: 'approval', kind: 'Approval', name: a.title, head: a.title, at: a.at,
      sub: `Asked by ${ownerName(a.requested_by) || 'a bot'} · waiting ${waited(a.at)}`,
      facts: [{ l: 'From', v: ownerName(a.requested_by) || '–' }, { l: 'Card', v: t ? t.title : 'No card linked' }, { l: 'Does', v: p.does }],
      body: p.notes.join(' '), links: p.links.filter((l) => webLink(l.href)),
      act: { type: 'approval', url: `${API}/approvals/${a.id}/decide`, confirm: `Approve "${a.title}"? ${p.does}` },
    });
  }
  for (const x of D.questions) {
    if (hidden(x.idem_key)) continue;
    const t = x.task_id && byId.get(x.task_id);
    const opts = (() => { const o = parse(x.options); return Array.isArray(o) ? o.filter((s) => typeof s === 'string' && s.trim()).slice(0, 10) : []; })();
    items.push({
      id: `q:${x.id}`, type: 'question', kind: 'Decision', name: plain(x.question) || 'Question', head: plain(x.question) || 'Question', at: x.at,
      sub: `Asked by ${ownerName(x.asked_by) || 'a bot'} · waiting ${waited(x.at)}`,
      facts: [{ l: 'From', v: ownerName(x.asked_by) || '–' }, { l: 'Card', v: t ? t.title : 'No card linked' }],
      body: noteText(x.context), act: { type: 'question', url: `${API}/questions/${x.id}/answer`, options: opts },
    });
  }
  return items.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
}

// ---- Goals numbers d2 doesn't have ----
const metric = (f) => ({ actual: null, target: null, display: 'No data', pace: null, status: { text: 'No data', cls: 'idle' }, note: '', days: [], ...f });

// Weeks this month in which Ana's usage check reached 100% (one per weekly reset).
function tokenWeeks(rows, first, last) {
  if (!rows) return metric({ target: 0, source: { label: "Ana's Claude usage check", ageLabel: 'could not be read', stale: true } });
  const weeks = new Map();
  for (const r of rows) {
    const d = parse(r.data);
    const day = dayOf(r.created_at);
    if (!(Number(d.weekPct) >= 100) || !day || day < first || day > last) continue;
    const key = String(d.resetsAt || weekStart(Date.parse(r.created_at)));
    if (!weeks.has(key) || weeks.get(key) > day) weeks.set(key, day);
  }
  const days = [...weeks.values()].sort();
  const n = days.length;
  return metric({
    actual: n, target: 0, display: String(n), status: n ? { text: 'Behind', cls: 'risk' } : { text: 'Done', cls: 'ok' }, hitDays: days,
    note: n ? `Limit reached in the weeks of ${days.join(', ')}.` : 'The weekly limit was not reached this month.',
  });
}

function qcFirstTry(rows, from) {
  if (!rows) return metric({});
  const firstOf = new Map();
  for (const r of rows) if (!firstOf.has(r.task_id)) firstOf.set(r.task_id, r);
  const firsts = [...firstOf.values()].filter((r) => Date.parse(r.created_at) >= Date.parse(from));
  const passed = firsts.filter((r) => r.status === 'passed').length;
  const total = firsts.length;
  if (!total) return metric({ note: 'No render was checked by QC this month yet.' });
  const pct = Math.round((passed / total) * 100);
  return metric({ actual: pct, display: `${pct}%`, passed, total, status: { text: 'No target', cls: 'idle' }, note: `${passed} of ${total} renders checked this month passed QC on the first try.` });
}

function lifeOf(D, P) {
  const habits = D.habits;
  if (!habits) return { workouts: metric({ target: WORKOUT_TARGET }), dateNights: metric({ target: DATE_NIGHT_TARGET }) };
  const done = (kind) => habits.filter((h) => h.kind === kind && Number(h.done));
  const wDays = new Set(done('workout').map((h) => h.day));
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(P.ws, i)).map((ymd) => ({ ymd, actual: ymd > P.today ? null : wDays.has(ymd) ? 1 : 0 }));
  const w = days.reduce((n, d) => n + (d.actual || 0), 0);
  const wPace = WORKOUT_TARGET * P.weekShare;
  // Date nights: Jon's marks plus calendar events named "date night", as the Life page counts them.
  const perDay = {};
  for (const h of done('date_night')) if (h.day >= P.first && h.day <= P.last) perDay[h.day] = (perDay[h.day] || 0) + 1;
  for (const e of D.calendar?.events || []) {
    const day = /date night/i.test(e.title || '') && dayOf(e.start);
    if (day && day >= P.first && day <= P.today) perDay[day] = (perDay[day] || 0) + 1;
  }
  const n = Object.values(perDay).reduce((a, b) => a + b, 0);
  const nPace = DATE_NIGHT_TARGET * P.elapsed;
  return {
    workouts: metric({
      actual: w, target: WORKOUT_TARGET, display: `${w} of ${WORKOUT_TARGET}`, pace: wPace, status: statusOf(w, WORKOUT_TARGET, wPace, 'count'), days,
      loggedToday: wDays.has(P.today), note: 'Workouts you logged this week (Monday to Sunday).',
    }),
    dateNights: metric({
      actual: n, target: DATE_NIGHT_TARGET, display: `${n} of ${DATE_NIGHT_TARGET}`, pace: nPace, status: statusOf(n, DATE_NIGHT_TARGET, nPace, 'count'),
      perDay, loggedToday: done('date_night').some((h) => h.day === P.today), note: 'Date nights you logged this month, plus calendar events named "date night".',
    }),
  };
}

function chargesOf(rows) {
  if (!rows) return metric({});
  const open = rows.filter((r) => r.status === 'open').length;
  const confirmed = rows.length - open;
  return metric({
    actual: confirmed, target: rows.length, display: `${confirmed} of ${rows.length}`, open,
    status: !rows.length ? { text: 'No data', cls: 'idle' } : open ? { text: 'Behind', cls: 'risk' } : { text: 'Done', cls: 'ok' },
    note: rows.length ? `${open} MoneyClaw charge question${open === 1 ? '' : 's'} still open for you.` : 'No charge questions this month.',
  });
}

// ---- Team: one row per roster bot (src/d3-team.json), from its cards, proofs and runs ----
const RANK = { doing: 0, waiting_on_jon: 1, qc: 2, todo: 3, review: 4 };
const STATUS = { doing: 'Doing', waiting_on_jon: 'Waiting on you', qc: 'In QC', todo: 'To do', review: 'In Review' };
const ROSTER = new Map(TEAM.bots.map((b) => [b.slug, b]));
// A slug not on the roster is a retired bot (Mila, Ivy): never shown by name.
export const ownerName = (slug) => (slug === 'jon' ? 'Jon' : !slug ? '' : ROSTER.get(slug)?.names.join(', ') || 'Former bot');
const since = (iso, nowMs) => (Number.isFinite(Date.parse(iso)) ? agoLabel(Math.max(0, nowMs - Date.parse(iso))).replace(/ ago$/, '') : '');
const shortSince = (iso, nowMs) => {
  const m = Math.floor(Math.max(0, nowMs - Date.parse(iso)) / 60000);
  return m < 60 ? `${m} m` : m < 2880 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`;
};
// A card's note as plain text for "Work so far": no links, no file paths, no heading marks, at most 360 characters.
const noteText = (note) => {
  const t = String(note || '').replace(/https?:\/\/\S+/g, '').replace(/[A-Za-z]:[\\/][^\s,;)]*/g, (p) => p.split(/[\\/]/).filter(Boolean).pop())
    .replace(/^\s*#+\s*/gm, '').replace(/^\s*[-*•]+\s+/gm, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return t.length > 360 ? `${t.slice(0, 357).trimEnd()}…` : t;
};
// ---- Video board: open cards with a stage (set by the dispatcher's hand-off), by stage ----
// Columns as designed, with their proposed limits (hours). A card in QC shows under that stage's QC column when there is
// one (script -> Script QC, edit -> Render QC). Any other stage gets its own column after these, with no limit.
const BOARD = [['brief', 'Brief', 4], ['script', 'Script', 4], ['script qc', 'Script QC', 2], ['a-roll', 'A-roll', 4],
  ['pack', 'Pack', 8], ['edit', 'Edit', 8], ['render qc', 'Render QC', 2], ['publish', 'Publish', 72]];
const QC_COL = { script: 'script qc', edit: 'render qc' };
const limitLabel = (h) => (h == null ? '' : h % 24 ? `${h} h` : `${h / 24} d`);
function lineOf(tasks, nowMs) {
  const cols = new Map(BOARD.map(([key, name, h]) => [key, { key, name, limit: limitLabel(h), hours: h, cards: [] }]));
  for (const t of tasks) {
    const stage = String(t.stage || '').trim().toLowerCase();
    if (!stage) continue;
    const key = t.status === 'qc' && QC_COL[stage] ? QC_COL[stage] : stage;
    if (!cols.has(key)) cols.set(key, { key, name: key.charAt(0).toUpperCase() + key.slice(1), limit: '', hours: null, cards: [] });
    // Time in the column: since the stage began, or since the card went to QC for a QC column (the move updates the card).
    const from = Date.parse(key !== stage ? t.updated_at : t.stage_since || t.updated_at);
    const ms = Number.isFinite(from) ? Math.max(0, nowMs - from) : 0;
    cols.get(key).cards.push({ id: t.id, title: t.title, ms });
  }
  let late = 0;
  const stages = [...cols.values()].map((c) => {
    const cards = c.cards.sort((a, b) => b.ms - a.ms).map((x) => {
      const over = c.hours != null && x.ms > c.hours * 3600000;
      if (over) late++;
      return { id: x.id, title: x.title, age: agoLabel(x.ms).replace(/ ago$/, ''), tone: over ? 'r' : 'g' };
    });
    return { key: c.key, name: c.name, limit: c.limit, n: cards.length, oldest: cards[0]?.age || '', cards: cards.slice(0, 3), more: Math.max(0, cards.length - 3) };
  });
  return { stages, late, total: stages.reduce((n, s) => n + s.n, 0) };
}

function dueLabel(due, today) {
  const d = String(due || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (d === today) return 'today';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${d}T12:00:00Z`));
}

function teamOf(D, today) {
  if (!D.tasks) return null;
  const nowMs = D.nowMs;
  const posts = D.runBots ? new Set(D.runBots.map((r) => r.bot)) : new Set();
  const bots = TEAM.bots.map((b) => {
    const mine = D.tasks.filter((t) => t.owner === b.slug);
    const counts = {};
    for (const t of mine) counts[t.status] = (counts[t.status] || 0) + 1;
    const cur = mine.filter((t) => t.status !== 'review')
      .sort((x, y) => RANK[x.status] - RANK[y.status] || Date.parse(y.updated_at) - Date.parse(x.updated_at))[0] || null;
    const runs = (D.runs || []).filter((r) => r.bot === b.slug);
    const failedRuns = runs.filter((r) => r.status === 'failed' && r.started_at >= D.today0).length;
    const qcFails = D.failsToday ? D.failsToday.filter((f) => f.owner === b.slug).length : null;
    const running = runs.filter((r) => r.status === 'running').pop();
    const toks = runs.filter((r) => r.started_at >= D.today0 && r.tokens != null && Number.isFinite(Number(r.tokens)));
    const failed = failedRuns + (qcFails || 0);
    return {
      slug: b.slug, names: b.names, role: b.role, counts,
      card: cur && { id: cur.id, title: cur.title, status: cur.status, stage: cur.stage ? `${cur.stage.charAt(0).toUpperCase()}${cur.stage.slice(1)} · ${STATUS[cur.status]}` : STATUS[cur.status], due: dueLabel(cur.due, today), updated: since(cur.updated_at, nowMs), note: noteText(cur.note) },
      tone: failed ? 'r' : cur?.status === 'doing' ? 'g' : cur?.status === 'waiting_on_jon' ? 'y' : '',
      failedToday: qcFails == null ? null : failed, qcFailsToday: qcFails, failedRunsToday: failedRuns,
      // Run feed: null = this bot posts no runs (No feed); '' = it posts runs but none is running now.
      running: !posts.has(b.slug) ? null : running ? shortSince(running.started_at, nowMs) : '',
      tokens: toks.length ? toks.reduce((n, r) => n + Number(r.tokens), 0) : null, // tokens per run: nothing posts them yet
      finishedToday: D.finished ? [...new Map(D.finished.filter((e) => e.owner === b.slug).map((e) => [e.task_id, e.title])).values()] : null,
    };
  });
  const waiting = D.tasks.filter((t) => t.status === 'waiting_on_jon' && ROSTER.has(t.owner));
  const oldest = Math.min(...waiting.map((t) => Date.parse(t.updated_at)).filter(Number.isFinite));
  return {
    bots, names: TEAM.bots.reduce((n, b) => n + b.names.length, 0),
    working: bots.filter((b) => (b.counts.doing || 0) > 0).length,
    waiting: { count: waiting.length, oldest: Number.isFinite(oldest) ? since(new Date(oldest).toISOString(), nowMs) : '' },
    failedToday: D.failsToday ? bots.reduce((n, b) => n + (b.failedToday || 0), 0) : null,
    cost: null, // no cost feed per bot yet
    line: lineOf(D.tasks, nowMs),
  };
}

// ---- Blockers from D1: cards waiting on Jon, open questions, pending approvals, Stuck cards, late cards ----
// Stuck: the dispatcher's rule (a card whose proof failed QC 2 or more times), read live from bot_proofs, for cards still
// open and not in Review (a card in Review passed QC on its newest version). Late: in Doing, no card update in 2 hours.
// kind: p = waiting on a person, f = work that failed, s = slow or idle (a = access and limits, added on the page from the rail).
// Jon's rows he put off with "Not now" (needs_later) are left out until their time is up, and pushed to `putOff`.
function blockersOf(D, putOff = []) {
  if (!D.tasks || !D.approvals || !D.questions || !D.stuck) return null;
  const nowMs = D.nowMs;
  const byId = new Map(D.tasks.map((t) => [t.id, t]));
  const later = new Set((D.later || []).map((r) => r.item));
  const seen = new Set();
  const out = [];
  const add = (x) => (x.you && later.has(x.id.slice(2)) ? putOff.push(x.id) : out.push({ age: since(x.at, nowMs), ...x }));
  for (const t of D.tasks) {
    if (t.status !== 'waiting_on_jon') continue;
    seen.add(t.id);
    add({ id: `t:${t.id}`, kind: 'p', you: true, title: t.title, at: t.updated_at, owner: ownerName(t.owner), blocks: plain(t.note) || 'Waiting on you' });
  }
  for (const x of D.questions) {
    if (hidden(x.idem_key)) continue;
    const t = x.task_id && byId.get(x.task_id);
    if (t && seen.has(t.id)) continue;
    add({ id: `q:${x.id}`, kind: 'p', you: true, review: true, title: plain(x.question) || 'Question', at: x.at, owner: ownerName(x.asked_by), blocks: t ? t.title : 'No card linked' });
  }
  for (const x of D.approvals) {
    const t = x.task_id && byId.get(x.task_id);
    add({ id: `a:${x.id}`, kind: 'p', you: true, review: true, title: x.title, at: x.at, owner: ownerName(x.requested_by), blocks: t ? t.title : `Approval to ${String(x.action || '').replace(/_/g, ' ')}` });
  }
  for (const s of D.stuck) {
    const t = byId.get(s.task_id);
    if (!t || t.status === 'review' || seen.has(t.id)) continue;
    seen.add(t.id);
    add({ id: `t:${t.id}`, kind: 'f', you: false, title: t.title, at: s.last, owner: ownerName(t.owner), blocks: `Stuck: failed QC ${s.n} times`, fails: Number(s.n) });
  }
  for (const t of D.tasks) {
    if (t.status !== 'doing' || t.owner === 'jon' || seen.has(t.id) || !(nowMs - Date.parse(t.updated_at) >= 2 * 3600000)) continue;
    add({ id: `t:${t.id}`, kind: 's', you: false, title: t.title, at: t.updated_at, owner: ownerName(t.owner), blocks: `Late: no card update for ${since(t.updated_at, nowMs)}` });
  }
  return out;
}

export function buildD3(D) {
  const nowMs = D.nowMs;
  const win = monthWindow(nowMs);
  const first = `${win.key}-01`;
  const daysInMonth = Math.round((win.end - win.start) / DAY);
  const ws = weekStart(nowMs);
  const putOff = [];
  const P = {
    today: vanYmd(nowMs), ws, first, last: addDays(first, daysInMonth - 1), elapsed: win.elapsed,
    weekShare: clamp((nowMs - midnight(ws)) / (7 * DAY)),
  };
  return {
    rail: {
      dispatcher: { ...NO_FEED }, // no dispatcher heartbeat reaches the dashboard yet
      bots: { ...NO_FEED }, // no per-bot heartbeat reaches the dashboard yet
      tokens: tokensLine(D.lastUsage, nowMs),
      youtube: youtubeLine(D.youtube),
    },
    review: reviewOf(D),
    queue: queueOf(D),
    team: teamOf(D, P.today),
    blockers: blockersOf(D, putOff),
    notNow: D.later ? putOff.length : null, // Needs you items put off with "Not now"; null when needs_later can't be read
    openCards: D.open ? Object.fromEntries(D.open.map((r) => [r.project || '', Number(r.n) || 0])) : null,
    goals: {
      tokenWeeks: tokenWeeks(D.usage, first, P.last),
      qcFirstTry: qcFirstTry(D.proofs, new Date(win.start).toISOString()),
      ...lifeOf(D, P),
      charges: chargesOf(D.charges),
    },
  };
}
