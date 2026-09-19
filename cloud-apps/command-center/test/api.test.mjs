import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { claimQueued } from '../src/db.js';
import { signSession, sessionCookieHeader, COOKIE } from '../src/auth.js';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };

const SECRET = 'test-session-secret-32-bytes-ok!';
const PASS = 'test-dashboard-password';
const env = { SESSION_SECRET: SECRET, DASHBOARD_PASSWORD: PASS };
const TOKENS = { MACHINE_TOKEN_MAC: 'mac-token-value', MACHINE_TOKEN_GPU2: 'gpu2-token-value' };

function memDb(rows = []) {
  const data = rows.map((r) => ({ ...r }));
  return {
    data,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('WHERE id')) return data.find((r) => r.id === args[0]) || null;
              return null;
            },
            async all() {
              const [machine] = args;
              return { results: data.filter((r) => r.target === machine && r.status === 'queued').map((r) => ({ ...r })) };
            },
            async run() {
              if (sql.includes("status = 'claimed'")) {
                const row = data.find((r) => r.id === args[1]);
                if (row) { row.status = 'claimed'; row.claimed_at = args[0]; }
              }
              if (sql.includes('payload = ?')) {
                const row = data.find((r) => r.id === args[1]);
                if (row) row.payload = args[0];
              }
              if (sql.includes('finished_at')) {
                const row = data.find((r) => r.id === args[3]);
                if (row) { row.status = args[0]; row.result = args[1]; row.finished_at = args[2]; }
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

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

test('login without X-CC is rejected', async () => {
  const res = await handleApi(req('/dashboard/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASS }),
  }), env);
  assert.equal(res.status, 403);
});

test('login with X-CC sets a session cookie', async () => {
  const res = await handleApi(req('/dashboard/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ password: PASS }),
  }), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Set-Cookie') || '', /__Host-cc_session=/);
});

test('logout without X-CC does not clear the cookie', async () => {
  const res = await handleApi(req('/dashboard/api/logout', { method: 'POST' }), env);
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('Set-Cookie'), null);
});

test('unset dashboard password does not accept an empty password', async () => {
  const res = await handleApi(req('/dashboard/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ password: '' }),
  }), { SESSION_SECRET: SECRET });
  assert.equal(res.status, 401);
});

test('ingest rejects an unknown machine even with a mac token', async () => {
  const res = await handleApi(req('/dashboard/api/ingest', {
    method: 'POST',
    headers: { Authorization: 'Bearer mac-token-value', 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine: 'nope' }),
  }), { ...env, ...TOKENS });
  assert.equal(res.status, 401);
});

test('gpu2 token cannot complete a mac action', async () => {
  const db = memDb([{ id: 'a1', target: 'mac', status: 'claimed', payload: '{}' }]);
  const res = await handleApi(req('/dashboard/api/actions/a1/complete', {
    method: 'POST',
    headers: { Authorization: 'Bearer gpu2-token-value', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, result: 'stolen' }),
  }), { ...env, ...TOKENS, DB: db });
  assert.equal(res.status, 401);
  assert.equal(db.data[0].status, 'claimed');
});

test('mac token can complete its own action', async () => {
  const db = memDb([{ id: 'a1', target: 'mac', status: 'claimed', payload: '{}' }]);
  const res = await handleApi(req('/dashboard/api/actions/a1/complete', {
    method: 'POST',
    headers: { Authorization: 'Bearer mac-token-value', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, result: 'ok' }),
  }), { ...env, ...TOKENS, DB: db });
  assert.equal(res.status, 200);
  assert.equal(db.data[0].status, 'done');
});

test('claim returns bank code to the runner then wipes storage', async () => {
  const db = memDb([{
    id: 'b1', kind: 'bank.submit_code', target: 'mac', status: 'queued',
    payload: JSON.stringify({ code: '123456' }),
  }]);
  const rows = await claimQueued(db, 'mac', 'now');
  assert.equal(JSON.parse(rows[0].payload).code, '123456');
  assert.equal(db.data[0].payload, '{}');
});
