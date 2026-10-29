import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayBankScan } from '../src/money.js';

test('bank scan rows name each account and show a failed scan as Failed', () => {
  const page = {};
  const data = JSON.stringify({ accounts: [
    { id: 'rbc-business', title: 'RBC business accounts', scanned: 0, total: 4, status: 'failed' },
    { id: 'rbc-personal', title: 'Personal accounts', status: 'needs_code' },
  ] });
  overlayBankScan(page, { data, collected_at: '2026-10-29T15:00:07Z' }, Date.parse('2026-10-29T20:00:00Z'));
  assert.deepEqual(page.bankScan.rows.map((r) => [r.title, r.pill, r.pillCls]),
    [['RBC business accounts', 'Failed', 'crit'], ['Personal accounts', 'Needs code', 'risk']]);
  assert.equal(page.bankScan.meta, '0 of 2 accounts done');
});
