// No /s/ in tracker links (Jon, 2026-11-21): jonmac.ai/<slug> is the short link, /s/<slug> answers 301 to it,
// every route wins over a slug, an unknown path stays 404, and a route name cannot be a slug. See src/skool.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { RESERVED, ROUTED_SLUGS, reservedSlug } from '../src/skool.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const env = () => ({ DB: sqliteD1(), SESSION_SECRET: SECRET });
async function go(e, path, { method = 'GET', body, jon } = {}) {
  const h = new Headers();
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
const clicks = async (e) => (await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_clicks').first()).n;
const add = (e, slug) => go(e, '/track/api/links', { method: 'POST', jon: true, body: { slug, title: 'T' } });

test('/mythos52 shows the pop-over (form posts to /mythos52) and counts one click', async () => {
  const e = env();
  const a = await add(e, 'mythos52');
  assert.equal(a.status, 201);
  assert.equal((await a.json()).url, 'https://jonmac.ai/mythos52'); // the add-link API hands out the new form
  const r = await go(e, '/mythos52');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Enter your email to get access/);
  assert.match(html, /<form method="post" action="\/mythos52">/);
  assert.equal(await clicks(e), 1);
  const p = await go(e, '/mythos52', { method: 'POST', body: { email: 'buyer@example.com' } });
  assert.equal(p.status, 302);
  assert.equal(new URL(p.headers.get('Location')).searchParams.get('utm_campaign'), 'mythos52');
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_leads').first()).n, 1);
  e.DB.sqlite.exec('UPDATE skool_links SET capture = 0');
  const off = await go(e, '/Mythos52');
  assert.equal(off.status, 302); // email step off: straight to Skool, slug case-insensitive as before
  assert.equal(new URL(off.headers.get('Location')).origin, 'https://www.skool.com');
  assert.equal(await clicks(e), 2);
  assert.equal((await go(e, '/mythos52/')).status, 302); // one trailing slash still works, as /s/<slug>/ did
  assert.equal(await clicks(e), 3);
});

test('/s/mythos52 answers 301 to /mythos52 with the query kept and counts nothing; the click counts once on /mythos52', async () => {
  const e = env();
  await add(e, 'mythos52');
  const r = await go(e, '/s/mythos52?utm_x=1&b=2');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), 'https://jonmac.ai/mythos52?utm_x=1&b=2');
  assert.equal(await clicks(e), 0);
  await go(e, new URL(r.headers.get('Location')).pathname + new URL(r.headers.get('Location')).search);
  assert.equal(await clicks(e), 1);
  // An old pop-over still open in a tab posts to /s/: the email is still taken (a 301 would drop it).
  const p = await go(e, '/s/mythos52', { method: 'POST', body: { email: 'old@example.com' } });
  assert.equal(p.status, 302);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_leads').first()).n, 1);
  assert.equal(await clicks(e), 1);
  assert.equal((await go(e, '/s/never-added')).status, 302); // unknown /s/ slug still forwards to Skool, as before
  assert.equal((await go(e, '/s/about-desktop.jpg')).status, 404); // backdrop route untouched (no ASSETS here)
});

test('routes win: /track still loads the tracker, other paths are not slugs, an unknown path is 404', async () => {
  const e = env();
  await add(e, 'mythos52');
  const t = await go(e, '/track', { jon: true });
  assert.equal(t.status, 200);
  const html = await t.text();
  assert.match(html, /Skool tracker/);
  assert.match(html, /data-url="https:\/\/jonmac\.ai\/mythos52">jonmac\.ai\/mythos52</);
  assert.doesNotMatch(html, /jonmac\.ai\/s\//);
  assert.equal((await go(e, '/track')).status, 302); // signed out: sign-in, as before
  assert.equal((await go(e, '/zzqq-nothing')).status, 404);
  assert.equal((await go(e, '/mythos52/extra')).status, 404);
  assert.equal((await go(e, '/')).status, 404);
  // A slug row named like a route (planted straight into the table) never takes the route's path.
  e.DB.sqlite.exec("INSERT INTO skool_links (slug, title, created_at, capture) VALUES ('scripts', 'x', '2026-01-01', 0), ('api', 'x', '2026-01-01', 0)");
  assert.equal((await go(e, '/scripts')).status, 308); // still the scripts route
  assert.equal((await go(e, '/api')).status, 404); // reserved: not served as a slug
  assert.equal(await clicks(e), 0);
});

test('the add-link API refuses a route or top-level name as a slug with a clear 400', async () => {
  const e = env();
  for (const slug of ['track', 's', 'api', 'dash', 'dashboard', 'monitor', 'scripts', 'twilio', 'review', 'clone', 'clone-x', 'yt2', 'assets']) {
    const r = await add(e, slug);
    if (slug.length < 2) { assert.equal(r.status, 400); continue; } // "s" is already too short for a slug
    assert.equal(r.status, 400, slug);
    assert.match((await r.json()).error, /site page name/, slug);
  }
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_links').first()).n, 0);
});

test('every path this Worker routes, and every slug route in wrangler.jsonc, agrees with the reserved list', () => {
  const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  for (const seg of ['v', 's', 'track', 'dashboard', 'dashboard-2', 'dash', 'twilio', 'monitor', 'scripts']) assert.ok(RESERVED.has(seg), seg);
  assert.ok(src.includes("'/s/'") && src.includes("'/v/'"));
  const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const slugRoutes = [...cfg.matchAll(/"pattern": "jonmac\.ai\/([a-z0-9-]+)\*"/g)].map((m) => m[1]);
  assert.deepEqual([...slugRoutes].sort(), [...ROUTED_SLUGS].sort()); // every live slug has its route, and only those
  for (const s of slugRoutes) assert.equal(reservedSlug(s), false, `route jonmac.ai/${s}* is a reserved name`);
});

test('a new link without its production route says so on the add reply and on /track; previews need no route', async () => {
  const e = env();
  const r = await add(e, 'brand-new-vid');
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.live, false);
  assert.match(j.note, /next dashboard deploy/);
  await add(e, 'mythos52');
  const html = await (await go(e, '/track', { jon: true })).text();
  assert.match(html, /jonmac\.ai\/brand-new-vid<\/button> <span class="est"[^>]*>not live yet/);
  assert.doesNotMatch(html, /jonmac\.ai\/mythos52<\/button> <span/);
  const p = { ...e, PREVIEW: '1' };
  const pr = await (await go(p, '/track/api/links', { method: 'POST', jon: true, body: { slug: 'prev-vid', title: 'T' } })).json();
  assert.equal(pr.live, true);
  assert.equal(pr.note, undefined);
});
