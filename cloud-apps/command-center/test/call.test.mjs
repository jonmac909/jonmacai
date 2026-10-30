import test from 'node:test';
import assert from 'node:assert/strict';
import { signSession, COOKIE } from '../src/auth.js';

// Workers runtime pieces that Node lacks: WebSocketPair, auto-response pairs and 101 responses.
class FakeSocket {
  constructor() { this.readyState = 1; this.sent = []; this.closedWith = null; this.att = null; }
  accept() {}
  send(msg) { if (this.readyState !== 1) throw new Error('closed'); this.sent.push(msg); }
  close(code, reason) { this.readyState = 3; this.closedWith = [code, reason]; }
  serializeAttachment(v) { this.att = structuredClone(v); }
  deserializeAttachment() { return this.att; }
}
globalThis.WebSocketPair = class {
  constructor() { this[0] = new FakeSocket(); this[1] = new FakeSocket(); this[0].server = this[1]; }
};
globalThis.WebSocketRequestResponsePair = class { constructor(request, response) { this.request = request; this.response = response; } };
const NodeResponse = globalThis.Response;
globalThis.Response = class extends NodeResponse {
  constructor(body, init = {}) {
    super(body, init.status === 101 ? { ...init, status: 200 } : init);
    if (init.status === 101) this.webSocket = init.webSocket;
  }
};
const { default: worker } = await import('../src/worker.js');
const { CallRelay, STARTS_PER_HOUR, MAX_CALL_MS } = await import('../src/call.js');

const SECRET = 'test-session-secret-32-bytes-ok!';
const RELAY_SECRET = 'r'.repeat(48);

function namespace() {
  const seen = [];
  return {
    seen,
    idFromName: (name) => name,
    get: (id) => ({ fetch: async (req) => { seen.push({ id, role: req.headers.get('X-Call-Role') }); return new NodeResponse('to relay'); } }),
  };
}

function env(extra = {}) {
  return {
    SESSION_SECRET: SECRET,
    CALL_RELAY_SECRET: RELAY_SECRET,
    CALL_RELAY: namespace(),
    ASSETS: { fetch: async (req) => new NodeResponse(new URL(req.url).pathname) },
    ...extra,
  };
}

async function cookie() {
  return `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;
}

function req(path, headers = {}) {
  return new Request(`https://jonmac.ai${path}`, { headers });
}

test('the call page and a phone call need a signed-in dashboard session', async () => {
  const e = env();
  const ws = { Upgrade: 'websocket', Origin: 'https://jonmac.ai' };
  assert.equal(await (await worker.fetch(req('/dashboard/call'), e)).text(), '/login.html');
  assert.equal(await (await worker.fetch(req('/dashboard/call', { Cookie: await cookie() }), e)).text(), '/call.html');
  assert.equal(await (await worker.fetch(req('/dashboard/call.html'), e)).text(), '/login.html');

  assert.equal((await worker.fetch(req('/dashboard/api/call/phone', ws), e)).status, 401);
  assert.equal((await worker.fetch(req('/dashboard/api/call/phone', { ...ws, Cookie: `${COOKIE}=123.abc` }), e)).status, 401);
  assert.equal((await worker.fetch(req('/dashboard/api/call/phone', { ...ws, Cookie: await cookie(), Origin: 'https://evil.example' }), e)).status, 403);
  assert.equal((await worker.fetch(req('/dashboard/api/call/phone', { Origin: 'https://jonmac.ai', Cookie: await cookie() }), e)).status, 426);
  assert.equal(e.CALL_RELAY.seen.length, 0, 'nothing reached the relay');

  const ok = await worker.fetch(req('/dashboard/api/call/phone', { ...ws, Cookie: await cookie(), 'X-Call-Role': 'gpu1' }), e);
  assert.equal(await ok.text(), 'to relay');
  assert.deepEqual(e.CALL_RELAY.seen, [{ id: 'ana', role: 'phone' }], 'a phone can never claim to be GPU1');
});

test('GPU1 connects only with the long relay secret', async () => {
  const ws = { Upgrade: 'websocket' };
  const tries = [
    [env(), {}],
    [env(), { Authorization: 'Bearer wrong' }],
    [env(), { Authorization: `Bearer ${RELAY_SECRET}x` }],
    [env({ CALL_RELAY_SECRET: 'short' }), { Authorization: 'Bearer short' }],
    [env({ CALL_RELAY_SECRET: undefined }), { Authorization: 'Bearer ' }],
  ];
  for (const [e, headers] of tries) {
    assert.equal((await worker.fetch(req('/dashboard/api/call/gpu1', { ...ws, ...headers }), e)).status, 401);
    assert.equal(e.CALL_RELAY.seen.length, 0);
  }
  const e = env();
  await worker.fetch(req('/dashboard/api/call/gpu1', { ...ws, Authorization: `Bearer ${RELAY_SECRET}` }), e);
  assert.deepEqual(e.CALL_RELAY.seen, [{ id: 'ana', role: 'gpu1' }]);
  assert.equal((await worker.fetch(req('/dashboard/api/call/other', ws), env())).status, 404);
});

// ---- the Durable Object, driven the way the runtime drives it ----

