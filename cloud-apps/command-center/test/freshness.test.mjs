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

test('merge marks each source fresh or stale by its schedule and keeps fixture pages', () => {
  const fixture = {
    nav: { brand: 'Jon Mac' },
    sources: { sponsors: { updatedAt: '2026-09-16T00:00:00-07:00' } },
    pages: { sponsors: { title: 'Sponsors' } },
  };
  const rows = [
    { source: 'machine_gpu1', data: '{}', collected_at: '2026-09-18T17:58:00Z', received_at: '2026-09-18T17:58:01Z' },
    { source: 'machine_gpu2', data: '{}', collected_at: '2026-09-18T17:40:00Z', received_at: '2026-09-18T17:40:01Z' },
  ];
  const out = mergeSnapshot(fixture, rows, now);
  assert.equal(out.pages.sponsors.title, 'Sponsors');
  assert.equal(out.sources.sponsors.updatedAt, '2026-09-16T00:00:00-07:00');
  assert.deepEqual(out.sources.machine_gpu1, { updatedAt: '2026-09-18T17:58:00Z', stale: false, ageLabel: 'updated 2 min ago' });
  assert.deepEqual(out.sources.machine_gpu2, { updatedAt: '2026-09-18T17:40:00Z', stale: true, ageLabel: 'updated 20 min ago' });
});
