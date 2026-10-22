// Sponsor income is every deposit into the RBC USD account for the month (Jon, Oct 22). That includes
// payouts that are not sponsor invoices, such as Commas / DIVISIBLE. Two feeds supply the deposits:
//   - the MoneyClaw `income` block (bank transactions), authoritative for the dates it covers;
//   - GPU2 `sponsors_cash` (cash_ledger.csv, kept by hand), used for every date the bank feed does not cover.
// Invoices owed come from the `sponsors` collections feed and never count as income.
// See docs/sponsor-income.md.
export const SPONSOR_TARGET = 10000;
// Jon, Oct 14: the Coursiv receivable was bogus; never count or show Coursiv or GoLogin.
export const EXCLUDED_SPONSORS = /coursiv|gologin/i;
// Nothing reads RBC for the ledger, so its edit time is the only sign it is current.
export const LEDGER_STALE_DAYS = 3;
export const FEED_STALE_DAYS = 2;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

const excluded = (x) => EXCLUDED_SPONSORS.test(String(x?.sponsor || '')) || EXCLUDED_SPONSORS.test(String(x?.contact || ''));

export function withoutExcluded(source, data) {
  const d = parse(data);
  if (source === 'sponsors_cash') return { ...d, rows: (d.rows || []).filter((r) => !excluded(r)) };
  const out = { ...d };
  if (d.collections) out.collections = { ...d.collections, items: (d.collections.items || []).filter((i) => !excluded(i)) };
  if (Array.isArray(d.cards)) out.cards = d.cards.filter((c) => !excluded(c));
  return out;
}