function relay() {
  const tags = new Map();
  const store = new Map();
  const ctx = {
    alarmAt: null,
    acceptWebSocket(ws, t) { tags.set(ws, t); },
    getWebSockets(tag) { return [...tags.keys()].filter((ws) => tags.get(ws).includes(tag)); },
    getTags(ws) { return tags.get(ws) || []; },
    setWebSocketAutoResponse(pair) { ctx.auto = pair; },
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => { store.set(k, v); },
      setAlarm: async (t) => { ctx.alarmAt = t; },
    },
  };
  const room = new CallRelay(ctx);
  room.connect = async (role) => (await room.fetch(new Request('https://relay/', { headers: { 'X-Call-Role': role } }))).webSocket.server;
  return { ctx, room };
}

const events = (ws) => ws.sent.filter((m) => typeof m === 'string').map((m) => JSON.parse(m).type);

test('a call is refused while GPU1 is offline', async () => {
  const { room } = relay();
  const phone = await room.connect('phone');
  assert.equal(phone.closedWith[0], 4503);
  assert.match(phone.closedWith[1], /GPU1 is offline/);
});

test('ten call starts an hour and one call at a time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-30T12:00:00Z') });
  const { room } = relay();
  const gpu1 = await room.connect('gpu1');
  const phones = [];
  for (let i = 0; i < STARTS_PER_HOUR; i++) {
    phones.push(await room.connect('phone'));
    t.mock.timers.tick(60_000);
  }
  assert.equal(phones.at(-1).closedWith, null, 'the latest call is on');
  assert.ok(phones.slice(0, -1).every((p) => p.closedWith[0] === 4001), 'each new call replaced the one before');
  const refused = await room.connect('phone');
  assert.equal(refused.closedWith[0], 4429);
  assert.equal(phones.at(-1).closedWith, null, 'a refused call leaves the current one alone');
  t.mock.timers.tick(60 * 60 * 1000 - 9 * 60_000);
  assert.equal((await room.connect('phone')).closedWith, null, 'allowed again once the first start is an hour old');
  assert.equal(events(gpu1).filter((e) => e === 'call.start').length, STARTS_PER_HOUR + 1);
});

test('audio and events pass both ways once GPU1 has picked up', async () => {
  const { ctx, room } = relay();
  assert.equal(ctx.auto.request, 'ping', 'the idle GPU1 link is answered without waking the object');
  assert.equal(ctx.auto.response, 'pong');
  const gpu1 = await room.connect('gpu1');
  const phone = await room.connect('phone');
  assert.deepEqual(events(gpu1), ['call.start']);

  const mic = new Uint8Array([1, 2, 3, 4]).buffer;
  room.webSocketMessage(phone, mic);
  assert.equal(gpu1.sent.at(-1), mic);

  room.webSocketMessage(gpu1, new Uint8Array([9, 9]).buffer);
  room.webSocketMessage(gpu1, '{"type":"session.output_transcript.delta","delta":"old call"}');
  assert.equal(phone.sent.length, 0, 'frames from before this call never reach the phone');

  room.webSocketMessage(gpu1, '{"type":"call.started"}');
  const voice = new Uint8Array([5, 6]).buffer;
  room.webSocketMessage(gpu1, voice);
  room.webSocketMessage(gpu1, '{"type":"session.output_transcript.delta","delta":"Hola Jon"}');
  assert.deepEqual(phone.sent, ['{"type":"call.started"}', voice, '{"type":"session.output_transcript.delta","delta":"Hola Jon"}']);

  room.webSocketMessage(phone, '{"type":"call.start"}');
  assert.equal(events(gpu1).length, 1, 'the phone cannot send GPU1 commands');

  room.webSocketMessage(gpu1, '{"type":"session.closed","reason":"connection_lost"}');
  assert.deepEqual(phone.closedWith, [1000, 'Call ended.']);
});

test('hang up, a dropped phone and the 30-minute cap end the call on GPU1', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-30T12:00:00Z') });
  const { ctx, room } = relay();
  const gpu1 = await room.connect('gpu1');

  const a = await room.connect('phone');
  assert.equal(ctx.alarmAt, Date.now() + MAX_CALL_MS);
  room.webSocketMessage(a, '{"type":"session.close"}');
  assert.deepEqual(a.closedWith, [1000, 'Call ended.']);
  assert.deepEqual(events(gpu1), ['call.start', 'call.end']);

  const b = await room.connect('phone');
  b.readyState = 3;
  room.webSocketClose(b, 1006, '', false);
  assert.deepEqual(events(gpu1).slice(2), ['call.start', 'call.end']);

  const c = await room.connect('phone');
  await room.alarm();
  assert.equal(c.closedWith[0], 4408);
  assert.deepEqual(events(gpu1).slice(4), ['call.start', 'call.end']);
});

test('GPU1 dropping or reconnecting ends the call on the phone', async () => {
  const { room } = relay();
  const gpu1 = await room.connect('gpu1');
  const a = await room.connect('phone');
  gpu1.readyState = 3;
  room.webSocketClose(gpu1, 1006, '', false);
  assert.equal(a.closedWith[0], 4502);

  const again = await room.connect('gpu1');
  const b = await room.connect('phone');
  const newer = await room.connect('gpu1');
  assert.equal(b.closedWith[0], 4502, 'the call on the old link ends');
  assert.equal(again.closedWith[0], 4000, 'only one GPU1 link at a time');
  assert.equal(newer.closedWith, null);
});
