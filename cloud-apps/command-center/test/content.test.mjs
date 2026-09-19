import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { mergeSnapshot } from '../src/snapshot.js';
import { memD1 } from './memd1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';
const SECRET = 'test-session-secret-32-bytes-ok!';
const GPU = 'gpu-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const now = Date.parse('2026-09-18T18:00:00Z');

function envWith(db) {
  return {
    SESSION_SECRET: SECRET,
    DASHBOARD_PASSWORD: '909090',
    MACHINE_TOKEN_MAC: 'mac-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    MACHINE_TOKEN_GPU2: GPU,
    DB: db,
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

const fixture = {
  nav: { brand: 'Jon Mac', badges: { content: 7 } },
  goal: { pct: 50 },
  sources: { content: { updatedAt: 'old' } },
  pages: {
    content: {
      title: 'Content',
      sub: 'Goal: 3 posts a day on each platform · 2–3 YouTube videos a week',
      actions: [{ label: 'Write a post', msg: 'New post box opened' }],
      tiles: [
        { icon: 'pen', label: 'Posts today', value: '5', goal: '/ 12', pct: 42, pg: 'risk', sub: '7 queued' },
        { icon: 'chart', label: 'Posts this week', value: '37', goal: '/ 84', pct: 44, pg: 'risk', sub: 'pace' },
        { icon: 'film', label: 'YouTube this week', value: '1', goal: '/ 3', pct: 33, sub: 'editing' },
        { icon: 'fire', label: 'Days in a row with a post', value: '11', sub: 'Best ever: 19' },
      ],
      todayPlatforms: { title: 'Today by platform', meta: '3 each', rows: [{ label: 'X', value: '2 of 3' }] },
      heat: { title: 'This week', days: ['Mon'], rows: [{ p: 'X', cells: [{ n: 3 }] }] },
      queue: {
        title: "Today's queue", meta: '7 left', approveAll: 'Approve all', approveAllMsg: 'example',
        rows: [{ title: 'example', quote: 'example', msg: 'example' }],
        more: { title: '4 more', sub: 'x', btn: 'Show all', msg: 'example' },
      },
      ytWeek: { title: 'YouTube this week', rows: [], note: 'Steps: record · edit · your review · live' },
      bestPosts: {
        title: 'Best posts · last 30 days', meta: 'Ranked by clicks to Viral View',
        rows: [{ post: 'example', platform: 'X', views: '48,200', clicks: '410', sales: '1' }],
        btn: 'Remix it', msg: 'Remix sent to Content Marketing agent',
      },
    },
  },
};

const livePosts = [
  { id: 'p1', platform: 'X', posted_at: '2026-09-18T15:00:00Z', url: 'https://x.com/1', first_line: 'Morning hook', source: 'agent' },
  { id: 'p2', platform: 'X', posted_at: '2026-09-18T16:00:00Z', url: 'https://x.com/2', first_line: 'Second X', source: 'agent' },
  { id: 'p3', platform: 'Instagram', posted_at: '2026-09-18T16:30:00Z', url: 'https://ig.com/1', first_line: 'IG one', source: 'manual' },
  { id: 'p4', platform: 'X', posted_at: '2026-09-17T18:00:00Z', url: 'https://x.com/thu', first_line: 'Thu X', source: 'agent' },
];

test('merge overlays the posting grid from logged posts', () => {
  const out = mergeSnapshot(fixture, [], now, {}, [], livePosts);
  const p = out.pages.content;
  assert.equal(p.actions[0].label, 'Log a post');
  assert.equal(p.actions[0].log, true);
  assert.equal(p.tiles[0].label, 'Posts today');
  assert.equal(p.tiles[0].value, '3');
  assert.equal(p.tiles[0].goal, '/ 12');
  assert.equal(p.tiles[1].value, '4');
  assert.equal(p.tiles[1].goal, '/ 84');
  assert.equal(p.tiles[2].value, '0');
  assert.equal(p.todayPlatforms.rows[0].label, 'X');
  assert.equal(p.todayPlatforms.rows[0].value, '2 of 3');
  assert.equal(p.todayPlatforms.rows[3].label, 'LinkedIn');
  assert.equal(p.todayPlatforms.rows[3].value, '0 of 3');
  const x = p.heat.rows.find((r) => r.p === 'X');
  assert.equal(x.cells[4].n, 2);
  assert.equal(x.cells[4].today, true);
  assert.equal(x.cells[3].n, 1);
  assert.equal(x.cells[5].future, true);
});

test('queue overlay wires Approve to GPU2 content actions', () => {
  const row = {
    source: 'content_queue',
    collected_at: '2026-09-18T17:50:00Z',
    data: JSON.stringify({
      queued: [
        { id: 'q1', platform: 'LinkedIn', at: '2026-09-18T19:30:00Z', firstLine: 'First line of the LinkedIn post' },
        { id: 'q2', platform: 'X', at: '2026-09-18T20:00:00Z', firstLine: 'First line of the X post' },
      ],
    }),
  };
  const out = mergeSnapshot(fixture, [row], now, {}, [], []);
  const q = out.pages.content.queue;
  assert.equal(q.meta, '2 left');
  assert.equal(q.rows[0].kind, 'content.approve');
  assert.equal(q.rows[0].payload.id, 'q1');
  assert.equal(q.approveAllKind, 'content.approve_all');
  assert.deepEqual(q.approveAllPayload.ids, ['q1', 'q2']);
  assert.equal(out.nav.badges.content, 2);
});

test('best posts overlay from Viral View summary posts', () => {
  const row = {
    source: 'viralview',
    collected_at: '2026-09-18T17:00:00Z',
    data: JSON.stringify({
      posts: [
        { id: 't1', platform: 'X', postUrl: 'https://x.com/top', views: 48200, clicks: 410, firstLine: 'First line of top post' },
        { id: 't2', platform: 'Instagram', postUrl: 'https://ig.com/top', views: 9400, clicks: 120 },
      ],
    }),
  };
  const out = mergeSnapshot(fixture, [row], now, {}, [], []);
  const rows = out.pages.content.bestPosts.rows;
  assert.equal(rows[0].post, 'First line of top post');
  assert.equal(rows[0].platform, 'X');
  assert.equal(rows[0].views, '48,200');
  assert.equal(rows[0].clicks, '410');
  assert.equal(rows[0].kind, 'content.remix');
  assert.equal(rows[1].views, '9,400');
});

test('POST /posts logs a manual row into the posts table', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  const res = await handleApi(req('/dashboard/api/posts', {
    method: 'POST',
    cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ platform: 'LinkedIn', first_line: 'Logged by hand', url: 'https://lnkd.in/1', posted_at: '2026-09-18T18:00:00Z' }),
  }), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  const snap = await handleApi(req('/dashboard/api/snapshot?pages=content', { cookie: ck }), env);
  const page = (await snap.json()).pages.content;
  assert.equal(page.tiles[0].value, '1');
  assert.equal(page.todayPlatforms.rows[3].value, '1 of 3');
});

