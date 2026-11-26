// One-word video links from data (src/skoolwords.js): POST /track/api/words with the LINK_REGISTER_TOKEN bearer token
// registers a word in D1, gives its six links and its wildcard route; collisions are refused; neon is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { trackerData } from '../src/skool.js';
import { syncSlugRoutes } from '../src/skoolroutes.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const TOKEN = 'test-link-register-token';
const ZONE = 'zone1';
const zone = { routes: [], calls: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname !== 'api.cloudflare.com') return realFetch(input, init);
  const method = init.method || 'GET';
  zone.calls.push({ method, body: init.body ? JSON.parse(init.body) : null });
  const ok = (result) => new Response(JSON.stringify({ success: true, errors: [], result }), { headers: { 'Content-Type': 'application/json' } });
  if (method === 'GET') return ok(zone.routes);
  if (method === 'POST') { const r = { id: `r${zone.routes.length}`, ...JSON.parse(init.body) }; zone.routes.push(r); return ok({ id: r.id }); }
  return new Response('{}', { status: 400 });
};
const apex = (pages = []) => ({ async fetch(req) { const p = new URL(req.url).pathname; return new Response('apex', { status: pages.includes(p) ? 200 : 404 }); } });

async function go(e, path, { method = 'GET', body, auth = TOKEN, form } = {}) {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const init = { method, redirect: 'manual', headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = typeof body === 'string' ? body : JSON.stringify(body); }
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(form).toString(); }
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, init), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
const reg = (e, body, opts = {}) => go(e, '/track/api/words', { method: 'POST', body, ...opts });
const env = (over = {}) => ({ DB: sqliteD1(), LINK_REGISTER_TOKEN: TOKEN, APEX: apex(), ...over });
const clicks = async (e, slug) => (await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_clicks WHERE slug = ?').bind(slug).first()).n;

test('missing secret refuses (503); missing or wrong token is 401', async () => {
  assert.equal((await reg(env({ LINK_REGISTER_TOKEN: undefined }), { word: 'astra', title: 'A' })).status, 503);
  for (const auth of [null, 'wrong-token']) {
    const r = await reg(env(), { word: 'astra', title: 'A' }, { auth });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).ok, false);
  }
  assert.equal((await go(env(), '/track/api/words', { auth: null })).status, 401);
});

test('a good register gives six links, is idempotent, and GET lists it with neon', async () => {
  const e = env();
  const r = await reg(e, { word: 'Astra', title: 'Astra Seedance', youtube_url: 'https://youtu.be/abcdefghijk' });
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.word, 'astra'); assert.equal(j.created, true);
  assert.deepEqual(j.links, { youtube: 'https://jonmac.ai/astra', x: 'https://jonmac.ai/astrax', linkedin: 'https://jonmac.ai/astrali', facebook: 'https://jonmac.ai/astrafb', instagram: 'https://jonmac.ai/astraig', tiktok: 'https://jonmac.ai/astratt' });
  assert.match(j.warning, /dry run/); // no ROUTES_LIVE: no route made, and it says so
  const again = await reg(e, { word: 'astra', title: 'Astra Seedance' });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).created, false);
  const other = await reg(e, { word: 'astra', title: 'Another video' });
  assert.equal(other.status, 409);
  const list = await (await go(e, '/track/api/words')).json();
  assert.deepEqual(list.words.map((w) => w.word).sort(), ['astra', 'neon']);
  assert.equal(list.words.find((w) => w.word === 'neon').builtin, true);
});

