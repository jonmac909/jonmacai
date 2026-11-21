// Sponsor memory (card t_dd14c08f25ea4179): one record per sponsor company, its partners@ threads and its follow-ups.
// GPU1's tools/sponsor_memory.py reads partners@ and posts here (POST /sponsor-memory/ingest, machine token); the Money
// page reads the cards (GET /sponsor-memory, session) and Florence's `sponsor_followups.py due` reads the open follow-ups
// (GET /sponsor-memory/followups, machine token). Deals and invoices are not stored twice: a card shows the board deals
// (sponsor_deals + stage overrides) and the collections items that match the sponsor, read when the page loads.
import { keepCard, mapColumn, withDeals } from './sponsors.js';

const TZ = 'America/Vancouver';
const KINDS = new Set(['reply', 'chase', 'promise', 'payment', 'due']);
const STATUSES = new Set(['', 'lead', 'negotiating', 'active', 'paid', 'closed', 'skip']);
const MAX_THREADS = 150; // per ingest call: GPU1 sends the backfill in chunks

export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const slugOf = (name) => norm(name).slice(0, 40);
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const jsonList = (v, max, each) => JSON.stringify((Array.isArray(v) ? v : []).slice(0, max).map(each).filter(Boolean));

// Today in Kelowna, YYYY-MM-DD.
export function todayYmd(nowMs = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(nowMs)).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const contactRow = (c) => (c && (c.email || c.name) ? { name: text(c.name, 80), email: text(c.email, 120).toLowerCase(), last: iso(c.last) || '' } : null);
const rateRow = (r) => (r && Number(r.amount) > 0 ? { amount: Math.round(Number(r.amount)), what: text(r.what, 80), date: ymd(r.date) || '', thread: text(r.thread, 40) } : null);
const dealRow = (d) => (d && d.label ? { label: text(d.label, 100), amount: Number(d.amount) > 0 ? Math.round(Number(d.amount) * 100) / 100 : null, stage: text(d.stage, 60), date: ymd(d.date) || '', source: text(d.source, 30) } : null);
const invoiceRow = (i) => (i && (i.no || i.amount) ? { no: text(i.no, 20), amount: Number(i.amount) > 0 ? Math.round(Number(i.amount) * 100) / 100 : null, state: ['sent', 'paid', 'owed'].includes(i.state) ? i.state : 'sent', date: ymd(i.date) || '', thread: text(i.thread, 40) } : null);

