import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overlayWebinar, listFunnel } from '../src/webinar.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';
const now = Date.parse('2026-10-15T23:00:00Z');

test('countdown, buyers and upsells come from the clone funnel', () => {
  const p = overlayWebinar({}, { buyers: 2, upsells: [{ offer: 'audit', state: 'charged', n: 1 }, { offer: 'audit', state: 'fallback', n: 2 }], sessions: [{ session_label: 'Wednesday, October 7, 2026 at 7:00 PM EDT', n: 1 }] }, now);
  assert.equal(p.sub, 'Thu Oct 29 · 4 PM PT · jonmac.ai/clone');
  assert.deepEqual(p.tiles.map((t) => t.value), ['14d 0h', '2']);
  assert.deepEqual(p.sales.rows, [{ name: '$497 audit', charged: 1, hosted: 2 }]);
  assert.equal('checklist' in p, false);
});

test('no funnel database shows no data', () => {
  const p = overlayWebinar({}, null, now);
  assert.equal(p.sales.available, false);
  assert.equal(p.tiles[1].value, 'no data');
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
