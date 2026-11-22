// Budget page (cards t_13a6d327341447f0, t_9a6930f719354c07): src/budget.js calculation, its API, and the page (public/d3/js/budget.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { budgetView, BUDGETS, isTravel, windows } from '../src/budget.js';
import { renderBudget, budgetClick } from '../public/d3/js/budget.js';
import { isMcPage } from '../public/d3/js/moneyclaw.js';

const NOW = Date.parse('2026-11-21T19:00:00Z'); // Vancouver 2026-11-21, midday
const T = (date, merchant, amount, category, group, pending = false) => ({ date, merchant, amount, category, group, pending });
const ROWS = [
  T('2026-11-20', 'SAMPLE Adobe', 60, 'Software', 'business'),
  T('2026-11-20', 'SAMPLE Hotel Vancouver', 900, 'Business Travel', 'business'), // Travel: never counted
  T('2026-11-20', 'SAMPLE Costco', 300, 'Groceries', 'personal'), // personal yesterday over 247
  T('2026-11-20', 'SAMPLE Air Canada', 700, 'Flights', 'personal'), // Travel
  T('2026-11-16', 'SAMPLE AWS', 400, 'Software', 'business'),
  T('2026-11-14', 'SAMPLE Mic', 120, 'Equipment', 'business'),
  T('2026-11-13', 'SAMPLE Old', 999, 'Equipment', 'business'), // before the 7 days, still this month
  T('2026-11-21', 'SAMPLE Today Lunch', 25, 'Meals', 'business', true), // today: month only
  T('2026-10-31', 'SAMPLE October', 5000, 'Software', 'business'), // last month: nowhere
  T('2026-11-05', 'SAMPLE Rent', 3200, 'Housing', 'personal'),
];

test('windows: yesterday, the 7 days before today, the 1st to today', () => {
  assert.deepEqual(windows('2026-11-21'), {
    yesterday: { label: 'Yesterday', from: '2026-11-20', to: '2026-11-20' },
    week: { label: 'Last 7 days', from: '2026-11-14', to: '2026-11-20' },
    month: { label: 'This month', from: '2026-11-01', to: '2026-11-21' },
  });
  assert.deepEqual(windows('2026-03-01').week, { label: 'Last 7 days', from: '2026-02-22', to: '2026-02-28' });
});

test('six numbers, Travel excluded, biggest first, over budget is red', () => {
  const b = budgetView({ budgetTransactions: ROWS }, NOW);
  assert.equal(b.today, '2026-11-21');
  assert.equal(b.transactionsLoaded, true);
  const bz = b.groups.business.periods;
  const pz = b.groups.personal.periods;
  assert.equal(bz.yesterday.spent, 60);
  assert.equal(bz.yesterday.green, true);
  assert.equal(bz.week.spent, 580);
  assert.deepEqual(bz.week.transactions.map((t) => t.merchant), ['SAMPLE AWS', 'SAMPLE Mic', 'SAMPLE Adobe']); // biggest first
  assert.equal(bz.week.green, true);
  assert.equal(bz.month.spent, 1604);
  assert.equal(pz.yesterday.spent, 300);
  assert.equal(pz.yesterday.over, true);
  assert.equal(pz.yesterday.green, false); // over budget -> red
  assert.equal(pz.month.spent, 3500);
  for (const g of Object.values(b.groups)) for (const p of Object.values(g.periods)) assert.ok(!p.transactions.some((t) => isTravel(t.category)), 'Travel row leaked');
  assert.equal(isTravel('hotel/accommodation'), true);
  assert.equal(isTravel('Software'), false);
  assert.deepEqual(BUDGETS, { business: { yesterday: 99, week: 692, month: 3000 }, personal: { yesterday: 247, week: 1731, month: 7500 } });
});

test('on track for month: month-to-date / days elapsed * days in month <= budget', () => {
  // 21 of 30 days: 2100 projects to 3000 exactly (on track), 2101 does not, even though both are under 3000 so far.
  const at = (amt) => budgetView({ budgetTransactions: [T('2026-11-02', 'SAMPLE x', amt, 'Software', 'business')] }, NOW).groups.business.periods.month;
  assert.equal(at(2100).onTrack, true);
  assert.equal(at(2100).projected, 3000);
  assert.equal(at(2100).green, true);
  assert.equal(at(2101).onTrack, false);
  assert.equal(at(2101).over, false);
  assert.equal(at(2101).green, false);
});

