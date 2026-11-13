import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary, fetchWeather, strangePurchases, windowTotals, wmoText } from '../src/summary.js';

// Daily Summary on the Dashboard 2 Today page (src/summary.js). The end-to-end answer is in test/d2.test.mjs.
const NOW = Date.parse('2026-11-09T18:00:00Z'); // Monday Nov 9, 10:00 in Kelowna
const TODAY = '2026-11-09';
const ch = (date, description, amount, extra = {}) => ({ date, description, amount, pending: false, ...extra });

test('rolling windows: yesterday, 7 and 30 days counted back from today, refunds netted, partial when the list starts late', () => {
  const list = [ch('2026-11-09', 'A', 10), ch('2026-11-08', 'B', 20), ch('2026-11-03', 'C', 30), ch('2026-11-02', 'D', 40), ch('2026-10-11', 'E', 50), ch('2026-10-10', 'F', 60), ch('2026-11-05', 'Refund', -5)];
  const t = windowTotals(list, TODAY, '2026-10-01');
  assert.deepEqual([t.yesterday.total, t.week.total, t.month.total], [20, 55, 145]); // 7 days = Nov 3..9, 30 days = Oct 11..Nov 9
  assert.equal(t.week.from, '2026-11-03');
  assert.equal(t.month.from, '2026-10-11');
  assert.equal(t.month.partial, false);
  assert.equal(windowTotals(list, TODAY, '2026-11-01').month.partial, true, 'list starts Nov 1: 30 days not covered');
  assert.equal(windowTotals(list, TODAY, null).week.partial, true, 'unknown start counts as partial');
});

// Three months of clean history: nothing here should be flagged.
const clean = [
  ch('2026-10-02', 'ADOBE CREATIVE CLOUD', 20), ch('2026-10-09', 'ADOBE CREATIVE CLOUD', 20), ch('2026-10-16', 'ADOBE CREATIVE CLOUD', 22),
  ch('2026-10-20', 'CANVA 111', 14.99), ch('2026-11-03', 'CANVA 222', 14.99), ch('2026-11-04', 'ADOBE CREATIVE CLOUD', 25),
  ch('2026-11-06', 'ZOOM.US', 15.99, { currency: 'CAD' }), ch('2026-11-07', 'X CORP ADVERTISING', 90.5, { currency: 'USD' }),
  ch('2026-10-05', 'X CORP ADVERTISING', 80),
];
const strange = (list, over = {}) => strangePurchases(list, { today: TODAY, coverFrom: '2026-10-01', ...over });

test('strange purchases: clean data raises no flag', () => {
  const s = strange(clean);
  assert.deepEqual(s.items, []);
  assert.equal(s.currencyInFeed, true);
});

test('strange purchases: the same merchant and amount twice in a day is a duplicate (once, not twice)', () => {
  const s = strange([...clean, ch('2026-11-07', 'CANVA 333', 14.99), ch('2026-11-07', 'CANVA 334', 14.99)]);
  assert.deepEqual(s.items.map((i) => i.rule), ['duplicate']);
  assert.match(s.items[0].detail, /2 charges of \$14\.99/);
  assert.deepEqual(strange([...clean, ch('2026-11-07', 'CANVA 333', 14.99), ch('2026-11-07', 'CANVA 334', 15.99)]).items, [], 'different amounts are not duplicates');
});

test('strange purchases: more than 3x the merchant median needs 3 earlier charges', () => {
  const s = strange([...clean, ch('2026-11-08', 'ADOBE CREATIVE CLOUD', 80)]); // median of the 4 earlier Adobe charges is 21
  assert.deepEqual(s.items.map((i) => i.rule), ['high']);
  assert.match(s.items[0].detail, /3x its usual \$21\.00/);
  assert.deepEqual(strange([...clean, ch('2026-11-08', 'ADOBE CREATIVE CLOUD', 62)]).items, [], '62 is under 3 x 21');
  const young = [ch('2026-10-02', 'NEWTOOL', 20), ch('2026-10-09', 'NEWTOOL', 20), ch('2026-11-08', 'NEWTOOL', 200)];
  assert.deepEqual(strange(young).items.map((i) => i.rule), [], 'only 2 earlier charges: no usual price yet');
});

