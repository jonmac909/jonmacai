import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overlayVideos, heygenTile, stageIndex } from '../src/videos.js';
import { mergeSnapshot } from '../src/snapshot.js';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';
const now = Date.parse('2026-10-15T23:30:00Z');

const feed = {
  ok: true,
  updated: '2026-10-15T23:29:30Z',
  header: { heygenUsed: 9, heygenCap: 130 },
  rows: [
    { program: 'viralview', channel: 'Theo', host: 'Theo', video_no: 1, title: 'Seedance guide', stage: 'Ready for Jon', stage_pct: null, stage_started: '2026-10-15T21:00:00Z', cap_min: 240, eta: null, last_line: 'v6 page up', review_url: 'https://jonmac.ai/review/theo-1-v6', blocked_reason: null },
    { program: 'affiliate', channel: "Marco's Dog Sense", host: 'Marco', video_no: 1, title: null, stage: 'HeyGen', stage_pct: 40, stage_started: '2026-10-15T18:00:00Z', cap_min: 240, eta: '17:10', last_line: null, review_url: null, blocked_reason: null },
  ],
};
const reviews = [{ video: 'theo-1', version: 'v6', slug: 'theo-1-v6', status: 'needs_review', updated_at: '2026-10-15T20:56:28Z', open_comments: 2 }];

test('rows come straight from the production feed', () => {
  const p = overlayVideos({}, { data: feed }, reviews, now);
  assert.equal(p.stale, false);
  assert.equal(p.rows.length, 2);
  const theo = p.rows[0];
  assert.equal(theo.stageIdx, stageIndex('Ready for Jon'));
  assert.equal(theo.review.text, 'Waiting on Jon · v6 · 2 open comments');
  assert.equal(theo.inStage, 150);
  const marco = p.rows[1];
  assert.equal(marco.kind, 'affiliate');
  assert.equal(marco.target, 7);
  assert.equal(marco.overCap, true);
  assert.equal(marco.review.text, 'Not cleared yet');
  assert.equal(marco.lastLine, '');
  assert.deepEqual(p.ready.map((r) => r.channel), ['Theo']);
  assert.equal(p.tiles[2].value, '1');
  assert.equal(p.tiles[3].value, 'no data');
});

test('missing or old feed is stale with no data, never fixture numbers', () => {
  const none = overlayVideos({}, null, null, now);
  assert.equal(none.stale, true);
  assert.equal(none.rows.length, 0);
  assert.equal(none.heygen.value, 'no data');
  const missing = overlayVideos({}, { data: { ok: false, error: 'production feed not written yet', rows: [] } }, null, now);
  assert.match(missing.sub, /not written yet/);
  const old = overlayVideos({}, { data: { ...feed, updated: '2026-10-15T23:20:00Z' } }, null, now);
  assert.equal(old.stale, true);
  const merged = mergeSnapshot({ ...snapshot, pages: { ...snapshot.pages, videos: {} } }, [], now);
  assert.equal(merged.pages.videos.rows.length, 0);
});

test('HeyGen tile turns amber at 80 and red at 100', () => {
  assert.equal(heygenTile({ heygenUsed: 79, heygenCap: 130 }).level, 'ok');
  assert.equal(heygenTile({ heygenUsed: 80, heygenCap: 130 }).level, 'risk');
  assert.equal(heygenTile({ heygenUsed: 100, heygenCap: 130 }).level, 'crit');
  assert.equal(heygenTile({ heygenUsed: null }).value, 'no data');
});

test('feed reader keeps schema fields and strips keys from links', () => {
  const code = [
    'import json, os, tempfile, production_feed as f',
    'p = os.path.join(tempfile.mkdtemp(), "status.json")',
    'json.dump({"updated": "2026-10-15T23:29:30Z", "header": {"heygen_used": 9, "heygen_cap": 130, "gpu1": 5}, "rows": [{"program": "viralview", "channel": "Theo", "stage": "Edit", "review_url": "https://jonmac.ai/review/theo-1-v6?k=SECRETKEY", "last_line": "ok token=abc123", "extra": "x"}]}, open(p, "w"))',
    'print(json.dumps([f.collect(p), f.collect(p + ".missing")]))',
  ].join('\n');
  const r = spawnSync(py, ['-c', code], { encoding: 'utf8', cwd: join(root, 'collectors/lib') });
  assert.equal(r.status, 0, r.stderr);
  const [d, missing] = JSON.parse(r.stdout);
  assert.equal(d.rows[0].review_url, 'https://jonmac.ai/review/theo-1-v6');
  assert.ok(!JSON.stringify(d).includes('SECRETKEY'));
  assert.ok(!JSON.stringify(d).includes('abc123'));
  assert.equal(d.rows[0].extra, undefined);
  assert.equal(d.header.heygenUsed, 9);
  assert.equal(missing.ok, false);
});
