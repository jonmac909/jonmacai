// Skool email step as a pop-over on a screenshot of the Skool about page. See src/skool.js (capturePage, backdrop).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import worker from '../src/worker.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';

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

test('email step on: pop-over over a blurred Skool backdrop, no iframe, same form and privacy line', async () => {
  const e = env();
  await go(e, '/track/api/links', { method: 'POST', jon: true, body: { slug: 'pop', title: 'Pop' } });
  assert.equal((await go(e, '/track/api/capture', { method: 'POST', jon: true, body: { slug: 'pop', capture: true } })).status, 200);
  const g = await go(e, '/s/pop');
  assert.equal(g.status, 200);
  const html = await g.text();
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /Enter your email to get access/);
  assert.doesNotMatch(html, /stays on jonmac\.ai/); // Jon removed the privacy line
  assert.match(html, /<form method="post" action="\/s\/pop">/);
  assert.match(html, /url\(\/s\/about-desktop\.jpg\)/);
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
  assert.match(ok.headers.get('Location'), /^https:\/\/www\.skool\.com\/ai-ugc\?utm_source=youtube&utm_medium=video&utm_campaign=pop$/);
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
  const g = await go(e, '/s/constructor');
  assert.equal(g.status, 200);
  const html = await g.text();
  assert.match(html, /\.wrap\{[^}]*overflow:auto/);
  assert.match(html, /\.box\{margin:auto/);
});
