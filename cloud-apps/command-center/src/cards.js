// Dashboard 3 Cards page (docs/dashboard-3.md): a read-only checklist of every open card, every owner, plus the cards
// finished in the last 7 days. Reads D1 only and writes nothing. MacFrames work is flagged by its name in the card's
// title, note or project: the team's MacFrames cards are ordinary dashboard cards, so nothing else is needed to find them.
import TEAM from './d3-team.json' with { type: 'json' };
import { agoLabel } from './today.js';

const DAY = 86400000;
// The dispatcher's live feed (dispatch_live, every 2 min) counts as current for 10 minutes, as on the Team page (src/d3.js).
const LIVE_STALE = 10 * 60000;
// A card its owner updated within this long counts as being worked on ("Working now").
const ACTIVE_WINDOW = 60 * 60000;
const OPEN = ['todo', 'doing', 'waiting_on_jon', 'qc', 'review'];
// Past these the page says the list is cut (today about 500 open cards).
export const OPEN_CAP = 3000;
export const DONE_CAP = 500;
export const MACFRAMES = /mac[\s_-]?frames?/i;

export const isMacFrames = (c) => MACFRAMES.test(`${c.title || ''} ${c.note || ''} ${c.project || ''}`);

const NAMES = new Map(TEAM.bots.map((b) => [b.slug, b.names]));

// "Working now" (Jon, 2026-11-17, tightened the same day), shown at the top of the Cards page. Only real work counts: a card is listed
// when (a) the dispatcher's live feed (fresh within 10 minutes) shows a run going on it, or (b) its own owner updated it in the last
// 60 minutes (a note or other edit, a proof, a status change, a comment). Owning a Doing card is not enough, and a script's write
// (the load balancer moving a card, with its "Moved from" comment) or Jon's own action is not the owner's update. One row per card,
// running ones first, then the most recently updated. Jon himself is not a team member here. Pure: cards = open cards (raw rows),
// runs = the feed's running list, extra = run cards that are not in `cards`, recent = card id -> ISO time of the owner's last update.
export function activeOf(cards, runs, extra, nowMs, recent) {
  const age = (iso) => (Number.isFinite(Date.parse(iso)) ? agoLabel(Math.max(0, nowMs - Date.parse(iso))) : '');
  const rows = new Map();
  const add = (owner, c, running, at) => {
    if (!owner || owner === 'jon' || !c?.id) return;
    const prev = rows.get(c.id);
    if (prev) { prev.running = prev.running || running; return; }
    rows.set(c.id, { owner, names: NAMES.get(owner) || [], id: c.id, title: c.title || '', status: c.status, running, updatedAt: at || c.updated_at || null, age: age(at || c.updated_at) });
  };
  const byId = new Map([...cards, ...(extra || [])].map((c) => [c.id, c]));
  for (const r of runs || []) {
    const c = byId.get(r?.card);
    if (c) add(r.bot || c.owner, c, true, r.since);
  }
  for (const c of cards) {
    const at = recent?.get?.(c.id);
    if (c.status === 'doing' && at && nowMs - Date.parse(at) <= ACTIVE_WINDOW) add(c.owner, c, false, at);
  }
  return [...rows.values()].sort((a, b) => Number(b.running) - Number(a.running) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.id.localeCompare(b.id));
}

// Doing cards whose own owner touched them since `since`: id -> newest ISO time. Three signals, all by the owner: the card's last write
// (a note, progress, any edit), a history row (status change, proof, stage), a comment. The load balancer's owner move and its
// "Moved from" comment are scripts, not the owner, so they are left out.
async function ownerUpdates(db, since) {
  const q = await db.prepare(
    `SELECT id, MAX(at) AS at FROM (
       SELECT t.id AS id, t.updated_at AS at FROM bot_tasks t WHERE t.status = 'doing' AND t.updated_at >= ?1 AND t.updated_by = t.owner
         AND NOT EXISTS (SELECT 1 FROM bot_task_events e WHERE e.task_id = t.id AND e.kind = 'owner' AND e.at = t.updated_at)
       UNION ALL
       SELECT t.id, e.at FROM bot_task_events e JOIN bot_tasks t ON t.id = e.task_id
         WHERE t.status = 'doing' AND e.at >= ?1 AND e."by" = t.owner AND e.kind NOT IN ('owner', 'comment')
       UNION ALL
       SELECT t.id, c.created_at FROM bot_task_comments c JOIN bot_tasks t ON t.id = c.task_id
         WHERE t.status = 'doing' AND c.created_at >= ?1 AND c.author = t.owner AND c.body NOT LIKE 'Moved from %'
     ) GROUP BY id LIMIT 1000`).bind(since).all();
  return new Map((q.results || []).map((r) => [r.id, r.at]));
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
    let recent = new Map();
    try { recent = await ownerUpdates(db, new Date(nowMs - ACTIVE_WINDOW).toISOString()); } catch { recent = new Map(); }
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
      active: activeOf((open.results || []).slice(0, OPEN_CAP), runs, extra, nowMs, recent),
      cut: (open.results || []).length > OPEN_CAP || (done.results || []).length > DONE_CAP,
    };
  } catch (err) {
    console.error('cards', err);
    return null;
  }
}
