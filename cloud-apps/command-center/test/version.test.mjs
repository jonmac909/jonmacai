import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const ASSETS = { fetch: async (r) => new Response('<html>sign in</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }) };
const env = (meta) => ({ ASSETS, CF_VERSION_METADATA: meta });
const get = (path, e) => worker.fetch(new Request('https://jonmac.ai' + path), e, {});

test('/dash/version: public JSON with commit and deployedAt only, no cookie, no-store', async () => {
  const res = await get('/dash/version', env({ id: 'v-1', tag: 'ABCDEF1', timestamp: '2026-11-11T20:00:00.000Z' }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { commit: 'abcdef1', deployedAt: '2026-11-11T20:00:00.000Z' });
});

test('/dash/version: no tag or bad tag answers 503, never a made-up commit', async () => {
  for (const meta of [undefined, { id: 'v', timestamp: '2026-11-11T20:00:00Z' }, { id: 'v', tag: 'not a sha', timestamp: '2026-11-11T20:00:00Z' }]) {
    const res = await get('/dash/version', env(meta));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).commit, null);
  }
});

test('other /dash paths still need sign-in or are 404', async () => {
  const e = env({ id: 'v', tag: 'abcdef1', timestamp: '2026-11-11T20:00:00Z' });
  e.SESSION_SECRET = 'x'.repeat(32);
  const page = await get('/dash/', e); // no session: login page
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control') === 'no-store', false);
  for (const p of ['/dash/version/', '/dash/version.json', '/dash/versions', '/dash/version/x']) {
    const r = await get(p, e);
    assert.notEqual((r.headers.get('content-type') || '').includes('application/json'), true, p);
  }
  const post = await worker.fetch(new Request('https://jonmac.ai/dash/version', { method: 'POST' }), e, {});
  assert.equal(post.status, 404);
});
