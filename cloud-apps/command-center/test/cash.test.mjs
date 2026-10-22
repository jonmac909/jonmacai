import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCash, cashTile, usdExact, LEDGER_STALE_DAYS } from '../src/cash.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';
const now = Date.parse('2026-10-15T23:00:00Z');
const cash = { data: JSON.stringify({ rows: [
  { date: '2026-07-10', sponsor: 'Old', usd: 5000 },
  { date: '2026-08-19', sponsor: 'GetPoppy', usd: 2500 },
  { date: '2026-09-16', sponsor: 'GetPoppy', usd: 2500 },
  { date: '2026-09-20', sponsor: 'Hide', usd: null },
  { date: '2026-10-02', sponsor: 'Topview', usd: 734.37 },
] }) };
const sponsors = { data: JSON.stringify({ sourceEditedAt: 'Oct 3', collections: { items: [
  { sponsor: 'InVideo', owed: 4200, bucketLabel: 'Collect now', lastEmail: 'October 3, 2026' },
  { sponsor: 'Paid', owed: 0 },
  { sponsor: 'Coursiv', owed: 650 },
] } }) };

test('month cash and trailing 90-day average come from the ledger only', () => {
  const c = buildCash(cash, sponsors, now);
  assert.equal(c.month.label, 'October');
  assert.equal(c.month.usd, 734.37);
  assert.equal(c.trailing.total, 5734.37);
  assert.equal(Math.round(c.trailing.avg), 1911);
  assert.equal(c.trailing.unknown, 1);
  assert.equal(c.pct, 19);
  assert.deepEqual(c.unpaid.map((u) => u.sponsor), ['InVideo', 'Coursiv']);
  assert.equal(c.unpaid[0].due, null);
  assert.equal(c.owed, 4850);
});

test('no ledger means no data, not a number', () => {
  const c = buildCash(null, null, now);
  assert.equal(c.available, false);
  assert.equal(cashTile(c).value, 'no data');
  assert.equal(c.unpaidAvailable, false);
});

