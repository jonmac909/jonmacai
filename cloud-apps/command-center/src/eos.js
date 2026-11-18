// EOS page data (Jon, 2026-11-18; card t_75395eabd6774bdc). GET /v1/eos, read only, all from the dashboard's own rows:
//   scorecard  newest eos_scorecard feed entry (null until one is posted; the page then says "no data yet")
//   rocks      cards titled "Rock Q<1-4>: ..."   issues  cards titled "Issue: ..." (open first, then newest change)
//   meetings   eos_meeting feed, newest entry per Monday, newest Monday first
//   queue      the Needs you list (pending approvals, open questions, cards waiting on Jon) with its filters: hidden
//              questions, items linked to deleted cards and Jon's "Not now" put-offs are left out. Money first, then oldest.
// Self-contained SQL: bots.js imports this file, so this file never imports bots.js.
import { hidden } from './d3.js';

const parse = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };

// Sponsor money, invoices and payments go to the top of Jon's queue. Word boundaries keep out MoneyClaw, Cashflow,
// "Paid promotion", "paid generators", "wire up", "rate limit", "deal with", "terms of service" and "pay attention";
// sponsor deal words (deal, contract, terms, rate, counter-offer) count.
const MONEY_RE = /\binvoices?\b|\bpayments?\b|\bpay\b(?!\s+attention)|\bpaid\b(?!\s+(?:promotion|generators?))|\brefunds?\b|\bdeposits?\b|\bcash\b(?![\s-]*flow)|\bmoney\b|\$\s?\d|\d\s?(?:usd|cad)\b|\bgst\b|\bwire (?:transfer|payment|money)\b|\bdeals?\b(?!\s+with)|\bcontracts?\b|\bterms\b(?!\s+of\s+(?:service|use))|\brates?\b(?![\s-]+limit)|\bcounter-?offers?\b/i;
// Like Needs you (d3.js blockersOf): anything the Sponsors bot asked for or owns is sponsor money.
export const isMoney = (text, project, by) => project === 'accounting' || by === 'sponsors' || MONEY_RE.test(text || '');

// Money first, oldest first inside each group. Pure, so the test checks it on its own.
export function queueOrder(items) {
  return [...items].sort((a, b) => (a.money === b.money ? String(a.createdAt).localeCompare(String(b.createdAt)) : a.money ? -1 : 1));
}

const CLOSED = ['done', 'cancelled'];
const ROCK = /^Rock Q[1-4]:/;
const NOT_DELETED = "(task_id IS NULL OR task_id NOT IN (SELECT id FROM bot_tasks WHERE status = 'deleted'))";

async function cards(db, like) {
  const { results } = await db.prepare(`SELECT t.id, t.title, t.owner, t.status, t.created_at, t.updated_at,
      (SELECT p.link FROM bot_proofs p WHERE p.task_id = t.id AND p.link LIKE 'https://%' AND p.status != 'failed'
        ORDER BY p.status = 'passed' DESC, p.created_at DESC, p.rowid DESC LIMIT 1) AS proof
    FROM bot_tasks t WHERE t.title LIKE ? AND t.status != 'deleted' ORDER BY t.updated_at DESC`).bind(like).all();
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

// Jon's "Not now" put-offs still within their time (needs_later.item is the raw card, question or approval id).
async function putOff(db, now) {
  try { return new Set(((await db.prepare('SELECT item FROM needs_later WHERE until > ? LIMIT 2000').bind(now).all()).results || []).map((r) => r.item)); }
  catch { return new Set(); } // table not there yet: nothing is put off
}

async function queue(db, now) {
  const [ap, qs, ts, later] = await Promise.all([
    db.prepare(`SELECT id, action, title, project, requested_by, task_id, created_at FROM bot_approvals WHERE status = 'pending' AND ${NOT_DELETED}`).all(),
    db.prepare(`SELECT id, question, project, asked_by, task_id, idem_key, created_at FROM bot_questions WHERE status = 'open' AND ${NOT_DELETED}`).all(),
    db.prepare("SELECT id, title, project, owner, created_at, updated_at FROM bot_tasks WHERE status = 'waiting_on_jon'").all(),
    putOff(db, now),
  ]);
  // Same rows as Needs you (d3.js blockersOf): a card waiting on Jon is its own row (dated by its last update) and its
  // linked question is dropped, so a "Not now" on the card hides both; an approval keeps its own row.
  const waiting = new Set();
  const items = [];
  for (const t of ts.results || []) {
    waiting.add(t.id);
    if (later.has(t.id)) continue; // put off
    items.push({ id: t.id, kind: 'card', title: t.title, createdAt: t.updated_at || t.created_at, money: isMoney(t.title, t.project, t.owner), taskId: t.id });
  }
  for (const q of qs.results || []) {
    if (hidden(q.idem_key) || later.has(q.id) || (q.task_id && waiting.has(q.task_id))) continue; // bot health goes to Ana, MoneyClaw's charges to the expenses review; a waiting card's question rides on the card row
    items.push({ id: q.id, kind: 'question', title: q.question, createdAt: q.created_at, money: isMoney(q.question, q.project, q.asked_by), taskId: q.task_id || null });
  }
  for (const a of ap.results || []) {
    if (later.has(a.id)) continue;
    items.push({ id: a.id, kind: 'approval', title: a.title, createdAt: a.created_at, money: isMoney(`${a.title} ${a.action}`, a.project, a.requested_by), taskId: a.task_id || null });
  }
  return queueOrder(items);
}

export async function eosData(db, now = new Date().toISOString()) {
  const [sc, rocks, issues, meets, q] = await Promise.all([
    db.prepare("SELECT data, created_at FROM bot_feed_entries WHERE name = 'eos_scorecard' ORDER BY created_at DESC, rowid DESC LIMIT 1").first(),
    cards(db, 'Rock Q%'),
    cards(db, 'Issue:%'),
    meetings(db),
    queue(db, now),
  ]);
  const open = (r) => (CLOSED.includes(r.status) ? 1 : 0);
  issues.sort((a, b) => open(a) - open(b) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const rockList = rocks.filter((r) => ROCK.test(r.title)).sort((a, b) => a.title.localeCompare(b.title));
  return {
    scorecard: sc ? { ...parse(sc.data, {}), postedAt: sc.created_at } : null,
    rocks: rockList, issues, meetings: meets, queue: q,
  };
}