test('Vancouver day edges: an evening there is still that day, though UTC has moved on', () => {
  const rows = { budgetTransactions: [T('2026-11-20', 'SAMPLE late', 50, 'Software', 'business'), T('2026-11-19', 'SAMPLE before', 10, 'Software', 'business')] };
  const late = budgetView(rows, Date.parse('2026-11-21T06:30:00Z')); // 22:30 or 23:30 on Nov 20 in Vancouver
  assert.equal(late.today, '2026-11-20');
  assert.equal(late.groups.business.periods.yesterday.spent, 10);
  const early = budgetView(rows, Date.parse('2026-11-21T08:30:00Z')); // 00:30 or 01:30 on Nov 21 in Vancouver
  assert.equal(early.today, '2026-11-21');
  assert.equal(early.groups.business.periods.yesterday.spent, 50);
  const firstOfMonth = budgetView({ budgetTransactions: [T('2026-11-30', 'SAMPLE', 40, 'Software', 'business')] }, Date.parse('2026-12-01T19:00:00Z'));
  assert.equal(firstOfMonth.groups.business.periods.month.spent, 0); // Nov 30 is not December
  assert.equal(firstOfMonth.groups.business.periods.yesterday.spent, 40);
});

test('no budgetTransactions: MoneyClaw totals where it has them, lists say not loaded', () => {
  const b = budgetView({ expenses: { business: { yesterday: { total: 12 }, week: { totalCents: 80000 } }, personal: {} } }, NOW);
  assert.equal(b.transactionsLoaded, false);
  assert.equal(b.note, 'transactions not loaded yet');
  assert.equal(b.groups.business.periods.yesterday.spent, 12);
  assert.equal(b.groups.business.periods.week.spent, 800);
  assert.equal(b.groups.business.periods.week.green, false);
  assert.equal(b.groups.business.periods.month.spent, null);
  assert.equal(b.groups.business.periods.month.green, null);
  assert.equal(b.groups.personal.periods.week.transactions, null);
  assert.equal(budgetView(null, NOW).groups.personal.periods.month.spent, null);
  const html = renderBudget(null, { ok: true, budget: b }, { bgOpen: { g: 'business', k: 'week', view: 'cats', line: null } });
  assert.match(html, /Transactions not loaded yet\./);
});