test('collisions and bad input are refused with one plain line', async () => {
  const e = env({ APEX: apex(['/pricing']) });
  await e.DB.prepare("INSERT INTO skool_links (slug, title, created_at, capture) VALUES ('macframes', 'M', '2026-11-24T00:00:00Z', 1)").run();
  assert.equal((await reg(e, { word: 'astra', title: 'Astra' })).status, 201);
  const cases = [
    ['track', 409, /dashboard path/], // reserved path
    ['neon', 409, /already/], // existing word
    ['astra', 409, /already the word/], // existing word, other title
    ['astrax', 409, /overlaps/], // a variant of an existing word / prefix overlap
    ['ast', 409, /overlaps/], // prefix of an existing word
    ['neonlights', 409, /overlaps/], // existing word is its prefix
    ['igfun', 409, /social link/], // social prefix
    ['youtubers', 409, /social link/],
    ['team', 409, /another app/], // another worker's route
    ['macframes', 409, /\/track link/], // existing skool_links slug
    ['pricing', 409, /already a page/], // real apex page
    ['bad-word', 400, /no dashes/], ['9lives', 400, /starting with a letter/], ['a', 400, /Word/],
  ];
  for (const [word, status, re] of cases) {
    const r = await reg(e, { word, title: word === 'neon' ? 'Gemini 4 Neon x' : 'T' });
    assert.equal(r.status, status, word);
    const j = await r.json();
    assert.equal(j.ok, false, word);
    assert.match(j.error, re, word);
    assert.doesNotMatch(j.error, /\n/);
  }
  assert.equal((await reg(e, { word: 'zeta' })).status, 400); // title missing
  assert.equal((await reg(e, { word: 'zeta', title: 'Z', youtube_url: 'https://evil.example/x' })).status, 400);
  assert.equal((await reg(e, 'not json')).status, 400);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_words').first()).n, 1); // only astra
});

test("a registered word's six slugs serve the lander, count under their own slug and send the right utm tags", async () => {
  const e = env();
  await reg(e, { word: 'astra', title: 'Astra Seedance' });
  const want = { astra: 'youtube', astrax: 'x', astrali: 'linkedin', astrafb: 'facebook', astraig: 'instagram', astratt: 'tiktok' };
  for (const [slug, source] of Object.entries(want)) {
    const page = await go(e, `/${slug}`, { auth: null });
    assert.equal(page.status, 302, slug); // straight to the Skool about page (Jon 2026-11-25)
    assert.equal(new URL(page.headers.get('Location')).searchParams.get('utm_source'), source, slug);
    assert.equal(await clicks(e, slug), 1, slug);
    const r = await go(e, `/${slug}`, { auth: null, method: 'POST', form: { email: `w-${slug}@gmail.com` } });
    assert.equal(r.status, 302);
    assert.deepEqual(Object.fromEntries(new URL(r.headers.get('Location')).searchParams), { utm_source: source, utm_medium: 'video', utm_campaign: 'astra' });
    const s = await go(e, `/s/${slug}`, { auth: null });
    assert.equal(s.status, 301);
    assert.equal(s.headers.get('Location'), `/${slug}`);
  }
  // Other paths under the wildcard go to the main site; /track lists the word's rows.
  const pass = await go(e, '/astra-lights', { auth: null });
  assert.equal(pass.status, 404);
  assert.equal(await pass.text(), 'apex'); // answered by the main site, not this worker
  const d = await trackerData(e.DB);
  assert.equal(d.rows.find((r) => r.slug === 'astrax').title, 'Astra Seedance - X');
  assert.equal(d.rows.find((r) => r.slug === 'astrax').clicks.all, 1);
  // Neon is unchanged alongside it.
  assert.equal((await go(e, '/neon', { auth: null })).status, 302);
  assert.equal(await clicks(e, 'neon'), 1);
  assert.equal((await go(e, '/s/neon', { auth: null })).headers.get('Location'), '/neon');
});

test('live: register makes the jonmac.ai/<word>* route, and a sync after a deploy puts it back', async () => {
  zone.routes = []; zone.calls = [];
  const e = env({ ROUTES_LIVE: '1', CF_ZONE_ID: ZONE, CF_ROUTES_TOKEN: 'tok' });
  const r = await (await reg(e, { word: 'astra', title: 'Astra' })).json();
  assert.equal(r.route, 'created');
  assert.equal(r.warning, undefined);
  assert.deepEqual(zone.routes.map((x) => x.pattern), ['jonmac.ai/astra*']);
  zone.routes = []; // a deploy dropped it
  const s = await syncSlugRoutes(e);
  assert.deepEqual(s.created, ['astra']);
  assert.deepEqual(zone.routes.map((x) => x.pattern), ['jonmac.ai/astra*']);
  assert.deepEqual((await syncSlugRoutes(e)).created, []); // already there
});

test('an empty or missing skool_words table leaves neon working', async () => {
  const e = env();
  e.DB.sqlite.exec('DROP TABLE skool_words');
  assert.equal((await go(e, '/neonx', { auth: null })).status, 302);
  assert.equal(await clicks(e, 'neonx'), 1);
  // The first register makes the table again.
  assert.equal((await reg(e, { word: 'astra', title: 'A' })).status, 201);
});