test('strange purchases: a new merchant over $100 is flagged only with 14+ days of history before it', () => {
  const s = strange([...clean, ch('2026-11-07', 'OPENAI API', 180)]);
  assert.deepEqual(s.items.map((i) => i.rule), ['newMerchant']);
  assert.deepEqual(strange([...clean, ch('2026-11-07', 'OPENAI API', 99)]).items, [], 'under $100');
  assert.deepEqual(strange([...clean, ch('2026-11-07', 'OPENAI API', 180)], { coverFrom: '2026-11-01' }).items, [], 'list starts Nov 1: cannot say it is new');
  assert.deepEqual(strange([...clean, ch('2026-10-03', 'OPENAI API', 180), ch('2026-11-07', 'OPENAI API', 180)]).items, [], 'seen before');
});

test('strange purchases: a currency other than CAD or USD, only when the feed carries one', () => {
  const s = strange([...clean, ch('2026-11-08', 'PADDLE.NET', 12, { currency: 'EUR' })]);
  assert.deepEqual(s.items.map((i) => i.rule), ['currency']);
  assert.match(s.items[0].detail, /EUR/);
  const none = strange(clean.map(({ currency, ...c }) => c));
  assert.equal(none.currencyInFeed, false);
  assert.deepEqual(none.items, []);
});

test('strange purchases: only the last 7 days are flagged, and a refund is never a purchase', () => {
  assert.deepEqual(strange([...clean, ch('2026-10-20', 'CANVA 5', 14.99), ch('2026-10-20', 'CANVA 6', 14.99), ch('2026-11-08', 'ADOBE CREATIVE CLOUD', -500)]).items, []);
});

// ---- the sections ----
const ctx = (over = {}) => ({
  nowMs: NOW, today: TODAY, ws: '2026-11-09', we: '2026-11-15', by: {}, keyOf: new Map(), cards: [], cash: null,
  t: { feeds: {}, questions: [], tasks: [] }, data: { calendar: [], keys: [] },
  src: { calendar: { label: 'Channel calendars', ageLabel: 'updated 1 hr ago', stale: false } }, ...over,
});
const X = (over = {}) => ({ weather: null, videoCards: [], sponsors: undefined, goals: [], ...over });
const sec = (s, key) => s.sections.find((x) => x.key === key);
const money = (collected_at, data) => ({ moneyclaw: { source: 'moneyclaw', collected_at, data: JSON.stringify(data) } });
const ago = (h) => new Date(NOW - h * 3600000).toISOString();

test('sections come in Jon\'s order', () => {
  const s = buildSummary(ctx(), X({ goals: ['jonmac', 'jonmacai', 'hgp'].map((key) => ({ key, title: key, owner: 'Sydney', project: key, chans: [] })) }));
  assert.deepEqual(s.sections.map((x) => x.key), ['weather', 'calendar', 'markets', 'expenses', 'sponsors', 'jonmac', 'jonmacai', 'hgp']);
});

test('weather: plain words from the WMO code, and the failure line names Open-Meteo and Mila', () => {
  assert.equal(wmoText(61), 'light rain');
  assert.equal(wmoText(95), 'thunderstorm');
  assert.equal(wmoText(1234), null);
  const ok = sec(buildSummary(ctx(), X({ weather: { at: new Date(NOW).toISOString(), temp: 6.4, code: 61, hi: 9.1, lo: 2.2, rain: 60 } })), 'weather');
  assert.equal(ok.rows[0].value, '6°C, light rain');
  assert.equal(ok.rows[1].value, 'High 9°, low 2°, 60% chance of rain');
  assert.equal(sec(buildSummary(ctx(), X()), 'weather').line, 'Weather unavailable (Open-Meteo), owner Mila');
});