test('collector drops the evidence column', () => {
  const code = 'import json, os, tempfile, sys\nsys.path.insert(0, "collectors/gpu2/sources")\np = os.path.join(tempfile.mkdtemp(), "l.csv")\nopen(p, "w").write(chr(10).join(["date,sponsor,invoice,amount_usd,amount_cad,evidence,status", "2026-10-02,Topview,1070,734.37,,RBC USD deposit acct 1234,Observed", "2026-08-12,Eezy,,,,fee row,Observed"]))\nimport cash\nprint(json.dumps(cash.read_ledger(p)))';
  const r = spawnSync(py, ['-c', code], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  assert.equal(rows[0].usd, 734.37);
  assert.equal(rows[1].usd, null);
  assert.ok(!JSON.stringify(rows).includes('RBC'));
});

test('Coursiv and GoLogin are never counted or shown', async () => {
  const { mergeSnapshot } = await import('../src/snapshot.js');
  const snap = (await import('../fixtures/snapshot.json', { with: { type: 'json' } })).default;
  const out = mergeSnapshot(snap, [
    { source: 'sponsors_cash', collected_at: new Date(now).toISOString(), data: JSON.stringify({ rows: [{ date: '2026-10-05', sponsor: 'Coursiv', usd: 650 }, { date: '2026-10-02', sponsor: 'Topview', usd: 734.37 }] }) },
    { source: 'sponsors', collected_at: new Date(now).toISOString(), data: JSON.stringify({ collections: { items: [
      { sponsor: 'InVideo', total: 4200, paid: 0, owed: 4200, month: 'October', bucket: 'collect-now' },
      { sponsor: 'Viktor (Softstory)', total: 2000, paid: 1000, owed: 1000, month: 'October', bucket: 'delivery-balance' },
      { sponsor: 'Coursiv', total: 650, paid: 0, owed: 650, month: 'October', bucket: 'collect-now' },
      { sponsor: 'GoLogin', total: 900, paid: 0, owed: 900, month: 'October', bucket: 'collect-now' },
    ], incomeTotals: {}, incomeLabels: {} }, cards: [{ id: 'g', sponsor: 'Gologin', contact: 'Kyle', stage: 'drafts' }] }) },
  ], now);
  const c = out.pages.sponsors.cash;
  assert.deepEqual(c.unpaid.map((u) => [u.sponsor, u.owed]), [['InVideo', 4200], ['Viktor (Softstory)', 1000]]);
  assert.equal(c.month.usd, 734.37);
  assert.equal(/coursiv|gologin/i.test(JSON.stringify(out.pages)), false);
});

// Oct 22, 2026 11:00 Pacific. Jon's rule: sponsor income is every deposit into the RBC USD account.
const oct22 = Date.parse('2026-10-22T18:00:00Z');
const octoberDeposits = [
  { date: '2026-09-16', sponsor: 'GetPoppy', usd: 2500 },
  { date: '2026-10-02', sponsor: 'Topview', usd: 734.37 },
  { date: '2026-10-16', sponsor: 'Topview', usd: 1984.38 },
  { date: '2026-10-16', sponsor: 'InVideo', usd: 4200 },
  { date: '2026-10-16', sponsor: 'Commas (Divisible payout)', usd: 970 },
  { date: '2026-10-19', sponsor: 'Schalumov (Viktor)', usd: 1000 },
];
const ledgerRow = (rows, ledgerEditedAt) => ({ collected_at: new Date(oct22).toISOString(), data: JSON.stringify({ rows, ledgerEditedAt }) });
const moneyRow = (income, collectedAt = new Date(oct22).toISOString()) => ({ collected_at: collectedAt, data: JSON.stringify({ asOf: '2026-10-21', income }) });

test('October sponsor income is every deposit, cents kept, Commas payout included', () => {
  const c = buildCash(ledgerRow(octoberDeposits, '2026-10-22T18:00:00Z'), null, oct22);
  assert.equal(c.month.usd, 8888.75);
  assert.equal(c.month.payments, 5);
  assert.equal(c.pct, 38);
  assert.equal(usdExact(c.month.usd), '$8,888.75');
  assert.equal(usdExact(2500), '$2,500');
  assert.match(cashTile(c).sub, /October: \$8,888\.75 received/);
  assert.equal(c.recent[0].sponsor, 'Schalumov (Viktor)');
});

test('a ledger nobody has edited for days is flagged stale, a fresh one is not', () => {
  const stale = buildCash(ledgerRow(octoberDeposits.slice(0, 2), '2026-10-15T18:00:00Z'), null, oct22);
  assert.equal(stale.source.kind, 'ledger');
  assert.equal(stale.source.stale, true);
  assert.match(stale.source.label, /Oct 15/);
  assert.match(stale.source.note, /not counted/);
  assert.match(cashTile(stale).sub, /\(stale\)$/);
  const fresh = buildCash(ledgerRow(octoberDeposits, new Date(oct22 - (LEDGER_STALE_DAYS - 1) * 86400000).toISOString()), null, oct22);
  assert.equal(fresh.source.stale, false);
  assert.equal(fresh.source.note, '');
  const unknown = buildCash(ledgerRow(octoberDeposits, null), null, oct22);
  assert.equal(unknown.source.stale, true);
  assert.match(unknown.source.note, /did not report/);
});

test('the bank feed wins for the dates it covers and the ledger fills the rest', () => {
  const ledger = ledgerRow([
    ...octoberDeposits,
    { date: '2026-10-22', sponsor: 'Hand entry', usd: 500 },
  ], '2026-10-22T18:00:00Z');
  const bank = moneyRow({
    since: '2026-10-01',
    asOf: '2026-10-21',
    deposits: [
      { date: '2026-10-02', amount: 734.37, description: 'TOPVIEW PTE. LTD. 123456789' },
      { date: '2026-10-16', amount: 1984.38, description: 'TOPVIEW PTE. LTD.' },
      { date: '2026-10-16', amount: 4200, description: 'INVIDEO INC' },
      { date: '2026-10-16', amount: 970, description: 'DIVISIBLE' },
      { date: '2026-10-19', amount: 1000, description: 'SCHALUMOV' },
      { date: '2026-10-20', amount: 25, description: 'Unmatched credit' },
      { date: '2026-10-21', amount: -40, description: 'A debit never counts' },
      { date: '2026-09-30', amount: 99, description: 'Before the window' },
    ],
  });
  const c = buildCash(ledger, null, oct22, bank);
  assert.equal(c.source.kind, 'bank');
  assert.match(c.source.label, /RBC USD feed through Oct 21/);
  assert.equal(c.source.stale, false);
  assert.equal(c.month.usd, 8888.75 + 25 + 500);
  assert.equal(c.month.payments, 7);
  assert.equal(c.recent.some((r) => /123456789/.test(r.sponsor)), false);
  assert.equal(c.recent.find((r) => r.sponsor === 'Hand entry').date, '2026-10-22');
  assert.equal(c.recent.filter((r) => r.usd === 4200).length, 1);
});

test('a bank feed with no coverage window is ignored, and a stale one is flagged', () => {
  const ledger = ledgerRow(octoberDeposits, '2026-10-22T18:00:00Z');
  const loose = buildCash(ledger, null, oct22, moneyRow({ deposits: [{ date: '2026-10-20', amount: 999, description: 'X' }] }));
  assert.equal(loose.source.kind, 'ledger');
  assert.equal(loose.month.usd, 8888.75);
  const old = moneyRow({ since: '2026-10-01', asOf: '2026-10-14', deposits: [{ date: '2026-10-02', amount: 734.37, description: 'TOPVIEW' }] });
  const c = buildCash(ledger, null, oct22, old);
  assert.equal(c.source.kind, 'bank');
  assert.equal(c.source.stale, true);
  assert.match(c.source.note, /last synced Oct 14/);
  assert.equal(c.month.usd, 8888.75);
  const bankOnly = buildCash(null, null, oct22, old);
  assert.equal(bankOnly.available, true);
  assert.equal(bankOnly.month.usd, 734.37);
});

test('a bank feed cannot vouch for days that have not happened, and keeps excluded payers out', () => {
  const ledger = ledgerRow(octoberDeposits, '2026-10-22T18:00:00Z');
  const skewed = moneyRow({
    since: '2026-10-01',
    asOf: '2026-10-25',
    deposits: [
      { date: '2026-10-02', amount: 734.37, description: 'TOPVIEW PTE. LTD.' },
      { date: '2026-10-05', amount: 650, description: `REF 1234567 ${'X'.repeat(70)} COURSIV` },
      { date: '2026-10-23', amount: 5000, description: 'FUTURE DATED' },
    ],
  });
  const c = buildCash(ledger, null, oct22, skewed);
  assert.equal(c.source.kind, 'bank');
  assert.match(c.source.label, /through Oct 22/);
  assert.equal(c.month.usd, 734.37);
  assert.equal(c.month.payments, 1);
  const past = buildCash(ledger, null, oct22, moneyRow({ since: '2026-10-24', asOf: '2026-10-25', deposits: [] }));
  assert.equal(past.source.kind, 'ledger');
  assert.equal(past.month.usd, 8888.75);
});

test('the month table always holds every deposit of the month', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ date: `2026-10-${String((i % 22) + 1).padStart(2, '0')}`, sponsor: `Payer ${i}`, usd: 10 }));
  const c = buildCash(ledgerRow(rows, '2026-10-22T18:00:00Z'), null, oct22);
  assert.equal(c.month.payments, 45);
  assert.equal(c.recent.filter((r) => r.date.startsWith(c.month.key)).length, 45);
  assert.equal(c.recent.reduce((n, r) => n + r.usd, 0), c.month.usd);
});

