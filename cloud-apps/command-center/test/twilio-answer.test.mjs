import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { twilioSignature } from '../src/twilioanswer.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';

const TOKEN = 't'.repeat(32);
const SESSION_SECRET = 'x'.repeat(32);
const BOT_TOKEN = `ccb_${'a'.repeat(40)}`;
const Q = 'a1b2c3d4e5f60718';
const ASSETS = { fetch: async () => new Response('asset') };

async function makeEnv() {
  const DB = sqliteD1();
  DB.sqlite.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').run(await sha256Hex(BOT_TOKEN), 'ana', new Date().toISOString());
  return { ASSETS, DB, TWILIO_AUTH_TOKEN: TOKEN, SESSION_SECRET };
}
const call = (env, path, init = {}) => worker.fetch(new Request('https://jonmac.ai' + path, init), env, {});
// What Twilio sends: a form POST signed over the full URL and the form fields.
async function twilioPost(env, path, fields, { token = TOKEN, sign = true } = {}) {
  const form = new URLSearchParams(fields);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (sign) headers['X-Twilio-Signature'] = await twilioSignature(token, 'https://jonmac.ai' + path, form);
  return call(env, path, { method: 'POST', headers, body: form.toString() });
}
const rows = (env) => env.DB.sqlite.prepare('SELECT q, digit, at FROM phone_answers').all();

test('signature follows Twilio\'s algorithm (value computed independently with Python hmac)', async () => {
  // url + name+value of each field sorted by name, HMAC-SHA1 with the auth token, base64.
  const params = new URLSearchParams({ CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' });
  assert.equal(await twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', params), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
});

test('a bad or missing signature is refused and stores nothing', async () => {
  const env = await makeEnv();
  const path = `/twilio/answer?q=${Q}&n=3`;
  assert.equal((await twilioPost(env, path, { Digits: '1' }, { sign: false })).status, 403);
  assert.equal((await twilioPost(env, path, { Digits: '1' }, { token: 'w'.repeat(32) })).status, 403);
  // Signed for another question id, then replayed against this one.
  const form = new URLSearchParams({ Digits: '1' });
  const headers = { 'X-Twilio-Signature': await twilioSignature(TOKEN, `https://jonmac.ai/twilio/answer?q=${'f'.repeat(16)}&n=3`, form) };
  assert.equal((await call(env, path, { method: 'POST', headers, body: form })).status, 403);
  // Tampered field after signing.
  const good = await twilioSignature(TOKEN, 'https://jonmac.ai' + path, new URLSearchParams({ Digits: '1' }));
  assert.equal((await call(env, path, { method: 'POST', headers: { 'X-Twilio-Signature': good }, body: new URLSearchParams({ Digits: '2' }) })).status, 403);
  assert.deepEqual(rows(env), []);
});

test('no auth token configured refuses everything', async () => {
  const env = await makeEnv();
  delete env.TWILIO_AUTH_TOKEN;
  assert.equal((await twilioPost(env, `/twilio/answer?q=${Q}`, { Digits: '1' })).status, 503);
});

test('a valid digit is stored once and Jon hears "Got it, thanks."', async () => {
  const env = await makeEnv();
  const path = `/twilio/answer?q=${Q}&n=3`;
  const res = await twilioPost(env, path, { Digits: '2', CallSid: 'CAx' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/xml/);
  const xml = await res.text();
  assert.match(xml, /<Say[^>]*>Got it, thanks\.<\/Say>/);
  assert.doesNotMatch(xml, /Gather/);
  let r = rows(env);
  assert.equal(r.length, 1);
  assert.equal(r[0].q, Q);
  assert.equal(r[0].digit, 2);
  assert.ok(Date.parse(r[0].at) > Date.now() - 60000);
  // A Twilio retry or a second press never changes the first answer.
  await twilioPost(env, path, { Digits: '3' });
  assert.deepEqual(rows(env).map((x) => x.digit), [2]);
});

test('a wrong key repeats the question once, then gives up; nothing is stored', async () => {
  const env = await makeEnv();
  const t = encodeURIComponent('Ship it now? Press 1 for yes. Press 2 for no.');
  const path = `/twilio/answer?q=${Q}&n=2&t=${t}`;
  const first = await (await twilioPost(env, path, { Digits: '7' })).text();
  assert.match(first, /<Gather numDigits="1" timeout="10" action="https:\/\/jonmac\.ai\/twilio\/answer\?q=[0-9a-f]+&amp;n=2&amp;t=[^"]*&amp;r=1">/);
  assert.match(first, /Ship it now\? Press 1 for yes/);
  assert.match(first, /I'll message you instead/);
  const again = await (await twilioPost(env, path + '&r=1', { Digits: '9' })).text();
  assert.doesNotMatch(again, /Gather/);
  assert.match(again, /I'll message you instead/);
  // 0, # and empty are wrong keys too; the digit has to be within n.
  for (const d of ['0', '#', '', '3']) await twilioPost(env, `/twilio/answer?q=${Q}&n=2`, { Digits: d });
  assert.deepEqual(rows(env), []);
});

test('prompt text is XML-escaped in the repeat', async () => {
  const env = await makeEnv();
  const path = `/twilio/answer?q=${Q}&n=2&t=${encodeURIComponent('A <b> & "c"')}`;
  const xml = await (await twilioPost(env, path, { Digits: '9' })).text();
  assert.doesNotMatch(xml, /<b>/);
  assert.match(xml, /A &lt;b&gt; &amp; &quot;c&quot;/);
});

test('a bad question id is refused even when signed', async () => {
  const env = await makeEnv();
  assert.equal((await twilioPost(env, '/twilio/answer?q=nope', { Digits: '1' })).status, 400);
  assert.equal((await twilioPost(env, '/twilio/answer', { Digits: '1' })).status, 400);
  assert.deepEqual(rows(env), []);
});

test('signed-out GET is refused; a bot token or a session reads the answer', async () => {
  const env = await makeEnv();
  assert.equal((await call(env, `/twilio/answer/${Q}`)).status, 401);
  assert.equal((await call(env, `/twilio/answer/${Q}`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call(env, `/twilio/answer/${Q}`, { headers: { Authorization: `Bearer ccb_${'b'.repeat(40)}` } })).status, 401);
  const bot = { headers: { Authorization: `Bearer ${BOT_TOKEN}` } };
  let res = await call(env, `/twilio/answer/${Q}`, bot);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { q: Q, answered: false });
  await twilioPost(env, `/twilio/answer?q=${Q}&n=3`, { Digits: '3' });
  const got = await (await call(env, `/twilio/answer/${Q}`, bot)).json();
  assert.equal(got.answered, true);
  assert.equal(got.digit, 3);
  const cookie = `${COOKIE}=${await signSession(SESSION_SECRET, Date.now() + 3600e3)}`;
  assert.equal((await (await call(env, `/twilio/answer/${Q}`, { headers: { Cookie: cookie } })).json()).digit, 3);
  assert.equal((await call(env, '/twilio/answer/zzz', bot)).status, 400);
});

test('other methods on the route are refused', async () => {
  const env = await makeEnv();
  assert.equal((await call(env, `/twilio/answer?q=${Q}`)).status, 405);
  assert.equal((await call(env, `/twilio/answer/${Q}`, { method: 'POST' })).status, 405);
});
