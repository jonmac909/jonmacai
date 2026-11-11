import test from 'node:test';
import assert from 'node:assert/strict';
import { expenseSplit, splitMismatch } from '../src/summary.js';
import { renderMoney } from '../public/d3/js/money.js';

// Money page: RBC expenses in two labelled sections, Personal and Business (card t_7c5ac8880a044f1b).
const TODAY = '2026-11-09';
const ch = (date, description, amount, pending = false) => ({ date, description, amount, pending });
const ex = () => ({
  personal: {
    yesterday: { total: 20 },
    lastMonth: { startDate: '2026-10-01', endDate: '2026-10-31', charges: [ch('2026-10-15', 'GROCER', 100.25), ch('2026-10-05', 'OLD', 999)] },
    month: { startDate: '2026-11-01', endDate: '2026-11-30', charges: [ch('2026-11-08', 'CAFE', 20), ch('2026-11-05', 'REFUND', -5), ch('2026-11-09', 'PEND', 7.5, true)] },
  },
  business: {
    yesterday: { total: 90.5 },
    lastMonth: { startDate: '2026-10-01', endDate: '2026-10-31', charges: [ch('2026-10-20', 'ADS', 300)] },
    month: { startDate: '2026-11-01', endDate: '2026-11-30', charges: [ch('2026-11-08', 'X CORP', 90.5), ch('2026-11-03', 'ZOOM', 15.99)] },
  },
});
const d2 = (split) => ({ asOf: '2026-11-09T18:00:00Z', d2: { summary: { sections: [{ key: 'expenses', currency: 'CAD', split }] } } });

test('(a) the Money page shows Personal and Business sections, each with its own totals', () => {
  const split = expenseSplit(ex(), TODAY);
  const html = renderMoney(d2(split), null);
  assert.match(html, /<h2>Personal<\/h2>/);
  assert.match(html, /<h2>Business<\/h2>/);
  assert.ok(html.indexOf('<h2>Personal</h2>') < html.indexOf('<h2>Business</h2>'));
  assert.match(html, /data-exp="personal-yesterday">\$20\.00</);
  assert.match(html, /data-exp="personal-week">\$22\.50</); // 20 - 5 + 7.5 pending
  assert.match(html, /data-exp="personal-month">\$122\.75</); // 100.25 + 22.5
  assert.match(html, /data-exp="business-yesterday">\$90\.50</);
  assert.match(html, /data-exp="business-week">\$106\.49</);
  assert.match(html, /data-exp="business-month">\$406\.49</);
});

test('(b) Personal + Business equal the combined total for yesterday, 7 and 30 days', () => {
  const split = expenseSplit(ex(), TODAY);
  assert.deepEqual(splitMismatch(split), []);
  for (const k of ['yesterday', 'week', 'month']) {
    assert.equal(Math.round((split.personal[k] + split.business[k]) * 100), Math.round(split.combined[k] * 100), k);
  }
});

test('(c) a planted mismatch (a charge dropped from one side) fails the sum check', () => {
  const split = expenseSplit(ex(), TODAY);
  const dropped = { ...split, business: { ...split.business, week: split.business.week - 15.99 } };
  assert.deepEqual(splitMismatch(dropped), ['week']);
  assert.deepEqual(splitMismatch(null), ['no split']);
});

// MoneyClaw's live feed (2026-11-11) has stage totals only, no charge lists: the sections use those totals.
const st = (startDate, totalCents) => ({ startDate, endDate: '2026-11-11', totalCents, total: totalCents / 100 });
const stagesEx = () => ({
  personal: { yesterday: st('2026-11-10', 1250), week: st('2026-11-05', 47350), month: st('2026-11-01', 90001), lastMonth: st('2026-10-01', 300000) },
  business: { yesterday: st('2026-11-10', 0), week: st('2026-11-05', 120099), month: st('2026-11-01', 827301), lastMonth: st('2026-10-01', 500000) },
});

test('stage totals only: both sections show MoneyClaw totals, labelled This month, and add up', () => {
  const split = expenseSplit(stagesEx(), '2026-11-11');
  assert.equal(split.personal.basis, 'stages');
  const html = renderMoney(d2(split), null);
  assert.match(html, /data-exp="personal-week">\$473\.50</);
  assert.match(html, /data-exp="business-month">\$8,273\.01</);
  assert.match(html, /This month \(from 11\/01\)/);
  assert.doesNotMatch(html, /Last 30 days/);
  assert.deepEqual(splitMismatch(split), []);
  assert.equal(split.combined.month, 9173.02);
  const dropped = { ...split, personal: { ...split.personal, month: split.personal.month - 12.5 } };
  assert.deepEqual(splitMismatch(dropped), ['month']);
});

test('no feed: the page says so and shows no made-up figure', () => {
  assert.equal(expenseSplit({}, TODAY), null);
  const html = renderMoney(d2(null), null);
  assert.match(html, /RBC expenses/);
  assert.match(html, /No feed/);
});