test('weather fetch: kept 10 minutes, a failure is kept 5 minutes and never throws', async () => {
  let calls = 0;
  const good = async () => { calls++; return Response.json({ current: { temperature_2m: 3, weather_code: 0 }, daily: { temperature_2m_max: [5], temperature_2m_min: [1], precipitation_probability_max: [0] } }); };
  const t0 = Date.parse('2030-01-01T00:00:00Z');
  const a = await fetchWeather(t0, good);
  await fetchWeather(t0 + 9 * 60000, good);
  assert.equal(calls, 1);
  assert.equal(a.temp, 3);
  await fetchWeather(t0 + 11 * 60000, good);
  assert.equal(calls, 2);
  const t1 = t0 + 3600000;
  assert.equal(await fetchWeather(t1, async () => { throw new Error('offline'); }), null);
  assert.equal(await fetchWeather(t1 + 240000, good), null, 'a failure is remembered for 5 minutes');
  assert.equal(await fetchWeather(t1 + 301000, async () => new Response('x', { status: 500 })), null);
  assert.equal(await fetchWeather(t1 + 700000, async () => Response.json({ current: {} })), null, 'an answer without a temperature is a failure');
});

test('calendar: no feed says "Calendar feed not connected. Owner: Ana."; a feed from another day is not today\'s', () => {
  assert.equal(sec(buildSummary(ctx(), X()), 'calendar').line, 'Calendar feed not connected. Owner: Ana.');
  const feed = (date, events) => ({ t: { feeds: { calendar_today: { createdAt: ago(1), data: { date, events } } }, questions: [], tasks: [] } });
  const old = sec(buildSummary(ctx(feed('2026-11-08', [])), X()), 'calendar');
  assert.equal(old.line, 'Calendar feed is from Nov 8, not today. Owner: Ana.');
  const today = sec(buildSummary(ctx(feed(TODAY, [{ start: '09:30', end: '10:00', title: 'Call', calendar: 'jon@' }])), X()), 'calendar');
  assert.equal(today.line, '');
  assert.deepEqual(today.rows, [{ label: '09:30-10:00', value: 'Call', sub: 'jon@' }]);
  assert.equal(sec(buildSummary(ctx(feed(TODAY, [])), X()), 'calendar').line, 'No events today.');
});

test('calendar: all-day events read "All day", and the footer shows the push time in Kelowna time', () => {
  const feed = { t: { feeds: { calendar_today: { createdAt: ago(1), data: { date: TODAY, events: [{ start: 'All day', end: 'All day', title: 'Trip', calendar: 'jonstagger@' }] } } }, questions: [], tasks: [] } };
  const s = sec(buildSummary(ctx(feed), X()), 'calendar');
  assert.deepEqual(s.rows, [{ label: 'All day', value: 'Trip', sub: 'jonstagger@' }]);
  assert.match(s.sources[0].ageLabel, /^updated \d{1,2}:\d{2} (AM|PM) \(1 hr ago\)$/);
});

const core = [
  { symbol: 'VOO', price: 701.89, allTimeHigh: 716.39, todayPct: 0.1, pctOffHigh: 2 },
  { symbol: 'QQQ', price: 721.35, allTimeHigh: 748.65, todayPct: -0.6 },
];
test('markets: long decimals show one decimal, and a missing day change shows nothing', () => {
  const long = [
    { symbol: 'VOO', price: 701.89, todayPct: 2.4226704540324375, pctOffHigh: 1.9999999 },
    { symbol: 'QQQ', price: 721.35, allTimeHigh: 748.65, todayPct: -0.04 },
  ];
  const m = sec(buildSummary(ctx({ by: money(ago(1), { markets: { core: long } }) }), X()), 'markets');
  assert.deepEqual(m.rows.map((r) => r.sub), ['2% below all-time high · today +2.4%', '3.6% below all-time high · today 0%']);
  const none = sec(buildSummary(ctx({ by: money(ago(1), { markets: { core: [{ symbol: 'VOO', price: 700, pctOffHigh: 1.26 }] } }) }), X()), 'markets');
  const nul = sec(buildSummary(ctx({ by: money(ago(1), { markets: { core: [{ symbol: 'VOO', price: 700, pctOffHigh: null, todayPct: null }] } }) }), X()), 'markets');
  assert.equal(nul.rows[0].sub, 'all-time high not in feed');
  assert.equal(none.rows[0].sub, '1.3% below all-time high');
});
test('markets: price and % below all-time high, a missing symbol or feed says so, an old feed is stale', () => {
  const m = sec(buildSummary(ctx({ by: money(ago(1), { markets: { core } }) }), X()), 'markets');
  assert.deepEqual(m.rows.map((r) => [r.label, r.value, r.sub]), [['VOO', '$701.89', '2% below all-time high · today +0.1%'], ['QQQ', '$721.35', '3.6% below all-time high · today -0.6%']]);
  assert.equal(m.sources[0].stale, false);
  assert.equal(sec(buildSummary(ctx({ by: money(ago(30), { markets: { core } }) }), X()), 'markets').sources[0].stale, true);
  const one = sec(buildSummary(ctx({ by: money(ago(1), { markets: { core: [core[0]] } }) }), X()), 'markets');
  assert.match(one.rows[1].sub, /Not in the MoneyClaw feed\. Owner: Mila\./);
  assert.equal(sec(buildSummary(ctx(), X()), 'markets').line, 'Market feed not connected (MoneyClaw). Owner: Mila.');
});

