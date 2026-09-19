import test from 'node:test';
import assert from 'node:assert/strict';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import { mergeSnapshot } from '../src/snapshot.js';
import { handleCron } from '../src/cron.js';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { memD1 } from './memd1.mjs';
import { overlayMoney, overlayMarkets } from '../src/money.js';
import { overlayViral } from '../src/viral.js';

const NOW = Date.parse('2026-09-18T20:00:00-07:00');
const SECRET = 'test-session-secret-32-bytes-ok!';
const LAST_PAY = Date.parse('2026-09-15T18:00:00-07:00');

function period(total, pending = 0) {
  return { total, pending, posted: total - pending, totalCents: Math.round(total * 100), pendingCents: Math.round(pending * 100) };
}

const moneySummary = {
  asOf: '2026-09-18',
  expenses: {
    personal: {
      yesterday: period(0),
      week: period(12),
      month: period(42, 5),
      lastMonth: period(80),
    },
    business: {
      yesterday: period(0),
      week: period(20),
      month: period(60, 8),
      lastMonth: period(40),
    },
    businessCategories: [
      { name: 'Misc', count: 9, total: 30, totalCents: 3000 },
      { name: 'Software', count: 2, total: 20, totalCents: 2000 },
      { name: 'Business Advertising', count: 1, total: 10, totalCents: 1000 },
    ],
    latestBusinessCharges: [
      { id: 'x1', date: '2026-09-12', description: 'X CORP ADVERTISING', accountLabel: 'Visa', category: 'Misc', amount: 31.41 },
      { id: 'x2', date: '2026-09-12', description: 'X CORP ADVERTISING', accountLabel: 'Visa', category: 'Misc', amount: 37.78 },
      { id: 'ok', date: '2026-09-16', description: 'Payment fee', accountLabel: 'Current account', category: 'Misc', amount: 23.29 },
    ],
    uncategorized: [],
  },
  netWorth: { value: 128000, series: [{ month: '2026-06', value: 100000 }, { month: '2026-08', value: 128000 }] },
  markets: {
    pulse: {
      mood: 'Calm',
      vix: { price: 14.9, changePct: -3.5, status: 'low' },
      voo: { price: 701.89, changePct: 0.1 },
      newsLevel: 'Pending',
    },
    core: [
      { symbol: 'VOO', label: 'VOO', price: 701.89, allTimeHigh: 716.39, todayPct: 0.1, pctOffHigh: 2, pctToRecover: 2.1 },
      { symbol: 'QQQ', label: 'QQQ', price: 721.35, allTimeHigh: 748.65, todayPct: 0.6, pctOffHigh: 3.6, pctToRecover: 3.8 },
      { symbol: 'DIA', label: 'DIA', price: 515.93, allTimeHigh: 546.75, todayPct: -0.5, pctOffHigh: 5.6, pctToRecover: 6 },
      { symbol: 'GC=F', label: 'XAU', price: 4421, allTimeHigh: 5586.2, todayPct: 0.5, pctOffHigh: 20.9, pctToRecover: 26.4 },
      { symbol: 'IBIT', label: 'IBIT', price: 46.02, allTimeHigh: 71.82, todayPct: 6.3, pctOffHigh: 35.9, pctToRecover: 56.1 },
      { symbol: 'SI=F', label: 'XAG', price: 66.97, allTimeHigh: 121.3, todayPct: 2.3, pctOffHigh: 44.8, pctToRecover: 81.1 },
    ],
    alerts: [],
  },
};

