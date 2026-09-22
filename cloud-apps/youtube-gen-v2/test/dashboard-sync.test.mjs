import test from 'node:test';
import assert from 'node:assert/strict';
import { handleYt2Api, youtubeSyncRecord } from '../api.js';

function memDb() {
  const projects = new Map();
  const snapshots = new Map();
  return {
    projects,
    snapshots,
    prepare(sql) {
      const s = String(sql);
      const stmt = {
        _args: [],
        bind(...args) { stmt._args = args; return stmt; },
        async first() {
          if (s.includes("source = 'youtube'")) return snapshots.get('youtube') || null;
          return null;
        },
        async run() {
          if (/DELETE FROM video_projects/.test(s)) throw new Error('sync must not delete projects');
          if (/INSERT OR REPLACE INTO snapshots/.test(s)) {
            snapshots.set(stmt._args[0], { data: stmt._args[1], collected_at: stmt._args[2] });
          }
          if (/INSERT OR REPLACE INTO video_projects/.test(s)) {
            projects.set(stmt._args[0], stmt._args[1]);
          }
        },
      };
      return stmt;
    },
  };
}

const rows = [
  { id: 'a', title: 'AI UGC ads', channel: 'One', outlier_score: 9, views: 100, views_per_day: 10 },
  { id: 'b', title: 'Talking head', channel: 'Two', outlier_score: 1, views: 10, views_per_day: 1 },
];

test('sync record keeps the live ranked count and timestamp', () => {
  const record = youtubeSyncRecord(rows, '2026-09-22T23:27:51.354Z', [{ id: 'ch1' }, { id: 'ch2' }]);
  assert.equal(record.ranked, 2);
  assert.equal(record.channels, 2);
  assert.equal(record.generatedAt, '2026-09-22T23:27:51.354Z');
  assert.equal(record.outliers.length, 1);
  assert.equal(record.outliers[0].title, 'AI UGC ads');
});

test('POST /api/sync refreshes the dashboard source without touching projects', async () => {
  const DB = memDb();
  DB.projects.set('keep-me', '{}');
  const res = await handleYt2Api(new Request('https://jonmac.ai/yt2/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-YT2': '1' },
    body: JSON.stringify({
      rows,
      generatedAt: '2026-09-22T23:27:51.354Z',
      refreshed: [{ id: 'ch1' }, { id: 'ch2' }],
    }),
  }), { DB });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ranked, 2);
  assert.equal(body.generatedAt, '2026-09-22T23:27:51.354Z');
  const stored = JSON.parse(DB.snapshots.get('youtube').data);
  assert.equal(stored.ranked, 2);
  assert.equal(DB.snapshots.get('youtube').collected_at, '2026-09-22T23:27:51.354Z');
  assert.equal(DB.projects.has('keep-me'), true);

  const outliers = await handleYt2Api(new Request('https://jonmac.ai/yt2/api/outliers'), { DB });
  const listed = await outliers.json();
  assert.equal(listed.ranked, 2);
  assert.equal(listed.generatedAt, '2026-09-22T23:27:51.354Z');
});
