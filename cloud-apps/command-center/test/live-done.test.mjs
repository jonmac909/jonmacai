// POST /v1/tasks/:id/live: the live-YouTube sync moves a card to done only after the server finds the video public.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex, watchIdOf } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TOKENS = { developer: `ccb_${'d'.repeat(43)}`, sponsors: `ccb_${'s'.repeat(43)}`, qc: `ccb_${'q'.repeat(43)}` };
const VIDEO = 'R9dtH4r9Yl4';
const WATCH = `https://www.youtube.com/watch?v=${VIDEO}`;

async function setup(status = 'review') {
  const db = sqliteD1();
  for (const [bot, token] of Object.entries(TOKENS)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), bot, '2026-11-01T00:00:00.000Z').run();
  }
  const env = { DB: db, SESSION_SECRET: SECRET };
  const made = await call(env, 'POST', '/tasks', { bot: 'sponsors', body: { title: 'Topview video 2: approved by Dorothy, publish and send reply', project: 'sponsors' } });
  const id = made.body.task.id;
  await db.prepare('UPDATE bot_tasks SET status = ? WHERE id = ?').bind(status, id).run();
  return { db, env, id };
}

function call(env, method, path, { bot, body, cookie } = {}) {
  const headers = new Headers();
  if (bot) headers.set('Authorization', `Bearer ${TOKENS[bot]}`);
  if (cookie) { headers.set('Cookie', cookie); headers.set('X-CC', '1'); }
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const init = { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
  return handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, init), env).then(async (r) => ({ status: r.status, body: await r.json() }));
}

// Swaps in a fake YouTube for one test; `answer(url)` returns a Response or throws.
async function withYouTube(answer, work) {
  const prev = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return answer(String(url)); };
  try { return await work(calls); } finally { globalThis.fetch = prev; }
}
const oembed = (title = 'I Tested Topview T1 vs Seedance 2.5 (Can You Tell Which Is Which?)') => () =>
  new Response(JSON.stringify({ title, author_name: 'Jon Mac', type: 'video' }), { status: 200, headers: { 'Content-Type': 'application/json' } });

const live = (env, id, link = WATCH, bot = 'developer') => call(env, 'POST', `/tasks/${id}/live`, { bot, body: { link } });

test('a public video moves its card to done, with the watch link as passed proof', async () => {
  const { env, id } = await setup('review');
  await withYouTube(oembed(), async (calls) => {
    const r = await live(env, id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.task.status, r.body.task.updatedBy, typeof r.body.task.doneAt], ['done', 'developer', 'string']);
    assert.deepEqual([r.body.proof.kind, r.body.proof.link, r.body.proof.status, r.body.proof.checkedBy], ['url', WATCH, 'passed', 'developer']);
    assert.equal(r.body.video.title, 'I Tested Topview T1 vs Seedance 2.5 (Can You Tell Which Is Which?)');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(WATCH)}`, 'the server asks YouTube itself');
  });
  const card = (await call(env, 'GET', `/tasks/${id}`, { bot: 'developer' })).body.task;
  assert.deepEqual(card.deliverable, { link: WATCH, kind: 'url', web: true }, 'Jon opens the live video from the Done card');
  assert.ok(card.history.some((h) => h.detail === 'status review → done (live on YouTube)'));
});

test('a youtu.be link is saved as the canonical watch link; any open status can move', async () => {
  for (const status of ['todo', 'doing', 'waiting_on_jon', 'qc']) {
    const { env, id } = await setup(status);
    const r = await withYouTube(oembed(), () => live(env, id, `https://youtu.be/${VIDEO}`));
    assert.deepEqual([r.status, r.body.task.status, r.body.proof.link], [200, 'done', WATCH], status);
  }
});