const viralSummary = {
  success: true,
  generatedAt: NOW,
  lastEventAt: LAST_PAY,
  lastSyncAt: '2026-09-18T12:00:00.000Z',
  subscriptions: {
    current: { mrrCents: 99300, activeCustomers: 5, arpuCents: 19860 },
    growth: {
      currentMonthKey: '2026-09',
      previousMonthKey: '2026-08',
      newMrrCents: 0,
      reactivationMrrCents: 0,
      expansionMrrCents: 74800,
      existingMrrCents: 24500,
      contractionMrrCents: 0,
      churnMrrCents: 0,
      netNewMrrCents: 74800,
    },
    customers: { active: 5, churnedThisMonth: 0, payingThisMonth: 5, payingPreviousMonth: 5 },
    cashFlow: {
      monthlySubsCents: 3900, yearlySubsCents: 0, oneTimeCents: 0, refundsCents: 0, netCashCents: 3900,
    },
    retention: { grossRetentionRate: 1, netRetentionRate: 4.05, retainedMrrCents: 24500 },
    trials: { activeTrials: 0 },
    plans: [
      { title: 'Commas y2Zqw', customers: 1, mrrCents: 58800, share: 0.592 },
      { title: 'Viral View Founders', customers: 2, mrrCents: 7800, share: 0.079 },
    ],
    months: [
      { key: '2026-04', label: 'April', mrrCents: 0, paidCustomers: 0, netNewMrrCents: 0, newMrrCents: 0, expansionMrrCents: 0, churnMrrCents: 0 },
      { key: '2026-05', label: 'May', mrrCents: 3900, paidCustomers: 1, netNewMrrCents: 3900, newMrrCents: 3900, expansionMrrCents: 0, churnMrrCents: 0 },
      { key: '2026-08', label: 'August', mrrCents: 24500, paidCustomers: 5, netNewMrrCents: 12800, newMrrCents: 16700, expansionMrrCents: 0, churnMrrCents: 3900 },
      { key: '2026-09', label: 'September', mrrCents: 99300, paidCustomers: 5, netNewMrrCents: 74800, newMrrCents: 0, expansionMrrCents: 74800, churnMrrCents: 0 },
    ],
    cohortMatrix: {
      months: [1, 2, 3, 4, 5],
      rows: [{
        cohortLabel: 'May', originalMrrCents: 3900,
        periods: [
          { retainedPercent: 1 }, { retainedPercent: 1 }, { retainedPercent: 0 },
          { retainedPercent: 0 }, { retainedPercent: 0 },
        ],
      }],
      weightedAverage: [
        { retainedPercent: 1 }, { retainedPercent: 5.31 }, { retainedPercent: 0.5 },
        { retainedPercent: 0.33 }, { retainedPercent: 0 },
      ],
    },
  },
  cashThisWeek: { netCents: 9900, startAt: Date.parse('2026-09-14T07:00:00.000Z'), lastPaymentAt: LAST_PAY, byDay: [{ date: '2026-09-15', netCents: 9900 }] },
  traffic: [
    { source: 'YouTube', clicks: 40, carts: 2, sales: 1, revenueCents: 9900 },
    { source: 'X', clicks: 10, carts: 0, sales: 0, revenueCents: 0 },
  ],
  ads: [
    { name: 'Ad 1 · polished cut', spendCents: 8000, revenueCents: 3900, sales: 1 },
    { name: 'Ad 2 · raw phone clip', spendCents: 7000, revenueCents: 0, sales: 0 },
  ],
  posts: [{ id: 'p1', platform: 'x', clicks: 40, views: 100, postUrl: 'https://x.com/p1' }],
};

function row(source, data, collected_at = '2026-09-18T18:00:00Z') {
  return { source, collected_at, data: JSON.stringify(data) };
}

function envWith(db) {
  return {
    SESSION_SECRET: SECRET,
    DASHBOARD_PASSWORD: '909090',
    MACHINE_TOKEN_MAC: 'mac-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    MACHINE_TOKEN_GPU2: 'gpu-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    MONEYCLAW_DASHBOARD_TOKEN: 'mc-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    VIRALVIEW_SUMMARY_SECRET: 'vv-secret',
    DB: db,
  };
}

function req(path, { method = 'GET', cookie, headers = {}, body } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  return new Request(`https://jonmac.ai${path}`, { method, headers: h, body });
}

