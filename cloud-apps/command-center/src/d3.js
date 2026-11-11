// Dashboard 3 (docs/dashboard-3.md): the rail's status lines and the Goals numbers /dashboard/api/d2 doesn't carry.
// View only: it reads D1 and writes nothing. Every part is null on its own when its table can't be read, and the page
// shows "No feed" or "No data" for a null, never a made-up number.
import { statusOf } from './d2.js';
import { DATE_NIGHT_TARGET, WORKOUT_TARGET } from './life.js';
import { vanYmd, weekStart } from './periods.js';
import { agoLabel, monthWindow, sourceOf, vanMidnight } from './today.js';

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
  const [youtube, review, approvals, questions, usage, lastUsage, open, proofs, habits, calendar, charges] = await Promise.all([
    q('SELECT channel, sync_error FROM yt_api'),
    q("SELECT updated_at AS at FROM bot_tasks WHERE status = 'review'"),
    q("SELECT created_at AS at FROM bot_approvals WHERE status = 'pending'"),
    q("SELECT created_at AS at, idem_key FROM bot_questions WHERE status = 'open'"),
    q("SELECT data, created_at FROM bot_feed_entries WHERE name = 'claude_usage' AND created_at >= ? ORDER BY created_at DESC LIMIT 2000", new Date(win.start - 7 * DAY).toISOString()),
    q("SELECT data, created_at FROM bot_feed_entries WHERE name = 'claude_usage' ORDER BY created_at DESC LIMIT 1"),
    q(`SELECT project, COUNT(*) AS n FROM bot_tasks WHERE status IN ${OPEN} GROUP BY project`),
    // Every QC verdict on a render, for the cards with a render this month; the first verdict per card decides "first try".
    q(`SELECT task_id, status, created_at FROM bot_proofs WHERE kind = 'render' AND status IN ('passed', 'failed')
      AND task_id IN (SELECT task_id FROM bot_proofs WHERE kind = 'render' AND created_at >= ?) ORDER BY created_at, rowid LIMIT 5000`, from),
    q("SELECT day, kind, done FROM habits WHERE kind IN ('workout', 'date_night') AND day >= ?", ws < first ? ws : first),
    q("SELECT data FROM snapshots WHERE source = 'calendar'"),
    q("SELECT status FROM bot_questions WHERE idem_key LIKE 'cw:%' AND (status = 'open' OR updated_at >= ?)", from),
  ]);
  return { youtube, review, approvals, questions, usage, lastUsage: lastUsage && (lastUsage[0] || undefined), open, proofs, habits, calendar: calendar && parse(calendar[0]?.data), charges, nowMs };
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

export function buildD3(D) {
  const nowMs = D.nowMs;
  const win = monthWindow(nowMs);
  const first = `${win.key}-01`;
  const daysInMonth = Math.round((win.end - win.start) / DAY);
  const ws = weekStart(nowMs);
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
    openCards: D.open ? Object.fromEntries(D.open.map((r) => [r.project || '', Number(r.n) || 0])) : null,
    goals: {
      tokenWeeks: tokenWeeks(D.usage, first, P.last),
      qcFirstTry: qcFirstTry(D.proofs, new Date(win.start).toISOString()),
      ...lifeOf(D, P),
      charges: chargesOf(D.charges),
    },
  };
}