// Body: { sponsors: [...], threads: [...], followups: [...], close: [{id, reason}] } -> counts. Every field is optional,
// bad rows are counted and skipped (one bad row never loses the rest). A manually closed follow-up is never reopened.
export async function ingestSponsorMemory(db, body, nowMs = Date.now()) {
  const now = new Date(nowMs).toISOString();
  const out = { sponsors: 0, threads: 0, followups: 0, closed: 0, skipped: 0 };
  const stmts = [];
  for (const s of (Array.isArray(body?.sponsors) ? body.sponsors : []).slice(0, 400)) {
    const id = slugOf(s?.id || s?.name);
    if (!id || !text(s?.name, 80)) { out.skipped += 1; continue; }
    const status = STATUSES.has(s.status) ? s.status : '';
    stmts.push(db.prepare(`INSERT INTO sponsor_mem (id, name, status, contacts, rates, deals, invoices, summary, last_contact, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, contacts = excluded.contacts, rates = excluded.rates,
        deals = excluded.deals, invoices = excluded.invoices, summary = excluded.summary, last_contact = excluded.last_contact, updated_at = excluded.updated_at`)
      .bind(id, text(s.name, 80), status, jsonList(s.contacts, 12, contactRow), jsonList(s.rates, 12, rateRow), jsonList(s.deals, 20, dealRow),
        jsonList(s.invoices, 30, invoiceRow), text(s.summary, 300), iso(s.last_contact), now));
    out.sponsors += 1;
  }
  const threads = (Array.isArray(body?.threads) ? body.threads : []).slice(0, MAX_THREADS);
  for (const t of threads) {
    const id = String(t?.thread_id || '');
    const sid = slugOf(t?.sponsor_id);
    if (!/^[0-9a-f]{6,32}$/i.test(id) || !sid) { out.skipped += 1; continue; }
    stmts.push(db.prepare(`INSERT INTO sponsor_mem_threads (thread_id, sponsor_id, subject, first_at, last_at, who, last_is_us, n, summary, labels, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET sponsor_id = excluded.sponsor_id, subject = excluded.subject, first_at = excluded.first_at, last_at = excluded.last_at,
        who = excluded.who, last_is_us = excluded.last_is_us, n = excluded.n, summary = excluded.summary, labels = excluded.labels, updated_at = excluded.updated_at`)
      .bind(id, sid, text(t.subject, 150), iso(t.first_at), iso(t.last_at), text(t.who, 120), t.last_is_us ? 1 : 0, Math.max(0, Math.min(999, Number(t.n) || 0)),
        text(t.summary, 220), jsonList(t.labels, 12, (x) => text(x, 40) || null), now));
    out.threads += 1;
  }
  for (const f of (Array.isArray(body?.followups) ? body.followups : []).slice(0, 600)) {
    const id = text(f?.id, 120);
    const sid = slugOf(f?.sponsor_id);
    if (!id || !sid || !KINDS.has(f.kind) || !ymd(f.due) || !text(f.text, 200)) { out.skipped += 1; continue; }
    // INSERT keeps created_at on a re-scan; an open row follows the new text and date; a manual close stays closed.
    stmts.push(db.prepare(`INSERT INTO sponsor_followups (id, sponsor_id, thread_id, kind, text, due, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
      ON CONFLICT(id) DO UPDATE SET text = excluded.text, due = excluded.due, sponsor_id = excluded.sponsor_id, thread_id = excluded.thread_id, updated_at = excluded.updated_at,
        status = CASE WHEN sponsor_followups.closed_by = 'manual' THEN sponsor_followups.status ELSE 'open' END,
        closed_reason = CASE WHEN sponsor_followups.closed_by = 'manual' THEN sponsor_followups.closed_reason ELSE '' END,
        closed_by = CASE WHEN sponsor_followups.closed_by = 'manual' THEN 'manual' ELSE '' END,
        closed_at = CASE WHEN sponsor_followups.closed_by = 'manual' THEN sponsor_followups.closed_at ELSE NULL END`)
      .bind(id, sid, /^[0-9a-f]{6,32}$/i.test(String(f.thread_id || '')) ? f.thread_id : '', f.kind, text(f.text, 200), f.due, now, now));
    out.followups += 1;
  }
  for (const c of (Array.isArray(body?.close) ? body.close : []).slice(0, 600)) {
    const id = text(c?.id, 120);
    if (!id) { out.skipped += 1; continue; }
    const by = c.by === 'manual' ? 'manual' : 'auto';
    stmts.push(db.prepare(`UPDATE sponsor_followups SET status = 'closed', closed_reason = ?, closed_by = ?, closed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`)
      .bind(text(c.reason, 120) || 'done', by, now, now, id));
    out.closed += 1;
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return out;
}

// Open follow-ups, soonest first. `through` (YYYY-MM-DD): only those due on or before it (overdue ones included).
export async function openFollowups(db, through = null) {
  const sql = `SELECT f.id, f.sponsor_id, f.thread_id, f.kind, f.text, f.due, f.created_at, m.name AS sponsor
    FROM sponsor_followups f LEFT JOIN sponsor_mem m ON m.id = f.sponsor_id
    WHERE f.status = 'open'${through ? ' AND f.due <= ?' : ''} ORDER BY f.due, f.created_at LIMIT 500`;
  const q = db.prepare(sql);
  const { results } = await (through ? q.bind(through) : q).all();
  return (results || []).map((r) => ({ ...r, sponsor: r.sponsor || r.sponsor_id }));
}

const parse = (s, dflt) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : dflt; } catch { return dflt; } };

// What GPU1 needs to derive follow-ups from deals: the collections items and the board's deals (no email text).
export function dealsSource(data, deals = {}, overrides = {}) {
  return {
    items: (data?.collections?.items || []).map((i) => ({ sponsor: text(i.sponsor, 80), total: Number(i.total) || 0, paid: Number(i.paid) || 0, owed: Number(i.owed) || 0, bucket: text(i.bucket, 30), lastEmail: text(i.lastEmail, 40), action: text(i.action, 240), blocker: text(i.blocker, 240) })),
    cards: withDeals(data, overrides, deals).map((c) => ({ id: c.id, sponsor: text(c.sponsor, 80), stage: c.stage, amount: Number(c.amountSet) > 0 ? Number(c.amountSet) : Number(c.amount) || null, next: text(c.next, 240), blocker: text(c.blocker, 240), threadId: c.threadId || '', latestDate: c.latestDate || '' })),
  };
}

