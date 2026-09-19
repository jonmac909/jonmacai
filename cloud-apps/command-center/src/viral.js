import { parseStamp } from './time.js';

const TZ = 'America/Vancouver';
const WEEK_GOAL_CENTS = 100000;

function usd(cents, digits) {
  const x = (Number(cents) || 0) / 100;
  const d = digits == null ? (Math.abs(x - Math.round(x)) < 1e-9 ? 0 : 2) : digits;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d,
  }).format(x);
}

function signedUsd(cents) {
  const n = Number(cents) || 0;
  if (n === 0) return '$0';
  return `${n < 0 ? '−' : '+'}${usd(Math.abs(n))}`;
}

function shortDate(v) {
  const ms = parseStamp(v);
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(new Date(ms));
}

function monthKey(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date(ms));
}

function monthShort(key) {
  const [y, m] = String(key).split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(y, m - 1, 1));
}

function lastSix(months, nowMs) {
  const by = new Map((months || []).map((m) => [m.key, m]));
  const [y, m] = monthKey(nowMs).split('-').map(Number);
  const out = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push(by.get(key) || { key, label: monthShort(key), mrrCents: 0, paidCustomers: 0, netNewMrrCents: 0, newMrrCents: 0, expansionMrrCents: 0, churnMrrCents: 0 });
  }
  return out;
}

function pgOf(pct) {
  if (pct <= 0) return 'crit';
  if (pct < 50) return 'crit';
  if (pct < 80) return 'risk';
  return 'ok';
}

function ratioPct(p) {
  if (p == null || Number.isNaN(Number(p))) return null;
  return Math.round(Number(p) * 100);
}

function coh(p) {
  if (p == null) return ['none', '–'];
  const pct = ratioPct(p);
  if (pct > 100) return ['up', `${pct}%`];
  if (pct === 100) return ['ok', '100%'];
  if (pct >= 50) return ['risk', `${pct}%`];
  return ['crit', `${pct}%`];
}

