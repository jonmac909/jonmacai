// Skool email step as a pop-over on a screenshot of the Skool about page. See src/skool.js (capturePage, backdrop).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import worker from '../src/worker.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const JPEG = readFileSync(new URL('../public/skool/about-desktop.jpg', import.meta.url));
const assetCalls = [];
const ASSETS = { async fetch(req) { const p = new URL(req.url).pathname; assetCalls.push(p); return p === '/skool/about-desktop.jpg' ? new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } }) : new Response('nope', { status: 404 }); } };
const env = () => ({ DB: sqliteD1(), SESSION_SECRET: SECRET, ASSETS });
async function go(e, path, { method = 'GET', body, jon } = {}) {
  const h = new Headers();
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}

test('the Skool about page cannot be framed, so the backdrop is a stored screenshot (both sizes ship)', () => {
  for (const f of ['about-desktop.jpg', 'about-mobile.jpg']) {
    const p = new URL(`../public/skool/${f}`, import.meta.url);
    assert.ok(existsSync(p), f);
    const b = readFileSync(p);
    assert.deepEqual([b[0], b[1], b[2]], [0xff, 0xd8, 0xff]); // a real JPEG
    assert.ok(b.length > 10000 && b.length < 400000);
  }
});

test('the priced Skool screenshots ($9/month, Regular $99/mo) never ship again (Jon 2026-11-24: no price anywhere)', async () => {
  const { createHash } = await import('node:crypto');
  const PRICED = new Set([
    '99e251c4491b1ae518c1d71e3bdb56e32bd064f68184269adc2429b95da0292c', // about-desktop.jpg before 2026-11-24
    'a3a6c8d10d5137187697afee3b43d056c899a6ef371910185090a8f8f446ef6d', // about-mobile.jpg before 2026-11-24
  ]);
  for (const f of ['about-desktop.jpg', 'about-mobile.jpg']) {
    const h = createHash('sha256').update(readFileSync(new URL(`../public/skool/${f}`, import.meta.url))).digest('hex');
    assert.ok(!PRICED.has(h), `${f} is the old screenshot with prices`);
  }
});

test('email step on: pop-over over the blurred Skool page (prices taken out of the screenshots), no iframe, same form and privacy line', async () => {
  const e = env();
  await go(e, '/track/api/links', { method: 'POST', jon: true, body: { slug: 'pop', title: 'Pop' } });
  assert.equal((await go(e, '/track/api/capture', { method: 'POST', jon: true, body: { slug: 'pop', capture: true } })).status, 200);
  const g = await go(e, '/s/pop'); // GET goes straight to the about page now (Jon 2026-11-25); the pop-over only answers a POST
  assert.equal(g.status, 302);
  assert.equal(new URL(g.headers.get('Location')).pathname, '/ai-ugc/about');
  const html = await (await go(e, '/s/pop', { method: 'POST', body: { email: 'x' } })).text();
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /Enter your email to get access/);
  assert.doesNotMatch(html, /stays on jonmac\.ai/); // Jon removed the privacy line
  assert.match(html, /<form method="post" action="\/pop">/);
  assert.match(html, /url\(\/s\/about-desktop\.jpg\)/); // the Skool page under the opt-in on every lander (Jon), screenshots with no price (Jon 2026-11-24)
  assert.match(html, /url\(\/s\/about-mobile\.jpg\)/);
  assert.match(html, /filter:blur\(/);
  assert.doesNotMatch(html, /<iframe/i);
  assert.doesNotMatch(html, /skool\.com/i); // nothing loads from Skool
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_clicks').first()).n, 1); // the click still counts
  // a bad email shows the same pop-over with the error
  const bad = await go(e, '/s/pop', { method: 'POST', body: { email: 'nope' } });
  assert.equal(bad.status, 400);
  const bh = await bad.text();
  assert.match(bh, /role="dialog"/); assert.match(bh, /Please enter a valid email address/);
  // a good email still stores lower case and forwards with UTM
  const ok = await go(e, '/s/pop', { method: 'POST', body: { email: 'Pop@Example.com' } });
  assert.equal(ok.status, 302);
  assert.match(ok.headers.get('Location'), /^https:\/\/www\.skool\.com\/ai-ugc\/about\?utm_source=youtube&utm_medium=video&utm_campaign=pop$/);
  assert.deepEqual((await e.DB.prepare('SELECT email FROM skool_leads').all()).results, [{ email: 'pop@example.com' }]);
});

test('email step off: no pop-over, straight 302 as before', async () => {
  const e = env();
  await go(e, '/track/api/links', { method: 'POST', jon: true, body: { slug: 'off', title: 'Off' } });
  e.DB.sqlite.exec('UPDATE skool_links SET capture = 0');
  const r = await go(e, '/s/off');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('Location'), /utm_campaign=off$/);
});

test('backdrop image route: serves only the two screenshots, GET only, no click, no slug clash', async () => {
  const e = env();
  const r = await go(e, '/s/about-desktop.jpg');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'image/jpeg');
  assert.match(r.headers.get('Cache-Control'), /max-age=\d+/);
  assert.equal(Buffer.from(await r.arrayBuffer()).length, JPEG.length);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_clicks').first()).n, 0);
  assert.equal((await go(e, '/s/about-desktop.jpg', { method: 'POST', body: {} })).status, 404);
  assetCalls.length = 0;
  for (const p of ['/s/other.jpg', '/s/about-desktop.jpg.png', '/s/..%2Fsecret.jpg', '/s/about-desktop.JPG.x']) {
    const x = await go(e, p);
    assert.notEqual(x.status, 200, p); // forwards (302), never an asset
  }
  assert.deepEqual(assetCalls, []);
  assert.equal((await go({ DB: e.DB, SESSION_SECRET: SECRET }, '/s/about-desktop.jpg')).status, 404); // no asset binding: 404, no crash
});

test('slug "constructor" is an ordinary link, not the image route; the box scrolls on short screens', async () => {
  const e = env();
  assert.equal((await go(e, '/s/constructor')).status, 302); // unknown slug forwards, as before
  await go(e, '/track/api/links', { method: 'POST', jon: true, body: { slug: 'constructor', title: 'C' } });
  await go(e, '/track/api/capture', { method: 'POST', jon: true, body: { slug: 'constructor', capture: true } });
  const g = await go(e, '/s/constructor', { method: 'POST', body: { email: 'x' } }); // the pop-over (now only after a bad POST)
  assert.equal(g.status, 400);
  const html = await g.text();
  assert.match(html, /\.wrap\{[^}]*overflow:auto/);
  assert.match(html, /\.box\{margin:auto/);
});