const period = (total, extra = {}) => ({ total, ...extra });
const expenses = (business) => ({ asOf: '2026-11-08', expenses: { business, personal: { yesterday: period(0), week: period(0), month: period(0), lastMonth: period(0) } } });
const biz = (charges, from = '2026-10-01') => ({
  yesterday: period(20), week: period(30), month: period(30, { startDate: '2026-11-01', endDate: '2026-11-08', charges }),
  lastMonth: period(0, { startDate: from, endDate: '2026-10-31', charges: [] }),
});

test('expenses: totals, strange purchases and charge-watch flags, with the feed age', () => {
  const charges = [...clean, ch('2026-11-07', 'CANVA 333', 14.99), ch('2026-11-07', 'CANVA 334', 14.99)];
  const q = [{ id: 'q1', question: 'New charge: $12 Canva. Keep it?' }, { id: 'q2', question: 'Other question' }];
  const e = sec(buildSummary(ctx({ by: money(ago(2), expenses(biz(charges))), t: { feeds: {}, questions: q, tasks: [] }, keyOf: new Map([['q1', 'cw:canva:new:2026-11-07']]) }), X()), 'expenses');
  assert.match(e.rows[0].value, /^Yesterday \$20 · 7 days \$\d+ · 30 days \$\d+$/);
  assert.deepEqual(e.strange.map((s) => s.rule), ['duplicate']);
  assert.equal(e.rows.filter((r) => r.label === 'Charge watch').length, 1, 'only cw: questions');
  assert.equal(e.sources[0].stale, false);
  assert.match(e.sources[0].ageLabel, /updated 2 hr ago/);
});

test('expenses: a feed older than 2 days is marked stale, and so is data older than 2 days', () => {
  const stale = sec(buildSummary(ctx({ by: money(ago(60), expenses(biz(clean))) }), X()), 'expenses');
  assert.equal(stale.sources[0].stale, true);
  const old = { ...expenses(biz(clean)), asOf: '2026-11-05' };
  assert.equal(sec(buildSummary(ctx({ by: money(ago(1), old) }), X()), 'expenses').sources[0].stale, true);
  assert.equal(sec(buildSummary(ctx({ by: money(ago(47), expenses(biz(clean))) }), X()), 'expenses').sources[0].stale, false, '47 hours is not yet 2 days');
});

test('expenses: says so in one line when the lists cannot cover 30 days or carry no currency; names Mila when missing', () => {
  const noCur = sec(buildSummary(ctx({ by: money(ago(1), expenses(biz([ch('2026-11-02', 'ZOOM.US', 15.99)]))) }), X()), 'expenses');
  assert.ok(noCur.notes.includes('Foreign currency check: currency not in feed.'));
  const partial = expenses(biz([ch('2026-11-02', 'ZOOM.US', 15.99)]));
  delete partial.expenses.business.lastMonth.charges;
  const p = sec(buildSummary(ctx({ by: money(ago(1), partial) }), X()), 'expenses');
  assert.equal(p.rows[0].sub, '30 days counts only from Nov 1, where the charge list starts');
  assert.ok(p.notes.some((n) => /New-merchant check needs 14 days/.test(n)));
  assert.equal(sec(buildSummary(ctx(), X()), 'expenses').line, 'Expenses feed not connected (MoneyClaw). Owner: Mila.');
  const noList = sec(buildSummary(ctx({ by: money(ago(1), { expenses: { business: { yesterday: period(5), week: period(5), month: period(5), lastMonth: period(5) } } }) }), X()), 'expenses');
  assert.match(noList.rows[0].sub, /Charge list not in feed.*Owner: Mila\./);
});