// One card per sponsor: the stored record + its threads + its open follow-ups + the board deals and collections items that match.
// `data` is the 'sponsors' snapshot (cards + collections), `deals`/`overrides` the board's hand edits.
export async function sponsorCards(db, data, deals = {}, overrides = {}, nowMs = Date.now()) {
  const [m, t, f] = await Promise.all([
    db.prepare('SELECT * FROM sponsor_mem').all(),
    db.prepare('SELECT * FROM sponsor_mem_threads ORDER BY last_at DESC').all(),
    db.prepare(`SELECT id, sponsor_id, thread_id, kind, text, due FROM sponsor_followups WHERE status = 'open' ORDER BY due`).all(),
  ]);
  const items = data?.collections?.items || [];
  const board = withDeals(data, overrides, deals).filter((c) => keepCard(c, nowMs, items));
  const by = new Map();
  const get = (name) => {
    const key = slugOf(name);
    if (!key) return null;
    if (!by.has(key)) by.set(key, { id: key, name: text(name, 80), status: '', contacts: [], rates: [], extraDeals: [], extraInvoices: [], summary: '', lastContact: null, threads: [], followups: [], deals: [], money: null });
    return by.get(key);
  };
  for (const r of m.results || []) {
    const c = get(r.name);
    if (!c) continue;
    Object.assign(c, { id: r.id, status: r.status, contacts: parse(r.contacts, []), rates: parse(r.rates, []), extraDeals: parse(r.deals, []), extraInvoices: parse(r.invoices, []), summary: r.summary, lastContact: r.last_contact });
    by.set(r.id, c);
  }
  for (const r of t.results || []) by.get(r.sponsor_id)?.threads.push({ id: r.thread_id, subject: r.subject, last: r.last_at, who: r.who, us: !!r.last_is_us, n: r.n, summary: r.summary });
  for (const r of f.results || []) by.get(r.sponsor_id)?.followups.push({ id: r.id, kind: r.kind, text: r.text, due: r.due, thread: r.thread_id });
  // The board and the collections sheet add what the emails don't know: deals with their stage, amounts owed and paid.
  for (const card of board) {
    const c = [...by.values()].find((x) => norm(x.name) === norm(card.sponsor)) || get(card.sponsor);
    if (!c) continue;
    c.deals.push({ label: card.subject || card.status || 'Deal', stage: mapColumn(card.stage), amount: Number(card.amountSet) > 0 ? Number(card.amountSet) : Number(card.amount) || null, next: card.next || '', blocker: card.blocker || '', date: String(card.latestDate || '').slice(0, 10) });
  }
  for (const item of items) {
    const c = [...by.values()].find((x) => norm(x.name) === norm(item.sponsor)) || get(item.sponsor);
    if (!c) continue;
    c.money = { total: Number(item.total) || 0, paid: Number(item.paid) || 0, owed: Number(item.owed) || 0, bucket: item.bucketLabel || item.bucket || '', last: item.lastEmail || '', action: item.action || '', blocker: item.blocker || '' };
  }
  const today = todayYmd(nowMs);
  const list = [...new Set(by.values())].filter((c) => c.threads.length || c.deals.length || c.money || c.extraDeals.length)
    .map((c) => ({ ...c, nextFollowup: c.followups[0]?.due || null, overdue: c.followups.filter((x) => x.due < today).length }));
  // Open follow-ups first (soonest), then money owed, then the newest contact.
  list.sort((a, b) => (a.nextFollowup && b.nextFollowup ? a.nextFollowup.localeCompare(b.nextFollowup) : a.nextFollowup ? -1 : b.nextFollowup ? 1 : 0)
    || (b.money?.owed || 0) - (a.money?.owed || 0) || String(b.lastContact || '').localeCompare(String(a.lastContact || '')));
  return { today, asOf: new Date(nowMs).toISOString(), sponsors: list, open: (f.results || []).length };
}
