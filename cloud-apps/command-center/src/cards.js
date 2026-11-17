// Dashboard 3 Cards page (docs/dashboard-3.md): a read-only checklist of every open card, every owner, plus the cards
// finished in the last 7 days. Reads D1 only and writes nothing. MacFrames work is flagged by its name in the card's
// title, note or project: the team's MacFrames cards are ordinary dashboard cards, so nothing else is needed to find them.
const DAY = 86400000;
const OPEN = ['todo', 'doing', 'waiting_on_jon', 'qc', 'review'];
// Past these the page says the list is cut (today about 500 open cards).
export const OPEN_CAP = 3000;
export const DONE_CAP = 500;
export const MACFRAMES = /mac[\s_-]?frames?/i;

export const isMacFrames = (c) => MACFRAMES.test(`${c.title || ''} ${c.note || ''} ${c.project || ''}`);

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
    const shape = (r) => ({
      id: r.id, title: r.title || '', owner: r.owner || '', status: r.status, project: r.project || null,
      updatedAt: r.done_at || r.updated_at || null, macframes: isMacFrames(r),
    });
    const o = (open.results || []).slice(0, OPEN_CAP).map(shape);
    const d = (done.results || []).slice(0, DONE_CAP).map(shape);
    return {
      open: o, done: d,
      counts: { open: o.length, done: d.length, macframesOpen: o.filter((c) => c.macframes).length, macframesDone: d.filter((c) => c.macframes).length },
      cut: (open.results || []).length > OPEN_CAP || (done.results || []).length > DONE_CAP,
    };
  } catch (err) {
    console.error('cards', err);
    return null;
  }
}
