const TZ = 'America/Vancouver';
const HIDDEN = '$ • • • • • •';
const ACTION = 'https://moneyclaw.jonmac.ai/api/internal/dashboard-action';

export function usd(n, digits) {
  const x = Number(n) || 0;
  const d = digits == null ? (Math.abs(x - Math.round(x)) < 1e-9 ? 0 : 2) : digits;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d,
  }).format(x);
}

function dollars(period) {
  if (!period) return 0;
  if (typeof period.total === 'number') return period.total;
  return (Number(period.totalCents) || 0) / 100;
}

function pendingOf(period) {
  if (!period) return 0;
  if (typeof period.pending === 'number') return period.pending;
  return (Number(period.pendingCents) || 0) / 100;
}

function ymd(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function monthName(ms, which = 'long') {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: which }).format(new Date(ms));
}

function lastMonthName(ms) {
  const [y, m] = ymd(ms).split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(y, m - 2, 1));
}

function monthLen(ms) {
  const [y, m] = ymd(ms).split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function shortDate(value) {
  const raw = String(value || '');
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? Date.parse(`${raw}T12:00:00Z`) : Date.parse(raw);
  if (!Number.isFinite(ms)) return raw;
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(new Date(ms));
}

function vsLast(month, last, nowMs) {
  const monthN = Number(month) || 0;
  const lastN = Number(last) || 0;
  const raw = lastN > 0 ? Math.round((monthN / lastN) * 100) : monthN > 0 ? 100 : 0;
  const day = Number(ymd(nowMs).slice(8));
  const over = raw > 100;
  return {
    barLabel: `${monthName(nowMs)} against all of ${lastMonthName(nowMs)}`,
    barValue: over ? `${raw}% · already over` : `${raw}% · day ${day} of ${monthLen(nowMs)}`,
    pct: Math.min(100, raw),
    pg: over ? 'crit' : raw >= 80 ? 'risk' : 'ok',
  };
}

function expenseCurrency(data) {
  const raw = String(data?.currency || data?.expenses?.currency || '').toUpperCase();
  // ponytail: payload omits currency; MoneyClaw totals are cadMinor. Prefer an ISO field if one appears.
  return /^[A-Z]{3}$/.test(raw) ? raw : 'CAD';
}

function windowBit(group) {
  const week = group?.week;
  const month = group?.month;
  const bits = [];
  if (week?.startDate && week?.endDate) bits.push(`week ${shortDate(week.startDate)}-${shortDate(week.endDate)}`);
  else bits.push('week window unavailable');
  if (month?.startDate && month?.endDate) bits.push(`month ${shortDate(month.startDate)}-${shortDate(month.endDate)}`);
  return bits.join(' · ');
}

function stages(group) {
  const week = group?.week;
  const weekLabel = week?.startDate && week?.endDate
    ? `This week · ${shortDate(week.startDate)}-${shortDate(week.endDate)}`
    : 'This week';
  const monthLabel = monthVerified(group?.month) ? 'This month' : 'This month · unverified';
  return [
    { label: 'Yesterday', value: usd(dollars(group?.yesterday)) },
    { label: weekLabel, value: usd(dollars(group?.week)) },
    { label: monthLabel, value: usd(dollars(group?.month)) },
    { label: 'Last month', value: usd(dollars(group?.lastMonth)) },
  ];
}

export function monthVerified(month) {
  const charges = month?.charges;
  if (!Array.isArray(charges) || !month.startDate || !month.endDate) return false;
  const count = Number(month.postedCount || 0) + Number(month.pendingCount || 0);
  if (!count || charges.length < count) return false;
  const settled = charges.filter((c) => !c.pending && c.date >= month.startDate && c.date <= month.endDate);
  const sum = settled.reduce((s, c) => s + Number(c.amount || 0), 0);
  const posted = Number(month.posted);
  return Number.isFinite(posted) && Math.round(sum * 100) === Math.round(posted * 100);
}

function block(title, group, nowMs) {
  const month = dollars(group?.month);
  const pending = pendingOf(group?.month);
  return {
    title,
    meta: '',
    stages: stages(group),
    ...vsLast(month, dollars(group?.lastMonth), nowMs),
    note: pending > 0 ? `${usd(pending)} of this month is still pending.` : 'Nothing pending this month.',
  };
}

export function sparkPath(series) {
  const pts = (series || []).map((p) => Number(p.value) || 0);
  if (!pts.length) return 'M0,46 L300,14';
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  return pts.map((v, i) => {
    const x = pts.length === 1 ? 0 : (i / (pts.length - 1)) * 300;
    const y = 50 - ((v - min) / span) * 36;
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function adsToMove(data) {
  const rows = [...(data.expenses?.latestBusinessCharges || []), ...(data.expenses?.uncategorized || [])];
  const seen = new Set();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    const desc = String(r.description || '');
    const cat = String(r.category || '');
    if (!/x corp advertising/i.test(desc)) return false;
    if (/advertising/i.test(cat) && !/misc/i.test(cat)) return false;
    seen.add(r.id);
    return true;
  });
}

function fixCard(data) {
  const ads = adsToMove(data);
  const n = ads.length;
  if (!n) {
    return {
      pill: 'Filed',
      heading: 'No X ad charges sitting in Misc',
      body: 'New charges will show here if they land in Misc or Uncategorized.',
      box: '',
      btn: '',
    };
  }
  const ids = ads.map((a) => a.id);
  return {
    pill: n > 4 ? 'Over half is "Misc"' : `${n} ad charges in Misc`,
    heading: 'Your X ad charges are filed as Misc',
    body: `At least ${n} X Corp Advertising charges this month sit under Misc, so your ad spend looks far smaller than it is.`,
    box: 'Move them to Business advertising and file future ones there automatically.',
    btn: `Move all ${n} and remember`,
    kind: 'money.move_and_remember',
    payload: { ids, category: 'Business Advertising', vendor: 'X CORP ADVERTISING' },
    msg: `${n} charges moved to Business advertising · rule saved`,
  };
}

function categoryRows(list) {
  const rows = [...(list || [])].sort((a, b) => (b.total || 0) - (a.total || 0));
  const max = rows[0]?.total || 1;
  const sum = rows.reduce((s, r) => s + (r.total || 0), 0) || 1;
  return rows.map((r) => {
    const share = (r.total || 0) / sum;
    const pct = ((r.total || 0) / max) * 100;
    const count = r.count ? ` · ${r.count} charge${r.count === 1 ? '' : 's'}` : '';
    const misc = /misc|uncategorized/i.test(r.name) && share >= 0.4;
    return {
      label: `${r.name}${count}`,
      value: share >= 0.1 ? `${usd(r.total, 2)} · ${Math.round(share * 100)}%` : usd(r.total, 2),
      pct,
      pg: misc ? 'crit' : '',
      min: pct < 1 ? '3px' : undefined,
      tall: true,
    };
  });
}

function chargeRows(list) {
  return (list || []).slice(0, 20).map((r) => {
    const adsMisc = /x corp advertising/i.test(r.description || '') && /misc/i.test(r.category || '');
    return {
      date: shortDate(r.date),
      charge: r.description || '',
      card: r.accountLabel || '',
      filed: adsMisc ? `${r.category} · should be ads` : (r.category || ''),
      filedCls: adsMisc ? 'crit' : '',
      amount: usd(r.amount, 2),
    };
  });
}

export function overlayMoney(page, data, nowMs) {
  if (!page || !data?.expenses) return page;
  const monthTotal = data.expenses.businessCategories?.reduce((s, r) => s + (r.total || 0), 0) || dollars(data.expenses.business?.month);
  const asOf = data.asOf ? `as of ${shortDate(data.asOf)}` : 'as-of date unavailable';
  const ledger = monthVerified(data.expenses.business?.month) ? '' : ' · month total unverified';
  page.sub = `From MoneyClaw Expenses · ${expenseCurrency(data)} · America/Vancouver · ${windowBit(data.expenses.business)} · ${asOf}${ledger}`;
  page.actions = [
    { label: 'Open MoneyClaw', href: 'https://moneyclaw.jonmac.ai', msg: 'Opens moneyclaw.jonmac.ai' },
    page.actions?.[1] || { label: 'Scan banks now', msg: 'Bank scan started' },
  ];
  page.personal = block('Personal', data.expenses.personal, nowMs);
  page.business = block('Business', data.expenses.business, nowMs);
  page.categories = {
    title: 'Business · this month by category',
    meta: `${usd(monthTotal, 2)} total${monthVerified(data.expenses.business?.month) ? '' : ' · unverified'}`,
    note: 'Bars are sized against the biggest category. Click a category to see its charges, the same as in MoneyClaw.',
    rows: categoryRows(data.expenses.businessCategories),
  };
  page.fix = fixCard(data);
  page.netWorth = {
    title: 'Net worth',
    meta: '90 days',
    hidden: HIDDEN,
    shown: usd(data.netWorth?.value),
    spark: sparkPath(data.netWorth?.series),
  };
  page.charges = { title: 'Latest business charges', rows: chargeRows(data.expenses.latestBusinessCharges) };
  return page;
}

// Bank scan card from the `bank_scan` snapshot (one row per account, scanned today or not).
export function overlayBankScan(page, row, nowMs) {
  if (!row) {
    const bs = page.bankScan;
    if (bs?.rows?.length) page.bankScan = { ...bs, meta: 'No scan yet', pct: 0, pg: '', rows: [] };
    return;
  }
  let accounts = [];
  try { accounts = JSON.parse(row.data).accounts || []; } catch { accounts = []; }
  const today = ymd(nowMs);
  const rows = accounts.map((a) => {
    const scanned = a.status === 'scanned' && ymd(Date.parse(a.scannedAt || row.collected_at) || nowMs) === today;
    const need = a.status === 'needs_code';
    return {
      title: a.name,
      sub: need ? 'Sent you a code' : (scanned ? 'Scanned' : a.status || ''),
      pill: need ? 'Needs code' : scanned ? 'Scanned' : 'Waiting',
      pillCls: need ? 'risk' : scanned ? 'ok' : '',
      btn: need ? 'Enter code' : '',
      msg: need ? 'Code box opened' : '',
    };
  });
  const done = rows.filter((r) => r.pill === 'Scanned').length;
  page.bankScan = {
    title: 'Bank scan',
    meta: `${done} of ${accounts.length} accounts done`,
    pct: accounts.length ? Math.round(done / accounts.length * 100) : 0,
    pg: done === accounts.length ? 'ok' : 'risk',
    rows,
  };
}

export async function runMoneyMove(env, payload, fetchFn = globalThis.fetch) {
  const token = env.MONEYCLAW_DASHBOARD_TOKEN;
  if (!token) throw new Error('MoneyClaw is not connected');
  const ids = Array.isArray(payload.ids) ? payload.ids : [payload.ids].filter(Boolean);
  const category = String(payload.category || 'Business Advertising');
  const vendor = String(payload.vendor || 'X CORP ADVERTISING');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const cat = await fetchFn(ACTION, { method: 'POST', headers, body: JSON.stringify({ action: 'categorize', ids, category }) });
  if (!cat.ok) throw new Error('Could not move those charges');
  const rule = await fetchFn(ACTION, { method: 'POST', headers, body: JSON.stringify({ action: 'add_rule', vendor, category }) });
  if (!rule.ok) throw new Error('Charges moved, but the remember rule failed');
  return `${ids.length} charges moved to Business advertising · rule saved`;
}
