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
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };

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
    MACHINE_TOKEN_GPU1: 'gpu1-token-cccccccccccccccccccccccccccc',
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

test('youtube production tile is live zeros without projects', () => {
  const page = structuredClone(fixture.pages.youtube);
  overlayYoutube(page, { projects: [], nowMs: now });
  assert.equal(page.tiles[0].value, '0');
  assert.equal(page.tiles[1].value, '0');
  assert.equal(page.tiles[1].sub, 'None in production');

});

test('video target follows the live editor queue not fixture 1 of 3', () => {
  const page = structuredClone(fixture.pages.video);
  overlayVideo(page, { queue: [] });
  assert.equal(page.target.rows[0].value, '0 of 3');
  assert.equal(page.target.rows[1].value, '0 of 3');
  assert.equal(page.editing.rows.length, 0);
});

test('home YouTube tile and video target drop fixture examples', () => {
  const out = mergeSnapshot(snapshot, [
    { source: 'youtube', collected_at: '2026-09-18T17:50:00Z', data: JSON.stringify({ outliers: [], channels: 22, ranked: 516 }) },
    { source: 'video', collected_at: '2026-09-18T17:55:00Z', data: JSON.stringify({ queue: [] }) },
  ], now);
  assert.equal(out.pages.home.tiles[3].sub, 'None in production');
  assert.equal(out.pages.youtube.tiles[1].sub, 'None in production');
  assert.equal(out.pages.video.target.rows[0].value, '0 of 3');
  assert.equal(out.pages.video.target.rows[1].value, '0 of 3');
});




test('sponsor pipeline skips unmatched invoice-sent cards and keeps channel rows', () => {
  const page = structuredClone(fixture.pages.youtube);
  overlayYoutube(page, {
    projects: [],
    sponsors: {
      collections: { items: [] },
      cards: [
        { id: 'spam', sponsor: 'Random Lead', stage: 'invoice-sent', latestDate: '2026-10-06' },
        { id: 'vik', sponsor: 'Viktor', stage: 'script-approval', latestDate: '2026-09-30', subject: '90-second ad' },
      ],
    },
    nowMs: now,
  });
  const names = page.pipeline.rows.map((r) => r.video);
  assert.equal(names.some((n) => /Random Lead/.test(n)), false);
  assert.equal(names.some((n) => /Viktor/.test(n)), true);
  assert.equal(page.pipeline.rows.some((r) => r.type === 'Your channel'), true);
});

test('sponsor due tile only counts collection deals when items exist', () => {
  const page = structuredClone(fixture.pages.youtube);
  overlayYoutube(page, {
    projects: [],
    sponsors: {
      collections: { items: [{ sponsor: 'Viktor', owed: 1000 }] },
      cards: [
        { id: 'vik', sponsor: 'Viktor', stage: 'script-approval', latestDate: '2026-09-30', subject: '90-second ad' },
        { id: 'noise', sponsor: 'Random Lead', stage: 'production', latestDate: '2026-09-20', subject: 'dedicated' },
      ],
    },
    nowMs: now,
  });
  const names = page.pipeline.rows.map((r) => r.video);
  assert.equal(names.some((n) => /Viktor/.test(n)), true);
  assert.equal(names.some((n) => /Random Lead/.test(n)), false);
  assert.equal(page.tiles[3].value, '1');
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
  ], now, {}, [], [], projects);
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

test('upload PUT queues one GPU1 job and a repeat does not overwrite it', async () => {
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
  const putPath = new URL(putUrl).pathname + new URL(putUrl).search;
  const put = await handleApi(req(putPath, { method: 'PUT', body: 'fake-bytes' }), env);
  assert.equal(put.status, 200, await put.clone().text());
  const done = await put.json();
  assert.equal(done.ok, true);
  assert.equal(done.host, 'gpu1');
  const action = db.actions.find((a) => a.kind === 'video.start_edit');
  assert.equal(action.target, 'gpu1');
  assert.equal(action.status, 'queued');
  assert.equal(action.idem_key, `upload-${id}`);
  assert.equal(db.actions.filter((a) => a.kind === 'video.start_edit').length, 1);
  const again = await handleApi(req(putPath, { method: 'PUT', body: 'other-bytes' }), env);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).id, action.id);
  assert.equal(db.actions.filter((a) => a.kind === 'video.start_edit').length, 1);
  const stored = store.get([...store.keys()][0]);
  const text = typeof stored === 'string' ? stored : new TextDecoder().decode(stored);
  assert.equal(text, 'fake-bytes');
  const gpu2 = await handleApi(req('/dashboard/api/actions/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GPU}` },
    body: JSON.stringify({ machine: 'gpu2' }),
  }), env);
  assert.equal((await gpu2.json()).actions.length, 0);
  const gpu1 = await handleApi(req('/dashboard/api/actions/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer gpu1-token-cccccccccccccccccccccccccccc' },
    body: JSON.stringify({ machine: 'gpu1' }),
  }), env);
  const claimed = await gpu1.json();
  assert.equal(claimed.actions.length, 1);
  assert.equal(claimed.actions[0].id, action.id);
});

