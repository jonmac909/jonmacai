import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import { memD1 } from './memd1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const MAC = 'mac-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const GPU = 'gpu-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function envWith(db) {
  return {
    SESSION_SECRET: SECRET,
    DASHBOARD_PASSWORD: 'test-dashboard-password',
    MACHINE_TOKEN_MAC: MAC,
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

test('ingest rejects a missing or wrong machine token', async () => {
  const env = envWith(memD1());
  const body = JSON.stringify({ source: 'agents_mac', collectedAt: '2026-09-18T18:00:00Z', data: { ok: true } });
  const noTok = await handleApi(req('/dashboard/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), env);
  assert.equal(noTok.status, 401);
  const bad = await handleApi(req('/dashboard/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' },
    body,
  }), env);
  assert.equal(bad.status, 401);
});

test('ingest upserts a snapshot and snapshot route overlays it', async () => {
  const db = memD1();
  const env = envWith(db);
  const collectedAt = new Date().toISOString();
  const res = await handleApi(req('/dashboard/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MAC}` },
    body: JSON.stringify({ source: 'agents_mac', collectedAt, data: { machine: 'mac', hostname: 'mini.local', ok: true } }),
  }), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  const row = db.snapshots.get('agents_mac');
  assert.equal(row.collected_at, collectedAt);
  assert.match(row.data, /mini.local/);

  const snap = await handleApi(req('/dashboard/api/snapshot?pages=home,agents', { cookie: await cookie() }), env);
  assert.equal(snap.status, 200);
  const json = await snap.json();
  assert.equal(json.pages.home.tiles[0].value, snapshot.pages.home.tiles[0].value);
  assert.equal(json.sources.agents_mac.updatedAt, collectedAt);
  assert.equal(json.sources.agents_mac.stale, false);
  const mac = json.pages.agents.machines.find((m) => m.id === 'mac');
  assert.equal(mac.hostname, 'mini.local');
  assert.equal(mac.stale, false);
});

test('stale GPU2 heartbeat shows Stale on the agents machine card', async () => {
  const db = memD1();
  const env = envWith(db);
  const collectedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  await handleApi(req('/dashboard/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GPU}` },
    body: JSON.stringify({ source: 'agents_gpu2', collectedAt, data: { machine: 'gpu2', hostname: 'gpu2', ok: true } }),
  }), env);
  const snap = await handleApi(req('/dashboard/api/snapshot?pages=agents', { cookie: await cookie() }), env);
  const json = await snap.json();
  const gpu = json.pages.agents.machines.find((m) => m.id === 'gpu2');
  assert.equal(gpu.stale, true);
  assert.ok(json.pages.agents.staleSources.some((s) => s.source === 'agents_gpu2'));
});

test('ping queues for the named machine and only that runner can claim it', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  const created = await handleApi(req('/dashboard/api/actions', {
    method: 'POST',
    cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ kind: 'ping', payload: { machine: 'mac' }, idemKey: 'ping-1' }),
  }), env);
  assert.equal(created.status, 200);
  const { id, status } = await created.json();
  assert.equal(status, 'queued');
  assert.ok(id);

  const stolen = await handleApi(req('/dashboard/api/actions/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GPU}` },
    body: JSON.stringify({ machine: 'mac' }),
  }), env);
  assert.equal(stolen.status, 401);

  const gpuClaim = await handleApi(req('/dashboard/api/actions/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GPU}` },
    body: JSON.stringify({ machine: 'gpu2' }),
  }), env);
  assert.equal(gpuClaim.status, 200);
  assert.equal((await gpuClaim.json()).actions.length, 0);

  const claim = await handleApi(req('/dashboard/api/actions/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MAC}` },
    body: JSON.stringify({ machine: 'mac' }),
  }), env);
  assert.equal(claim.status, 200);
  const claimed = await claim.json();
  assert.equal(claimed.actions.length, 1);
  assert.equal(claimed.actions[0].kind, 'ping');
  assert.equal(claimed.actions[0].target, 'mac');

  const done = await handleApi(req(`/dashboard/api/actions/${id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MAC}` },
    body: JSON.stringify({ ok: true, result: 'Mac mini is up' }),
  }), env);
  assert.equal(done.status, 200);

  const got = await handleApi(req(`/dashboard/api/actions/${id}`, { cookie: ck }), env);
  const row = await got.json();
  assert.equal(row.status, 'done');
  assert.equal(row.result, 'Mac mini is up');
});

test('gpu2 token cannot complete a mac action', async () => {
  const db = memD1();
  const env = envWith(db);
  const created = await handleApi(req('/dashboard/api/actions', {
    method: 'POST',
    cookie: await cookie(),
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ kind: 'ping', payload: { machine: 'mac' }, idemKey: 'ping-2' }),
  }), env);
  const { id } = await created.json();
  const res = await handleApi(req(`/dashboard/api/actions/${id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GPU}` },
    body: JSON.stringify({ ok: true, result: 'nope' }),
  }), env);
  assert.equal(res.status, 401);
});
