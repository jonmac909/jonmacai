import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COOKIE,
  signSession,
  verifySession,
  sessionCookieHeader,
  timingSafeEqualString,
  checkLockout,
  recordLoginFailure,
} from '../src/auth.js';

const SECRET = 'test-session-secret-32-bytes-ok!';

function memDb(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    async get(ip) {
      return rows.get(ip) || null;
    },
    async put(ip, row) {
      rows.set(ip, row);
    },
    rows,
  };
}

test('cookie name is __Host-cc_session', () => {
  assert.equal(COOKIE, '__Host-cc_session');
});

test('signed session verifies and expires', async () => {
  const exp = 1_800_000_000;
  const token = await signSession(SECRET, exp);
  assert.equal(await verifySession(SECRET, token, exp * 1000 - 1), exp);
  assert.equal(await verifySession(SECRET, token, exp * 1000 + 1), null);
  assert.equal(await verifySession(SECRET, 'not-a-token', Date.now()), null);
  assert.equal(await verifySession('other-secret-secret-secret-secret', token, exp * 1000 - 1), null);
});

test('session cookie is HttpOnly Secure SameSite=Strict', () => {
  const header = sessionCookieHeader('abc', 30 * 24 * 3600);
  assert.match(header, /^__Host-cc_session=abc;/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Path=\//);
  assert.match(header, /Max-Age=2592000/);
});

test('password compare is length-safe', () => {
  assert.equal(timingSafeEqualString('alpha', 'alpha'), true);
  assert.equal(timingSafeEqualString('alpha', 'alphb'), false);
  assert.equal(timingSafeEqualString('alpha', 'short'), false);
});

test('10 wrong tries in 15 minutes locks that IP for 15 minutes', async () => {
  const db = memDb();
  const ip = '1.2.3.4';
  const t0 = Date.parse('2026-09-18T12:00:00Z');
  for (let i = 0; i < 9; i++) {
    const r = await recordLoginFailure(db, ip, t0 + i * 1000);
    assert.equal(r.ipLocked, false);
  }
  assert.equal(await checkLockout(db, ip, t0 + 9_000), null);
  const tenth = await recordLoginFailure(db, ip, t0 + 10_000);
  assert.equal(tenth.ipLocked, true);
  assert.equal(await checkLockout(db, ip, t0 + 10_000), 'ip');
  assert.equal(await checkLockout(db, ip, t0 + 10_000 + 15 * 60 * 1000 - 1), 'ip');
  assert.equal(await checkLockout(db, ip, t0 + 10_000 + 15 * 60 * 1000), null);
});

test('51 wrong tries across IPs in an hour locks every IP for an hour', async () => {
  const db = memDb();
  const t0 = Date.parse('2026-09-18T12:00:00Z');
  for (let i = 0; i < 50; i++) {
    const r = await recordLoginFailure(db, `10.0.0.${i}`, t0 + i * 1000);
    assert.equal(r.globalLocked, false);
  }
  assert.equal(await checkLockout(db, '9.9.9.9', t0 + 50_000), null);
  const last = await recordLoginFailure(db, '10.0.0.50', t0 + 50_000);
  assert.equal(last.globalLocked, true);
  assert.equal(last.alert, true);
  assert.equal(await checkLockout(db, '9.9.9.9', t0 + 50_000), 'global');
  assert.equal(await checkLockout(db, '9.9.9.9', t0 + 50_000 + 60 * 60 * 1000 - 1), 'global');
  assert.equal(await checkLockout(db, '9.9.9.9', t0 + 50_000 + 60 * 60 * 1000), null);
});
