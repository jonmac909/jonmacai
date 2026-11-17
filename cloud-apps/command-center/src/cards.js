// Dashboard 3 Cards page (docs/dashboard-3.md): a read-only checklist of every open card, every owner, plus the cards
// finished in the last 7 days. Reads D1 only and writes nothing. MacFrames work is flagged by its name in the card's
// title, note or project: the team's MacFrames cards are ordinary dashboard cards, so nothing else is needed to find them.
import TEAM from './d3-team.json' with { type: 'json' };
import { agoLabel } from './today.js';

const DAY = 86400000;
// The dispatcher's live feed (dispatch_live, every 2 min) counts as current for 10 minutes, as on the Team page (src/d3.js).
const LIVE_STALE = 10 * 60000;
const OPEN = ['todo', 'doing', 'waiting_on_jon', 'qc', 'review'];
// Past these the page says the list is cut (today about 500 open cards).
export const OPEN_CAP = 3000;
export const DONE_CAP = 500;
export const MACFRAMES = /mac[\s_-]?frames?/i;

export const isMacFrames = (c) => MACFRAMES.test(`${c.title || ''} ${c.note || ''} ${c.project || ''}`);

const NAMES = new Map(TEAM.bots.map((b) => [b.slug, b.names]));

// "Who is working on what now" (Jon, 2026-11-17), shown at the top of the Cards page. A team member is active when they own a card in
// Doing, or the dispatcher's live feed (when fresh) shows a run going on one of their cards; the same card is listed once.
// Jon himself is not a team member here. Members with nothing active are left out. Pure: cards = open cards (raw rows),
// runs = the feed's running list, titles = card id -> row for run cards that are not in `cards`.
export function activeOf(cards, runs, extra, nowMs) {
  const age = (iso) => (Number.isFinite(Date.parse(iso)) ? agoLabel(Math.max(0, nowMs - Date.parse(iso))) : '');
  const by = new Map();
  const add = (owner, c, running, at) => {
    if (!owner || owner === 'jon' || !c?.id) return;
    if (!by.has(owner)) by.set(owner, new Map());
    const m = by.get(owner);
    const prev = m.get(c.id);
    if (prev) { prev.running = prev.running || running; return; }
    m.set(c.id, { id: c.id, title: c.title || '', status: c.status, running, updatedAt: at || c.updated_at || null, age: age(at || c.updated_at) });
  };
  for (const c of cards) if (c.status === 'doing') add(c.owner, c, false, c.updated_at);
  const byId = new Map([...cards, ...(extra || [])].map((c) => [c.id, c]));
  for (const r of runs || []) {
    const c = byId.get(r?.card);
    if (c) add(r.bot || c.owner, c, true, r.since);
  }
  return [...by.entries()].map(([owner, m]) => {
    const list = [...m.values()].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return { owner, names: NAMES.get(owner) || [], cards: list, latest: list[0]?.updatedAt || '' };
  }).sort((a, b) => b.latest.localeCompare(a.latest) || a.owner.localeCompare(b.owner)).map(({ latest, ...x }) => x);
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
    try {
      const live = await db.prepare("SELECT data, created_at FROM bot_feed_entries WHERE name = 'dispatch_live' ORDER BY created_at DESC LIMIT 1").all();
      const row = (live.results || [])[0];
      if (row && nowMs - Date.parse(row.created_at) < LIVE_STALE) {
        let d = row.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
        runs = (Array.isArray(d?.running) ? d.running : []).filter((r) => r && typeof r.card === 'string' && r.card.length <= 64).slice(0, 50);
        const known = new Set((open.results || []).map((c) => c.id));
        const miss = [...new Set(runs.map((r) => r.card))].filter((id) => !known.has(id));
        if (miss.length) {
          const q = await db.prepare(`SELECT id, title, owner, status, updated_at FROM bot_tasks WHERE status IN (${marks}) AND id IN (${miss.map(() => '?').join(', ')})`).bind(...OPEN, ...miss).all().catch(() => ({ results: [] }));
          extra = q.results || [];
        }
      }
    } catch { runs = []; }
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
      cut: (open.results || []).length > OPEN_CAP || (done.results || []).length > DONE_CAP,
    };
  } catch (err) {
    console.error('cards', err);
    return null;
  }
}