function fmtN(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

export function overlayViral(page, data, nowMs, ageLabel = '') {
  if (!page || !data) return page;
  const sub = data.subscriptions || {};
  const cur = sub.current || {};
  const growth = sub.growth || {};
  const cash = data.cashThisWeek || {};
  const week = Number(cash.netCents) || 0;
  const weekPct = Math.min(100, Math.round(week / WEEK_GOAL_CENTS * 100));
  const last = cash.lastPaymentAt;
  const salesSub = week <= 0 && last
    ? `No payment recorded since ${shortDate(last)}`
    : last ? `Last payment ${shortDate(last)}` : 'No payment recorded';
  const sync = data.lastSyncAt ? shortDate(data.lastSyncAt) : '';
  const age = ageLabel ? ` · ${ageLabel}` : '';
  page.sub = `${sync ? `Subscriptions from your revenue page, synced ${sync}` : 'Subscriptions from your revenue page'} · USD · America/Vancouver${age}`;
  page.actions = [
    { label: 'Open revenue page', href: 'https://app.viralview.io/admin/mrr', msg: 'Opens app.viralview.io/admin/mrr' },
    { label: 'Open tracker', href: 'https://app.viralview.io/track', msg: 'Opens app.viralview.io/track' },
  ];

  page.tiles = [
    { icon: 'dollar', label: 'Sales this week', value: usd(week), goal: '/ $1K', pct: weekPct, pg: pgOf(weekPct), sub: salesSub },
    {
      icon: 'trend', label: 'Subscription revenue a month', value: usd(cur.mrrCents),
      subHtml: `<span class="${(growth.netNewMrrCents || 0) < 0 ? 'down' : 'up'}">${(growth.netNewMrrCents || 0) < 0 ? '▼' : '▲'} ${usd(Math.abs(growth.netNewMrrCents || 0))}</span> on last month`,
    },
    { icon: 'heart', label: 'Paying customers', value: String(cur.activeCustomers ?? sub.customers?.active ?? 0), sub: (sub.customers?.churnedThisMonth || 0) ? `${sub.customers.churnedThisMonth} cancelled this month` : 'None cancelled this month' },
    { icon: 'wallet', label: 'Revenue per customer', value: usd(cur.arpuCents, 2), sub: '' },
  ];

  const parts = [
    { amount: usd(cur.mrrCents), label: 'This month', total: true, cents: cur.mrrCents || 0 },
    { amount: usd(growth.existingMrrCents), label: 'Kept from last month', cents: growth.existingMrrCents || 0 },
    { amount: usd(growth.expansionMrrCents), label: 'Upgrades', cents: growth.expansionMrrCents || 0 },
    { amount: usd(growth.newMrrCents), label: 'New customers', cents: growth.newMrrCents || 0, zero: !(growth.newMrrCents) },
    { amount: usd(growth.reactivationMrrCents), label: 'Came back', cents: growth.reactivationMrrCents || 0, zero: !(growth.reactivationMrrCents) },
    { amount: usd(growth.contractionMrrCents), label: 'Downgrades', cents: growth.contractionMrrCents || 0, zero: !(growth.contractionMrrCents) },
    { amount: usd(growth.churnMrrCents), label: 'Cancelled', cents: growth.churnMrrCents || 0, zero: !(growth.churnMrrCents) },
  ];
  const pos = parts.slice(1, 5).filter((p) => p.cents > 0);
  const posSum = pos.reduce((s, p) => s + p.cents, 0) || 1;
  const fills = ['var(--accent)', 'var(--ok-fill)', 'var(--risk-fill)', 'var(--crit-fill)'];
  page.pieces = {
    title: `${monthName(nowMs)}'s ${usd(cur.mrrCents)}, piece by piece`,
    meta: `Yearly run rate ${usd((cur.mrrCents || 0) * 12)}`,
    parts: parts.map(({ cents, ...p }) => p),
    ops: ['=', '+', '+', '+', '−', '−'],
    barAria: pos.map((p) => `${p.label} ${p.amount}`).join(', '),
    bar: pos.map((p, i) => ({
      pct: (p.cents / posSum) * 100,
      fill: fills[i] || 'var(--accent)',
      tip: `${p.label} ${p.amount}`,
      legend: p.label,
      amount: p.amount,
    })),
  };

  const six = lastSix(sub.months, nowMs);
  const maxMrr = Math.max(...six.map((m) => m.mrrCents || 0), 1);
  page.byMonthChart = {
    title: 'Subscription revenue by month',
    meta: six[0]?.mrrCents ? '' : 'Nothing before the first paying month',
    cols: six.map((m) => ({
      tip: `${monthShort(m.key)} · ${usd(m.mrrCents)}${m.paidCustomers ? ` · ${m.paidCustomers} customer${m.paidCustomers === 1 ? '' : 's'}` : ''}`,
      label: usd(m.mrrCents),
      height: m.mrrCents ? `${Math.max(3, (m.mrrCents / maxMrr) * 94)}%` : '2px',
      x: monthShort(m.key),
    })),
  };

  const cf = sub.cashFlow || {};
  page.check = {
    pill: (cf.netCashCents || 0) < (cur.mrrCents || 0) ? "Money in doesn't match" : 'Cash this month',
    heading: `${usd(cur.mrrCents)} a month on paper, ${usd(cf.netCashCents)} collected this month`,
    body: week <= 0 && last ? `No payment has been recorded since ${shortDate(last)}, even though the subscription sync ran.` : 'Commas payments minus refunds, this month.',
    cash: [
      { label: 'Monthly plans', amount: usd(cf.monthlySubsCents) },
      { label: 'Yearly plans', amount: usd(cf.yearlySubsCents) },
      { label: 'One-time', amount: usd(cf.oneTimeCents) },
      { label: 'Refunds', amount: usd(cf.refundsCents) },
    ],
    note: week <= 0 ? 'Either the upgraded plans bill later in the month, or payments have stopped reaching the revenue page.' : `Last payment ${shortDate(last) || '—'}.`,
    btn: 'Create Planner task',
    kind: 'mastermind.send_to_planner',
    payload: { id: 'viral-cash', title: `${usd(cur.mrrCents)} a month on paper, ${usd(cf.netCashCents)} collected this month`, body: week <= 0 && last ? `No payment has been recorded since ${shortDate(last)}, even though the subscription sync ran.` : 'Commas payments minus refunds, this month.', area: 'Viral View' },
  };

  const planRows = sub.plans || [];
  page.plans = {
    title: 'Plans',
    meta: `Share of ${usd(cur.mrrCents)}`,
    note: 'Plan names as they appear in Commas.',
    rows: planRows.map((p) => ({
      plan: p.title,
      customers: p.customers,
      month: usd(p.mrrCents),
      pct: (p.share || 0) * 100,
      share: `${Math.round((p.share || 0) * 100)}%`,
    })),
  };

  const gross = ratioPct(sub.retention?.grossRetentionRate);
  const net = ratioPct(sub.retention?.netRetentionRate);
  page.keeping = {
    title: 'Keeping customers',
    meta: monthName(nowMs),
    bars: [
      { label: "Last month's revenue still paying", value: gross == null ? '—' : `${gross}%`, pct: Math.min(100, gross || 0), pg: (gross || 0) >= 100 ? 'ok' : 'risk' },
      { label: 'Counting upgrades', value: net == null ? '—' : net > 100 ? `${net}% · grew` : `${net}%`, pct: Math.min(100, net || 0) },
    ],
    rows: [
      { title: 'Cancelled this month', pill: (sub.customers?.churnedThisMonth || 0) ? String(sub.customers.churnedThisMonth) : 'None', pillCls: (sub.customers?.churnedThisMonth || 0) ? 'risk' : 'ok' },
    ],
  };

  const custMonths = six.filter((m) => m.paidCustomers || m.mrrCents);
  const custMax = Math.max(...custMonths.map((m) => m.paidCustomers || 0), 1);
  page.customersByMonth = {
    title: 'Customers by month',
    rows: custMonths.map((m) => ({ label: monthShort(m.key), value: String(m.paidCustomers || 0), pct: ((m.paidCustomers || 0) / custMax) * 100 })),
    empty: (sub.trials?.activeTrials || 0) ? `${sub.trials.activeTrials} free trials running.` : 'No free trials running.',
    emptyRest: 'When you start them, this card also shows how many turn into paying customers.',
  };

  const matrix = sub.cohortMatrix || { months: [], rows: [], weightedAverage: [] };
  const headers = ['Joined', 'First month', ...(matrix.months || []).slice(0, 5).map((n) => `Month ${n}`)];
  page.cohort = {
    title: 'Do customers keep paying?',
    note: "Each row is the customers who joined that month. Boxes show how much of their first month's revenue is still coming in.",
    headers,
    rows: (matrix.rows || []).map((r) => ({
      joined: r.cohortLabel,
      first: usd(r.originalMrrCents),
      cells: (r.periods || []).slice(0, 5).map((p) => coh(p.retainedPercent)),
    })),
    foot: (matrix.weightedAverage || []).slice(0, 5).map((p) => coh(p.retainedPercent)),
  };

  const monthRows = [...(sub.months || [])].filter((m) => m.mrrCents || m.paidCustomers).reverse();
  page.monthTable = {
    title: 'Month by month',
    meta: monthRows.length ? '' : 'No subscriptions yet',
    rows: monthRows.map((m) => ({
      month: m.label || monthShort(m.key),
      rev: usd(m.mrrCents),
      change: signedUsd(m.netNewMrrCents),
      changeCls: (m.netNewMrrCents || 0) > 0 ? 'up' : (m.netNewMrrCents || 0) < 0 ? 'down' : '',
      neu: signedUsd(m.newMrrCents),
      neuCls: (m.newMrrCents || 0) > 0 ? 'up' : '',
      upg: signedUsd(m.expansionMrrCents),
      upgCls: (m.expansionMrrCents || 0) > 0 ? 'up' : '',
      can: signedUsd(-(m.churnMrrCents || 0) || 0),
      canCls: (m.churnMrrCents || 0) > 0 ? 'down' : '',
      cust: m.paidCustomers || 0,
    })),
  };

  const traffic = data.traffic || [];
  const tClicks = traffic.reduce((s, r) => s + (r.clicks || 0), 0);
  const tCarts = traffic.reduce((s, r) => s + (r.carts || 0), 0);
  const tSales = traffic.reduce((s, r) => s + (r.sales || 0), 0);
  const tRev = traffic.reduce((s, r) => s + (r.revenueCents || 0), 0) || 1;
  page.traffic = {
    title: 'Traffic',
    meta: 'Last 30 days',
    tableTitle: 'By traffic source',
    tableMeta: "Bar shows each source's share of revenue",
    empty: traffic.length ? '' : 'No traffic in the last 30 days.',
    rows: traffic.map((r) => ({
      source: r.source,
      clicks: fmtN(r.clicks),
      carts: fmtN(r.carts),
      sales: fmtN(r.sales),
      rev: usd(r.revenueCents),
      pct: ((r.revenueCents || 0) / tRev) * 100,
      share: `${Math.round(((r.revenueCents || 0) / tRev) * 100)}%`,
    })),
    foot: { clicks: fmtN(tClicks), carts: fmtN(tCarts), sales: fmtN(tSales), rev: usd(traffic.reduce((s, r) => s + (r.revenueCents || 0), 0)) },
  };


  page.dropoff = {
    title: 'Where people drop off',
    meta: 'Last 30 days',
    bars: [
      { label: 'Clicked a link', value: fmtN(tClicks), pct: 100 },
      { label: 'Added to cart', value: `${fmtN(tCarts)} · ${tClicks ? ((tCarts / tClicks) * 100).toFixed(1) : 0}% of clicks`, pct: tClicks ? (tCarts / tClicks) * 100 : 0, min: '6px' },
      { label: 'Bought', value: `${fmtN(tSales)} · ${tCarts ? Math.round((tSales / tCarts) * 100) : 0}% of carts`, pct: tClicks ? (tSales / tClicks) * 100 : 0, min: '4px' },
    ],
    leakTitle: 'Biggest leak',
    leak: tCarts > tSales ? `${tCarts - tSales} people added to cart and left. A cart reminder email is the cheapest fix.` : 'Carts are converting.',
  };

  const ads = data.ads || [];
  const spend = ads.reduce((s, r) => s + (r.spendCents || 0), 0);
  const back = ads.reduce((s, r) => s + (r.revenueCents || 0), 0);
  page.ads = {
    title: 'Meta Ads',
    meta: `${usd(spend)} spent · ${usd(back)} back`,
    note: 'Bars run from $0 to $2 back per $1 spent. Halfway is break even.',
    empty: ads.length ? '' : 'No Meta ads in the last 30 days.',
    rows: ads.map((r, i) => {
      const per = r.spendCents ? (r.revenueCents || 0) / r.spendCents : 0;
      return {
        ad: r.name || `Ad ${i + 1}`,
        pill: (r.revenueCents || 0) <= 0 ? 'No sales' : (r.revenueCents < r.spendCents ? 'Losing' : 'Paying back'),
        spent: usd(r.spendCents),
        back: usd(r.revenueCents),
        pct: Math.min(100, (per / 2) * 100),
        per: `$${per.toFixed(2)}`,
        msg: `${r.name || `Ad ${i + 1}`} paused`,
      };
    }),
  };

  return page;
}

function monthName(ms) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long' }).format(new Date(ms));
}