test('only the sync bot may use it; Jon and other bots are refused before YouTube is asked', async () => {
  const { env, id } = await setup();
  await withYouTube(oembed(), async (calls) => {
    assert.equal((await live(env, id, WATCH, 'sponsors')).status, 403);
    assert.equal((await live(env, id, WATCH, 'qc')).status, 403);
    const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;
    assert.equal((await call(env, 'POST', `/tasks/${id}/live`, { cookie, body: { link: WATCH } })).status, 403);
    assert.equal((await call(env, 'POST', `/tasks/${id}/live`, { body: { link: WATCH } })).status, 401);
    assert.equal(calls.length, 0);
  });
  assert.equal((await call(env, 'GET', `/tasks/${id}`, { bot: 'developer' })).body.task.status, 'review');
});

test('anything but an https youtube.com watch or youtu.be link is refused', async () => {
  const { env, id } = await setup();
  const bad = [null, '', 42, `http://www.youtube.com/watch?v=${VIDEO}`, `https://studio.youtube.com/video/${VIDEO}/edit`,
    `https://www.youtube.com/shorts/${VIDEO}`, `https://www.youtube.com/embed/${VIDEO}`, `https://evil.com/watch?v=${VIDEO}`,
    `https://youtube.com.evil.com/watch?v=${VIDEO}`, `https://user@www.youtube.com/watch?v=${VIDEO}`, `https://www.youtube.com:8443/watch?v=${VIDEO}`,
    'https://www.youtube.com/watch?v=short', `https://youtu.be/${VIDEO}/x`, 'https://www.youtube.com/watch', `javascript:alert(1)//youtu.be/${VIDEO}`];
  await withYouTube(oembed(), async (calls) => {
    for (const link of bad) assert.equal((await live(env, id, link)).status, 400, String(link));
    assert.equal((await call(env, 'POST', `/tasks/${id}/live`, { bot: 'developer', body: {} })).status, 400, 'no link');
    assert.equal(calls.length, 0);
  });
  assert.equal(watchIdOf(`https://m.youtube.com/watch?feature=share&v=${VIDEO}`), VIDEO);
  assert.equal(watchIdOf(`https://YOUTUBE.com/watch?v=${VIDEO}`), VIDEO);
});

test('a done or cancelled card stays as it is, and an unknown card is 404', async () => {
  for (const status of ['done', 'cancelled']) {
    const { env, id } = await setup(status);
    await withYouTube(oembed(), async (calls) => {
      const r = await live(env, id);
      assert.deepEqual([r.status, r.body.error], [409, `Task is already ${status}`]);
      assert.equal(calls.length, 0);
    });
    const card = (await call(env, 'GET', `/tasks/${id}`, { bot: 'developer' })).body.task;
    assert.deepEqual([card.status, card.proofs.length], [status, 0]);
  }
  const { env } = await setup();
  assert.equal((await withYouTube(oembed(), () => live(env, 't_0123456789abcdef'))).status, 404);
});

test('a private, deleted or unreachable video changes nothing', async () => {
  const cases = [
    [() => new Response('Unauthorized', { status: 401 }), 422],
    [() => new Response('Forbidden', { status: 403 }), 422],
    [() => new Response('Not Found', { status: 404 }), 422],
    [() => new Response('Bad Request', { status: 400 }), 422],
    [() => { throw new TypeError('network down'); }, 502],
    [() => new Response('oops', { status: 500 }), 502],
    [() => new Response('', { status: 302, headers: { Location: 'https://consent.youtube.com/' } }), 502],
    [() => new Response('<html>not json</html>', { status: 200 }), 502],
    [() => new Response(JSON.stringify({ error: 'no title' }), { status: 200 }), 502],
  ];
  for (const [answer, code] of cases) {
    const { env, id } = await setup('review');
    const r = await withYouTube(answer, () => live(env, id));
    assert.equal(r.status, code, r.body.error);
    const card = (await call(env, 'GET', `/tasks/${id}`, { bot: 'developer' })).body.task;
    assert.deepEqual([card.status, card.proofs.length], ['review', 0], `card untouched after ${code}`);
  }
});

test('bots still cannot set done through PATCH', async () => {
  const { env, id } = await setup('review');
  assert.equal((await call(env, 'PATCH', `/tasks/${id}`, { bot: 'developer', body: { status: 'done' } })).status, 403);
});
