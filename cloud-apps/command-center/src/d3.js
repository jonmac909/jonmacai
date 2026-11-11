// Dashboard 3 (docs/dashboard-3.md): the rail's status lines, the Goals numbers /dashboard/api/d2 doesn't carry, and the
// Team and Blockers pages' card data.
// View only: it reads D1 and writes nothing. Every part is null on its own when its table can't be read, and the page
// shows "No feed" or "No data" for a null, never a made-up number.
import TEAM from './d3-team.json' with { type: 'json' };
import CONFIG from './d2-goals.json' with { type: 'json' };
import { plain, statusOf } from './d2.js';
import { DATE_NIGHT_TARGET, WORKOUT_TARGET } from './life.js';
import { vanYmd, weekStart } from './periods.js';
import { PROJECTS } from './projects.js';
import { agoLabel, monthWindow, plainApproval, sourceOf, vanMidnight } from './today.js';

const DAY = 86400000;
const OPEN = "('todo', 'doing', 'waiting_on_jon', 'qc', 'review')";
// Open cards read for Team and Blockers. Past this the Team page says the list is cut (today about 400 are open).
export const TASK_CAP = 5000;
// Questions kept out of Jon's queue, as in d2.js: bot health goes to Ana, MoneyClaw's known charges to the expenses review.
const hidden = (key) => /^team-guard/.test(key || '') || /^cw:/.test(key || '');
// A YouTube sync that failed on Google sign-in (src/youtube.js), not on quota or the network.
const LOGIN_OUT = /connect this channel again|token refresh/i;
const NO_FEED = { state: 'none', text: 'No feed' };
const MIN = 60000;
// The dispatcher's live feed (tools/dash_live_feed.py, every 2 min): grey once it is 10 minutes old.
const LIVE_STALE = 10 * MIN;

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
  const apSince = new Date(nowMs - 14 * DAY).toISOString();
  const AP_CARDS = `SELECT id FROM bot_tasks WHERE project IN ('home-guide-press', 'jon-mac', 'jonmacai') AND (status IN ${OPEN} OR (status = 'done' AND updated_at >= ?))`;
  const [youtube, review, approvals, questions, usage, lastUsage, open, proofs, habits, calendar, charges,
    tasks, finished, stuck, failsToday, runs, runBots, later, scripts, scoreProofs, staged, apCards, apEvents, ytLive, live, feedRows, snapRows] = await Promise.all([
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
    // Every QC verdict on a video (a proof linking a review page), for the cards with one this month; the first verdict
    // per card decides "first try".
    q(`SELECT task_id, status, created_at FROM bot_proofs WHERE (link LIKE '%/review/%' OR kind = 'render') AND status IN ('passed', 'failed')
      AND task_id IN (SELECT task_id FROM bot_proofs WHERE (link LIKE '%/review/%' OR kind = 'render') AND created_at >= ?) ORDER BY created_at, rowid LIMIT 5000`, from),
    q("SELECT day, kind, done FROM habits WHERE kind IN ('workout', 'date_night') AND day >= ?", ws < first ? ws : first),
    q("SELECT data FROM snapshots WHERE source = 'calendar'"),
    q("SELECT status FROM bot_questions WHERE idem_key LIKE 'cw:%' AND (status = 'open' OR updated_at >= ?)", from),
    // Team and Blockers: open cards, cards moved to Review or Done today, Stuck cards, QC fails today, runs.
    q(`SELECT id, title, owner, project, status, note, due, updated_at, stage, stage_since FROM bot_tasks WHERE status IN ${OPEN} ORDER BY updated_at DESC LIMIT ${TASK_CAP}`),
    // Driven from the cards updated today (a status move updates the card), so events are read by (task_id, at) only.
    q(`SELECT e.task_id, e.at, t.owner, t.title FROM bot_tasks t CROSS JOIN bot_task_events e ON e.task_id = t.id AND e.at >= ?
      WHERE t.status IN ('todo','doing','waiting_on_jon','qc','review','done','cancelled') AND t.updated_at >= ? AND e.kind = 'status' AND (e.detail LIKE '%→ review%' OR e.detail LIKE '%→ done%') ORDER BY e.at DESC LIMIT 500`, today0, today0),
    q(`SELECT p.task_id, COUNT(*) AS n, MAX(COALESCE(p.checked_at, p.created_at)) AS last FROM bot_proofs p JOIN bot_tasks t ON t.id = p.task_id
      WHERE p.status = 'failed' AND t.status NOT IN ('done', 'cancelled') GROUP BY p.task_id HAVING COUNT(*) >= 2`),
    q(`SELECT p.task_id, t.owner, t.title, COALESCE(p.checked_at, p.created_at) AS at FROM bot_proofs p JOIN bot_tasks t ON t.id = p.task_id
      WHERE p.status = 'failed' AND COALESCE(p.checked_at, p.created_at) >= ? LIMIT 1000`, today0),
    q('SELECT bot, status, started_at, tokens, task_id, error FROM bot_runs WHERE started_at >= ? ORDER BY started_at LIMIT 2000', new Date(nowMs - DAY).toISOString()),
    // Bots that post runs: only runs from the last 30 days, newest first, bounded.
    q('SELECT DISTINCT bot FROM (SELECT bot FROM bot_runs WHERE started_at >= ? ORDER BY started_at DESC LIMIT 5000)', new Date(nowMs - 30 * DAY).toISOString()),
    // Needs you "Not now": items Jon put off, still within their 24 hours.
    q('SELECT item FROM needs_later WHERE until > ? LIMIT 2000', new Date(nowMs).toISOString()),
    // Scripts page: open @JonMacAI cards, newest first, with the newest Doc link a proof carries (passed first) and
    // whether a QC-passed proof names the a-roll or footage (a note that is still waiting on it, or a draft, doesn't count).
    q(`SELECT t.id, t.title, t.status, t.stage, t.note, t.created_at,
      (SELECT p.link FROM bot_proofs p WHERE p.task_id = t.id AND p.link LIKE 'https://docs.google.com/%'
        ORDER BY p.status = 'passed' DESC, p.created_at DESC, p.rowid DESC LIMIT 1) AS doc,
      EXISTS (SELECT 1 FROM bot_proofs p WHERE p.task_id = t.id AND p.status = 'passed'
        AND (LOWER(COALESCE(p.note, '')) LIKE '%a-roll%' OR LOWER(COALESCE(p.note, '')) LIKE '%aroll%' OR LOWER(COALESCE(p.note, '')) LIKE '%footage%')
        AND LOWER(COALESCE(p.note, '')) NOT LIKE '%waiting%' AND LOWER(COALESCE(p.note, '')) NOT LIKE '%draft%') AS footage
      FROM bot_tasks t WHERE t.project = 'jonmacai' AND t.status IN ${OPEN} AND t.title LIKE '%@JonMacAI%'
      ORDER BY t.created_at DESC, t.rowid DESC LIMIT 500`),
    // Goals scoreboard: render proofs QC passed in the last week (a card counts only if its first pass is today) with their cards, and the video cards in a timed stage now. The
    // 3-hour clock starts at the card's first stage (a card made ahead of time isn't late), else when it was made.
    q(`SELECT p.task_id, p.link, COALESCE(p.checked_at, p.created_at) AS at, t.title, t.project, t.status, t.created_at, ${STARTED('t')}
      FROM bot_proofs p JOIN bot_tasks t ON t.id = p.task_id
      WHERE p.kind = 'render' AND p.status = 'passed' AND p.created_at >= ?
      ORDER BY p.created_at LIMIT 2000`, new Date(Date.parse(today0) - 7 * DAY).toISOString()),
    q(`SELECT t.id, t.title, t.project, t.status, t.stage, t.stage_since, t.created_at, ${STARTED('t')} FROM bot_tasks t
      WHERE t.status IN ('todo', 'doing', 'waiting_on_jon', 'qc') AND t.stage IN ('brief', 'script', 'pack', 'edit') ORDER BY t.stage_since LIMIT 500`),
    // Approved, not uploaded: Home Guide Press, Jon Mac and @JonMacAI cards (open, or done in the last 14 days) with their proof links and Jon's
    // approve / send-back events, and the calendar titles already published or scheduled.
    q(`SELECT t.id, t.title, (SELECT group_concat(p.link, ' ') FROM bot_proofs p WHERE p.task_id = t.id) AS links
      FROM bot_tasks t WHERE t.id IN (${AP_CARDS}) LIMIT 1000`, apSince),
    q(`SELECT task_id, kind, detail, at FROM bot_task_events WHERE task_id IN (${AP_CARDS}) AND kind IN ('review', 'status')
      AND (detail LIKE 'approved %' OR detail LIKE 'changes asked%' OR detail LIKE '%(approved by Jon)' OR detail LIKE '%(sent back by Jon)') ORDER BY at DESC LIMIT 5000`, apSince),
    q("SELECT DISTINCT lower(trim(title)) AS t FROM yt_calendar WHERE lower(status) IN ('published', 'scheduled') LIMIT 20000"),
    q("SELECT data, created_at FROM bot_feed_entries WHERE name = 'dispatch_live' ORDER BY created_at DESC LIMIT 1"),
    // System page, Sources: when each feed and each collected snapshot last reported.
    q('SELECT name, MAX(created_at) AS at FROM bot_feed_entries GROUP BY name'),
    q('SELECT source AS name, collected_at AS at FROM snapshots'),
  ]);
  return {
    youtube, review, approvals, questions, usage, lastUsage: lastUsage && (lastUsage[0] || undefined), open, proofs, habits, calendar: calendar && parse(calendar[0]?.data), charges,
    tasks, finished, stuck, failsToday, runs, runBots, later, scripts, scoreProofs, staged, apCards, apEvents, ytLive, today0, nowMs,
    live: live && (live[0] ? { d: parse(live[0].data), at: live[0].created_at } : undefined),
    feedRows, snapRows,
  };
}

