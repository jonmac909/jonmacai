// Proof files: POST /dashboard/api/v1/files (bot token) stores one file in R2; GET /dashboard/f/<name> reads it, no sign-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { sha256Hex } from '../src/bots.js';
import { sqliteD1 } from './sqlited1.mjs';

const TOKEN = `ccb_${'d'.repeat(43)}`;

// Minimal R2: put reads the stream, get returns a fresh body each time.
function fakeR2() {
  const store = new Map();
  return {
    store,
    async put(key, body, opts) { store.set(key, { bytes: new Uint8Array(await new Response(body).arrayBuffer()), opts }); },
    async get(key) {
      const hit = store.get(key);
      return hit ? { body: new Response(hit.bytes).body, size: hit.bytes.byteLength } : null;
    },
  };
}

async function setup() {
  const db = sqliteD1();
  await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(TOKEN), 'developer', '2026-11-01T00:00:00.000Z').run();
  return { DB: db, UPLOADS: fakeR2() };
}

function upload(env, name, bytes, { token = TOKEN, length } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (length !== undefined) headers.set('Content-Length', String(length));
  else headers.set('Content-Length', String(bytes.byteLength));
  const req = new Request(`https://jonmac.ai/dashboard/api/v1/files?name=${encodeURIComponent(name)}`, { method: 'POST', headers, body: bytes });
  return worker.fetch(req, env, {}).then(async (r) => ({ status: r.status, body: await r.json() }));
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test('a bot uploads a png and anyone reads it back at an unguessable https link', async () => {
  const env = await setup();
  const up = await upload(env, 'D:\\qc\\sheet.png', PNG);
  assert.equal(up.status, 200);
  assert.match(up.body.url, /^https:\/\/jonmac\.ai\/dashboard\/f\/[0-9a-f]{32}\.png$/);
  assert.equal(up.body.bytes, PNG.byteLength);
  const [key] = env.UPLOADS.store.keys();
  assert.match(key, /^proofs\/[0-9a-f]{32}\.png$/);
  assert.equal(env.UPLOADS.store.get(key).opts.customMetadata.bot, 'developer');

  const read = await worker.fetch(new Request(up.body.url), env, {});
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('Content-Type'), 'image/png');
  assert.equal(read.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await read.arrayBuffer()), PNG);
});

test('two uploads of the same file get different names', async () => {
  const env = await setup();
  const a = await upload(env, 'a.txt', new TextEncoder().encode('hi'));
  const b = await upload(env, 'a.txt', new TextEncoder().encode('hi'));
  assert.notEqual(a.body.url, b.body.url);
  const read = await worker.fetch(new Request(a.body.url), env, {});
  assert.equal(read.headers.get('Content-Type'), 'text/plain; charset=utf-8');
});

test('no token or a bad token gets 401 and stores nothing', async () => {
  const env = await setup();
  assert.equal((await upload(env, 'a.png', PNG, { token: null })).status, 401);
  assert.equal((await upload(env, 'a.png', PNG, { token: `ccb_${'x'.repeat(43)}` })).status, 401);
  assert.equal(env.UPLOADS.store.size, 0);
});

test('empty, oversize and unlisted files are refused and nothing is stored', async () => {
  const env = await setup();
  assert.equal((await upload(env, 'a.png', new Uint8Array(0))).status, 400);
  assert.equal((await upload(env, 'a.png', PNG, { length: 96 * 1024 * 1024 })).status, 413);
  const html = await upload(env, 'page.html', PNG);
  assert.equal(html.status, 415);
  assert.match(html.body.error, /png, jpg/);
  assert.equal((await upload(env, 'noext', PNG)).status, 415);
  assert.equal(env.UPLOADS.store.size, 0);
});

test('reads: unknown, malformed and traversal names are 404; upload route only takes POST', async () => {
  const env = await setup();
  for (const path of ['/dashboard/f/' + '0'.repeat(32) + '.png', '/dashboard/f/abc.png', '/dashboard/f/..%2Fproofs%2F' + '0'.repeat(32) + '.png', '/dashboard/f/' + '0'.repeat(32) + '.html']) {
    assert.equal((await worker.fetch(new Request(`https://jonmac.ai${path}`), env, {})).status, 404, path);
  }
  const get = await worker.fetch(new Request('https://jonmac.ai/dashboard/api/v1/files', { headers: { Authorization: `Bearer ${TOKEN}` } }), env, {});
  assert.equal(get.status, 405);
});
