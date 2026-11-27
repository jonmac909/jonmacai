import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { matchAnswer, trackerData } from '../src/skool.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TOKEN = 'zap-token-for-tests';
const env = () => ({ DB: sqliteD1(), SESSION_SECRET: SECRET, SKOOL_ZAP_TOKEN: TOKEN });
async function go(e, path, { method = 'GET', body, jon, headers = {} } = {}) {
  const h = new Headers(headers);
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
const addLink = (e, slug, title, youtube_url) => go(e, '/track/api/links', { method: 'POST', jon: true, body: { slug, title, youtube_url } });

test('a short link counts the click and forwards to Skool with UTM tags, never ?ref', async () => {
  const e = env();
  assert.equal((await addLink(e, 'seedance-ugc', 'Seedance UGC', 'https://www.youtube.com/watch?v=jiwzKmYi4NU')).status, 201);
  e.DB.sqlite.exec('UPDATE skool_links SET capture = 0'); // email step off: straight forward
  const r = await go(e, '/s/seedance-ugc', { headers: { Referer: 'https://www.youtube.com/watch?v=jiwzKmYi4NU' } });
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://www.skool.com/jonmac/about');
  assert.equal(to.searchParams.get('utm_campaign'), 'seedance-ugc');
  assert.equal(to.searchParams.has('ref'), false);
  const row = await e.DB.prepare('SELECT * FROM skool_clicks').first();
  assert.equal(row.slug, 'seedance-ugc');
  assert.equal(row.referrer, 'www.youtube.com/watch'); // no query string kept
  await go(e, '/s/seedance-ugc?qc=1');
  await go(e, '/s/unknown-slug');
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_clicks').first()).n, 1);
  assert.equal((await go(e, '/s/unknown-slug')).status, 302); // unknown slugs still forward
});

test('sale intake needs the token', async () => {
  const e = env();
  assert.equal((await go(e, '/track/api/sale', { method: 'POST', body: { email: 'a@b.co' } })).status, 401);
  assert.equal((await go(e, '/track/api/sale?token=wrong', { method: 'POST', body: { email: 'a@b.co' } })).status, 401);
  assert.equal((await go({ ...e, SKOOL_ZAP_TOKEN: undefined }, '/track/api/sale?token=', { method: 'POST', body: { email: 'a@b.co' } })).status, 401);
  assert.equal((await go(e, `/track/api/sale?token=${TOKEN}`, { method: 'POST', body: { email: 'a@b.co', transaction_id: 't1' } })).status, 401); // URL tokens refused
  assert.equal((await go(e, '/track/api/sale', { method: 'POST', headers: { 'X-Track-Token': TOKEN }, body: { email: 'a@b.co', transaction_id: 't1' } })).status, 200);
  assert.equal((await go(e, '/track/api/sale', { method: 'POST', headers: { 'X-Track-Token': TOKEN }, body: { email: 'a@b.co', transaction_id: 't1' } })).status, 200);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_sales').first()).n, 1); // same transaction once
});

test('a sale goes to the video the answer names, else to the last click as an estimate', async () => {
  const e = env();
  await addLink(e, 'astra', 'GPT-6 Astra + Seedance 2.5', 'https://youtu.be/lmajeGL-1B8');
  await addLink(e, 'tiktok-shop', 'How to Find Winning TikTok Shop Products');
  await go(e, '/s/tiktok-shop');
  const H = { 'X-Track-Token': TOKEN };
  await go(e, '/track/api/answer', { method: 'POST', headers: H, body: { email: 'X@Y.co', answer: 'the gpt-6 astra + seedance 2.5 one' } });
  await go(e, '/track/api/sale', { method: 'POST', headers: H, body: { email: 'x@y.co', first_name: 'Ann', transaction_id: 's1' } });
  await go(e, '/track/api/sale', { method: 'POST', headers: H, body: { email: 'z@y.co', transaction_id: 's2' } });
  const d = await trackerData(e.DB);
  const by = Object.fromEntries(d.rows.map((r) => [r.slug, r]));
  assert.equal(by.astra.sales, 1);
  assert.equal(by['tiktok-shop'].estimated, 1);
  assert.equal(by['tiktok-shop'].clicks.all, 1);
  assert.equal(d.sales.find((s) => s.name === 'Ann').how, 'answer');
});

test('answers match by slug, YouTube ID or title', () => {
  const links = [{ slug: 'astra', title: 'GPT-6 Astra + Seedance 2.5', youtube_url: 'https://youtu.be/lmajeGL-1B8' }];
  assert.equal(matchAnswer('jonmac.ai/s/astra', links), 'astra');
  assert.equal(matchAnswer('https://www.youtube.com/watch?v=lmajeGL-1B8', links), 'astra');
  assert.equal(matchAnswer('GPT 6 Astra Seedance 2.5', links), 'astra');
  assert.equal(matchAnswer('a friend told me', links), null);
  assert.equal(matchAnswer('your ai ugc video', [{ slug: 'ai', title: 'Something else entirely' }]), null); // short slugs never match as a word
});

test('/track needs a session; adding a link needs the session and X-CC', async () => {
  const e = env();
  const out = await go(e, '/track');
  assert.equal(out.status, 302);
  assert.equal(out.headers.get('Location'), 'https://jonmac.ai/dash/');
  assert.equal((await go(e, '/track/api/links', { method: 'POST', body: { slug: 'ab', title: 't' } })).status, 401);
  assert.equal((await addLink(e, 'Bad Slug!', 't')).status, 400);
  assert.equal((await addLink(e, 'ok-slug', 't', 'https://evil.example/x')).status, 400);
  assert.equal((await addLink(e, 'ok-slug', '<b>t</b>')).status, 201);
  assert.equal((await addLink(e, 'ok-slug', 'again')).status, 409);
  const page = await go(e, '/track', { jon: true });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /jonmac\.ai\/ok-slug/);
  assert.match(html, /&lt;b&gt;t&lt;\/b&gt;/);
});

test('root short links (Jon 2026-11-21): jonmac.ai/<slug> works like /s/<slug>; routes win; unknown paths 404', async () => {
  const e = env();
  await go(e, '/track/api/links', { method: 'POST', jon: true, body: { slug: 'root-test', title: 'Root test' } });
  const r = await go(e, '/root-test');
  assert.ok([200, 302].includes(r.status), `root slug answered ${r.status}`);
  assert.ok((await go(e, '/s/root-test')).status !== 404, 'old /s/ link still works');
  assert.equal((await go(e, '/no-such-slug-here')).status, 404);
  const add = await go(e, '/track/api/links', { method: 'POST', jon: true, body: { slug: 'root-two', title: 'Two' } });
  assert.equal((await add.json()).url, 'https://jonmac.ai/root-two');
});