test('expenses: clean charges say there is nothing strange', () => {
  const e = sec(buildSummary(ctx({ by: money(ago(1), expenses(biz(clean))) }), X()), 'expenses');
  assert.deepEqual(e.strange, []);
  assert.ok(e.notes.includes('No strange purchases in the last 7 days.'));
});

test('sponsors: every piece without a source says so and names Florence', () => {
  const s = sec(buildSummary(ctx({ src: { calendar: {}, cards: {} } }), X({ videoCards: null })), 'sponsors');
  assert.equal(s.rows.length, 5);
  for (const r of s.rows) { assert.equal(r.cls, 'muted'); assert.match(r.sub, /No source, owner Florence|Owner: Florence/); }
});

test('sponsors: income, who owes, due dates, deals to close and videos to make from the existing feeds', () => {
  const cash = { month: { usd: 3100, payments: 2 }, unpaidAvailable: true, owed: 2100, unpaid: [{ sponsor: 'Invideo', owed: 2100, due: '2026-11-08' }] };
  // Deals to close (Jon, 2026-11-13): priced Deals / Deposit Invoice not on the owed list. Talks, unpriced deals and an
  // owed deal count nowhere here.
  const sponsors = { collect: { rows: [{ sponsor: 'Invideo', owedUsd: 2100 }] }, board: { columns: [
    { title: 'Negotiations', cards: [{ boardStage: 'negotiating', name: 'Poppy', amt: 2500 }] },
    { title: 'Deals', cards: [{ id: 'd1', name: 'Enter', amt: 3000 }, { id: 'd2', name: 'Munch' }, { id: 'd3', name: 'Invideo', amt: 2100 }] },
    { title: 'Deposit Invoice', cards: [{ id: 'd4', name: 'Topview', amt: 2000 }] },
  ] } };
  const c = ctx({
    cash, cards: [{ key: 'sponsors', usd: 3100, source: { label: 'Sponsor cash', ageLabel: 'updated 1 hr ago', stale: false } }],
    by: { sponsors: { collected_at: ago(1), data: JSON.stringify({ collections: { items: [] } }) } }, src: { calendar: {}, cards: { label: 'Dashboard cards', ageLabel: 'live', stale: false } },
  });
  const s = sec(buildSummary(c, X({ sponsors, videoCards: [{ title: 'Poppy video 1: integration', status: 'doing', due: '2026-11-12' }, { title: 'Invideo video 1', status: 'done' }] })), 'sponsors');
  const by = Object.fromEntries(s.rows.map((r) => [r.label, r]));
  assert.equal(by['Income this month'].value, '$3,100 · 2 deposits');
  assert.equal(by['Owes you'].value, '$2,100 from 1 sponsor');
  assert.equal(by['Collections due'].value, 'Invideo $2,100 overdue since Nov 8');
  assert.equal(by['Collections due'].cls, 'crit');
  assert.deepEqual([by['Deals to close'].value, by['Deals to close'].sub], ['2 deals · $5,000', 'Enter $3,000, Topview $2,000']);
  assert.deepEqual([by['Videos still to make'].value, by['Videos still to make'].sub], ['1 sponsor video', 'Poppy video 1 (due Nov 12)']);
});

