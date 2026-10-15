import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overlayVideos, stageOf, heygenTile } from '../src/videos.js';
import { mergeSnapshot } from '../src/snapshot.js';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';

const data = {
  channels: [
    { id: 'theo', name: 'Theo', kind: 'viralview', target: 3, key: 'theo-1', title: 'Seedance guide', queueStatus: 'review', ledger: { status: 'rendering' } },
    { id: 'max', name: 'Max', kind: 'viralview', target: 3, key: '', title: 'Argon vs GPT-6', queueStatus: 'brief', ledger: null },
    { id: 'aff-steve', name: 'Steve Copper Dogs', kind: 'affiliate', target: 7, key: 'affiliate-2', reviewSlug: 'avatar-studio-stills-2', ledger: { status: 'rendering' } },
    { id: 'aff-delton', name: 'Delton Mendenhall', kind: 'affiliate', target: 7, key: '', ledger: null },
  ],
  heygen: { date: '2026-10-15', used: 9, pressed: 14, cap: 130 },
  posts: null,
};
const reviews = [
  { channel: 'theo', video: 'theo-1', version: 'v4', slug: 'theo-1-v4', status: 'needs_review', updated_at: '2026-10-15T00:05:38Z', open_comments: 3 },
  { channel: 'theo', video: 'theo-1', version: 'v6', slug: 'theo-1-v6', status: 'needs_review', updated_at: '2026-10-15T20:56:28Z', open_comments: 0 },
];

test('stage follows review page, then HeyGen ledger, then queue', () => {
  assert.equal(stageOf({ queueStatus: 'brief' }, null), 'script');
  assert.equal(stageOf({ ledger: { status: 'rendering' } }, null), 'HeyGen');
  assert.equal(stageOf({ ledger: { status: 'done' } }, null), 'build');
  assert.equal(stageOf({ queueStatus: 'review' }, null), 'Ana check');
  assert.equal(stageOf({}, { status: 'needs_review' }), 'ready for Jon');
  assert.equal(stageOf({}, { status: 'approved' }), 'approved');
  assert.equal(stageOf({}, { status: 'changes_requested' }), 'build');
  assert.equal(stageOf({}, null), '');
});

test('videos page uses the newest review version and never invents posts', () => {
  const page = overlayVideos({}, { data: JSON.stringify(data), collected_at: '2026-10-15T22:00:00Z' }, reviews, 'updated just now');
  const theo = page.rows.find((r) => r.id === 'theo');
  assert.equal(theo.stage, 'ready for Jon');
  assert.equal(theo.review.slug, 'theo-1-v6');
  assert.equal(theo.posts, null);
  assert.equal(page.rows.find((r) => r.id === 'aff-steve').stage, 'HeyGen');
  assert.equal(page.rows.find((r) => r.id === 'aff-delton').stage, '');
  assert.equal(page.tiles[3].value, 'no data');
  assert.deepEqual(page.ready.map((r) => r.channel), ['Theo']);
});

test('HeyGen tile turns amber at 80 and red at 100', () => {
  assert.equal(heygenTile({ used: 79, cap: 130 }).level, 'ok');
  assert.equal(heygenTile({ used: 80, cap: 130 }).level, 'risk');
  assert.equal(heygenTile({ used: 100, cap: 130 }).level, 'crit');
  assert.equal(heygenTile(null).value, 'no data');
});

test('no videos feed shows no data, not fixture numbers', () => {
  const out = mergeSnapshot({ ...snapshot, pages: { ...snapshot.pages, videos: {} } }, [], Date.parse('2026-10-15T22:00:00Z'));
  assert.equal(out.pages.videos.rows.length, 0);
  assert.equal(out.pages.videos.stale, true);
  assert.equal(out.pages.videos.heygen.value, 'no data');
});

test('collector counts only accepted HeyGen presses for the day', () => {
  const code = [
    'import json, tempfile, os, videos_state as v',
    'p = os.path.join(tempfile.mkdtemp(), "s.csv")',
    'open(p, "w").write(chr(10).join(["# note", "date,time_pt,video_key,draft_id,title,submitted_by,on_screen_result,project_status_after", "2026-10-15,08:00,a,x,t,k,ok,processing", "2026-10-15,09:00,b,x,t,k,limit,draft", "2026-10-14,09:00,c,x,t,k,ok,processing"]))',
    'print(json.dumps([v.heygen_today(p, "2026-10-15"), v.video_key({"channel": "mina", "review_url": "https://jonmac.ai/review/mina-1-v11"}), v.review_slug("https://gpu1.example/remake/x")]))',
  ].join('\n');
  const r = spawnSync(py, ['-c', code], { encoding: 'utf8', cwd: join(root, 'collectors/lib') });
  assert.equal(r.status, 0, r.stderr);
  const [h, key, slug] = JSON.parse(r.stdout);
  assert.equal(h.used, 1);
  assert.equal(h.pressed, 2);
  assert.equal(key, 'mina-1');
  assert.equal(slug, '');
});
