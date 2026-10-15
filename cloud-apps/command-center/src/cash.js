// Sponsors tile: cash actually received (GPU2 `sponsors_cash` from cash_ledger.csv), trailing 90-day
// monthly average vs $10k, and unpaid invoices from the `sponsors` collections feed.
export const SPONSOR_TARGET = 10000;
// Jon, Oct 14: the Coursiv receivable was bogus; never count or show Coursiv or GoLogin.
export const EXCLUDED_SPONSORS = /coursiv|gologin/i;

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

function vanDate(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export function buildCash(cashRow, sponsorsRow, nowMs) {
  const d = cashRow ? parse(cashRow.data) : null;
  const rows = Array.isArray(d?.rows) ? d.rows : null;
  const today = vanDate(nowMs);
  const month = today.slice(0, 7);
  const since = vanDate(nowMs - 90 * 86400000);
  const out = { target: SPONSOR_TARGET, available: !!rows, ledgerEditedAt: d?.ledgerEditedAt || null };
  if (rows) {
    const inMonth = rows.filter((r) => r.date.startsWith(month));
    const in90 = rows.filter((r) => r.date > since && r.date <= today);
    const sum = (list) => list.reduce((n, r) => n + (Number(r.usd) || 0), 0);
    out.month = { label: new Date(`${month}-15T12:00:00Z`).toLocaleString('en-US', { month: 'long' }), usd: sum(inMonth), payments: inMonth.length, unknown: inMonth.filter((r) => r.usd == null).length };
    out.trailing = { total: sum(in90), avg: sum(in90) / 3, payments: in90.length, unknown: in90.filter((r) => r.usd == null).length, since };
    out.pct = Math.min(100, Math.round(out.trailing.avg / SPONSOR_TARGET * 100));
    out.last = rows.length ? rows[rows.length - 1] : null;
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
    sub: `${c.month.label}: ${usd(c.month.usd)} received${unknown} · ${usd(c.owed)} unpaid`,
  };
}
