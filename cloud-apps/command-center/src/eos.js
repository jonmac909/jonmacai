// EOS page data (Jon, 2026-11-18; card t_75395eabd6774bdc). GET /v1/eos, read only, all from the dashboard's own rows:
//   scorecard  newest eos_scorecard feed entry (null until one is posted; the page then says "no data yet")
//   rocks      cards titled "Rock Q4: ..."   issues  cards titled "Issue: ..." (open first, then newest change)
//   meetings   eos_meeting feed, newest entry per Monday, newest Monday first
//   queue      pending approvals, open questions and cards waiting on Jon: money first, then oldest first
// Self-contained SQL: bots.js imports this file, so this file never imports bots.js.

const parse = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };

// Sponsor money, invoices and payments go to the top of Jon's queue.
const MONEY_RE = /invoice|payment|\bpaid\b|\bpay\b|refund|deposit|cash|money|\$\s?\d|\bgst\b|\bwire\b/i;
export const isMoney = (text, project) => project === 'accounting' || MONEY_RE.test(text || '');

// Money first, oldest first inside each group. Pure, so the test checks it on its own.
export function queueOrder(items) {
  return [...items].sort((a, b) => (a.money === b.money ? String(a.createdAt).localeCompare(String(b.createdAt)) : a.money ? -1 : 1));
}

const CLOSED = ['done', 'cancelled'];

async function cards(db, prefix) {
  const { results } = await db.prepare(`SELECT t.id, t.title, t.owner, t.status, t.created_at, t.updated_at,
      (SELECT p.link FROM bot_proofs p WHERE p.task_id = t.id AND p.link LIKE 'https://%' AND p.status != 'failed'
        ORDER BY p.created_at DESC LIMIT 1) AS proof
    FROM bot_tasks t WHERE t.title LIKE ? AND t.status != 'deleted' ORDER BY t.updated_at DESC`).bind(`${prefix}%`).all();
  return (results || []).map((r) => ({ id: r.id, title: r.title, owner: r.owner, status: r.status, proofLink: r.proof || null, createdAt: r.created_at, updatedAt: r.updated_at }));
}

async function meetings(db) {
  const { results } = await db.prepare("SELECT data, created_at FROM bot_feed_entries WHERE name = 'eos_meeting' ORDER BY created_at DESC, rowid DESC").all();
  const seen = new Map();
  for (const r of results || []) {
    const d = parse(r.data, {});
    if (!d.date || seen.has(d.date)) continue; // rows come newest first, so the first per date wins
    seen.set(d.date, { date: d.date, summary: d.summary || '', ...(d.rating != null ? { rating: d.rating } : {}), postedAt: r.created_at });
  }
  return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date));
}

async function queue(db) {
  const [ap, qs, ts] = await Promise.all([
    db.prepare("SELECT id, action, title, project, task_id, created_at FROM bot_approvals WHERE status = 'pending'").all(),
    db.prepare("SELECT id, question, project, task_id, created_at FROM bot_questions WHERE status = 'open'").all(),
    db.prepare("SELECT id, title, project, created_at FROM bot_tasks WHERE status = 'waiting_on_jon'").all(),
  ]);
  const linked = new Set();
  const items = [];
  for (const a of ap.results || []) {
    if (a.task_id) linked.add(a.task_id);
    items.push({ id: a.id, kind: 'approval', title: a.title, createdAt: a.created_at, money: isMoney(`${a.title} ${a.action}`, a.project), taskId: a.task_id || null });
  }
  for (const q of qs.results || []) {
    if (q.task_id) linked.add(q.task_id);
    items.push({ id: q.id, kind: 'question', title: q.question, createdAt: q.created_at, money: isMoney(q.question, q.project), taskId: q.task_id || null });
  }
  for (const t of ts.results || []) {
    if (linked.has(t.id)) continue; // already on the list as its approval or question
    items.push({ id: t.id, kind: 'card', title: t.title, createdAt: t.created_at, money: isMoney(t.title, t.project), taskId: t.id });
  }
  return queueOrder(items);
}

export async function eosData(db) {
  const [sc, rocks, issues, meets, q] = await Promise.all([
    db.prepare("SELECT data, created_at FROM bot_feed_entries WHERE name = 'eos_scorecard' ORDER BY created_at DESC, rowid DESC LIMIT 1").first(),
    cards(db, 'Rock Q4:'),
    cards(db, 'Issue:'),
    meetings(db),
    queue(db),
  ]);
  const open = (r) => (CLOSED.includes(r.status) ? 1 : 0);
  issues.sort((a, b) => open(a) - open(b) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  rocks.sort((a, b) => a.title.localeCompare(b.title));
  return {
    scorecard: sc ? { ...parse(sc.data, {}), postedAt: sc.created_at } : null,
    rocks, issues, meetings: meets, queue: q,
  };
}