// ---- the rail's four lines: { state: 'g' | 'y' | 'r' | 'none', text } ----
// The newer of Ana's usage check and the dispatcher's weekly reading (live feed). Older than 6 hours: grey, with its age,
// and not counted as a limit hit.
function tokensLine(last, nowMs, live) {
  const w = live?.d?.week;
  const wAt = Date.parse(w?.at);
  const fromLive = Number.isFinite(Number(w?.pct)) && Number.isFinite(wAt) && !(Date.parse(last?.created_at) > wAt);
  if (!last && !fromLive) return { ...NO_FEED }; // table unreadable (null) or nothing posted yet
  const d = fromLive ? {} : parse(last.data);
  const pct = Number(fromLive ? w.pct : d.weekPct);
  const src = fromLive ? sourceOf('Dispatcher weekly limit check', w.at, nowMs) : sourceOf("Ana's Claude usage check", last.created_at, nowMs);
  if (!Number.isFinite(pct)) return { ...NO_FEED };
  const reset = Date.parse(d.resetsAt);
  if (Number.isFinite(reset) && reset <= nowMs) return { state: 'none', text: 'Tokens: no report this week', pct: null, source: src };
  const p = Math.round(pct);
  const age = nowMs - Date.parse(src.at);
  if (age > 6 * 3600000) return { state: 'none', text: `Tokens ${p}%, ${agoLabel(age).replace(/ ago$/, '')} old`, pct: p, stale: true, source: src };
  const state = p >= 90 ? 'r' : p >= 75 ? 'y' : 'g';
  return { state, text: p >= 100 ? 'Token limit hit' : `Tokens ${p}% used`, pct: p, source: src };
}

