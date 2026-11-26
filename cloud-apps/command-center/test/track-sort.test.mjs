// /track click-to-sort (card t_b5f61b3767414d44): numbers as numbers, dates as dates, blanks last, direction flips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellKey, compareCells, sortRows, SORT_JS } from '../src/tablesort.js';
import { trackerPage } from '../src/skool.js';

// Each case: [column values, dir, expected order]. A plain string sort gets every one wrong.
const CASES = [
  [['99', '1,234', '5'], 1, ['5', '99', '1,234']], // "1,234" > "99" as numbers
  [['$9.50', '$10.00', '$100'], -1, ['$100', '$10.00', '$9.50']],
  [['9.5%', '10.0%', '–'], -1, ['10.0%', '9.5%', '–']],
  [['2026-11-02', '2025-12-31', '2026-10-15'], 1, ['2025-12-31', '2026-10-15', '2026-11-02']],
  [['2026-11-20 09:05 UTC', '2026-11-20 14:30 UTC', '2026-11-19 23:59 UTC'], -1, ['2026-11-20 14:30 UTC', '2026-11-20 09:05 UTC', '2026-11-19 23:59 UTC']],
  [['', '3', '–', '12'], 1, ['3', '12', '', '–']], // blanks last ascending
  [['', '3', '–', '12'], -1, ['12', '3', '', '–']], // and descending
  [['beta', 'Alpha', 'gamma'], 1, ['Alpha', 'beta', 'gamma']], // case-insensitive
  [['beta', 'Alpha', 'gamma'], -1, ['gamma', 'beta', 'Alpha']],
];
const failures = (cmp) => CASES.filter(([vals, dir, want]) => {
  const got = vals.map((v) => [v]).sort((a, b) => cmp(a[0], b[0], dir)).map((r) => r[0]);
  return JSON.stringify(got) !== JSON.stringify(want);
}).length;
const naive = (a, b, dir) => (a < b ? -1 : a > b ? 1 : 0) * dir;

test('planted fault: a naive string sort fails the cases, compareCells passes them all', () => {
  assert.ok(failures(naive) >= 5, `naive sort should fail most cases, failed ${failures(naive)}`);
  assert.equal(failures(compareCells), 0);
});

test('cellKey types', () => {
  assert.deepEqual(cellKey('1,234'), { t: 1, v: 1234 });
  assert.deepEqual(cellKey('–'), { t: 0, v: null });
  assert.equal(cellKey('2026-11-20').t, 2);
  assert.deepEqual(cellKey('Neon'), { t: 3, v: 'neon' });
});

test('sortRows sorts by column and is stable', () => {
  const rows = [['a', '5'], ['b', '1,000'], ['c', ''], ['d', '5']];
  assert.deepEqual(sortRows(rows, 1, -1).map((r) => r[0]), ['b', 'a', 'd', 'c']);
  assert.deepEqual(sortRows(rows, 1, 1).map((r) => r[0]), ['a', 'd', 'b', 'c']);
});

test('/track page: both tables sortable, Added date column, sales sort by total, script compiles', () => {
  const html = trackerPage({ rows: [{ slug: 'neon', title: 'Neon', youtube_url: null, created_at: '2026-11-20T10:00:00Z', capture: true, emails: 2,
    clicks: { d7: 1, d30: 2, all: 3 }, sales: 1, estimated: 2, conversion: 1 }], sales: [], unattributed: 0, since: null }, 'https://jonmac.ai');
  assert.equal((html.match(/class="sortable"/g) || []).length, 2);
  assert.match(html, /<th>Added<\/th>/);
  assert.match(html, /<td>2026-11-20<\/td>/);
  assert.match(html, /data-sort="3"/);
  assert.match(html, /data-col="1" data-dir="-1"/); // default: newest added first
  assert.ok(html.includes(SORT_JS));
  assert.doesNotThrow(() => new Function(SORT_JS.replace(/\(function wireSort[\s\S]*$/, '')));
});

test('browser script: click sorts, click again flips, arrow shows, choice kept for the next load', () => {
  const store = {};
  const cell = (t) => ({ textContent: t, dataset: {} });
  const mkTable = () => {
    const ths = ['Video', 'Clicks 7d'].map((t, i) => ({ textContent: t, dataset: {}, classList: { contains: (c) => c === 'n' && i === 1 }, setAttribute() {} }));
    const rows = [['a', '99'], ['b', '1,234'], ['c', '–'], ['d', '5']].map((r) => ({ id: r[0], cells: r.map(cell) }));
    const body = { get rows() { return rows.slice(); }, appendChild(r) { rows.splice(rows.indexOf(r), 1); rows.push(r); } };
    return { id: 'links', dataset: { col: '0', dir: '-1' }, tHead: { rows: [{ cells: ths }] }, tBodies: [body], ths, order: () => rows.map((r) => r.id).join('') };
  };
  const run = (tbl) => new Function('document', 'localStorage', SORT_JS)(
    { querySelectorAll: () => [tbl] }, { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } });
  const t = mkTable(); run(t);
  assert.equal(t.order(), 'dcba'); // default column 0, descending
  t.ths[1].onclick();
  assert.equal(t.order(), 'badc'); // numeric column starts high to low, dash last
  assert.equal(t.ths[1].dataset.arrow, ' ▼');
  t.ths[1].onclick();
  assert.equal(t.order(), 'dabc');
  assert.equal(t.ths[1].dataset.arrow, ' ▲');
  assert.equal(t.ths[0].dataset.arrow, '');
  const t2 = mkTable(); run(t2); // reload keeps the sort
  assert.equal(t2.order(), 'dabc');
});
