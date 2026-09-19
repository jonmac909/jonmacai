import test from 'node:test';
import assert from 'node:assert/strict';
import { freshness, mergeSnapshot } from '../src/snapshot.js';

const INTERVAL = 5 * 60 * 1000;
const now = Date.parse('2026-09-18T18:00:00Z');

test('heartbeat is fresh inside 3x the 5-minute schedule', () => {
  const f = freshness('2026-09-18T17:46:00Z', now, INTERVAL);
  assert.equal(f.stale, false);
  assert.equal(f.label, 'updated 14 min ago');
});

test('heartbeat is stale when older than 3x the 5-minute schedule', () => {
  const f = freshness('2026-09-18T17:44:59Z', now, INTERVAL);
  assert.equal(f.stale, true);
  assert.equal(f.label, 'updated 15 min ago');
});

test('merge overlays live machine heartbeats and keeps fixture pages', () => {
  const fixture = {
    nav: { brand: 'Jon Mac' },
    goal: { pct: 50 },
    sources: { sponsors: { updatedAt: '2026-09-16T00:00:00-07:00' }, agents_mac: { updatedAt: 'old' } },
    pages: {
      home: { tiles: [{ value: '$5,000' }] },
      agents: { title: 'Agents', tiles: [{ label: 'Need you' }], waiting: { jobs: [] }, all: { rows: [] } },
    },
  };
  const rows = [{
    source: 'agents_mac',
    data: JSON.stringify({ machine: 'mac', hostname: 'mini.local', ok: true }),
    collected_at: '2026-09-18T17:58:00Z',
    received_at: '2026-09-18T17:58:01Z',
  }, {
    source: 'agents_gpu2',
    data: JSON.stringify({ machine: 'gpu2', hostname: 'gpu2', ok: true }),
    collected_at: '2026-09-18T17:40:00Z',
    received_at: '2026-09-18T17:40:01Z',
  }];
  const out = mergeSnapshot(fixture, rows, now);
  assert.equal(out.pages.home.tiles[0].value, '$5,000');
  assert.equal(out.pages.agents.title, 'Agents');
  assert.equal(out.sources.sponsors.updatedAt, '2026-09-16T00:00:00-07:00');
  assert.equal(out.sources.agents_mac.updatedAt, '2026-09-18T17:58:00Z');
  assert.equal(out.sources.agents_mac.stale, false);
  assert.equal(out.sources.agents_gpu2.stale, true);
  const mac = out.pages.agents.machines.find((m) => m.id === 'mac');
  const gpu = out.pages.agents.machines.find((m) => m.id === 'gpu2');
  assert.equal(mac.stale, false);
  assert.equal(mac.hostname, 'mini.local');
  assert.equal(gpu.stale, true);
  assert.equal(gpu.ageLabel, 'updated 20 min ago');
  assert.deepEqual(out.pages.agents.staleSources.map((s) => s.source), ['agents_gpu2']);
});
