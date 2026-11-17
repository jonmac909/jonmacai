// Money page "Income this month": one calendar month (Kelowna time) of incoming payments, newest first, a total per currency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { upsertSnapshot } from '../src/db.js';
import { buildCash, vanDate } from '../src/cash.js';
import { buildIncome, cleanPayer } from '../src/income.js';
import { incomeListHtml } from '../public/d3/js/money.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-17T20:00:00Z');
const money = (income, collected = '2026-11-17T16:00:00Z') => ({ data: JSON.stringify({ income }), collected_at: collected });
const ledger = (rows, edited = '2026-11-16T12:00:00Z') => ({ data: JSON.stringify({ ok: true, ledgerEditedAt: edited, rows }) });
const dep = (date, amount, description, extra = {}) => ({ date, amount, description, ...extra });

const FEED = money({
  since: '2026-10-01', asOf: '2026-11-17',
  deposits: [
    dep('2026-10-31', 100, 'Funds transfer credit TT EDGE OCT'),
    dep('2026-11-01', 50, 'Funds transfer credit TT EDGE NOV'),
    dep('2026-11-02', 734.37, 'Funds transfer credit TT 1/TOPVIEW PT 123456789'),
    dep('2026-11-05', 4200, 'Funds transfer credit TT INVIDEO IN'),
    dep('2026-11-09', 970, 'Funds transfer credit TT DIVISIBLE'),
    dep('2026-11-10', 500, 'Online banking transfer ECOMM HOUSE', { isTransfer: true }),
    dep('2026-11-11', 60, 'Card payment thank you', { kind: 'card_payment' }),
    dep('2026-11-12', 40, 'REFUND ACME STORE'),
    dep('2026-11-13', 1500, 'ACME CANADA PAYROLL', { currency: 'CAD', account: 'business-cad' }),
    dep('2026-11-14', 300, 'GIFT FROM FRIEND', { currency: 'CAD', account: 'personal' }),
    dep('2026-11-15', 80, 'Funds transfer credit TT CAD EQ CLIENT', { amountCad: 110.5 }),
    dep('2026-11-16', 25, 'MYSTERY ORIGIN', { type: 'unknown' }),
  ],
});

test('month filter: this month only, newest first, own transfers and card payments excluded', () => {
  const inc = buildIncome(null, FEED, NOW);
  assert.equal(inc.month.key, '2026-11');
  assert.equal(inc.month.current, true);
  assert.deepEqual(inc.rows.map((r) => `${r.date} ${r.payer} ${r.amount} ${r.currency}`), [
    '2026-11-15 Cad Eq Client 80 USD',
    '2026-11-14 Gift From Friend 300 CAD',
    '2026-11-13 Acme Canada Payroll 1500 CAD',
    '2026-11-09 Commas/DIVISIBLE 970 USD',
    '2026-11-05 InVideo 4200 USD',
    '2026-11-02 TopView 734.37 USD',
    '2026-11-01 Edge Nov 50 USD',
  ]);
  assert.ok(!inc.rows.some((r) => /ecomm|card payment|edge oct/i.test(`${r.payer}`)));
  assert.equal(inc.excluded, 2); // the own transfer and the card payment: counted nowhere
});

test('unsure credits go to Other credits: listed, never counted', () => {
  const inc = buildIncome(null, FEED, NOW);
  assert.deepEqual(inc.other.map((r) => [r.date, r.payer, r.amount]), [['2026-11-16', 'Mystery Origin', 25], ['2026-11-12', 'Refund Acme Store', 40]]);
  const usd = inc.totals.find((t) => t.currency === 'USD');
  assert.equal(usd.amount, 80 + 970 + 4200 + 734.37 + 50);
  assert.ok(inc.notes.some((n) => /2 credits could not be sorted/.test(n)));
});