test('channels: scheduled of planned this week plus open cards, one line a channel', () => {
  const goals = [{ key: 'hgp', title: 'Home Guide Press', owner: 'Elle', project: 'home-guide-press', group: 'Home Guide Press', chans: [{ slug: 'peter-collins', label: 'Peter Collins' }, { slug: 'new-one', label: 'New One', noCalendar: true }] }];
  const calendar = [
    { channel: 'peter-collins', day: '2026-11-09', status: 'scheduled' }, { channel: 'peter-collins', day: '2026-11-11', status: 'editing' },
    { channel: 'peter-collins', day: '2026-11-18', status: 'scheduled' }, { channel: 'jack-mercer', day: '2026-11-10', status: 'published' },
  ];
  const tasks = [
    { project: 'home-guide-press', status: 'doing', title: 'Video 2 - Peter Collins' }, { project: 'home-guide-press', status: 'done', title: 'Video 1 - Peter Collins' },
    { project: 'home-guide-press', status: 'todo', title: 'Something else' },
  ];
  const s = sec(buildSummary(ctx({ data: { calendar }, t: { feeds: {}, questions: [], tasks } }), X({ goals })), 'hgp');
  assert.deepEqual(s.rows.map((r) => [r.label, r.value, r.sub]), [['Peter Collins', '1 of 2 scheduled or live', '1 open card'], ['New One', 'No calendar yet', '0 open cards']]);
  assert.deepEqual(s.notes, ['1 more open card not tied to one channel.']);
  const lost = sec(buildSummary(ctx({ data: { calendar: null }, t: { feeds: {}, questions: [], tasks: null } }), X({ goals })), 'hgp');
  assert.deepEqual(lost.notes, ['Channel calendars unavailable. Owner: Elle.', 'Open cards unavailable (dashboard cards unreadable). Owner: Elle.']);
});

test('expenses: strange purchases are capped at 8 lines with "+N more"', () => {
  const many = Array.from({ length: 11 }, (_, i) => [ch('2026-11-08', `DUP${String.fromCharCode(97 + i)}`, 10), ch('2026-11-08', `DUP${String.fromCharCode(97 + i)}`, 10)]).flat();
  const e = sec(buildSummary(ctx({ by: money(ago(1), expenses(biz(many))) }), X()), 'expenses');
  assert.equal(e.strange.length, 11);
  assert.equal(e.rows.filter((r) => r.cls === 'crit').length, 8);
  assert.ok(e.notes.includes('+3 more strange purchases.'));
});

test('expenses: when the charge-watch lookup fails it says so and never claims "no strange purchases"', () => {
  const by = money(ago(1), expenses(biz(clean)));
  for (const bad of [{ data: { calendar: [], keys: null } }, { t: { feeds: {}, questions: null, tasks: [] } }]) {
    const e = sec(buildSummary(ctx({ by, ...bad }), X()), 'expenses');
    assert.ok(e.notes.includes('Charge-watch flags unavailable (bot questions unreadable). Owner: Mila.'));
    assert.equal(e.notes.some((n) => /No strange purchases/.test(n)), false);
  }
});

test('expenses: notes when the feed yesterday total and its charge list disagree', () => {
  const list = [ch('2026-11-08', 'ZOOM.US', 15.99)];
  const off = sec(buildSummary(ctx({ by: money(ago(1), expenses(biz(list))) }), X()), 'expenses'); // feed says $20, list says $15.99
  assert.ok(off.notes.some((n) => /Business: yesterday is MoneyClaw's total \(\$20\.00\); its charge list adds to \$15\.99/.test(n)));
  const same = expenses(biz(list));
  same.expenses.business.yesterday = period(15.99);
  assert.equal(sec(buildSummary(ctx({ by: money(ago(1), same) }), X()), 'expenses').notes.some((n) => /yesterday is MoneyClaw/.test(n)), false);
});

// One bad source must not blank the others (or /d2, see test/d2.test.mjs).
test('a malformed source turns only its own section into an unavailable line', () => {
  const bad = ctx({
    by: money(ago(1), { markets: { core: [null, ...core] }, ...expenses(biz([null, ...clean])) }),
    t: { feeds: { calendar_today: { createdAt: ago(1), data: { date: TODAY, events: 'not a list' } } }, questions: [], tasks: [] },
    cards: null, // Sponsors reads this and throws
  });
  const s = buildSummary(bad, X({ weather: { at: new Date(NOW).toISOString(), temp: 1, code: 0 } }));
  assert.equal(sec(s, 'calendar').line, 'Calendar unavailable (could not read its data). Owner: Ana.');
  assert.equal(sec(s, 'sponsors').line, 'Sponsors unavailable (could not read its data). Owner: Florence.');
  assert.equal(sec(s, 'markets').rows[0].value, '$701.89', 'a null entry in markets.core is skipped');
  assert.match(sec(s, 'expenses').rows[0].value, /^Yesterday \$20/, 'a null entry in the charge list is skipped');
  assert.equal(sec(s, 'weather').rows[0].value, '1°C, clear');
});