test('video.start_edit from the dashboard button targets GPU1', async () => {
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
  assert.equal(db.actions.at(-1).target, 'gpu1');
});

test('GPU1 reports waiting-for-review on the same job and resume does not duplicate it', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  db.actions.push({
    id: 'job1', kind: 'video.start_edit', target: 'gpu1', status: 'claimed',
    payload: JSON.stringify({ id: 'up1', title: 'QA', filename: 'qa.mp4', key: 'uploads/up1/qa.mp4' }),
    result: null, idem_key: 'upload-up1', created_at: '2026-09-22T00:00:00Z', finished_at: null,
  });
  const progress = await handleApi(req('/dashboard/api/actions/job1/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer gpu1-token-cccccccccccccccccccccccccccc' },
    body: JSON.stringify({
      host: 'gpu1', stage: 'waiting-for-review', device: 'cpu', encoder: 'libx264',
      failure: null, retry: 0, validated: false,
    }),
  }), env);
  assert.equal(progress.status, 200, await progress.clone().text());
  assert.equal(db.actions[0].status, 'waiting');
  assert.equal(db.actions[0].finished_at, null);
  const reported = JSON.parse(db.actions[0].result);
  assert.equal(reported.host, 'gpu1');
  assert.equal(reported.stage, 'waiting-for-review');
  assert.equal(reported.device, 'cpu');
  const empty = await handleApi(req('/dashboard/api/actions/job1/resume', {
    method: 'POST', cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ keepers: [] }),
  }), env);
  assert.equal(empty.status, 400);
  const before = await handleApi(req('/dashboard/api/snapshot?pages=video', { cookie: ck }), env);
  const review = (await before.json()).pages.video.editing.rows[0];
  assert.equal(review.kind, 'video.resume');
  assert.equal(review.payload.actionId, 'job1');
  const resume = await handleApi(req('/dashboard/api/actions/job1/resume', {
    method: 'POST', cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ keepers: [{ cs: 1.2, ce: 3.4, label: 'line' }] }),
  }), env);
  assert.equal(resume.status, 200, await resume.clone().text());
  assert.equal(db.actions.length, 1);
  assert.equal(db.actions[0].id, 'job1');
  assert.equal(JSON.parse(db.actions[0].payload).keepers.length, 1);
  const snap = await handleApi(req('/dashboard/api/snapshot?pages=video', { cookie: ck }), env);
  const page = (await snap.json()).pages.video;
  assert.match(page.editing.rows[0].sub, /gpu1/);
  assert.match(page.editing.rows[0].sub, /waiting-for-review|resume/);
});