test('totals per currency; a CAD equivalent only when the data carries one for every payment', () => {
  const inc = buildIncome(null, FEED, NOW);
  assert.deepEqual(inc.totals.map((t) => [t.currency, t.amount, t.count]), [['USD', 6034.37, 5], ['CAD', 1800, 2]]);
  assert.equal(inc.totals[0].cadEquivalent, null); // four of five USD payments have no CAD figure: none invented
  const rowCad = inc.rows.find((r) => r.payer === 'Cad Eq Client');
  assert.equal(rowCad.cad, 110.5);
  const all = buildIncome(null, money({ since: '2026-11-01', asOf: '2026-11-17', deposits: [dep('2026-11-02', 100, 'A', { amountCad: 140 }), dep('2026-11-03', 50, 'B', { amountCad: 70.25 })] }), NOW);
  assert.equal(all.totals[0].cadEquivalent, 210.25);
  const cadRow = all.totals.find((t) => t.currency === 'CAD');
  assert.equal(cadRow, undefined);
});

test('accounts: business USD, business CAD, personal; the legacy feed is business USD', () => {
  const inc = buildIncome(null, FEED, NOW);
  const by = Object.fromEntries(inc.rows.map((r) => [r.payer, r.accountLabel]));
  assert.equal(by.InVideo, 'Business USD');
  assert.equal(by['Acme Canada Payroll'], 'Business CAD');
  assert.equal(by['Gift From Friend'], 'Personal');
});

test('the USD total is the Home "Cash in" figure for the month', () => {
  const cash = ledger([{ date: '2026-11-03', sponsor: 'Arcads', usd: 1500, status: 'Observed', nonRbc: true }]);
  const c = buildCash(cash, null, NOW, FEED);
  const inc = buildIncome(cash, FEED, NOW);
  assert.equal(inc.totals.find((t) => t.currency === 'USD').amount, c.month.usd);
  assert.equal(inc.totals.find((t) => t.currency === 'USD').count, c.month.payments);
  const arcads = inc.rows.find((r) => r.payer === 'Arcads');
  assert.equal(arcads.accountLabel, 'Other bank (not RBC)');
  assert.equal(c.recent.every((r) => !r.currency || r.currency === 'USD'), true); // a CAD deposit never reaches the USD totals
});

// The first instant of a Kelowna calendar day, found with the same Intl rules the Worker uses (no hard-coded offset:
// the zone's rules for Nov 2026 onward are whatever the runtime's tz data says).
function midnightOf(ymd) {
  const base = Date.parse(`${ymd}T00:00:00Z`);
  for (let h = 0; h <= 14; h += 1) if (vanDate(base + h * 3600000) === ymd) return base + h * 3600000;
  throw new Error(`no midnight for ${ymd}`);
}

test('boundary: Kelowna midnight on Dec 1 (Nov 30 23:59:59 is November, Dec 1 00:00:00 is December)', () => {
  const feed = (asOf) => money({ since: '2026-11-01', asOf, deposits: [dep('2026-11-30', 10, 'LAST NOV'), dep('2026-12-01', 20, 'FIRST DEC')] });
  const mid = midnightOf('2026-12-01');
  assert.equal(vanDate(mid - 1000), '2026-11-30');
  const a = buildIncome(null, feed('2026-12-01'), mid - 1000);
  assert.equal(a.month.key, '2026-11');
  assert.deepEqual(a.rows.map((r) => r.payer), ['Last Nov']); // Dec 1 has not happened yet
  const b = buildIncome(null, feed('2026-12-01'), mid);
  assert.equal(b.month.key, '2026-12');
  assert.deepEqual(b.rows.map((r) => r.payer), ['First Dec']);
  assert.equal(b.next, null);
  assert.equal(b.prev, '2026-11');
  assert.deepEqual(buildIncome(null, feed('2026-12-01'), mid, '2026-11').rows.map((r) => r.payer), ['Last Nov']);
});

