import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeSnapshot } from '../src/snapshot.js';
import { mrrTile } from '../src/now.js';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';
const now = Date.parse('2026-10-15T23:00:00Z');
const at = new Date(now - 60000).toISOString();

test('home now-block uses live slices and says no data when they are missing', () => {
  const empty = mergeSnapshot(snapshot, [], now);
  const n = empty.pages.home.now;
  assert.equal(n.needsJon.available, false);
  assert.equal(n.ready.available, false);
  assert.equal(n.tiles[1].value, 'no data');
  assert.equal(n.tiles[2].value, 'no data');
  assert.equal(n.tiles[3].value, 'no data');
  const live = mergeSnapshot(snapshot, [
    { source: 'needs_jon', collected_at: at, data: JSON.stringify({ ok: true, updated: 'Updated today', items: [{ area: 'GitHub', ask: 'Confirm the charge' }] }) },
    { source: 'viralview', collected_at: at, data: JSON.stringify({ subscriptions: { current: { mrrCents: 28400, activeCustomers: 6 } } }) },
  ], now);
  assert.equal(live.pages.home.now.needsJon.items[0].area, 'GitHub');
  assert.equal(live.pages.home.now.tiles[2].value, '$284');
  assert.equal(live.pages.home.now.tiles[2].pct, 3);
});

test('MRR tile goes stale with its feed', () => {
  const t = mrrTile({ collected_at: new Date(now - 3 * 3600000).toISOString(), data: { subscriptions: { current: { mrrCents: 500000 } } } }, now, 600000);
  assert.equal(t.stale, true);
  assert.equal(t.pct, 50);
});

test('Waiting On You parser keeps numbered asks and drops emails', () => {
  const code = 'import json, sys\nsys.path.insert(0, "collectors/gpu2/sources")\nimport needs_jon\nprint(json.dumps(needs_jon.parse(chr(10).join(["# Waiting On You", "Updated 2026-10-15 14:34 PT", "1. Namecheap - Confirm the alert", "2. Reply to bob@example.com today", "Ana-owned: not for Jon"]))))';
  const r = spawnSync(py, ['-c', code], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, r.stderr);
  const [updated, items] = JSON.parse(r.stdout);
  assert.equal(updated, 'Updated 2026-10-15 14:34 PT');
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { area: 'Namecheap', ask: 'Confirm the alert' });
  assert.ok(!items[1].ask.includes('@'));
});

test('nav lists the live pages and hides the rest under Archive', async () => {
  const { liveNav } = await import('../src/api.js');
  const nav = liveNav(snapshot.nav);
  const main = nav.groups.filter((g) => !g.archive).flatMap((g) => g.items.map((i) => i.label));
  assert.deepEqual(main, ['Home', 'Machines & Agents', 'Videos', 'Webinar', 'Sponsors', 'Viral View', 'Money', 'Life']);
  const archived = nav.groups.find((g) => g.archive).items.map((i) => i.id);
  for (const id of ['mastermind', 'markets', 'outreach', 'content', 'youtube', 'video', 'support']) assert.ok(archived.includes(id), id);
  for (const g of nav.groups) for (const i of g.items) assert.ok(snapshot.pages[i.id] || ['videos', 'webinar'].includes(i.id), i.id);
});
