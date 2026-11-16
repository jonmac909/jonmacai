// /scripts: private pages from R2 private/scripts/, only with a dashboard session. Plants the faults the gate must stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import worker from '../src/worker.js';
import { signSession, COOKIE } from '../src/auth.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const SECRET_TEXT = 'PAID COURSE SENTENCE';
const store = {
  'private/scripts/index.html': `<h1>index ${SECRET_TEXT}</h1>`,
  'private/scripts/course-1.html': `<p>course one ${SECRET_TEXT}</p>`,
  'private/scripts/counts.json': '{"words":1}',
  'private/other.html': `outside ${SECRET_TEXT}`,
  'proofs/x.html': `proof ${SECRET_TEXT}`,
};
// Worst case: a store that folds '..' like a file system, so any traversal the worker lets through would leak.
const UPLOADS = { get: async (k) => { k = posix.normalize(k.replace(/\\/g, '/')); return k in store ? { body: store[k] } : null; } };
const env = { SESSION_SECRET: SECRET, UPLOADS, ASSETS: { fetch: async (r) => new Response(`asset:${new URL(r.url).pathname}`) } };
const go = (path, cookie) => worker.fetch(new Request(`https://jonmac.ai${path}`, cookie ? { headers: { Cookie: cookie } } : {}), env, {});
const signedIn = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;

test('/scripts signed out: never the content, redirect to the dashboard sign-in', async () => {
  for (const p of ['/scripts/', '/scripts/index.html', '/scripts/course-1.html', '/scripts/counts.json', '/scripts/nope.html']) {
    const res = await go(p);
    const body = await res.text();
    assert.equal(res.status, 302, p);
    assert.equal(res.headers.get('Location'), 'https://jonmac.ai/dash/', p);
    assert.ok(!body.includes(SECRET_TEXT), p);
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store', p);
  }
  const bad = await go('/scripts/', `${COOKIE}=9999999999.forged`);
  assert.equal(bad.status, 302);
  const bare = await go('/scripts');
  assert.equal(bare.status, 308);
  assert.equal(bare.headers.get('Location'), 'https://jonmac.ai/scripts/');
  assert.ok(!(await bare.text()).includes(SECRET_TEXT));
});

test('/scripts signed in: index and pages load, private headers, nothing outside the prefix', async () => {
  const cookie = await signedIn();
  for (const [p, want] of [['/scripts/', 'index'], ['/scripts/index.html', 'index'], ['/scripts/course-1.html', 'course one']]) {
    const res = await go(p, cookie);
    assert.equal(res.status, 200, p);
    assert.ok((await res.text()).includes(want), p);
    assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8', p);
    assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow', p);
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store', p);
  }
  assert.equal((await go('/scripts/counts.json', cookie)).headers.get('Content-Type'), 'application/json');
  for (const p of ['/scripts/..%2fother.html', '/scripts/%2e%2e/other.html', '/scripts/..%5cother.html', '/scripts/../other.html',
    '/scripts/course-1.html/../../proofs/x.html', '/scripts/private/scripts/index.html', '/scripts/course-9.html', '/scripts/x/', '/scripts/index.htm']) {
    const body = await (await go(p, cookie)).text();
    assert.ok(!body.includes('outside') && !body.includes('proof '), p);
  }
});
