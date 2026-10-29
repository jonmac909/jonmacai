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
// A real calendar day: '2026-02-30' fails the round trip and '2026-04-99' fails Date.parse.
const isDay = (s) => {
  if (typeof s !== 'string' || !DAY.test(s)) return false;
  const ms = Date.parse(`${s}T12:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
};

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
  if (!inc || !Array.isArray(inc.deposits) || !isDay(inc.since) || !isDay(inc.asOf)) return null;
  // A feed cannot vouch for days that have not happened (clock skew, a UTC date): clamp to today.
  const today = vanDate(nowMs);
  const asOf = inc.asOf > today ? today : inc.asOf;
  if (inc.since > asOf) return null;
  const deposits = inc.deposits
    .filter((d) => isDay(d?.date) && d.date >= inc.since && d.date <= asOf && Number(d.amount) > 0 && !EXCLUDED_SPONSORS.test(String(d.description || '')))
    .map((d) => ({ date: d.date, sponsor: payer(d.description), usd: cents(d.amount) }));
  const asOfAge = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${asOf}T12:00:00Z`)) / DAY_MS;
  const rowAge = nowMs - Date.parse(moneyRow.collected_at);
  const stale = asOfAge > FEED_STALE_DAYS || !(rowAge <= FEED_STALE_DAYS * DAY_MS);
  return { since: inc.since, asOf, asOfMs: Date.parse(`${asOf}T12:00:00Z`), deposits, stale };
}

function mergeDeposits(ledger, feed) {
  const rows = ledger.filter((r) => isDay(r?.date)).map((r) => ({ date: r.date, sponsor: r.sponsor, usd: r.usd }));
  const merged = feed ? rows.filter((r) => r.date < feed.since || r.date > feed.asOf).concat(feed.deposits) : rows;
  return merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function ledgerStatus(editedAt, nowMs) {
  const editedMs = Date.parse(editedAt);
  if (!Number.isFinite(editedMs)) return { known: false, stale: true, editedMs: NaN, days: null };
  const days = Math.floor(Math.max(0, nowMs - editedMs) / DAY_MS);
  return { known: true, stale: nowMs - editedMs > LEDGER_STALE_DAYS * DAY_MS, editedMs, days };
}

// `monthStart` lets the bank-feed case warn only when the ledger still supplies part of this month.
function sourceOf(feed, editedAt, nowMs, monthStart, hasLedger) {
  const led = ledgerStatus(editedAt, nowMs);
  if (feed) {
    const day = shortDay(feed.asOfMs);
    const notes = [];
    if (feed.stale) notes.push(`The bank feed last synced ${day}. Deposits after that come only from the hand-kept ledger.`);
    // The ledger is the only source for the start of the month before `since` and for days after `asOf`.
    const uncovered = !hasLedger || led.stale;
    const gapStart = feed.since > monthStart;
    const gapEnd = feed.asOf < vanDate(nowMs);
    if (gapStart && uncovered) {
      const until = shortDay(Date.parse(`${feed.since}T12:00:00Z`));
      if (!hasLedger) notes.push(`No deposit ledger has reported, so deposits before ${until} are not counted.`);
      else notes.push(led.known
        ? `The hand-kept ledger supplies this month through ${until} and has not been edited since ${shortDay(led.editedMs)} (${led.days} days), so those deposits may be missing.`
        : `The hand-kept ledger supplies this month through ${until} but did not report when it was last edited, so those deposits may be missing.`);
    }
    if (gapEnd && uncovered) {
      if (!hasLedger) notes.push(`No deposit ledger has reported, so deposits after ${day} are not counted.`);
      else notes.push(led.known
        ? `The hand-kept ledger is the only source after ${day} and has not been edited since ${shortDay(led.editedMs)} (${led.days} days), so recent deposits may be missing.`
        : `The hand-kept ledger is the only source after ${day} but did not report when it was last edited, so recent deposits may be missing.`);
    }
    const warn = feed.stale || (gapStart && uncovered) || (gapEnd && uncovered);
    return { kind: 'bank', label: `RBC USD feed through ${day}`, stale: warn, note: notes.join(' ') };
  }
  if (!led.known) {
    return {
      kind: 'ledger',
      label: 'Deposit ledger, edit time unknown',
      stale: true,
      note: 'The deposit ledger did not report when it was last edited, so it may be missing deposits.',
    };
  }
  return {
    kind: 'ledger',
    label: `Deposit ledger edited ${shortDay(led.editedMs)}`,
    stale: led.stale,
    note: led.stale ? `Nobody has updated the deposit ledger since ${shortDay(led.editedMs)} (${led.days} days). Deposits after that are not counted.` : '',
  };
}

export function buildCash(cashRow, sponsorsRow, nowMs, moneyRow = null) {
  const d = cashRow ? parse(cashRow.data) : null;
  // The collector reports a missing ledger as {ok:false, rows:[]}. An empty ledger is no data, not $0:
  // it must not override the hand-recorded totals on the Sponsors page.
  const ledger = d?.ok !== false && Array.isArray(d?.rows) && d.rows.length ? d.rows : null;
  const feed = bankFeed(moneyRow, nowMs);
  const rows = ledger || feed ? mergeDeposits(ledger || [], feed) : null;
  const today = vanDate(nowMs);
  const month = today.slice(0, 7);
  const since = vanDate(nowMs - 90 * DAY_MS);
  const out = { target: SPONSOR_TARGET, available: !!rows, ledgerEditedAt: d?.ledgerEditedAt || null };
  if (rows) {
    // Bound by today: a pre-entered wire dated later this month is not income yet, and the deposit table
    // can only show what the 90-day window holds, so both sides must use the same dates.
    const inMonth = rows.filter((r) => r.date.startsWith(month) && r.date <= today);
    const in90 = rows.filter((r) => r.date > since && r.date <= today);
    const sum = (list) => cents(list.reduce((n, r) => n + (Number(r.usd) || 0), 0));
    out.month = { key: month, label: new Date(`${month}-15T12:00:00Z`).toLocaleString('en-US', { month: 'long' }), usd: sum(inMonth), payments: inMonth.length, unknown: inMonth.filter((r) => r.usd == null).length };
    out.trailing = { total: sum(in90), avg: sum(in90) / 3, payments: in90.length, unknown: in90.filter((r) => r.usd == null).length, since };
    out.pct = Math.min(100, Math.round(out.trailing.avg / SPONSOR_TARGET * 100));
    out.last = rows.length ? rows[rows.length - 1] : null;
    // Newest first. Every deposit of the current month is kept so the table always adds up to the month total.
    out.recent = in90.slice(-Math.max(40, inMonth.length)).reverse();
    out.source = sourceOf(feed, d?.ledgerEditedAt, nowMs, `${month}-01`, !!ledger);
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
