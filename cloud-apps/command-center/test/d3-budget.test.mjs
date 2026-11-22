// Budget page (card t_13a6d327341447f0): src/budget.js calculation, its API, and the page (public/d3/js/budget.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { budgetView, BUDGETS, isTravel, windows } from '../src/budget.js';
import { renderBudget } from '../public/d3/js/budget.js';

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
  const html = renderBudget(null, { ok: true, budget: b }, 'business/week');
  assert.match(html, /Transactions not loaded yet\./);
});

test('page: 2 rows x 3 tap cards, colours, on-track line, opened list, no MoneyClaw frame', () => {
  const data = { ok: true, budget: budgetView({ budgetTransactions: ROWS }, NOW) };
  const html = renderBudget(null, data, 'business/week');
  assert.equal((html.match(/data-bgopen=/g) || []).length, 6);
  assert.match(html, /<h2>Business<\/h2>[\s\S]*<h2>Personal<\/h2>/);
  assert.match(html, /class="bgc bad" data-bgopen="personal\/yesterday"/);
  assert.match(html, /class="bgc ok" data-bgopen="business\/yesterday"/);
  assert.match(html, /On track for month: yes/);
  assert.match(html, /Business · Last 7 days[\s\S]*SAMPLE AWS[\s\S]*SAMPLE Mic[\s\S]*SAMPLE Adobe/);
  assert.doesNotMatch(html, /iframe|Hotel Vancouver/);
  assert.doesNotMatch(renderBudget(null, data, null), /<table/);
  const app = readFileSync(new URL('../public/d3/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /getJson\('\/dashboard\/api\/v1\/budget'\)/);
});

test('API: GET /dashboard/api/v1/budget reads the stored MoneyClaw summary', async () => {
  const bots = readFileSync(new URL('../src/bots.js', import.meta.url), 'utf8');
  assert.match(bots, /kind === 'budget' && !rawId && method === 'GET'/);
  assert.match(bots, /budget: budgetView\(data, Date\.now\(\)\)/);
});
