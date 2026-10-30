import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import worker from '../src/worker.js';
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
                const row = data.find((r) => r.id === args[1] && r.status === 'queued');
                if (!row) return { success: true, meta: { changes: 0 } };
                row.status = 'claimed';
                row.claimed_at = args[0];
                return { success: true, meta: { changes: 1 } };
              }
              if (sql.includes('payload = ?')) {
                const row = data.find((r) => r.id === args[1]);
                if (row) row.payload = args[0];
              }
              if (sql.includes('finished_at')) {
                const row = data.find((r) => r.id === args[3]);
                if (row) { row.status = args[0]; row.result = args[1]; row.finished_at = args[2]; }
              }
              return { success: true, meta: { changes: 1 } };
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
  assert.deepEqual(Object.keys(json.pages), ['sponsors'], 'a removed page is not served');
  assert.equal(json.pages.sponsors.tiles[0].value, snapshot.pages.sponsors.tiles[0].value);
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

test('workers.dev is not a login surface', async () => {
  const res = await worker.fetch(new Request('https://jonmac-command-center.jon-c95.workers.dev/dashboard/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ password: PASS }),
  }), env);
  assert.equal(res.status, 404);
});

test('gpu2 token cannot ingest another machine\'s heartbeat', async () => {
  const res = await handleApi(req('/dashboard/api/ingest', {
    method: 'POST',
    headers: { Authorization: 'Bearer gpu2-token-value', 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'machine_gpu1', collectedAt: '2026-09-18T18:00:00Z', data: { ok: true } }),
  }), { ...env, ...TOKENS, DB: memDb() });
  assert.equal(res.status, 401);
});

test('ingest accepts a retired source and stores nothing; a kept source is still stored', async () => {
  const writes = [];
  const DB = { prepare: (sql) => ({ bind: (...args) => ({ run: async () => { writes.push([sql.split(' (')[0], args[0]]); return { meta: { changes: 1 } }; } }) }) };
  const send = (source) => handleApi(req('/dashboard/api/ingest', {
    method: 'POST',
    headers: { Authorization: 'Bearer gpu2-token-value', 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, collectedAt: '2026-10-29T18:00:00Z', data: { team: [{ name: 'Old bot' }], deliverables: [{ id: 'd1' }], questions: [{ id: 'q1' }] } }),
  }), { ...env, ...TOKENS, DB });
  for (const source of ['jon_tasks', 'team', 'agents_gpu2', 'partners_report', 'webinar']) {
    const res = await send(source);
    assert.deepEqual([res.status, await res.json()], [200, { ok: true, ignored: true }], source);
  }
  assert.deepEqual(writes, [], 'nothing is written for a retired source, not even its team, deliverables or questions');
  const kept = await send('sponsors_cash');
  assert.deepEqual([kept.status, await kept.json()], [200, { ok: true }]);
  assert.deepEqual(writes, [['INSERT OR REPLACE INTO snapshots', 'sponsors_cash']]);
});

test('the nav holds exactly the kept pages, and those are the pages served', async () => {
  const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;
  const json = await (await handleApi(req('/dashboard/api/snapshot', { cookie }), env)).json();
  const ids = json.nav.groups.flatMap((g) => g.items.map((i) => i.id));
  assert.deepEqual(ids, ['today', 'todo', 'projects', 'feed', 'calendar', 'content', 'sponsors', 'viral', 'webinar', 'money', 'life', 'journal']);
  assert.deepEqual(Object.keys(json.pages), ids);
});