test('boundary: Kelowna midnight on Nov 1 (the clock change night) and on Oct 1', () => {
  const f = money({ since: '2026-09-01', asOf: '2026-11-01', deposits: [dep('2026-09-30', 5, 'LAST SEP'), dep('2026-10-01', 7, 'FIRST OCT'), dep('2026-10-31', 10, 'LAST OCT'), dep('2026-11-01', 20, 'FIRST NOV')] });
  const nov1 = midnightOf('2026-11-01');
  const oct = buildIncome(null, f, nov1 - 1000);
  assert.equal(oct.month.key, '2026-10');
  assert.deepEqual(oct.rows.map((r) => r.payer), ['Last Oct', 'First Oct']);
  const nov = buildIncome(null, f, nov1);
  assert.equal(nov.month.key, '2026-11');
  assert.deepEqual(nov.rows.map((r) => r.payer), ['First Nov']);
  const oct1 = midnightOf('2026-10-01');
  assert.equal(buildIncome(null, f, oct1 - 1000).month.key, '2026-09');
  assert.equal(buildIncome(null, f, oct1).month.key, '2026-10');
});

test('month switcher: a past month, an unknown or future month reads as this month', () => {
  const past = buildIncome(null, FEED, NOW, '2026-10');
  assert.equal(past.month.key, '2026-10');
  assert.equal(past.month.current, false);
  assert.equal(past.next, '2026-11');
  assert.equal(past.prev, '2026-09');
  assert.deepEqual(past.rows.map((r) => r.payer), ['Edge Oct']);
  for (const bad of ['2027-01', 'nope', '2026-13', '', null, undefined, '2026-11-01']) assert.equal(buildIncome(null, FEED, NOW, bad).month.key, '2026-11', String(bad));
  assert.equal(buildIncome(null, FEED, NOW, '2026-01').prev, '2025-12');
});

test('a ledger row dated later this month is not income yet; Reported rows are flagged', () => {
  const l = ledger([
    { date: '2026-11-20', sponsor: 'Pre-entered', usd: 999, status: 'Observed' },
    { date: '2026-11-04', sponsor: 'Popper', usd: 700, status: 'Reported' },
  ]);
  const inc = buildIncome(l, null, NOW);
  assert.deepEqual(inc.rows.map((r) => r.payer), ['Popper']);
  assert.match(inc.rows[0].note, /not seen in RBC/);
  assert.equal(inc.totals[0].amount, 700);
});

test('no data at all says so and shows no total', () => {
  const inc = buildIncome(null, null, NOW);
  assert.equal(inc.available, false);
  assert.deepEqual(inc.totals, []);
  assert.match(inc.notes[0], /No deposit data/);
});

test('the feed is one account today: the page says CAD and personal credits are not in it', () => {
  const legacy = money({ since: '2026-11-01', asOf: '2026-11-17', deposits: [dep('2026-11-02', 100, 'TOPVIEW')] });
  assert.ok(buildIncome(null, legacy, NOW).notes.some((n) => /Business CAD and personal credits are not in the bank feed/.test(n)));
  assert.ok(!buildIncome(null, FEED, NOW).notes.some((n) => /not in the bank feed/.test(n)));
});