async function cookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${COOKIE}=${await signSession(SECRET, exp)}`;
}

test('merge overlays finances from MoneyClaw and hides net worth', () => {
  const out = mergeSnapshot(snapshot, [row('moneyclaw', moneySummary)], NOW);
  const money = out.pages.money;
  assert.equal(money.personal.stages[2].value, '$42');
  assert.equal(money.business.stages[2].value, '$60');
  assert.equal(money.categories.rows[0].label.includes('Misc'), true);
  assert.equal(money.fix.kind, 'money.move_and_remember');
  assert.deepEqual(money.fix.payload.ids, ['x1', 'x2']);
  assert.equal(money.fix.payload.category, 'Business Advertising');
  assert.equal(money.netWorth.hidden.includes('•'), true);
  assert.match(money.netWorth.shown, /128,000/);
  assert.equal(money.netWorth.hidden.includes('128'), false);
  assert.equal(money.bankScan.title, snapshot.pages.money.bankScan.title);
});

test('merge overlays markets from the same MoneyClaw summary', () => {
  const out = mergeSnapshot(snapshot, [row('moneyclaw', moneySummary)], NOW);
  const m = out.pages.markets;
  assert.equal(m.tiles[0].value, 'Calm');
  assert.equal(m.tiles[1].value, '14.9');
  assert.equal(m.tiles[2].value, '$701.89');
  assert.equal(m.discount.rows[0].fund, 'VOO');
  assert.equal(m.discount.rows[0].price, '$701.89');
  assert.equal(m.discount.rows[3].fund, 'XAU');
});

test('merge overlays Viral View and matching home tiles', () => {
  const out = mergeSnapshot(snapshot, [row('viralview', viralSummary)], NOW);
  const v = out.pages.viral;
  assert.equal(v.tiles[0].value, '$99');
  assert.equal(v.tiles[1].value, '$993');
  assert.equal(v.tiles[2].value, '5');
  assert.equal(out.pages.home.tiles[1].value, v.tiles[0].value);
  assert.equal(out.pages.home.tiles[1].sub, v.tiles[0].sub);
  const sales = out.pages.home.glance.rows.find((r) => r.area === 'Viral View sales');
  const subs = out.pages.home.glance.rows.find((r) => r.area === 'Subscriptions');
  const ads = out.pages.home.glance.rows.find((r) => r.area === 'Meta Ads');
  assert.equal(sales.pct, v.tiles[0].pct);
  assert.match(subs.today, /\$993/);
  assert.match(ads.today, /\$150 spent/);
  assert.equal(v.traffic.rows[0].source, 'YouTube');
  assert.equal(v.traffic.meta.includes('example'), false);
  assert.equal(v.actions[1].href, 'https://app.viralview.io/track');
  assert.equal(v.ads.rows.length, 2);
  assert.equal(v.ads.rows[0].ad, 'Ad 1 · polished cut');
});


test('Viral traffic and ads keep every live row', () => {
  const data = {
    ...viralSummary,
    traffic: Array.from({ length: 10 }, (_, i) => ({
      source: `S${i}`, clicks: i + 1, carts: 0, sales: 0, revenueCents: i === 0 ? 3900 : 0,
    })),
    ads: Array.from({ length: 9 }, (_, i) => ({
      name: `Ad ${i}`, spendCents: 100, revenueCents: 0, sales: 0,
    })),
  };
  const v = mergeSnapshot(snapshot, [row('viralview', data)], NOW).pages.viral;
  assert.equal(v.traffic.rows.length, 10);
  assert.equal(v.ads.rows.length, 9);
  assert.equal(v.traffic.rows[9].source, 'S9');
  assert.equal(v.ads.rows[8].ad, 'Ad 8');
});

test('empty Viral traffic and ads are a blank list not fixture examples', () => {
  const out = mergeSnapshot(snapshot, [row('viralview', { ...viralSummary, traffic: [], ads: [] })], NOW);
  const v = out.pages.viral;
  assert.equal(v.traffic.rows.length, 0);
  assert.equal(v.ads.rows.length, 0);
  assert.match(v.traffic.empty, /No traffic/i);
  assert.match(v.ads.empty, /No Meta ads/i);
  assert.equal(JSON.stringify(v.traffic).includes('Instagram'), false);
  assert.equal(JSON.stringify(v.ads).includes('polished cut'), false);
});


test('cron pulls Viral View and MoneyClaw summaries into snapshots', async () => {
  const db = memD1();
  const prev = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    seen.push({ url: String(url), hasAuth: Boolean(opts?.headers?.authorization || opts?.headers?.Authorization), cron: Boolean(opts?.headers?.['x-cron-secret']) });
    if (String(url).includes('viralview')) {
      return new Response(JSON.stringify(viralSummary), { status: 200 });
    }
    return new Response(JSON.stringify(moneySummary), { status: 200 });
  };
  try {
    await handleCron(envWith(db));
  } finally {
    globalThis.fetch = prev;
  }
  const summaries = seen.filter((s) => s.url.includes('/api/internal/dashboard-summary'));
  assert.equal(summaries.length, 2);
  assert.ok(db.snapshots.get('viralview')?.data.includes('cashThisWeek'));
  assert.ok(db.snapshots.get('moneyclaw')?.data.includes('expenses'));
});

test('Move all and remember posts categorize then add_rule to MoneyClaw', async () => {
  const db = memD1();
  const env = envWith(db);
  const prev = globalThis.fetch;
  const posts = [];
  globalThis.fetch = async (url, opts) => {
    posts.push({ url: String(url), body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    const res = await handleApi(req('/dashboard/api/actions', {
      method: 'POST',
      cookie: await cookie(),
      headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
      body: JSON.stringify({
        kind: 'money.move_and_remember',
        payload: { ids: ['x1', 'x2'], category: 'Business Advertising', vendor: 'X CORP ADVERTISING' },
        idemKey: 'move-1',
      }),
    }), env);
    assert.equal(res.status, 200);
    const row = await res.json();
    assert.equal(row.status, 'done');
    assert.match(row.result, /2 charges moved/);
  } finally {
    globalThis.fetch = prev;
  }
  assert.equal(posts.length, 2);
  assert.ok(posts.every((p) => p.url.includes('/api/internal/dashboard-action')));
  assert.equal(posts[0].body.action, 'categorize');
  assert.deepEqual(posts[0].body.ids, ['x1', 'x2']);
  assert.equal(posts[1].body.action, 'add_rule');
  assert.equal(posts[1].body.vendor, 'X CORP ADVERTISING');
});

test('finance sub shows source period dates and does not claim bank reconciliation', () => {
  const page = overlayMoney(structuredClone(snapshot.pages.money), {
    asOf: '2026-09-19',
    expenses: {
      personal: {
        yesterday: { ...period(0), startDate: '2026-09-18', endDate: '2026-09-18' },
        week: { ...period(12), startDate: '2026-09-13', endDate: '2026-09-19' },
        month: { ...period(42), startDate: '2026-09-01', endDate: '2026-09-19' },
        lastMonth: { ...period(80), startDate: '2026-08-01', endDate: '2026-08-31' },
      },
      business: {
        yesterday: period(0),
        week: { ...period(20), startDate: '2026-09-13', endDate: '2026-09-19' },
        month: { ...period(60), startDate: '2026-09-01', endDate: '2026-09-19' },
        lastMonth: period(40),
      },
      businessCategories: [],
    },
    netWorth: { value: 1, series: [] },
  }, NOW, 'updated just now');
  assert.match(page.sub, /Sep 13/);
  assert.match(page.sub, /Sep 19/);
  assert.match(page.sub, /Sep 1/);
  assert.doesNotMatch(page.sub, /bank reconcil/i);
  assert.doesNotMatch(page.sub, /live bank/i);
  assert.match(page.personal.stages[1].label, /Sep 13/);
});

test('markets use source quote stamp when present', () => {
  const page = overlayMarkets(structuredClone(snapshot.pages.markets), {
    markets: {
      pulse: {
        mood: 'Calm',
        quoteAt: '2026-09-18T20:00:00.000Z',
        vix: { price: 14.9, changePct: -3.5 },
        voo: { price: 701.89, changePct: 0.1 },
        newsLevel: 'Pending',
      },
      core: [],
    },
  }, NOW, 'updated just now');
  assert.match(page.sub, /quoted /);
  assert.doesNotMatch(page.sub, /quote time unavailable/);
  assert.doesNotMatch(page.sub, /updated just now/);
  assert.equal(page.tiles[3].value, 'Pending');
});

test('Viral View sub distinguishes Commas last sync from summary fetch', () => {
  const page = overlayViral(structuredClone(snapshot.pages.viral), viralSummary, NOW, 'updated just now');
  assert.match(page.sub, /Commas last sync/i);
  assert.match(page.sub, /summary /i);
  assert.doesNotMatch(page.sub, /live bank/i);
});
