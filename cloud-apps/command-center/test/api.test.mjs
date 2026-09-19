import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { signSession, sessionCookieHeader, COOKIE } from '../src/auth.js';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };

const SECRET = 'test-session-secret-32-bytes-ok!';
const env = { SESSION_SECRET: SECRET, DASHBOARD_PASSWORD: '909090' };

function req(path, { method = 'GET', cookie, headers = {}, body } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  return new Request(`https://jonmac.ai${path}`, { method, headers: h, body });
}

test('snapshot route requires a session', async () => {
  const res = await handleApi(req('/dashboard/api/snapshot'), env);
  assert.equal(res.status, 401);
});

test('snapshot route rejects an expired session', async () => {
  const token = await signSession(SECRET, 1);
  const cookie = sessionCookieHeader(token, 1);
  const res = await handleApi(req('/dashboard/api/snapshot', { cookie }), env);
  assert.equal(res.status, 401);
});

test('snapshot route returns fixture pages for a valid session', async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = await signSession(SECRET, exp);
  const cookie = `${COOKIE}=${token}`;
  const res = await handleApi(req('/dashboard/api/snapshot?pages=home,sponsors', { cookie }), env);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.pages.home.tiles[0].value, snapshot.pages.home.tiles[0].value);
  assert.ok(json.pages.sponsors);
  assert.equal(json.pages.viral, undefined);
  assert.ok(json.sources.sponsors.updatedAt);
});