function parse(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export function usd(n) {
  return `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
}

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Deposit totals keep their cents: $8,888.75 is not $8,889.
export function usdExact(n) {
  const x = cents(n);
  return `$${x.toLocaleString('en-US', Number.isInteger(x) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function vanDate(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function shortDay(ms) {
  return new Date(ms).toLocaleString('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric' });
}

// A bank description names the payer; long digit runs are reference or account numbers and stay out.
function payer(description) {
  return String(description || '').replace(/\d{6,}/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Deposit';
}

// MoneyClaw `income`: { since, asOf, deposits: [{ date, amount, description }] }, RBC USD credits only.
// `since` and `asOf` bound the dates the feed vouches for. Without both, the feed is ignored.
function bankFeed(moneyRow, nowMs) {
  const inc = moneyRow ? parse(moneyRow.data).income : null;
  if (!inc || !Array.isArray(inc.deposits) || !DAY.test(inc.since) || !DAY.test(inc.asOf)) return null;
  // A feed cannot vouch for days that have not happened (clock skew, a UTC date): clamp to today.
  const today = vanDate(nowMs);
  const asOf = inc.asOf > today ? today : inc.asOf;
  if (inc.since > asOf) return null;
  const deposits = inc.deposits
    .filter((d) => DAY.test(String(d?.date)) && d.date >= inc.since && d.date <= asOf && Number(d.amount) > 0 && !EXCLUDED_SPONSORS.test(String(d.description || '')))
    .map((d) => ({ date: d.date, sponsor: payer(d.description), usd: cents(d.amount) }));
  const asOfAge = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${asOf}T12:00:00Z`)) / DAY_MS;
  const rowAge = nowMs - Date.parse(moneyRow.collected_at);
  const stale = asOfAge > FEED_STALE_DAYS || !(rowAge <= FEED_STALE_DAYS * DAY_MS);
  return { since: inc.since, asOf, asOfMs: Date.parse(`${asOf}T12:00:00Z`), deposits, stale };
}

function mergeDeposits(ledger, feed) {
  const rows = ledger.filter((r) => DAY.test(String(r?.date))).map((r) => ({ date: r.date, sponsor: r.sponsor, usd: r.usd }));
  const merged = feed ? rows.filter((r) => r.date < feed.since || r.date > feed.asOf).concat(feed.deposits) : rows;
  return merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function sourceOf(feed, editedAt, nowMs) {
  if (feed) {
    const day = shortDay(feed.asOfMs);
    return {
      kind: 'bank',
      label: `RBC USD feed through ${day}`,
      stale: feed.stale,
      note: feed.stale ? `The bank feed last synced ${day}. Deposits after that come only from the hand-kept ledger.` : '',
    };
  }
  const editedMs = Date.parse(editedAt);
  if (!Number.isFinite(editedMs)) {
    return {
      kind: 'ledger',
      label: 'Deposit ledger, edit time unknown',
      stale: true,
      note: 'The deposit ledger did not report when it was last edited, so it may be missing deposits.',
    };
  }
  const days = Math.floor(Math.max(0, nowMs - editedMs) / DAY_MS);
  const stale = nowMs - editedMs > LEDGER_STALE_DAYS * DAY_MS;
  return {
    kind: 'ledger',
    label: `Deposit ledger edited ${shortDay(editedMs)}`,
    stale,
    note: stale ? `Nobody has updated the deposit ledger since ${shortDay(editedMs)} (${days} days). Deposits after that are not counted.` : '',
  };
}

export function buildCash(cashRow, sponsorsRow, nowMs, moneyRow = null) {
  const d = cashRow ? parse(cashRow.data) : null;
  const ledger = Array.isArray(d?.rows) ? d.rows : null;
  const feed = bankFeed(moneyRow, nowMs);
  const rows = ledger || feed ? mergeDeposits(ledger || [], feed) : null;
  const today = vanDate(nowMs);
  const month = today.slice(0, 7);
  const since = vanDate(nowMs - 90 * DAY_MS);
  const out = { target: SPONSOR_TARGET, available: !!rows, ledgerEditedAt: d?.ledgerEditedAt || null };
  if (rows) {
    const inMonth = rows.filter((r) => r.date.startsWith(month));
    const in90 = rows.filter((r) => r.date > since && r.date <= today);
    const sum = (list) => cents(list.reduce((n, r) => n + (Number(r.usd) || 0), 0));
    out.month = { key: month, label: new Date(`${month}-15T12:00:00Z`).toLocaleString('en-US', { month: 'long' }), usd: sum(inMonth), payments: inMonth.length, unknown: inMonth.filter((r) => r.usd == null).length };
    out.trailing = { total: sum(in90), avg: sum(in90) / 3, payments: in90.length, unknown: in90.filter((r) => r.usd == null).length, since };
    out.pct = Math.min(100, Math.round(out.trailing.avg / SPONSOR_TARGET * 100));
    out.last = rows.length ? rows[rows.length - 1] : null;
    // Newest first. Every deposit of the current month is kept so the table always adds up to the month total.
    out.recent = in90.slice(-Math.max(40, inMonth.length)).reverse();
    out.source = sourceOf(feed, d?.ledgerEditedAt, nowMs);
  }
  const s = sponsorsRow ? parse(sponsorsRow.data) : null;
  const items = s?.collections?.items;
  out.unpaidAvailable = Array.isArray(items);
  out.unpaidEditedAt = s?.sourceEditedAt || null;
  out.unpaid = (items || []).filter((i) => Number(i.owed) > 0).map((i) => ({
    sponsor: String(i.sponsor || '').slice(0, 60),
    owed: Number(i.owed),
    due: i.due || i.dueDate || null,
    status: String(i.bucketLabel || '').slice(0, 40),
    lastEmail: String(i.lastEmail || '').slice(0, 30),
  })).sort((a, b) => b.owed - a.owed);
  out.owed = out.unpaid.reduce((n, i) => n + i.owed, 0);
  return out;
}

export function cashTile(c) {
  if (!c.available) return { icon: 'dollar', label: 'Sponsors · trailing 90-day avg', value: 'no data', sub: 'cash_ledger.csv not reported from GPU2' };
  const unknown = c.trailing.unknown ? ` · ${c.trailing.unknown} payment${c.trailing.unknown === 1 ? '' : 's'} with unknown amount` : '';
  return {
    icon: 'dollar',
    label: 'Sponsors · trailing 90-day avg',
    value: usd(c.trailing.avg),
    goal: `/ ${usd(c.target).replace('$10,000', '$10k')} a month`,
    pct: c.pct,
    pg: c.pct >= 100 ? 'ok' : c.pct >= 50 ? 'risk' : 'crit',
    sub: `${c.month.label}: ${usdExact(c.month.usd)} received${unknown} · ${usd(c.owed)} unpaid · ${c.source.label}${c.source.stale ? ' (stale)' : ''}`,
  };
}
