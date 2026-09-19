import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayBankScan, scrubBankScan } from '../src/bank-scan.js';
import { claimQueued, insertAction, upsertSnapshot, listSnapshots } from '../src/db.js';
import { mergeSnapshot } from '../src/snapshot.js';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import { memD1 } from './memd1.mjs';

const NOW = Date.parse('2026-09-18T15:04:00Z');

const LIVE = {
  accounts: [
    { id: 'rbc-business', title: 'RBC business accounts', scanned: 3, total: 4, status: 'needs_code', since: '2026-09-18T15:00:00Z' },
    { id: 'rbc-personal', title: 'Personal accounts', scanned: 3, total: 3, status: 'scanned' },
  ],
};

test('overlay maps needs_code to Enter code without copying secrets', () => {
  const page = overlayBankScan(structuredClone(snapshot.pages.money), LIVE, '2026-09-18T15:01:00Z', NOW);
  assert.equal(page.bankScan.rows[0].btn, 'Enter code');
  assert.equal(page.bankScan.rows[0].kind, 'bank.submit_code');
  assert.equal(page.bankScan.rows[0].payload.account, 'rbc-business');
  assert.equal(page.bankScan.rows[0].payload.code, undefined);
  assert.equal(page.bankScan.rows[1].btn, undefined);
  assert.equal(page.actions.some((a) => a.kind === 'bank.scan_now'), true);
  const dump = JSON.stringify(page);
  assert.equal(dump.includes('password'), false);
  assert.equal(/"code":/.test(dump), false);
});

test('overlay maps code_expired to Try again', () => {
  const data = {
    accounts: [{ id: 'rbc-business', title: 'RBC business accounts', scanned: 0, total: 4, status: 'code_expired' }],
  };
  const page = overlayBankScan(structuredClone(snapshot.pages.money), data, '2026-09-18T15:06:00Z', NOW);
  assert.equal(page.bankScan.rows[0].btn, 'Try again');
  assert.equal(page.bankScan.rows[0].kind, 'bank.scan_now');
  assert.equal(page.bankScan.rows[0].payload.account, 'rbc-business');
});

test('scrubBankScan drops password and code before ingest', () => {
  const clean = scrubBankScan({
    password: 'nope',
    code: '123456',
    accounts: [{ id: 'rbc-business', title: 'RBC', password: 'x', code: '999', status: 'needs_code', scanned: 1, total: 4 }],
  });
  const dump = JSON.stringify(clean);
  assert.equal(dump.includes('nope'), false);
  assert.equal(dump.includes('123456'), false);
  assert.equal(dump.includes('999'), false);
  assert.equal(clean.accounts[0].status, 'needs_code');
});

test('default claim skips bank.submit_code', async () => {
  const db = memD1();
  await insertAction(db, {
    id: 'b1', kind: 'bank.submit_code', target: 'mac', status: 'queued',
    payload: JSON.stringify({ code: '123456' }), result: null, idem_key: null,
    created_at: 't', finished_at: null,
  });
  await insertAction(db, {
    id: 'p1', kind: 'ping', target: 'mac', status: 'queued',
    payload: '{}', result: null, idem_key: null, created_at: 't', finished_at: null,
  });
  const rows = await claimQueued(db, 'mac', 'now');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'ping');
  const stored = await db.prepare('SELECT * FROM actions WHERE id = ?').bind('b1').first();
  assert.equal(JSON.parse(stored.payload).code, '123456');
});

test('codes claim returns bank code then wipes storage', async () => {
  const db = memD1();
  await insertAction(db, {
    id: 'b1', kind: 'bank.submit_code', target: 'mac', status: 'queued',
    payload: JSON.stringify({ code: '123456' }), result: null, idem_key: null,
    created_at: 't', finished_at: null,
  });
  const rows = await claimQueued(db, 'mac', 'now', { codes: true });
  assert.equal(JSON.parse(rows[0].payload).code, '123456');
  const stored = await db.prepare('SELECT * FROM actions WHERE id = ?').bind('b1').first();
  assert.equal(stored.payload, '{}');
});

test('mergeSnapshot overlays live bank_scan onto money.bankScan', () => {
  const out = mergeSnapshot(snapshot, [{
    source: 'bank_scan',
    collected_at: '2026-09-18T15:01:00Z',
    data: JSON.stringify(LIVE),
  }], NOW);
  assert.equal(out.pages.money.bankScan.rows[0].kind, 'bank.submit_code');
  assert.equal(out.pages.money.bankScan.rows[0].btn, 'Enter code');
});

test('upsertSnapshot stores scrubbed bank_scan data', async () => {
  const db = memD1();
  const clean = scrubBankScan({ code: '111222', accounts: [{ id: 'x', title: 'X', status: 'scanned', scanned: 1, total: 1 }] });
  await upsertSnapshot(db, 'bank_scan', JSON.stringify(clean), 't1', 't1');
  const rows = await listSnapshots(db);
  assert.equal(JSON.stringify(rows[0].data).includes('111222'), false);
});