test('what Jon saw on Oct 22 now says the ledger is stale', async () => {
  const { mergeSnapshot } = await import('../src/snapshot.js');
  const snap = (await import('../fixtures/snapshot.json', { with: { type: 'json' } })).default;
  const stale = ledgerRow([
    { date: '2026-10-02', sponsor: 'Topview', usd: 734.37 },
    { date: '2026-10-15', sponsor: 'Commas payout', usd: 1000 },
  ], '2026-10-15T20:00:00Z');
  const out = mergeSnapshot(snap, [{ source: 'sponsors_cash', ...stale }], oct22);
  const card = out.pages.home.goalCards.find((g) => g.key === 'sponsors');
  assert.equal(card.value, '$1,734.37');
  assert.match(card.warn, /Nobody has updated the deposit ledger since Oct 15/);
  assert.match(card.drivers.find((d) => d.label === 'Counted from').value, /stale/);
  const strip = out.pages.home.strip.find((s) => /^Cash in/.test(s.label));
  assert.equal(strip.pill, 'Stale');
  assert.equal(out.pages.sponsors.cash.source.stale, true);
});

test('every surface shows the same October total from the deposit ledger', async () => {
  const { mergeSnapshot } = await import('../src/snapshot.js');
  const snap = (await import('../fixtures/snapshot.json', { with: { type: 'json' } })).default;
  const out = mergeSnapshot(snap, [
    { source: 'sponsors_cash', ...ledgerRow(octoberDeposits, '2026-10-22T17:00:00Z') },
    { source: 'sponsors', collected_at: new Date(oct22).toISOString(), data: JSON.stringify({
      collections: { currentIncomeMonth: 'October', incomeTotals: { September: 6606.63, October: 750 }, completedIncomeMonths: ['September'], items: [
        { sponsor: 'InVideo', total: 4200, paid: 4200, owed: 0, month: 'October', bucket: 'collect-now' },
      ] },
      cards: [],
    }) },
  ], oct22);
  const card = out.pages.home.goalCards.find((g) => g.key === 'sponsors');
  assert.equal(card.value, '$8,888.75');
  assert.equal(card.pct, 89);
  assert.equal(card.warn, '');
  assert.equal(out.pages.sponsors.tiles[0].value, '$8,888.75');
  assert.equal(out.pages.sponsors.tiles[0].label, 'Collected in October');
  assert.equal(out.pages.sponsors.byMonth.rows.at(-1).label, 'October so far');
  assert.equal(out.pages.sponsors.byMonth.rows.at(-1).value, '$8,888.75');
  assert.equal(out.pages.home.strip.find((s) => /^Cash in/.test(s.label)).value, '$8,888.75');
  assert.equal(out.pages.home.moved.items[0].pill, '+$8,154.38');
  assert.match(out.pages.home.tiles[0].sub, /^\$0 more is owed · All deposits/);
});

