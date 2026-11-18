// Dashboard 3 Cards page (docs/dashboard-3.md): a read-only checklist of every open card, every owner, plus the cards
// finished in the last 7 days. Reads D1 only and writes nothing. MacFrames work is flagged by its name in the card's
// title, note or project: the team's MacFrames cards are ordinary dashboard cards, so nothing else is needed to find them.
import TEAM from './d3-team.json' with { type: 'json' };
import { agoLabel } from './today.js';

const DAY = 86400000;
// The dispatcher's live feed (dispatch_live, pushed every 2 min) counts for 5 minutes here: a feed nobody refreshed shows no one working
// (Jon, 2026-11-17: the count must be what really runs). The Team page (src/d3.js) keeps its own 10 minutes.
const LIVE_STALE = 5 * 60000;
const OPEN = ['todo', 'doing', 'waiting_on_jon', 'qc', 'review'];
// Past these the page says the list is cut (today about 500 open cards).
export const OPEN_CAP = 3000;
export const DONE_CAP = 500;
export const MACFRAMES = /mac[\s_-]?frames?/i;

export const isMacFrames = (c) => MACFRAMES.test(`${c.title || ''} ${c.note || ''} ${c.project || ''}`);

const NAMES = new Map(TEAM.bots.map((b) => [b.slug, b.names]));

// Helper jobs the dispatcher's live feed lists as running now (Jon, 2026-11-17: "how is no one working right now?"): background jobs of a bot,
// mostly Ana's (tools/helper_job.py). One row each: the bot, the job's title (its brief's first heading), minutes running, and the card when
// the job names one that is known here. Pure. feed = the parsed dispatch_live data, or null when the feed is stale or unreadable; a job with
// no readable start time, or one that starts in the future, is dropped. Oldest first.
export function jobsOf(feed, cards, nowMs) {
  const byId = new Map((cards || []).map((c) => [c.id, c]));
  const out = [];
  for (const j of Array.isArray(feed?.jobs) ? feed.jobs : []) {
    const start = Date.parse(j?.started);
    if (!j || typeof j.name !== 'string' || !j.name || !Number.isFinite(start) || start > nowMs + 60000) continue;
    const owner = /^[a-z][a-z0-9-]{0,39}$/.test(String(j.bot || '').toLowerCase()) ? String(j.bot).toLowerCase() : 'ana';
    if (owner === 'jon') continue;
    const card = typeof j.card === 'string' ? byId.get(j.card) : null;
    out.push({
      name: j.name.slice(0, 80), owner, names: NAMES.get(owner) || [], title: String(j.title || j.name).slice(0, 140),
      mins: Math.max(0, Math.floor((nowMs - start) / 60000)), startedAt: new Date(start).toISOString(),
      updatedAt: Number.isFinite(Date.parse(j.updated)) ? j.updated : null,
      card: card ? card.id : null, cardTitle: card ? card.title || '' : '',
    });
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.name.localeCompare(b.name)).slice(0, 30);
}

// "Working now" (Jon, 2026-11-17; again 19:42 when it said 7 with one job running), shown at the top of the Cards page. Only runs that
// really go count: a card is listed when the dispatcher's live feed (fresh, 5 minutes) shows a run going on it. A card its owner merely
// touched lately is not a run and is not listed. One row per card, oldest start first. Jon himself is not a team member here.
// Pure: cards = open cards (raw rows), runs = the feed's running list, extra = run cards that are not in `cards`.
export function activeOf(cards, runs, extra, nowMs) {
  const age = (iso) => (Number.isFinite(Date.parse(iso)) ? agoLabel(Math.max(0, nowMs - Date.parse(iso))) : '');
  const rows = new Map();
  const byId = new Map([...cards, ...(extra || [])].map((c) => [c.id, c]));
  for (const r of runs || []) {
    const c = byId.get(r?.card);
    const owner = r?.bot || c?.owner;
    if (!c || !owner || owner === 'jon' || rows.has(c.id)) continue;
    const at = r.since || c.updated_at || null;
    rows.set(c.id, { owner, names: NAMES.get(owner) || [], id: c.id, title: c.title || '', status: c.status, running: true, updatedAt: at, age: age(at) });
  }
  return [...rows.values()].sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')) || a.id.localeCompare(b.id));
}

// { open: [{id, title, owner, status, project, updatedAt, macframes}], done: [...], counts, cut } or null when D1 can't be read.
export async function cardsData(env, nowMs = Date.now()) {
  const db = env.DB;
  if (!db) return null;
  const since = new Date(nowMs - 7 * DAY).toISOString();
  try {
    const marks = OPEN.map(() => '?').join(', ');
    const cols = 'id, title, owner, status, project, updated_at, done_at, substr(note, 1, 600) AS note';
    const [open, done] = await Promise.all([
      db.prepare(`SELECT ${cols} FROM bot_tasks WHERE status IN (${marks}) ORDER BY updated_at DESC LIMIT ${OPEN_CAP + 1}`).bind(...OPEN).all(),
      db.prepare(`SELECT ${cols} FROM bot_tasks WHERE status = 'done' AND COALESCE(done_at, updated_at) >= ? ORDER BY COALESCE(done_at, updated_at) DESC LIMIT ${DONE_CAP + 1}`).bind(since).all(),
    ]);
    // The dispatcher's live feed, when fresh: runs going now. A feed that can't be read means no run signal, never an error.
    let runs = [];
    let extra = [];
    let feed = null;
    try {
      const live = await db.prepare("SELECT data, created_at FROM bot_feed_entries WHERE name = 'dispatch_live' ORDER BY created_at DESC LIMIT 1").all();
      const row = (live.results || [])[0];
      if (row && nowMs - Date.parse(row.created_at) < LIVE_STALE) {
        let d = row.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
        feed = d && typeof d === 'object' ? d : null;
        runs = (Array.isArray(d?.running) ? d.running : []).filter((r) => r && typeof r.card === 'string' && r.card.length <= 64).slice(0, 50);
        const known = new Set((open.results || []).map((c) => c.id));
        const miss = [...new Set(runs.map((r) => r.card))].filter((id) => !known.has(id));
        if (miss.length) {
          const q = await db.prepare(`SELECT id, title, owner, status, updated_at FROM bot_tasks WHERE status IN (${marks}) AND id IN (${miss.map(() => '?').join(', ')})`).bind(...OPEN, ...miss).all().catch(() => ({ results: [] }));
          extra = q.results || [];
        }
      }
    } catch { runs = []; feed = null; }
    const shape = (r) => ({
      id: r.id, title: r.title || '', owner: r.owner || '', status: r.status, project: r.project || null,
      updatedAt: r.done_at || r.updated_at || null, macframes: isMacFrames(r),
    });
    const o = (open.results || []).slice(0, OPEN_CAP).map(shape);
    const d = (done.results || []).slice(0, DONE_CAP).map(shape);
    return {
      open: o, done: d,
      counts: { open: o.length, done: d.length, macframesOpen: o.filter((c) => c.macframes).length, macframesDone: d.filter((c) => c.macframes).length },
      active: activeOf((open.results || []).slice(0, OPEN_CAP), runs, extra, nowMs),
      jobs: jobsOf(feed, [...(open.results || []).slice(0, OPEN_CAP), ...(done.results || []).slice(0, DONE_CAP), ...extra], nowMs),
      cut: (open.results || []).length > OPEN_CAP || (done.results || []).length > DONE_CAP,
    };
  } catch (err) {
    console.error('cards', err);
    return null;
  }
}