// MoneyClaw's /api/budget-simple shape (summary.budgetSimple): what its /budget page draws.
const cat = (name, spent, budget, over, count, basis = 'prorated') => ({ name, spent, budget, basis: budget == null ? null : basis, over, count });
const tx = (merchant, amount, category, line, date = '2026-11-20') => ({ date, merchant, amount, category, line, pending: false, currency: 'CAD' });
const SP = (period, startDate, endDate, budget, spent, txns, categories, wt, month) => ({
  period, startDate, endDate, spent, budget, over: spent > budget, count: txns.length, excludedTravel: wt.spent - spent, txns, categories,
  withTravel: { spent: wt.spent, over: wt.spent > budget, count: wt.txns.length, txns: wt.txns, categories: wt.categories, ...(month ? { onTrack: wt.onTrack } : {}) },
  ...(month || {}),
});
const AWS = tx('SAMPLE AWS', 400, 'Software', 'Software', '2026-11-16');
const HOTEL = tx('SAMPLE Hotel Lisbon', 900, 'Business Travel', 'Travel');
const SIMPLE = {
  today: '2026-11-21', month: '2026-11', latestPostedDate: '2026-11-20',
  groups: [
    { key: 'business', label: 'Business', periods: {
      yesterday: SP('yesterday', '2026-11-20', '2026-11-20', 99, 0, [], [cat('Software', 0, 100, false, 0)], { spent: 900, txns: [HOTEL], categories: [cat('Travel', 900, 69.43, true, 1)] }),
      week: SP('week', '2026-11-14', '2026-11-20', 692, 400, [AWS], [cat('Software', 400, 700, false, 1)], { spent: 1300, txns: [HOTEL, AWS], categories: [cat('Travel', 900, 486, true, 1), cat('Software', 400, 700, false, 1)] }),
      month: SP('month', '2026-11-01', '2026-11-20', 3000, 2100, [tx('SAMPLE Old', 1700, 'Equipment', 'Equipment', '2026-11-03'), AWS], [cat('Equipment', 1700, null, false, 1), cat('Software', 400, 2000, false, 1)],
        { spent: 3000, txns: [tx('SAMPLE Old', 1700, 'Equipment', 'Equipment', '2026-11-03'), HOTEL, AWS], categories: [cat('Travel', 900, 1388.67, false, 1)], onTrack: false },
        { paceBudget: 2000, daysGone: 20, daysInMonth: 30, onTrack: false }),
    } },
    { key: 'personal', label: 'Personal', periods: {
      yesterday: SP('yesterday', '2026-11-20', '2026-11-20', 247, 300, [tx('SAMPLE Costco', 300, 'Groceries', 'Groceries')], [cat('Groceries', 300, 40, true, 1)], { spent: 300, txns: [tx('SAMPLE Costco', 300, 'Groceries', 'Groceries')], categories: [cat('Groceries', 300, 40, true, 1)] }),
      week: SP('week', '2026-11-14', '2026-11-20', 1731, 300, [tx('SAMPLE Costco', 300, 'Groceries', 'Groceries')], [], { spent: 300, txns: [tx('SAMPLE Costco', 300, 'Groceries', 'Groceries')], categories: [] }),
      month: SP('month', '2026-11-01', '2026-11-20', 7500, 3500, [tx('SAMPLE Rent', 3200, 'Housing', 'Rent', '2026-11-05'), tx('SAMPLE Costco', 300, 'Groceries', 'Groceries')], [cat('Rent', 3200, 3200, false, 1, 'fixed')],
        { spent: 3500, txns: [], categories: [] }, { paceBudget: 5000, daysGone: 20, daysInMonth: 30, onTrack: true }),
    } },
  ],
};

test('budgetSimple from MoneyClaw wins: the same numbers as its /budget page, Travel block and categories kept', () => {
  const b = budgetView({ budgetSimple: SIMPLE, budgetTransactions: ROWS, asOf: '2026-11-21' }, NOW);
  assert.equal(b.source, 'moneyclaw');
  assert.equal(b.transactionsLoaded, true);
  const bm = b.groups.business.periods.month;
  assert.deepEqual([bm.label, bm.from, bm.to, bm.spent, bm.budget, bm.over, bm.green, bm.onTrack, bm.paceBudget], ['This month', '2026-11-01', '2026-11-20', 2100, 3000, false, true, false, 2000]);
  assert.deepEqual([bm.withTravel.spent, bm.withTravel.onTrack], [3000, false]);
  assert.equal(b.groups.business.periods.week.spent, 400); // MoneyClaw's number, not the row calculation (580)
  assert.equal(b.groups.business.periods.week.withTravel.spent, 1300);
  assert.equal(b.groups.personal.periods.yesterday.green, false);
  assert.equal(b.groups.business.periods.week.categories[0].name, 'Software');
  assert.equal(b.groups.business.periods.week.transactions[0].line, 'Software');
  // Brief fields still there (brief_page.py budget_card reads label, spent, budget, green, onTrack).
  for (const g of ['business', 'personal']) for (const k of ['yesterday', 'week', 'month']) {
    const p = b.groups[g].periods[k];
    for (const f of ['label', 'spent', 'budget', 'green']) assert.ok(p[f] !== undefined, `${g}.${k}.${f}`);
  }
  assert.equal(budgetView({ budgetSimple: { groups: [] }, budgetTransactions: ROWS }, NOW).groups.business.periods.week.spent, 580); // broken block: old calculation
});