// Dispatcher: green while its heartbeat is under 3 minutes old, red after. Bots: runs going now, grey when the feed is stale.
function dispatcherLine(L, nowMs) {
  if (!L) return { ...NO_FEED };
  const beat = Date.parse(L.d.beat);
  if (!Number.isFinite(beat)) return { state: 'r', text: 'Dispatcher: no heartbeat' };
  const age = Math.max(0, nowMs - beat);
  return age < 3 * MIN
    ? { state: 'g', text: 'Dispatcher running', at: L.d.beat }
    : { state: 'r', text: `Dispatcher stopped ${agoLabel(age)}`, at: L.d.beat };
}
function botsLine(L, nowMs) {
  if (!L) return { ...NO_FEED };
  const age = Math.max(0, nowMs - Date.parse(L.at));
  if (!(age < LIVE_STALE)) return { state: 'none', text: `Bots: no update for ${agoLabel(age).replace(/ ago$/, '')}`, stale: true };
  const n = Array.isArray(L.d.running) ? L.d.running.length : 0;
  return { state: 'g', text: `${n} run${n === 1 ? '' : 's'} going`, running: n, at: L.at };
}

// HeyGen today: submits from the shared submit log, via the live feed. Red when a render failed, amber when refused (daily cap).
export function heygenLine(L, nowMs = Date.now()) {
  const h = L?.d?.heygen;
  if (!h || typeof h !== 'object') return { ...NO_FEED };
  const age = Math.max(0, nowMs - Date.parse(L.at));
  if (age >= LIVE_STALE) return { state: 'none', text: `HeyGen: no update for ${agoLabel(age).replace(/ ago$/, '')}`, stale: true };
  const n = (k) => Number(h[k]) || 0;
  const parts = [`${n('accepted')} accepted`];
  if (n('refused')) parts.push(`${n('refused')} refused`);
  if (n('failed')) parts.push(`${n('failed')} failed`);
  return { state: n('failed') ? 'r' : n('refused') ? 'y' : 'g', text: parts.join(' · '), ...h };
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
// A number read from the dashboard database each time the page loads.
const LIVE = (label) => ({ label, at: null, ageLabel: 'live', stale: false });

// Weeks this month in which the weekly limit was reached (one per weekly reset): Ana's usage checks plus the
// dispatcher's weekly reading (live feed). Ana's check over 7 days old and no live hit: 'No data', not a wrong 0.
const shortDay = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric' }).format(new Date(ms));
function tokenWeeks(rows, first, last, nowMs, live, lastUsage) {
  if (!rows) return metric({ target: 0, source: { label: "Ana's Claude usage check", ageLabel: 'could not be read', stale: true } });
  const weeks = new Map(); // key -> { day, reset (ms or null) }
  for (const r of rows) {
    const d = parse(r.data);
    const day = dayOf(r.created_at);
    if (!(Number(d.weekPct) >= 100) || !day || day < first || day > last) continue;
    const reset = Date.parse(d.resetsAt);
    const key = String(d.resetsAt || weekStart(Date.parse(r.created_at)));
    if (!weeks.has(key) || weeks.get(key).day > day) weeks.set(key, { day, reset: Number.isFinite(reset) ? reset : null });
  }
  const w = live?.d?.week;
  const wAt = Date.parse(w?.at);
  const liveDay = Number.isFinite(wAt) ? dayOf(w.at) : null;
  const liveHit = Number(w?.pct) >= 100 && liveDay && liveDay >= first && liveDay <= last;
  if (liveHit) {
    const same = [...weeks.entries()].some(([k, v]) => (v.reset ? v.reset - 7 * DAY <= wAt && wAt < v.reset : k === String(weekStart(wAt))));
    if (!same) weeks.set(`live:${w.resets || weekStart(wAt)}`, { day: liveDay, reset: null });
  }
  const anaAt = Date.parse(rows[0]?.created_at || lastUsage?.created_at);
  const anaStale = !(nowMs - anaAt <= 7 * DAY);
  const anaSrc = Number.isFinite(anaAt) ? sourceOf("Ana's Claude usage check", new Date(anaAt).toISOString(), nowMs) : { label: "Ana's Claude usage check", at: null, ageLabel: 'no reading', stale: true };
  const gap = `Ana's usage check ${Number.isFinite(anaAt) ? `last posted ${shortDay(anaAt)}` : 'has never posted'}`;
  if (anaStale && !liveHit) {
    return metric({ target: 0, source: anaSrc, note: `Only the current week's reading exists (${gap}); past weeks can't be counted.` });
  }
  const days = [...weeks.values()].map((v) => v.day).sort();
  const n = days.length;
  return metric({
    actual: n, target: 0, display: String(n), status: n ? { text: 'Behind', cls: 'risk' } : { text: 'Done', cls: 'ok' }, hitDays: days,
    source: liveHit ? sourceOf('Dispatcher weekly limit check', w.at, nowMs) : anaSrc,
    note: (n ? `Limit reached in the weeks of ${days.join(', ')}.` : 'The weekly limit was not reached this month.') + (anaStale ? ` Earlier weeks can't be counted (${gap}).` : ''),
  });
}

function qcFirstTry(rows, from) {
  if (!rows) return metric({});
  const source = LIVE('QC verdicts on review pages');
  const firstOf = new Map();
  for (const r of rows) if (!firstOf.has(r.task_id)) firstOf.set(r.task_id, r);
  const firsts = [...firstOf.values()].filter((r) => Date.parse(r.created_at) >= Date.parse(from));
  const passed = firsts.filter((r) => r.status === 'passed').length;
  const total = firsts.length;
  if (!total) return metric({ source, note: 'No video was checked by QC this month yet.' });
  const pct = Math.round((passed / total) * 100);
  return metric({ actual: pct, display: `${pct}%`, passed, total, source, status: { text: 'No target', cls: 'idle' }, note: `${passed} of ${total} videos first checked by QC this month passed on the first try (cards with a render proof or a review-page link).` });
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
      loggedToday: wDays.has(P.today), source: LIVE('Your habit log'), note: 'Workouts you logged this week (Monday to Sunday).',
    }),
    dateNights: metric({
      actual: n, target: DATE_NIGHT_TARGET, display: `${n} of ${DATE_NIGHT_TARGET}`, pace: nPace, status: statusOf(n, DATE_NIGHT_TARGET, nPace, 'count'),
      perDay, loggedToday: done('date_night').some((h) => h.day === P.today), source: LIVE('Your habit log and calendar'), note: 'Date nights you logged this month, plus calendar events named "date night".',
    }),
  };
}

