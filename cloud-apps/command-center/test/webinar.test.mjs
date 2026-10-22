import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overlayWebinar, listFunnel } from '../src/webinar.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';
const now = Date.parse('2026-10-15T23:00:00Z');

const row = { collected_at: '2026-10-15T22:55:00Z', data: JSON.stringify({ ok: true, items: {
  stress: { status: 'fail', at: '2026-10-15T22:52:07Z', buyers: 10, charges: 30, charged: 11, offers: [{ offer: 'audit', firstTry: 0, retried: 0, refused: 10 }] },
  trial: { status: 'pass', at: '2026-10-15T22:52:07Z', note: '$1 trial charged one-click 5 of 5 in the stress run' },
} }) };

test('countdown and checklist come from results, missing items say no result', () => {
  const p = overlayWebinar({}, row, { buyers: 0, upsells: [], sessions: [{ session_label: 'Wednesday, October 7, 2026 at 7:00 PM EDT', n: 1 }] }, now, 'updated 5 min ago');
  assert.equal(p.countdown, '14d 0h');
  assert.equal(p.checklist[0].status, 'fail');
  assert.match(p.checklist[0].note, /11 of 30 one-click charges/);
  assert.equal(p.checklist[1].status, 'pass');
  assert.equal(p.checklist[2].status, 'pending');
  assert.match(p.checklist[2].note, /0 buyers assigned to Oct 29/);
  assert.equal(p.checklist[3].status, 'none');
  assert.equal(p.green, '1 of 5 green');
  assert.equal(p.sales.buyers, 0);
});

test('no feed and no funnel database show no data', () => {
  const p = overlayWebinar({}, null, null, now, '');
  assert.equal(p.stale, true);
  assert.equal(p.sales.available, false);
  assert.equal(p.tiles[2].value, 'no data');
  assert.ok(p.checklist.every((c) => c.status === 'none'));
});

test('funnel reader only asks for counts', async () => {
  const seen = [];
  const db = { prepare(sql) { seen.push(sql); return { first: async () => ({ n: 2, last: 1 }), all: async () => ({ results: [{ offer: 'audit', state: 'charged', n: 1 }] }) }; } };
  const f = await listFunnel(db);
  assert.equal(f.buyers, 2);
  assert.ok(seen.every((s) => /count\(\*\)/.test(s) && !/email/.test(s)));
});

test('stress log parser counts first-try, retried and refused per offer', () => {
  const code = 'import json, webinar_results as w\nprint(json.dumps(w.parse_stress(chr(10).join(["STRESS stress 1: software=first-try audit=REFUSED", "noise", "STRESS stress 2: trial=retry-1 audit=first-try"]))))';
  const r = spawnSync(py, ['-c', code], { encoding: 'utf8', cwd: join(root, 'collectors/lib') });
  assert.equal(r.status, 0, r.stderr);
  const [runs, offers] = JSON.parse(r.stdout);
  assert.equal(runs, 2);
  assert.deepEqual(offers.find((o) => o.offer === 'audit'), { offer: 'audit', firstTry: 1, retried: 0, refused: 1 });
  assert.equal(offers.find((o) => o.offer === 'trial').retried, 1);
});