test('a missing or empty ledger is no data, so the recorded totals still show', async () => {
  const { mergeSnapshot } = await import('../src/snapshot.js');
  const snap = (await import('../fixtures/snapshot.json', { with: { type: 'json' } })).default;
  const out = mergeSnapshot(snap, [
    { source: 'sponsors_cash', collected_at: new Date(oct22).toISOString(), data: JSON.stringify({ ok: false, error: 'cash ledger not found', rows: [] }) },
    { source: 'sponsors', collected_at: new Date(oct22).toISOString(), data: JSON.stringify({
      collections: { currentIncomeMonth: 'October', incomeTotals: { October: 750 }, completedIncomeMonths: [], items: [] },
      cards: [],
    }) },
  ], oct22);
  assert.equal(out.pages.sponsors.cash.available, false);
  assert.equal(out.pages.sponsors.basis, 'source');
  assert.equal(out.pages.sponsors.tiles[0].value, '$750');
  assert.match(out.pages.sponsors.tiles[0].sub, /^Recorded source total/);
  assert.notEqual(out.pages.home.goalCards.find((g) => g.key === 'sponsors').value, '$0');
});

test('a deposit dated later this month waits until it happens', () => {
  const c = buildCash(ledgerRow([
    { date: '2026-10-02', sponsor: 'Topview', usd: 734.37 },
    { date: '2026-10-30', sponsor: 'Expected wire', usd: 1000 },
  ], '2026-10-22T18:00:00Z'), null, oct22);
  assert.equal(c.month.usd, 734.37);
  assert.equal(c.month.payments, 1);
  assert.equal(c.recent.filter((r) => r.date.startsWith(c.month.key)).length, 1);
});

test('a fresh bank feed still warns when a stale ledger supplies part of the month', () => {
  const ledger = ledgerRow([{ date: '2026-10-02', sponsor: 'Topview', usd: 734.37 }], '2026-10-10T18:00:00Z');
  const midMonth = moneyRow({ since: '2026-10-15', asOf: '2026-10-21', deposits: [{ date: '2026-10-16', amount: 4200, description: 'INVIDEO INC' }] });
  const c = buildCash(ledger, null, oct22, midMonth);
  assert.equal(c.source.kind, 'bank');
  assert.equal(c.source.stale, true);
  assert.match(c.source.note, /supplies this month through Oct 15/);
  assert.equal(c.month.usd, 4934.37);
  const fromDayOne = moneyRow({ since: '2026-10-01', asOf: '2026-10-21', deposits: [{ date: '2026-10-02', amount: 734.37, description: 'TOPVIEW' }] });
  const fresh = buildCash(ledger, null, oct22, fromDayOne);
  assert.equal(fresh.source.stale, false);
  assert.equal(fresh.source.note, '');
});

test('a feed with an impossible date is ignored instead of printing Invalid Date', () => {
  const c = buildCash(ledgerRow(octoberDeposits, '2026-10-22T18:00:00Z'), null, oct22, moneyRow({ since: '2026-10-01', asOf: '2026-04-99', deposits: [] }));
  assert.equal(c.source.kind, 'ledger');
  assert.equal(c.month.usd, 8888.75);
});

test('the Content page counts the same merged deposits as Home', async () => {
  const { mergeSnapshot } = await import('../src/snapshot.js');
  const snap = (await import('../fixtures/snapshot.json', { with: { type: 'json' } })).default;
  const out = mergeSnapshot(snap, [
    { source: 'sponsors_cash', ...ledgerRow(octoberDeposits, '2026-10-22T17:00:00Z') },
    { source: 'viralview', collected_at: new Date(oct22).toISOString(), data: JSON.stringify({ cashThisWeek: { netCents: 0, byDay: [{ date: '2026-10-16' }, { date: '2026-10-19' }] } }) },
  ], oct22);
  const step = out.pages.content.factory.funnel.steps.find((s) => s.label === 'New revenue this week');
  assert.equal(step.sub, 'Viral View $0.00 + sponsors $8,154.38');
});
