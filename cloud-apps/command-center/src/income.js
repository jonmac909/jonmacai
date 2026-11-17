// Money page "Income this month" (docs/money-income.md): every incoming payment of one calendar month, Kelowna time
// (America/Vancouver), newest first, with a total per currency. Read only. Same two deposit feeds and the same merge as
// the Home and Sponsors totals (cash.js), so the USD total here is the "Cash in" figure on Home.
import { bankFeed, mergeDeposits, sourceOf, classify, isDay, vanDate } from './cash.js';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ACCOUNTS = {
  'business-usd': 'Business USD',
  'business-cad': 'Business CAD',
  personal: 'Personal',
};
const OTHER_BANK = 'Other bank (not RBC)';

function parse(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export const monthKeyOf = (ymd) => String(ymd).slice(0, 7);

function shiftMonth(key, by) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  return new Date(`${key}-15T12:00:00Z`).toLocaleString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
}

// A bank description to the payer's name: strip the wire boilerplate and reference numbers, name the known payers.
const KNOWN = [
  [/top\s?view/i, 'TopView'],
  [/in\s?video/i, 'InVideo'],
  [/commas|divisible/i, 'Commas/DIVISIBLE'],
];
const BOILER = /\b(funds transfer credit|incoming wire( transfer)?|wire (transfer )?(credit|in)|electronic funds transfer|tt)\b/gi;
const SUFFIX = /\b(pte|ltd|inc|llc|corp|co|limited|gmbh|pty)\b\.?/gi;
export function cleanPayer(raw) {
  const text = String(raw || '');
  for (const [re, name] of KNOWN) if (re.test(text)) return name;
  const base = text.replace(BOILER, ' ').replace(/\d+\s*\//g, ' ').replace(/[#*]?\d{4,}/g, ' ').replace(SUFFIX, ' ')
    .replace(/[^A-Za-z0-9&'.\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return 'Unnamed payer';
  // All caps from the bank reads as a name once cased; mixed case is already a clean name (the hand-kept ledger).
  const words = /[a-z]/.test(base) ? base : base.toLowerCase().replace(/(^|[ \-'])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return words.slice(0, 40);
}

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

function accountOf(r) {
  if (r.src === 'ledger') return r.nonRbc ? { slug: 'other-bank', label: OTHER_BANK } : { slug: 'business-usd', label: ACCOUNTS['business-usd'] };
  const slug = r.account || (r.currency === 'CAD' ? 'business-cad' : 'business-usd');
  return { slug, label: ACCOUNTS[slug] || String(slug) };
}

// monthKey: 'YYYY-MM' asked for. Anything else, or a month after this one, reads as this month.
export function buildIncome(cashRow, moneyRow, nowMs, monthKey) {
  const today = vanDate(nowMs);
  const current = monthKeyOf(today);
  const key = typeof monthKey === 'string' && MONTH.test(monthKey) && monthKey <= current ? monthKey : current;
  const d = cashRow ? parse(cashRow.data) : null;
  const ledger = d?.ok !== false && Array.isArray(d?.rows) && d.rows.length ? d.rows : null;
  const feed = bankFeed(moneyRow, nowMs);
  const out = {
    month: { key, label: monthLabel(key), current: key === current },
    prev: shiftMonth(key, -1),
    next: key < current ? shiftMonth(key, 1) : null,
    available: !!(ledger || feed),
    asOf: today,
    rows: [], other: [], totals: [], notes: [], source: null,
  };
  if (!out.available) {
    out.notes.push('No deposit data has reached the dashboard yet, so nothing is counted.');
    return out;
  }
  const all = mergeDeposits(ledger || [], feed);
  // Only days that have happened: a wire dated later this month is not income yet (same bound as the Home total).
  const inMonth = all.filter((r) => r.date.startsWith(key) && r.date <= today && isDay(r.date));
  const shape = (r) => {
    const acct = accountOf(r);
    const currency = r.currency || 'USD';
    return {
      date: r.date,
      payer: cleanPayer(r.src === 'bank' ? r.raw : r.sponsor),
      amount: r.usd == null ? null : cents(r.usd),
      currency,
      account: acct.slug,
      accountLabel: acct.label,
      cad: currency !== 'CAD' && r.amountCad ? r.amountCad : null,
      note: r.src === 'ledger' && /^reported$/i.test(String(r.status || '').trim()) ? 'Reported, not seen in RBC yet' : '',
    };
  };
  // Newest first; the same day keeps the feed's order by amount so the list does not jump between reads.
  const byNewest = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.amount || 0) - (a.amount || 0));
  out.rows = inMonth.filter((r) => classify(r) === 'income').map(shape).sort(byNewest);
  out.other = inMonth.filter((r) => classify(r) === 'other').map(shape).sort(byNewest);
  out.excluded = inMonth.filter((r) => classify(r) === 'excluded').length; // own transfers and card payments: counted nowhere, only the count is told
  const by = new Map();
  for (const r of out.rows) {
    const t = by.get(r.currency) || { currency: r.currency, amount: 0, count: 0, unknown: 0, cad: 0, cadAll: true };
    t.count += 1;
    if (r.amount == null) t.unknown += 1; else t.amount = cents(t.amount + r.amount);
    if (r.currency !== 'CAD') { if (r.cad) t.cad = cents(t.cad + r.cad); else t.cadAll = false; }
    by.set(r.currency, t);
  }
  // A CAD equivalent only when every payment in that currency carries one from the data; never a rate of ours.
  out.totals = [...by.values()].sort((a, b) => (a.currency === 'USD' ? -1 : b.currency === 'USD' ? 1 : a.currency < b.currency ? -1 : 1))
    .map((t) => ({ currency: t.currency, amount: t.amount, count: t.count, unknown: t.unknown, cadEquivalent: t.currency !== 'CAD' && t.cadAll && t.cad > 0 ? t.cad : null }));
  if (key === current) {
    out.source = sourceOf(feed, d?.ledgerEditedAt, nowMs, `${key}-01`, !!ledger);
    if (out.source.note) out.notes.push(out.source.note);
  } else if (!ledger && feed && key < feed.since.slice(0, 7)) {
    out.notes.push(`The bank feed starts ${feed.since}, so ${out.month.label} has no deposit data.`);
  } else if (!ledger && feed && key === feed.since.slice(0, 7) && feed.since > `${key}-01`) {
    out.notes.push(`The bank feed starts ${feed.since}, so deposits earlier in ${out.month.label} are not counted.`);
  }
  // The feed MoneyClaw sends today is one account. Say so until it sends the others, instead of implying a zero.
  const seen = new Set(inMonth.filter((r) => r.src === 'bank').map((r) => accountOf(r).slug));
  const widened = !!feed && feed.deposits.some((r) => r.account && r.account !== 'business-usd');
  if (feed && !widened && !seen.has('business-cad') && !seen.has('personal')) {
    out.notes.push('Only the RBC USD business account reaches the dashboard. Business CAD and personal credits are not in the bank feed yet, so they are not counted here.');
  }
  if (out.other.length) out.notes.push(`${out.other.length} credit${out.other.length === 1 ? '' : 's'} could not be sorted as income and ${out.other.length === 1 ? 'is' : 'are'} listed under Other credits, not counted.`);
  const unknown = out.rows.filter((r) => r.amount == null).length;
  if (unknown) out.notes.push(`${unknown} payment${unknown === 1 ? ' has' : 's have'} no amount recorded yet and ${unknown === 1 ? 'counts' : 'count'} as 0.`);
  return out;
}