function chargesOf(rows) {
  if (!rows) return metric({});
  const open = rows.filter((r) => r.status === 'open').length;
  const confirmed = rows.length - open;
  return metric({
    actual: confirmed, target: rows.length, display: `${confirmed} of ${rows.length}`, open, source: LIVE('MoneyClaw charge questions'),
    status: !rows.length ? { text: 'No data', cls: 'idle' } : open ? { text: 'Behind', cls: 'risk' } : { text: 'Done', cls: 'ok' },
    note: rows.length ? `${open} MoneyClaw charge question${open === 1 ? '' : 's'} still open for you.` : 'No charge questions this month.',
  });
}

// ---- Goals top: today's video scoreboard and "Approved, not uploaded" ----
// Same rules as D:\AgentTeam\tools\pipeline.py (pace, approved_at, report) and team_audit.py (VIDEO_MIN); keep them in step.
const VIDEO_MIN = { brief: 15, script: 20, pack: 75, edit: 70 }; // minutes a stage may take, QC included: 3 hours a video
const CLOCK_MIN = 180;
const PACE_PROJECTS = ['home-guide-press', 'jon-mac', 'jonmacai', null];
const OWN = ['jon-mac', 'jonmacai'];
const FINAL_VIDEO = /jonmac\.ai\/(dashboard\/)?review\//i;
const AROLL_AD = /[\\/](aroll|ad)[\\/]/i;
const VIDEO_NAME = /review\/(?:media\/)?[a-z0-9-]+-\d+-v\d+/i;
const NOT_VIDEO = /\(guide\)|channel \(clone|^clone @/i;
const NOT_HOST = /channels|affiliate|packs|pages|scripts|permissions|home guide press|,| and | vs /i;
const LIVE_LINK = /youtu\.?be|proof-shots/i;
// Jon's focus channels: d2-goals.json's copy of D:\AgentTeam\rules\facts\focus-channels.txt.
const FOCUS = (CONFIG.goals || []).find((g) => Array.isArray(g.focus))?.focus || null;
const halves = (title) => {
  const s = String(title || '');
  const i = s.lastIndexOf(' - ');
  return i < 0 ? null : [s.slice(0, i), s.slice(i + 3)];
};
const slugOf = (s) => String(s || '').toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const isVideo = (title) => { const h = halves(title); return !!h && !NOT_VIDEO.test(title) && !NOT_HOST.test(h[1]); };
const nameOf = (title) => (halves(title)?.[0] || '').trim().toLowerCase();
const hostSlug = (title) => { const h = halves(title); return h ? slugOf(h[1]) : ''; };
const isParked = (title, focus) => {
  const host = hostSlug(title);
  if (!focus || !host) return false;
  return !focus.some((f) => host === f || f.startsWith(`${host}-`) || host.startsWith(`${f}-`));
};
export const inFocus = (title, focus = FOCUS) => {
  if (!focus) return true;
  if (hostSlug(title)) return !isParked(title, focus);
  const text = slugOf(title);
  return focus.some((f) => new RegExp(`(?:^|-)${f.split('-').slice(0, 2).join('-')}(?:-|$)`).test(text));
};
const inScope = (t) => PACE_PROJECTS.includes(t.project ?? null) && (OWN.includes(t.project) || inFocus(t.title || ''));
// SQL: when a card entered its first stage (the stage log), for the 3-hour video clock.
const STARTED = (t) => `(SELECT MIN(e.at) FROM bot_task_events e WHERE e.task_id = ${t}.id AND e.kind = 'stage') AS started_at`;
const startOf = (t) => t.started_at || t.created_at;
const mins = (from, to) => (Number.isFinite(Date.parse(from)) ? Math.max(0, Math.round((to - Date.parse(from)) / 60000)) : null);

// "N of 6 passed today": a card counts once when QC passed a final-video render today (a review page, not an a-roll or ad);
// Home Guide Press only for a focus channel. Rows: those videos, then every in-scope card in a timed stage, with its stage
// time against VIDEO_MIN and its clock since the card started against 3 hours.
function scoreboardOf(D) {
  if (!D.scoreProofs || !D.staged) return null;
  const nowMs = D.nowMs;
  const first = new Map(); // task id -> its first passing proof today
  const named = new Map();
  for (const p of D.scoreProofs) {
    const link = p.link || '';
    if (!FINAL_VIDEO.test(link) || AROLL_AD.test(link)) continue;
    named.set(p.task_id, named.get(p.task_id) || VIDEO_NAME.test(link));
    if (!first.has(p.task_id) || Date.parse(p.at) < Date.parse(first.get(p.task_id).at)) first.set(p.task_id, p);
  }
  const today0 = Date.parse(D.today0);
  const passed = [...first.values()].filter((p) => Date.parse(p.at) >= today0 && inScope(p) && (isVideo(p.title) || named.get(p.task_id)))
    .map((p) => ({ id: p.task_id, title: p.title, state: 'passed', stage: 'passed', clockMin: mins(startOf(p), Date.parse(p.at)), at: p.at }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const done = new Set(passed.map((r) => r.id));
  const going = D.staged.filter((t) => !done.has(t.id) && inScope(t)).map((t) => {
    const stageMin = mins(t.stage_since, nowMs);
    const clockMin = mins(startOf(t), nowMs);
    const budgetMin = VIDEO_MIN[t.stage];
    return { id: t.id, title: t.title, state: (stageMin ?? 0) > budgetMin || (clockMin ?? 0) > CLOCK_MIN ? 'late' : 'on', stage: t.stage, stageMin, budgetMin, clockMin };
  }).sort((a, b) => (b.clockMin ?? 0) - (a.clockMin ?? 0));
  const target = (FOCUS ? FOCUS.length : 4) + OWN.length;
  const n = passed.length;
  const pace = target * clamp((nowMs - midnight(vanYmd(nowMs))) / DAY);
  const late = going.filter((r) => r.state === 'late').length;
  return metric({
    actual: n, target, display: `${n} of ${target}`, pace, status: statusOf(n, target, pace, 'count'),
    rows: [...passed, ...going], late, clockBudget: CLOCK_MIN,
    note: `Videos whose final render QC passed today (one per card; Home Guide Press focus channels, Jon Mac and @JonMacAI). ${going.length} more in progress, ${late} late.`,
  });
}

// When Jon approved the card's video, if no change request came after it (pipeline.py approved_at).
function approvedAt(events) {
  let yes = 0; let no = 0;
  for (const e of events) {
    const d = e.detail || '';
    const at = Date.parse(e.at) || 0;
    if ((e.kind === 'review' && d.startsWith('approved ')) || (e.kind === 'status' && d.endsWith('(approved by Jon)'))) yes = Math.max(yes, at);
    if ((e.kind === 'review' && d.startsWith('changes asked')) || d.includes('(sent back by Jon)')) no = Math.max(no, at);
  }
  return yes && yes > no ? yes : null;
}

// Videos Jon approved that are not on YouTube yet: no published or scheduled calendar row with the name, no live proof link.
function approvedWaitingOf(D) {
  if (!D.apCards || !D.apEvents || !D.ytLive) return null;
  const live = new Set(D.ytLive.map((r) => r.t));
  const ev = new Map();
  for (const e of D.apEvents) (ev.get(e.task_id) || ev.set(e.task_id, []).get(e.task_id)).push(e);
  const items = [];
  for (const c of D.apCards) {
    const title = c.title || '';
    if (!isVideo(title) || live.has(nameOf(title)) || LIVE_LINK.test(c.links || '') || /ebook ad/i.test(title)) continue;
    const at = approvedAt(ev.get(c.id) || []);
    if (at) items.push({ id: c.id, title, approvedAt: new Date(at).toISOString(), waitMin: Math.round((D.nowMs - at) / 60000) });
  }
  items.sort((a, b) => b.waitMin - a.waitMin);
  const n = items.length;
  const oldest = n ? agoLabel(items[0].waitMin * 60000).replace(/ ago$/, '') : '';
  return metric({
    actual: n, target: 0, display: String(n), items, oldestLabel: oldest,
    status: n ? { text: 'Behind', cls: 'crit' } : { text: 'Done', cls: 'ok' },
    note: n ? `${n} approved video${n === 1 ? '' : 's'} not scheduled or live on YouTube yet, oldest approved ${oldest === 'just now' ? oldest : `${oldest} ago`}.` : 'Every video you approved is scheduled or live.',
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
// Video stages with Jon's stage budgets in hours (2026-11-11: brief 15 min, script 20, pack 75, edit 70, QC included);
// a-roll and publish have no budget. A card in QC shows under that stage's QC column (script -> Script QC,
// edit -> Render QC). Stages that are not video stages (Build, Deploy) stay off the board.
const BOARD = [['brief', 'Brief', 0.25], ['script', 'Script', 0.33], ['script qc', 'Script QC', 0.33], ['a-roll', 'A-roll', null],
  ['pack', 'Pack', 1.25], ['edit', 'Edit', 1.17], ['render qc', 'Render QC', 1.17], ['publish', 'Publish', null]];
const QC_COL = { script: 'script qc', edit: 'render qc' };
export const limitLabel = (h) => {
  if (h == null) return '';
  const m = Math.round(h * 60);
  return m < 60 ? `${m} m` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m / 60} h`;
};
const VIDEO_STAGES = new Set([...BOARD.map(([key]) => key), 'sponsor review']); // sponsor review: its own column, no limit
function lineOf(tasks, nowMs) {
  const cols = new Map(BOARD.map(([key, name, h]) => [key, { key, name, limit: limitLabel(h), hours: h, cards: [] }]));
  for (const t of tasks) {
    const stage = String(t.stage || '').trim().toLowerCase();
    if (!VIDEO_STAGES.has(stage)) continue;
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
      const over = c.hours != null && x.ms > Math.round(c.hours * 60) * MIN;
      if (over) late++;
      return { id: x.id, title: x.title, age: agoLabel(x.ms).replace(/ ago$/, ''), tone: over ? 'r' : 'g' };
    });
    return { key: c.key, name: c.name, limit: c.limit, n: cards.length, oldest: cards[0]?.age || '', cards: cards.slice(0, 3), more: Math.max(0, cards.length - 3) };
  });
  return { stages, late, total: stages.reduce((n, s) => n + s.n, 0) };
}

// The live feed when under 10 minutes old, else null.
const liveFresh = (L, nowMs) => (L && nowMs - Date.parse(L.at) < LIVE_STALE ? L : null);

function dueLabel(due, today) {
  const d = String(due || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (d === today) return 'today';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${d}T12:00:00Z`));
}

// ---- Cards by owner: every open card in one of five columns, newest change first (Team page chips, All view, kanban) ----
// Same cards as the Projects boards, only grouped by owner. Owners not on the roster (Jon, retired bots) share "Others".
export const CARD_COLS = [['todo', 'To do'], ['doing', 'Doing'], ['qc', 'QC'], ['waiting_on_jon', 'Needs you'], ['review', 'Review']];
const PROJECT_LABEL = new Map(PROJECTS.map((p) => [p.slug, p.label]));
function cardsOf(mine, nowMs) {
  const cols = Object.fromEntries(CARD_COLS.map(([k]) => [k, []]));
  for (const t of [...mine].sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0))) {
    cols[t.status]?.push({
      id: t.id, title: t.title,
      project: PROJECT_LABEL.get(t.project) || (t.project ? String(t.project) : 'Unsorted'),
      stage: t.stage ? `${t.stage.charAt(0).toUpperCase()}${t.stage.slice(1)}` : '',
      ago: since(t.updated_at, nowMs),
    });
  }
  return cols;
}

function teamOf(D, today) {
  if (!D.tasks) return null;
  const nowMs = D.nowMs;
  const L = liveFresh(D.live, nowMs);
  const posts = D.runBots ? new Set(D.runBots.map((r) => r.bot)) : new Set();
  const bots = TEAM.bots.map((b) => {
    const mine = D.tasks.filter((t) => t.owner === b.slug);
    const counts = {};
    for (const t of mine) counts[t.status] = (counts[t.status] || 0) + 1;
    const cur = mine.filter((t) => t.status !== 'review')
      .sort((x, y) => RANK[x.status] - RANK[y.status] || Date.parse(y.updated_at) - Date.parse(x.updated_at))[0] || null;
    const runs = (D.runs || []).filter((r) => r.bot === b.slug);
    // Runs, tokens and failed runs from the dispatcher's live feed when it is fresh; else from posted runs (bot_runs).
    const liveRuns = L ? (L.d.running || []).filter((r) => r.bot === b.slug) : [];
    const failedRuns = L ? Number(L.d.runs?.[b.slug]?.failed || 0) : runs.filter((r) => r.status === 'failed' && r.started_at >= D.today0).length;
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
      running: L ? (liveRuns.length ? `${liveRuns.length > 1 ? `${liveRuns.length} · ` : ''}${shortSince(liveRuns[0].since, nowMs)}` : '')
        : !posts.has(b.slug) ? null : running ? shortSince(running.started_at, nowMs) : '',
      tokens: L ? Number(L.d.tokens?.[b.slug] || 0) : toks.length ? toks.reduce((n, r) => n + Number(r.tokens), 0) : null,
      runsToday: L ? Number(L.d.runs?.[b.slug]?.ok || 0) + failedRuns : null,
      finishedToday: D.finished ? [...new Map(D.finished.filter((e) => e.owner === b.slug).map((e) => [e.task_id, e.title])).values()] : null,
      cards: cardsOf(mine, nowMs),
    };
  });
  const byTitle = new Map(D.tasks.map((t) => [t.id, t.title]));
  const others = D.tasks.filter((t) => !ROSTER.has(t.owner));
  const waiting = D.tasks.filter((t) => t.status === 'waiting_on_jon' && ROSTER.has(t.owner));
  const oldest = Math.min(...waiting.map((t) => Date.parse(t.updated_at)).filter(Number.isFinite));
  // The Failed tile and its list are the same list: failed runs today (live feed when fresh, else posted runs) plus
  // QC fails today (team bots only). Stuck cards are their own list and count.
  const line1 = (f, kind) => ({ card: f.card, title: f.title || byTitle.get(f.card) || '', who: ownerName(f.bot), kind, why: f.why, at: f.at, age: since(f.at, nowMs) });
  const newest = (a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0);
  const runFails = L ? (L.d.fails || []).filter((f) => (f.kind || 'run') === 'run' && ROSTER.has(f.bot))
    : (D.runs || []).filter((r) => r.status === 'failed' && r.started_at >= D.today0 && ROSTER.has(r.bot))
      .map((r) => ({ card: r.task_id || '', bot: r.bot, why: r.error ? String(r.error).slice(0, 80) : '', at: r.started_at }));
  const fails = L || D.failsToday ? [
    ...runFails.map((f) => line1(f, 'run')),
    ...(D.failsToday || []).filter((f) => ROSTER.has(f.owner)).map((f) => line1({ card: f.task_id, title: f.title, bot: f.owner, at: f.at }, 'qc')),
  ].sort(newest) : null;
  const stuck = L ? (L.d.fails || []).filter((f) => f.kind === 'stuck' && ROSTER.has(f.bot)).map((f) => line1(f, 'stuck')).sort(newest) : null;
  return {
    bots, names: TEAM.bots.reduce((n, b) => n + b.names.length, 0),
    working: bots.filter((b) => (b.counts.doing || 0) > 0).length,
    waiting: { count: waiting.length, oldest: Number.isFinite(oldest) ? since(new Date(oldest).toISOString(), nowMs) : '' },
    failedToday: fails ? fails.length : null,
    fails, stuck,
    running: L ? (L.d.running || []).length : null,
    tokens: L ? Object.values(L.d.tokens || {}).reduce((n, x) => n + Number(x || 0), 0) : null,
    liveAge: L ? since(L.at, nowMs) : '',
    line: lineOf(D.tasks, nowMs),
    // Cards by owner: "Others" holds Jon's own and retired bots' open cards, so every open card is on the page.
    others: others.length ? { slug: 'others', names: ['Others'], role: 'Jon and former bots', cards: cardsOf(others, nowMs) } : null,
    openTotal: D.tasks.length, cut: D.tasks.length >= TASK_CAP,
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
  const add = (x) => (x.you && later.has(x.id.slice(2)) ? putOff.push(x.id) : out.push({ age: since(x.at, nowMs), card: x.id.startsWith('t:') ? x.id.slice(2) : x.card || null, ...x }));
  for (const t of D.tasks) {
    if (t.status !== 'waiting_on_jon') continue;
    seen.add(t.id);
    add({ id: `t:${t.id}`, kind: 'p', you: true, title: t.title, at: t.updated_at, sponsor: t.owner === 'sponsors', owner: ownerName(t.owner), blocks: plain(t.note) || 'Waiting on you' });
  }
  for (const x of D.questions) {
    if (hidden(x.idem_key)) continue;
    const t = x.task_id && byId.get(x.task_id);
    if (t && seen.has(t.id)) continue;
    add({ id: `q:${x.id}`, kind: 'p', you: true, review: true, title: plain(x.question) || 'Question', at: x.at, sponsor: x.asked_by === 'sponsors', owner: ownerName(x.asked_by), card: t?.id || null, blocks: t ? t.title : 'No card linked' });
  }
  for (const x of D.approvals) {
    const t = x.task_id && byId.get(x.task_id);
    add({ id: `a:${x.id}`, kind: 'p', you: true, review: true, title: x.title, at: x.at, sponsor: x.requested_by === 'sponsors', owner: ownerName(x.requested_by), card: t?.id || null, blocks: t ? t.title : `Approval to ${String(x.action || '').replace(/_/g, ' ')}` });
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
  // Every row names its card; rows sharing a title get the owner, and the card id too when the owners match.
  const n = (k) => out.filter(k).length;
  const titles = out.map((b) => {
    if (n((x) => x.title === b.title) < 2) return b.title;
    const same = n((x) => x.title === b.title && x.owner === b.owner) > 1;
    return `${b.title} (${b.owner || 'no owner'}${same ? `, ${b.card || b.id}` : ''})`;
  });
  out.forEach((b, i) => { b.title = titles[i]; });
  return out;
}

// ---- Sources: every feed and snapshot behind the numbers, with who posts it and when it last reported ----
// Real rows only: a name appears once something has been posted under it. The dispatcher's live feed turns stale after
// 10 minutes, everything else after 24 hours (sourceOf). Unknown names are listed as they are, never hidden.
const SOURCE_NAMES = {
  dispatch_live: ['Dispatcher live state', 'Dispatcher script'], claude_usage: ["Ana's Claude usage check", 'Ana'],
  morning_summary: ["Ana's morning summary", 'Ana'], calendar_today: ["Ana's calendar push", 'Ana'],
  ebook_sales: ['Ebook sales', 'Home Guide Press, Accounting'], daily_checklists: ['Daily checklists', 'Bots'],
  factory: ['Video factory', 'Factory script'], periods: ['Sponsor periods', 'Sponsors'], calendar: ['Google calendar', 'Ana'],
};
function sourcesOf(D) {
  if (!D.feedRows && !D.snapRows) return null;
  const rows = [];
  for (const [kind, list] of [['Feed', D.feedRows], ['Snapshot', D.snapRows]]) {
    for (const r of list || []) {
      const [label, owner] = SOURCE_NAMES[r.name] || [String(r.name), ''];
      const s = sourceOf(label, r.at, D.nowMs);
      if (r.name === 'dispatch_live' && s.at && D.nowMs - Date.parse(s.at) > 10 * 60000) s.stale = true;
      rows.push({ name: String(r.name), label, kind, owner, at: s.at, ageLabel: s.ageLabel, stale: s.stale });
    }
  }
  return rows.sort((a, b) => Number(b.stale) - Number(a.stale) || String(a.label).localeCompare(String(b.label)));
}

// ---- Scripts: every open @JonMacAI video card, newest first, with its script Doc and whether Jon has recorded it ----
// Video card: title ends "- @JonMacAI" (a trailing "(note)" allowed) or names "@JonMacAI video:"; TEAM (QC helper)
// cards are left out.
// Doc: the first docs.google.com link in the note ("Script Doc: [label](url)"), else the newest Doc a proof carries.
// Recorded: a QC-passed proof names the a-roll or footage (not waiting on it, not a draft), or the card's stage is past
// recording (edit, render qc, publish; a pack can be built before Jon records). Everything else reads "To record".
const VIDEO_CARD = /(^|\s)[-–—]\s*@JonMacAI\s*(\([^()]*\)\s*)?$|@JonMacAI video:/i;
const PAST_RECORDING = new Set(['edit', 'render qc', 'publish']);
const DOC = /https:\/\/docs\.google\.com\/[^\s)\]>"'<]+/i;
const docOf = (note, proofDoc) => (String(note || '').match(DOC) || [])[0] || (DOC.test(proofDoc || '') ? String(proofDoc).match(DOC)[0] : null);
function scriptsOf(D) {
  if (!D.scripts) return null;
  return D.scripts.filter((t) => VIDEO_CARD.test(t.title || '') && !/^\s*TEAM\b/i.test(t.title || '')).map((t) => {
    const recorded = !!Number(t.footage) || PAST_RECORDING.has(String(t.stage || '').trim().toLowerCase());
    return { id: t.id, title: t.title, at: t.created_at, doc: docOf(t.note, t.doc), status: recorded ? 'Recorded' : 'To record' };
  });
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
      dispatcher: dispatcherLine(D.live, nowMs),
      bots: botsLine(D.live, nowMs),
      tokens: tokensLine(D.lastUsage, nowMs, D.live),
      youtube: youtubeLine(D.youtube),
      heygen: heygenLine(D.live, nowMs),
    },
    review: reviewOf(D),
    queue: queueOf(D),
    team: teamOf(D, P.today),
    blockers: blockersOf(D, putOff),
    notNow: D.later ? putOff.length : null, // Needs you items put off with "Not now"; null when needs_later can't be read
    scripts: scriptsOf(D),
    sources: sourcesOf(D),
    openCards: D.open ? Object.fromEntries(D.open.map((r) => [r.project || '', Number(r.n) || 0])) : null,
    goals: {
      tokenWeeks: tokenWeeks(D.usage, first, P.last, nowMs, D.live, D.lastUsage),
      qcFirstTry: qcFirstTry(D.proofs, new Date(win.start).toISOString()),
      ...lifeOf(D, P),
      charges: chargesOf(D.charges),
      scoreboard: scoreboardOf(D),
      approvedWaiting: approvedWaitingOf(D),
    },
  };
}