export function applyHomeViral(snap, page) {
  if (!snap.pages?.home || !page?.tiles?.[0]) return;
  const sales = page.tiles[0];
  if (snap.pages.home.tiles?.[1]) {
    snap.pages.home.tiles[1] = { ...snap.pages.home.tiles[1], value: sales.value, pct: sales.pct, pg: sales.pg, sub: sales.sub };
  }
  const rows = snap.pages.home.glance?.rows || [];
  const salesRow = rows.find((r) => r.area === 'Viral View sales');
  if (salesRow) {
    salesRow.today = sales.sub;
    salesRow.pct = sales.pct;
    salesRow.pg = sales.pg;
    salesRow.pill = `${sales.pct}%`;
    salesRow.pillCls = sales.pg === 'ok' ? 'ok' : sales.pg === 'risk' ? 'risk' : 'crit';
  }
  const subs = rows.find((r) => r.area === 'Subscriptions');
  if (subs && page.tiles[1] && page.tiles[2]) {
    subs.today = `${page.tiles[1].value} a month · ${page.tiles[2].value} customers`;
    const up = String(page.tiles[1].subHtml || '').match(/\$[\d,]+/);
    if (up) {
      subs.pill = `+${up[0]}`;
      subs.pillCls = 'ok';
    }
  }
  const ads = rows.find((r) => r.area === 'Meta Ads');
  if (ads && page.ads?.meta) {
    ads.today = page.ads.meta.replace(' · ', ' · ');
    const spent = page.ads.rows?.reduce((s, r) => s + (Number(String(r.spent).replace(/[^0-9.]/g, '')) || 0), 0);
    const back = page.ads.rows?.reduce((s, r) => s + (Number(String(r.back).replace(/[^0-9.]/g, '')) || 0), 0);
    const pct = spent ? Math.min(100, Math.round((back / spent) * 100)) : 0;
    ads.pct = pct;
    ads.pg = pct >= 100 ? 'ok' : 'crit';
    ads.pill = `${back >= spent ? '+' : '−'}$${Math.abs(Math.round(back - spent))}`;
    ads.pillCls = back >= spent ? 'ok' : 'crit';
  }
}