test('ingest source post writes the posts table, not a snapshot', async () => {
  const db = memD1();
  const env = envWith(db);
  const res = await handleApi(req('/dashboard/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GPU}` },
    body: JSON.stringify({
      source: 'post',
      collectedAt: '2026-09-18T17:00:00Z',
      data: { platform: 'X', firstLine: 'Agent posted this', url: 'https://x.com/a', postedAt: '2026-09-18T17:00:00Z' },
    }),
  }), env);
  assert.equal(res.status, 200);
  assert.equal(db.snapshots.has('post'), false);
  assert.ok([...db.posts.values()].some((p) => p.first_line === 'Agent posted this' && p.platform === 'X'));
});

test('content.approve and content.approve_all queue on GPU2', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  for (const kind of ['content.approve', 'content.approve_all', 'content.remix']) {
    const res = await handleApi(req('/dashboard/api/actions', {
      method: 'POST',
      cookie: ck,
      headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
      body: JSON.stringify({ kind, payload: { id: 'q1', ids: ['q1'] }, idemKey: kind }),
    }), env);
    assert.equal(res.status, 200, kind);
    assert.equal((await res.json()).status, 'queued', kind);
    assert.equal(db.actions.at(-1).target, 'gpu2', kind);
  }
});

test('python approve handler writes a file the Content Marketing agent can read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-content-'));
  const r = spawnSync(py, ['-c',
    'from content_queue import handle\n'
    + 'ok, msg = handle("content.approve", {"id":"q1","platform":"LinkedIn","at":"12:30","firstLine":"hi","msg":"LinkedIn post approved for 12:30"})\n'
    + 'print(ok)\n'
    + 'print(msg)\n',
  ], { encoding: 'utf8', cwd: join(root, 'collectors/lib'), env: { ...process.env, CC_CONTENT_DIR: dir } });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], 'True');
  assert.match(lines[1], /LinkedIn post approved/);
  const rec = JSON.parse(readFileSync(join(dir, 'content-approvals.jsonl'), 'utf8').trim().split(/\n/).at(-1));
  assert.equal(rec.kind, 'content.approve');
  assert.equal(rec.payload.id, 'q1');
});

test('live posts do not keep fixture queue copy', () => {
  const out = mergeSnapshot(fixture, [], now, {}, [], livePosts);
  const p = out.pages.content;
  assert.equal(p.tiles[0].value, '3');
  assert.doesNotMatch(p.tiles[0].sub, /this afternoon|queued for/i);
  assert.equal(p.queue.rows.length, 0);
  assert.match(p.queue.meta, /none queued|0 left/i);
  assert.equal(p.tiles[2].value, '0');
  assert.doesNotMatch(p.tiles[2].sub || '', /70% edited|editing/i);
  assert.equal((p.ytWeek.rows || []).length, 0);
  assert.equal((p.bestPosts.rows || []).some((r) => /example/i.test(r.post)), false);
});

test('content empty state replaces fixture copy when there are no posts', () => {
  const out = mergeSnapshot(fixture, [], now, {}, [], []);
  const p = out.pages.content;
  assert.equal(p.tiles[0].value, '0');
  assert.equal(p.tiles[1].value, '0');
  assert.doesNotMatch(p.tiles[0].sub, /this afternoon/i);
  assert.equal(p.queue.rows.length, 0);
  assert.equal(p.heat.rows.find((r) => r.p === 'X').cells[4].n, 0);
});