test('payer names are cleaned', () => {
  const cases = {
    'Funds transfer credit TT 1/TOPVIEW PT 123456789': 'TopView',
    'Funds transfer credit TT INVIDEO IN': 'InVideo',
    'COMMAS INC': 'Commas/DIVISIBLE',
    'DIVISIBLE': 'Commas/DIVISIBLE',
    'Funds transfer credit TT SCHALUMOV': 'Schalumov',
    'Arcads': 'Arcads',
    '': 'Deposit (payer not named)',
    'Funds transfer credit 123456': 'Deposit (payer not named)',
    'Incoming wire payment': 'Incoming wire (payer not named)',
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(cleanPayer(raw), want, raw);
});

test('the section: total on top per currency, a row per payment, switcher, nothing unescaped', () => {
  const html = incomeListHtml(buildIncome(null, FEED, NOW));
  assert.match(html, /Income this month/);
  assert.match(html, /data-inctotal="USD"[\s\S]*\$6,034\.37 USD/);
  assert.match(html, /data-inctotal="CAD"[\s\S]*\$1,800\.00 CAD/);
  assert.equal((html.match(/data-incrow/g) || []).length, 7 + 2); // 7 income rows + 2 other credits
  assert.match(html, /Other credits/);
  assert.match(html, /data-incmonth="2026-10"/);
  assert.match(html, /aria-label="Next month" disabled/);
  assert.match(html, /\(\$110\.50 CAD\)/);
  const past = incomeListHtml(buildIncome(null, FEED, NOW, '2026-10'));
  assert.match(past, /Income · October 2026/);
  assert.match(past, /data-incmonth="2026-11" aria-label="Next month">/);
  const evil = incomeListHtml(buildIncome(ledger([{ date: '2026-11-03', sponsor: '<img src=x onerror=1>', usd: 5, status: 'Observed' }]), null, NOW));
  assert.ok(!evil.includes('<img'));
  assert.match(incomeListHtml(undefined), /Loading/);
  assert.match(incomeListHtml({ error: 'boom' }), /No feed: boom/);
});

// ---- the API ----
const cookie = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 10 * 365 * 86400)}`; // far-future expiry: the real clock moves past NOW+1h and a fixed 1 h cookie made these tests fail after 21:00Z on 2026-11-17
const withNow = async (fn) => { const real = Date.now; Date.now = () => NOW; try { return await fn(); } finally { Date.now = real; } };
async function seeded() {
  const db = sqliteD1();
  await upsertSnapshot(db, 'moneyclaw', JSON.stringify({ income: JSON.parse(FEED.data).income }), '2026-11-17T16:00:00Z', '2026-11-17T16:00:00Z');
  await upsertSnapshot(db, 'sponsors_cash', JSON.stringify({ ok: true, ledgerEditedAt: '2026-11-16T12:00:00Z', rows: [{ date: '2026-11-03', sponsor: 'Coursiv', usd: 650, status: 'Observed' }] }), '2026-11-17T16:00:00Z', '2026-11-17T16:00:00Z');
  return db;
}

test('GET /dashboard/api/money-income: signed out is refused, signed in reads, nothing writes', async () => {
  const db = await seeded();
  const env = { SESSION_SECRET: SECRET, DB: db };
  const call = (path = '', headers = {}, method = 'GET') => withNow(() => handleApi(new Request(`https://jonmac.ai/dashboard/api/money-income${path}`, { method, headers }), env, {}));
  assert.equal((await call()).status, 401);
  assert.equal((await call('?month=2026-10')).status, 401);
  assert.equal((await call('', { Cookie: `${COOKIE}=1.2` })).status, 401);
  assert.equal((await call('', { 'X-CC': '1', Origin: 'https://jonmac.ai' })).status, 401);
  assert.equal((await call('', { Authorization: 'Bearer ccb_nope' })).status, 401);
  const res = await call('', { Cookie: await cookie() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.income.month.key, '2026-11');
  assert.equal(body.income.rows.length, 7); // Coursiv is excluded everywhere, as on Home
  assert.ok(!JSON.stringify(body).toLowerCase().includes('coursiv'));
  assert.equal((await (await call('?month=2026-10', { Cookie: await cookie() })).json()).income.month.key, '2026-10');
  assert.equal((await (await call('?month=junk', { Cookie: await cookie() })).json()).income.month.key, '2026-11');
  const dump = () => JSON.stringify(db.sqlite.prepare('SELECT * FROM snapshots ORDER BY source').all());
  const before = dump();
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = await call('', { Cookie: await cookie(), 'Content-Type': 'application/json', 'X-CC': '1', Origin: 'https://jonmac.ai' }, m);
    assert.notEqual(r.status, 200, m);
  }
  assert.equal(dump(), before);
});

test('GET /dashboard/api/money-income: no database is a 503, never made-up rows', async () => {
  const res = await handleApi(new Request('https://jonmac.ai/dashboard/api/money-income', { headers: { Cookie: await cookie() } }), { SESSION_SECRET: SECRET }, {});
  assert.equal(res.status, 503);
});