test('GPU2 cannot claim, report, or take a GPU1 result', async () => {
  const db = memD1();
  const store = new Map();
  const env = envWith(db, {
    UPLOADS: { async put(key, value) { store.set(key, value); }, async get(key) { return store.has(key) ? { body: store.get(key) } : null; } },
  });
  db.actions.push({
    id: 'job1', kind: 'video.start_edit', target: 'gpu1', status: 'claimed',
    payload: JSON.stringify({ id: 'up1', title: 'QA', filename: 'qa.mp4', key: 'uploads/up1/qa.mp4' }),
    result: null, idem_key: 'upload-up1', created_at: '2026-09-22T00:00:00Z', finished_at: null,
  });
  const wrongMachine = await handleApi(req('/dashboard/api/actions/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer gpu1-token-cccccccccccccccccccccccccccc' },
    body: JSON.stringify({ machine: 'gpu2' }),
  }), env);
  assert.equal(wrongMachine.status, 401);
  const gpu2Progress = await handleApi(req('/dashboard/api/actions/job1/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GPU}` },
    body: JSON.stringify({ stage: 'done', validated: true, outputKey: 'uploads/other/out.mp4' }),
  }), env);
  assert.equal(gpu2Progress.status, 401);
  const stolen = await handleApi(req('/dashboard/api/actions/job1/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer gpu1-token-cccccccccccccccccccccccccccc' },
    body: JSON.stringify({ stage: 'done', validated: true, outputKey: 'uploads/other/out.mp4' }),
  }), env);
  assert.equal(stolen.status, 200);
  assert.equal(JSON.parse(db.actions[0].result).outputKey, 'uploads/up1/out.mp4');
  const gpu2Put = await handleApi(req('/dashboard/api/uploads/up1/output', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GPU}` },
    body: 'nope',
  }), env);
  assert.equal(gpu2Put.status, 401);
  const foreign = await handleApi(req('/dashboard/api/uploads/up1?key=uploads/other/secret.mp4', {
    headers: { Authorization: 'Bearer gpu1-token-cccccccccccccccccccccccccccc' },
  }), env);
  assert.equal(foreign.status, 400);
});

test('duplicate resume stays one job and bad keepers are rejected', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  db.actions.push({
    id: 'job1', kind: 'video.start_edit', target: 'gpu1', status: 'waiting',
    payload: JSON.stringify({ id: 'up1', title: 'QA' }),
    result: JSON.stringify({ host: 'gpu1', stage: 'waiting-for-review' }),
    idem_key: 'upload-up1', created_at: '2026-09-22T00:00:00Z', finished_at: null,
  });
  const bad = await handleApi(req('/dashboard/api/actions/job1/resume', {
    method: 'POST', cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ keepers: [{ label: 'no times' }] }),
  }), env);
  assert.equal(bad.status, 400);
  const body = JSON.stringify({ keepers: [{ cs: 1, ce: 2, label: 'line' }], expectedLines: ['The red box sits on the table.', 'We leave it there today.'] });
  const first = await handleApi(req('/dashboard/api/actions/job1/resume', {
    method: 'POST', cookie: ck, headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body,
  }), env);
  const second = await handleApi(req('/dashboard/api/actions/job1/resume', {
    method: 'POST', cookie: ck, headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body,
  }), env);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(db.actions.length, 1);
  assert.equal(db.actions[0].id, 'job1');
  assert.deepEqual(JSON.parse(db.actions[0].payload).expectedLines, ['The red box sits on the table.', 'We leave it there today.']);
});

test('video page says GPU1 disconnected until a fresh claimer heartbeat', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  db.actions.push({
    id: 'job1', kind: 'video.start_edit', target: 'gpu1', status: 'queued',
    payload: JSON.stringify({ id: 'up1', title: 'QA' }),
    result: JSON.stringify({ host: 'gpu1', stage: 'queued' }),
    idem_key: 'upload-up1', created_at: '2026-09-22T00:00:00Z', finished_at: null,
  });
  const quiet = await handleApi(req('/dashboard/api/snapshot?pages=video', { cookie: ck }), env);
  assert.match((await quiet.json()).pages.video.editing.meta, /GPU1 disconnected/);
  db.snapshots.set('video_gpu1', {
    source: 'video_gpu1', data: '{"ok":true,"device":"cpu"}',
    collected_at: new Date().toISOString(), received_at: new Date().toISOString(),
  });
  const live = await handleApi(req('/dashboard/api/snapshot?pages=video', { cookie: ck }), env);
  assert.doesNotMatch((await live.json()).pages.video.editing.meta || '', /disconnected/);
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

test('GPU1 cutter job records real stages and does not write a fake queue file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-loop-'));
  const cut = join(dir, 'cut.py');
  writeFileSync(cut, [
    'import sys, pathlib',
    'cmd, work = sys.argv[1], sys.argv[3]',
    'out = sys.argv[4] if len(sys.argv) > 4 else ""',
    'root = pathlib.Path(work)',
    'root.mkdir(parents=True, exist_ok=True)',
    'if cmd == "prep":',
    '    (root / "words.json").write_text("[]", encoding="utf-8")',
    'elif cmd == "finish":',
    '    pathlib.Path(out).write_bytes(b"mp4")',
    'elif cmd == "verify":',
    '    print("verify-ok")',
    'else:',
    '    raise SystemExit(2)',
  ].join('\n'));
  const root = dir.replace(/\\/g, '/');
  const r = runPy(
    'from loop_studio import open_job, advance\n'
    + 'import json, os\n'
    + `job = open_job(r'''${root}''', "up1", "QA clip")\n`
    + 'print(json.dumps(advance(job)))\n'
    + 'print("queue", os.path.exists(os.path.join(job, "queue-status.json")))\n',
    { LS_CUTTER: cut, LS_DEVICE: 'cpu', LS_ENCODER: 'libx264' },
  );
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  const state = JSON.parse(lines[0]);
  assert.equal(state.host, 'gpu1');
  assert.equal(state.stage, 'waiting-for-review');
  assert.equal(state.device, 'cpu');
  assert.equal(state.encoder, 'libx264');
  assert.equal(lines[1], 'queue False');
});
