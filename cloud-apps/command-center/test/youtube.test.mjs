import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { mergeSnapshot } from '../src/snapshot.js';
import { topOutliers, overlayYoutube } from '../src/youtube.js';
import { overlayVideo } from '../src/video.js';
import { memD1 } from './memd1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';
const SECRET = 'test-session-secret-32-bytes-ok!';
const GPU = 'gpu-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const now = Date.parse('2026-09-18T18:00:00Z');

function envWith(db, extra = {}) {
  return {
    SESSION_SECRET: SECRET,
    DASHBOARD_PASSWORD: '909090',
    MACHINE_TOKEN_MAC: 'mac-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    MACHINE_TOKEN_GPU2: GPU,
    DB: db,
    ...extra,
  };
}

function req(path, { method = 'GET', cookie, headers = {}, body } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  return new Request(`https://jonmac.ai${path}`, { method, headers: h, body });
}

async function cookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${COOKIE}=${await signSession(SECRET, exp)}`;
}

function runPy(code, env = {}) {
  return spawnSync(py, ['-c', code], {
    encoding: 'utf8',
    cwd: join(root, 'collectors/lib'),
    env: { ...process.env, ...env },
  });
}

const fixture = {
  nav: { brand: 'Jon Mac', badges: { video: 1 } },
  goal: { pct: 50 },
  sources: { youtube: { updatedAt: 'old' }, video: { updatedAt: 'old' } },
  pages: {
    youtube: {
      title: 'YouTube',
      sub: 'example',
      actions: [{ label: 'Open YouTube Gen', msg: 'Opens jonmac.ai/yt2', primary: true }],
      tiles: [
        { icon: 'film', label: 'Videos live this week', value: '1', goal: '/ 3', pct: 33, sub: 'Goal is 2–3 a week' },
        { icon: 'pen', label: 'In production', value: '2', sub: 'example' },
        { icon: 'fire', label: 'Best idea right now', value: '133×', sub: 'Views against that channel\'s normal' },
        { icon: 'dollar', label: 'Sponsor videos due', value: '3', sub: 'example' },
      ],
      pipeline: {
        title: 'Production pipeline',
        meta: 'Steps: idea · script · record · edit · your review · live',
        rows: [{ video: 'example', type: 'Your channel', pct: 100, pill: 'Live' }],
      },
      remake: {
        title: 'Best videos to remake',
        seeAll: 'See all 516',
        seeAllMsg: 'Opens jonmac.ai/yt2 Discover',
        jobs: [{ area: 'example', pill: '1× their normal', title: 'example', lines: ['x'] }],
        btn: 'Remake with a template',
        msg: 'Opens this video in YouTube Gen with a template',
      },
    },
    video: {
      title: 'Video editor',
      sub: 'example',
      editing: { title: 'In the editor', meta: 'Steps: upload · rough cut · graphics · sound · export', rows: [{ title: 'example' }] },
      ready: { title: 'Ready for you to watch', rows: [{ title: 'example' }] },
      finished: { title: 'Finished this week', rows: [{ video: 'example' }] },
      upload: { title: 'Upload a recording', drop: 'Drop a video here', sub: 'The auto editor starts right away', btn: 'Choose file', msg: 'File picker opened' },
      target: { title: "This week's target", rows: [{ label: 'YouTube videos', value: '1 of 3', pct: 33 }] },
    },
  },
};

const rows = [
  { id: 'a', channel: 'Joshua Mayo', title: '4 Side Hustles That No One Is Talking About For 2026', views: 5_000_000, views_per_day: 4562, outlier_score: 133.2 },
  { id: 'b', channel: 'Quiet Channel', title: 'Ignore me', views: 10, views_per_day: 1, outlier_score: 1.1 },
  { id: 'c', channel: 'Mr. Paid Social', title: 'How To Make Facebook Ads 100% Using AI In 2026', views: 233_000, views_per_day: 638, outlier_score: 50.6 },
  { id: 'd', channel: 'Karolis', title: 'Claude Skills That Changed Content Creation Forever', views: 16_000, views_per_day: 3200, outlier_score: 46.2 },
];

test('topOutliers keeps the three highest outlier scores', () => {
  const top = topOutliers(rows);
  assert.deepEqual(top.map((r) => r.id), ['a', 'c', 'd']);
  assert.equal(top[0].outlier_score, 133.2);
});

test('merge overlays yt2 projects onto the YouTube pipeline', () => {
  const projects = [
    {
      id: 'v2_live', createdAt: '2026-09-16T12:00:00Z', stage: 'publish',
      titleOptions: ['Video 1 of the week'], selectedTitleIndex: 0,
      source: { title: 'src' },
      edit: { status: 'approved', progress: 100 },
      publish: { status: 'published', publishedAt: '2026-09-16T18:00:00Z' },
    },
    {
      id: 'v2_edit', createdAt: '2026-09-18T12:00:00Z', stage: 'edit',
      titleOptions: ['Video 2 of the week'], selectedTitleIndex: 0,
      source: { title: 'src2' },
      edit: { status: 'rendering', progress: 67, currentJob: 'Building captions' },
      publish: { status: 'idle' },
    },
  ];
  const page = structuredClone(fixture.pages.youtube);
  overlayYoutube(page, { projects, nowMs: now });
  assert.equal(page.pipeline.rows[0].video, 'Video 1 of the week');
  assert.equal(page.pipeline.rows[0].pill, 'Live');
  assert.equal(page.pipeline.rows[1].video, 'Video 2 of the week');
  assert.match(page.pipeline.rows[1].pill, /edit/i);
  assert.equal(page.tiles[0].value, '1');
  assert.equal(page.tiles[1].value, '1');
});

test('merge overlays top outliers onto remake jobs', () => {
  const page = structuredClone(fixture.pages.youtube);
  overlayYoutube(page, { outliers: topOutliers(rows), channels: 22, ranked: 516, nowMs: now });
  assert.equal(page.remake.jobs.length, 3);
  assert.equal(page.remake.jobs[0].area, 'Joshua Mayo');
  assert.equal(page.remake.jobs[0].title, '4 Side Hustles That No One Is Talking About For 2026');
  assert.match(page.remake.jobs[0].pill, /133×/);
  assert.match(page.remake.jobs[0].lines[0], /5M views/);
  assert.equal(page.tiles[2].value, '133×');
  assert.match(page.sub, /22 channels/);
  assert.match(page.sub, /516 videos/);
  assert.equal(page.remake.seeAll, 'See all 516');
});

test('sponsor cards join the YouTube pipeline', () => {
  const page = structuredClone(fixture.pages.youtube);
  overlayYoutube(page, {
    projects: [],
    sponsors: {
      cards: [
        { id: 'inv1', sponsor: 'InVideo', stage: 'invoice-sent', latestDate: '2026-09-24', amount: 2100, subject: 'video 1' },
        { id: 'vik', sponsor: 'Viktor', stage: 'script-approval', latestDate: '2026-09-30', amount: 1500, subject: '90-second ad' },
      ],
    },
    nowMs: now,
  });
  const names = page.pipeline.rows.map((r) => r.video);
  assert.ok(names.some((n) => /InVideo/i.test(n)));
  assert.ok(names.some((n) => /Viktor/i.test(n)));
  assert.equal(page.tiles[3].value, '2');
});

test('merge overlays the GPU2 editor queue onto Video', () => {
  const page = structuredClone(fixture.pages.video);
  overlayVideo(page, {
    queue: [
      { id: 'e1', title: 'Video 2 of the week', step: 3, steps: 5, progress: 55, etaMinutes: 25, status: 'editing', readyPath: '' },
      { id: 'e2', title: 'Sponsor D · dedicated video', step: 1, steps: 5, progress: 12, etaMinutes: 40, status: 'queued', readyPath: '' },
      { id: 'e3', title: 'Sponsor C · 90-second cut', step: 5, steps: 5, progress: 100, etaMinutes: 0, status: 'ready', readyPath: 'out/sponsor-c.mp4' },
      { id: 'e4', title: 'Video 1 of the week', step: 5, steps: 5, progress: 100, etaMinutes: 0, status: 'done', readyPath: 'out/video-1.mp4', finishedAt: '2026-09-16', editMinutes: 52, where: 'Live on YouTube' },
    ],
  });
  assert.equal(page.editing.rows[0].title, 'Video 2 of the week');
  assert.match(page.editing.rows[0].sub, /25 minutes/);
  assert.equal(page.editing.rows[1].pill, 'Queued');
  assert.equal(page.ready.rows[0].title, 'Sponsor C · 90-second cut');
  assert.equal(page.finished.rows[0].video, 'Video 1 of the week');
  assert.match(page.sub, /1 editing now/);
});

test('mergeSnapshot wires youtube projects, outliers and the video queue', () => {
  const projects = [{
    id: 'p1', createdAt: '2026-09-18T10:00:00Z', stage: 'script',
    titleOptions: ['Video 3 of the week'], selectedTitleIndex: 0,
    source: { title: 'src' },
    edit: { status: 'idle', progress: 0 },
    publish: { status: 'idle' },
  }];
  const out = mergeSnapshot(fixture, [
    {
      source: 'youtube',
      collected_at: '2026-09-18T17:50:00Z',
      data: JSON.stringify({ outliers: topOutliers(rows), channels: 22, ranked: 516 }),
    },
    {
      source: 'video',
      collected_at: '2026-09-18T17:55:00Z',
      data: JSON.stringify({
        queue: [{ id: 'e1', title: 'Video 2 of the week', step: 3, steps: 5, progress: 55, etaMinutes: 25, status: 'editing' }],
      }),
    },
    {
      source: 'sponsors',
      collected_at: '2026-09-18T17:40:00Z',
      data: JSON.stringify({ cards: [{ id: 'inv1', sponsor: 'InVideo', stage: 'production', latestDate: '2026-09-24' }] }),
    },
  ], now, {}, [], projects);
  assert.equal(out.pages.youtube.pipeline.rows.some((r) => r.video === 'Video 3 of the week'), true);
  assert.equal(out.pages.youtube.remake.jobs[0].area, 'Joshua Mayo');
  assert.equal(out.pages.video.editing.rows[0].title, 'Video 2 of the week');
});

test('yt2 project PUT persists in D1 and snapshot shows it', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  const body = JSON.stringify([{
    id: 'v2_1', createdAt: '2026-09-18T12:00:00Z', stage: 'record',
    titleOptions: ['Persisted project'], selectedTitleIndex: 0,
    source: { title: 'src' },
    edit: { status: 'idle', progress: 0 },
    publish: { status: 'idle' },
  }]);
  const put = await handleApi(req('/dashboard/api/video-projects', {
    method: 'PUT', cookie: ck, headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body,
  }), env);
  assert.equal(put.status, 200, await put.text());
  const snap = await handleApi(req('/dashboard/api/snapshot?pages=youtube', { cookie: ck }), env);
  const json = await snap.json();
  assert.equal(json.pages.youtube.pipeline.rows.some((r) => r.video === 'Persisted project'), true);
});

test('upload PUT stores the file and queues video.start_edit on GPU2', async () => {
  const db = memD1();
  const store = new Map();
  const env = envWith(db, {
    UPLOADS: {
      async put(key, value) { store.set(key, value); },
      async get(key) {
        if (!store.has(key)) return null;
        const value = store.get(key);
        return { body: value, arrayBuffer: async () => value };
      },
    },
  });
  const ck = await cookie();
  const created = await handleApi(req('/dashboard/api/uploads', {
    method: 'POST', cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ filename: 'take.mp4', contentType: 'video/mp4', title: 'New recording' }),
  }), env);
  assert.equal(created.status, 200, await created.clone().text());
  const { id, putUrl } = await created.json();
  assert.ok(id);
  assert.match(putUrl, /\/dashboard\/api\/uploads\//);
  const put = await handleApi(req(new URL(putUrl).pathname + new URL(putUrl).search, {
    method: 'PUT', body: 'fake-bytes',
  }), env);
  assert.equal(put.status, 200, await put.clone().text());
  const done = await put.json();
  assert.equal(done.ok, true);
  const action = db.actions.find((a) => a.kind === 'video.start_edit');
  assert.ok(action);
  assert.equal(action.target, 'gpu2');
  assert.equal(action.status, 'queued');
  assert.match(action.payload, /New recording/);
  assert.ok([...store.keys()].length > 0);
});

test('video.start_edit action queues on GPU2 from the dashboard button', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  const res = await handleApi(req('/dashboard/api/actions', {
    method: 'POST', cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ kind: 'video.start_edit', payload: { title: 'Clip' }, idemKey: 'v1' }),
  }), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'queued');
  assert.equal(db.actions.at(-1).target, 'gpu2');
});

test('python collector reads queue-status.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-video-'));
  mkdirSync(join(dir, 'out'), { recursive: true });
  writeFileSync(join(dir, 'out', 'queue-status.json'), JSON.stringify([
    { id: 'e1', title: 'Video 2 of the week', step: 3, steps: 5, progress: 55, etaMinutes: 25, status: 'editing', readyPath: '' },
  ]));
  const r = runPy(
    'from video_edit import collect_queue\n'
    + 'import json\n'
    + 'print(json.dumps(collect_queue()))\n',
    { CC_VIDEO_ROOT: dir },
  );
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.queue[0].title, 'Video 2 of the week');
  assert.equal(data.queue[0].status, 'editing');
});

test('python start_edit writes the inbound file and queue-status.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-video-'));
  mkdirSync(join(dir, 'out'), { recursive: true });
  mkdirSync(join(dir, 'in'), { recursive: true });
  const src = join(dir, 'take.mp4');
  writeFileSync(src, 'abc123');
  const r = runPy(
    'from video_edit import handle\n'
    + 'import json, os\n'
    + `ok, msg = handle('video.start_edit', {'id': 'u1', 'title': 'New recording', 'filename': 'take.mp4', 'path': r'${src.replace(/\\/g, '/')}'})\n`
    + 'print(ok)\n'
    + 'print(msg)\n'
    + 'print(open(os.path.join(os.environ["CC_VIDEO_ROOT"], "out", "queue-status.json"), encoding="utf-8").read())\n',
    { CC_VIDEO_ROOT: dir },
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'True');
  const queue = JSON.parse(lines.slice(2).join('\n'));
  assert.equal(queue[0].title, 'New recording');
  assert.ok(queue[0].status === 'queued' || queue[0].status === 'editing');
  assert.equal(readFileSync(join(dir, 'in', 'u1-take.mp4'), 'utf8'), 'abc123');
});
