import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCash, cashTile } from '../src/cash.js';

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