test('page: 2 rows x 3 cards, Travel switch both ways, categories then transactions, no MoneyClaw frame or sign-in', () => {
  const data = { ok: true, budget: budgetView({ budgetSimple: SIMPLE }, NOW) };
  const off = renderBudget(null, data, { bgTravel: false });
  assert.equal((off.match(/data-bgopen=/g) || []).length, 6);
  assert.match(off, /<h2>Business<\/h2>[\s\S]*<h2>Personal<\/h2>/);
  assert.match(off, /class="bgc ok" data-bgopen="business\/week">[\s\S]*?\$400</);
  assert.match(off, /class="bgc bad" data-bgopen="personal\/yesterday"/);
  assert.match(off, /Over pace<i>\$2,000 budget for 20 of 30 days/);
  assert.match(off, /role="switch" aria-checked="false" data-bgtravel="1"[\s\S]*Travel not counted/);
  assert.match(off, /href="https:\/\/moneyclaw\.jonmac\.ai\/budget\/"[^>]*>Open in MoneyClaw/);
  assert.doesNotMatch(off, /<iframe|Signed out of MoneyClaw|Sign in to MoneyClaw|Hotel Lisbon/);
  // Travel on: travel counted, business week turns red at 1,300.
  const ui = { bgTravel: false, bgOpen: null };
  const ev = (attrs) => ({ target: { closest: (sel) => { const k = sel.slice(1, -1).replace(/^data-/, ''); return attrs[k] !== undefined ? { dataset: Object.fromEntries(Object.entries(attrs).map(([a, v]) => [a.replace(/^bg/, 'bg'), v])), tagName: 'BUTTON' } : null; } } });
  assert.equal(budgetClick(ev({ bgtravel: '1' }), ui), true);
  assert.equal(ui.bgTravel, true);
  const on = renderBudget(null, data, ui);
  assert.match(on, /aria-checked="true"[\s\S]*Travel counted/);
  assert.match(on, /class="bgc bad" data-bgopen="business\/week">[\s\S]*?\$1,300/);
  assert.equal(budgetClick(ev({ bgtravel: '1' }), ui), true);
  assert.equal(ui.bgTravel, false);
  // Tap a card: categories first, then one category's transactions, then all of them.
  budgetClick({ target: { closest: (sel) => (sel === '[data-bgopen]' ? { dataset: { bgopen: 'business/week' } } : null) } }, ui);
  assert.deepEqual(ui.bgOpen, { g: 'business', k: 'week', view: 'cats', line: null });
  const cats = renderBudget(null, data, ui);
  assert.match(cats, /class="bgd"[\s\S]*Business · Last 7 days[\s\S]*All 1 transaction[\s\S]*data-bgcat="Software"[\s\S]*\$400\.00[\s\S]*\$700\.00 budget/);
  ui.bgTravel = true;
  assert.match(renderBudget(null, data, ui), /All 2 transactions[\s\S]*data-bgcat="Travel"[\s\S]*bgcat ok" data-bgcat="Software"/);
  budgetClick({ target: { closest: (sel) => (sel === '[data-bgcat]' ? { dataset: { bgcat: 'Travel' } } : null) } }, ui);
  const line = renderBudget(null, data, ui);
  assert.match(line, /Business · Last 7 days · Travel[\s\S]*SAMPLE Hotel Lisbon[\s\S]*\$900\.00/);
  assert.doesNotMatch(line, /SAMPLE AWS/);
  assert.match(line, /data-bgback="1"/);
  budgetClick({ target: { closest: (sel) => (sel === '[data-bgclose]' ? { tagName: 'BUTTON' } : null) } }, ui);
  assert.equal(ui.bgOpen, null);
  // The app draws it natively and reads the dashboard API (dash sign-in only).
  const app = readFileSync(new URL('../public/d3/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /getJson\('\/dashboard\/api\/v1\/budget'\)/);
  assert.match(app, /renderBudget\(S\.d2, S\.budget, S\.ui\)/);
  assert.equal(isMcPage('budget'), false); // not a MoneyClaw frame
  assert.equal(isMcPage('expenses'), true);
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  assert.match(css, /\.d3 \.bgdl\{overflow-y:auto/); // category list scrolls on a phone
});

test('API: GET /dashboard/api/v1/budget reads the stored MoneyClaw summary', async () => {
  const bots = readFileSync(new URL('../src/bots.js', import.meta.url), 'utf8');
  assert.match(bots, /kind === 'budget' && !rawId && method === 'GET'/);
  assert.match(bots, /budget: budgetView\(data, Date\.now\(\)\)/);
});
