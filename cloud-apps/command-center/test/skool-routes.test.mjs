// Skool slug routes (src/skoolroutes.js): planted clashes are refused, a good slug gets its route, the cron and a new
// version put back routes a deploy dropped, and remove deletes. Cloudflare's API and the apex site are mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { RESERVED, ensureSlugRoute, removeSlugRoute, syncSlugRoutes, _resetVersionCheck } from '../src/skoolroutes.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const ZONE = '8f58dee14f7fc0e66494d6278aec53aa';
const ME = 'jonmac-command-center';

// Fake Cloudflare routes API: zone.routes is the live list; zone.calls records every call.
const zone = { routes: [], calls: [], next: 1 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname !== 'api.cloudflare.com') return realFetch(input, init);
  const method = init.method || 'GET';
  zone.calls.push({ method, path: url.pathname, body: init.body ? JSON.parse(init.body) : null, auth: new Headers(init.headers).get('Authorization') });
  const ok = (result) => new Response(JSON.stringify({ success: true, errors: [], result }), { headers: { 'Content-Type': 'application/json' } });
  const base = `/client/v4/zones/${ZONE}/workers/routes`;
  if (method === 'GET' && url.pathname === base) return ok(zone.routes);
  if (method === 'POST' && url.pathname === base) { const r = { id: `r${zone.next++}`, ...JSON.parse(init.body) }; zone.routes.push(r); return ok({ id: r.id }); }
  if (method === 'DELETE' && url.pathname.startsWith(`${base}/`)) { const id = url.pathname.slice(base.length + 1); zone.routes = zone.routes.filter((r) => r.id !== id); return ok({ id }); }
  return new Response(JSON.stringify({ success: false, errors: [{ message: 'unexpected' }] }), { status: 400 });
};
const writes = () => zone.calls.filter((c) => c.method !== 'GET');
function reset(routes = []) { zone.routes = routes.map((r, i) => ({ id: `seed${i}`, ...r })); zone.calls = []; }

// The apex site: listed paths answer 200, everything else 404.
const apex = (pages = []) => ({ seen: [], async fetch(req) { const p = new URL(req.url).pathname; this.seen.push(p); return new Response('', { status: pages.includes(p) ? 200 : 404 }); } });
const prodEnv = (over = {}) => ({ DB: sqliteD1(), SESSION_SECRET: SECRET, ROUTES_LIVE: '1', CF_ZONE_ID: ZONE, CF_ROUTES_TOKEN: 'tok', APEX: apex(), ...over });

async function add(e, slug) {
  const h = new Headers({ 'Content-Type': 'application/json', 'X-CC': '1', Cookie: `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}` });
  const waits = [];
  const r = await worker.fetch(new Request('https://jonmac.ai/track/api/links', { method: 'POST', headers: h, body: JSON.stringify({ slug, title: 'T' }) }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return { status: r.status, body: await r.json() };
}
const saved = async (e, slug) => !!(await e.DB.prepare('SELECT 1 FROM skool_links WHERE slug = ?').bind(slug).first());

test('a new slug gets route jonmac.ai/<slug> -> this worker, once', async () => {
  reset([{ pattern: 'jonmac.ai/*', script: 'elevateapp' }]);
  const e = prodEnv();
  const r = await add(e, 'seedance-ugc');
  assert.equal(r.status, 201);
  assert.equal(r.body.route, 'created');
  assert.equal(r.body.warning, undefined);
  assert.deepEqual(writes().map((c) => [c.method, c.path, c.body]), [['POST', `/client/v4/zones/${ZONE}/workers/routes`, { pattern: 'jonmac.ai/seedance-ugc', script: ME }]]);
  assert.equal(writes()[0].auth, 'Bearer tok');
  assert.deepEqual(e.APEX.seen, ['/seedance-ugc']);
  zone.calls = [];
  assert.equal((await ensureSlugRoute(e, 'seedance-ugc')).route, 'exists'); // idempotent
  assert.equal(writes().length, 0);
});

test('a slug that is a real page on the apex site is refused', async () => {
  reset();
  const e = prodEnv({ APEX: apex(['/pricing']) });
  const r = await add(e, 'pricing');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /already a page/);
  assert.equal(await saved(e, 'pricing'), false);
  assert.equal(writes().length, 0);
});

test('the apex check fails closed: no binding or an error refuses in production', async () => {
  reset();
  assert.equal((await add(prodEnv({ APEX: undefined }), 'no-binding')).status, 409);
  assert.equal((await add(prodEnv({ APEX: { fetch: async () => { throw new Error('down'); } } }), 'apex-down')).status, 409);
  assert.equal(writes().length, 0);
});

test('dashboard paths are refused', async () => {
  reset();
  const e = prodEnv();
  for (const slug of ['dashboard', 'dash', 'track', 'monitor', 'scripts', 'twilio', 'api']) {
    const r = await add(e, slug);
    assert.equal(r.status, 409, slug);
    assert.match(r.body.error, /dashboard path/);
  }
  assert.equal(writes().length, 0);
});

test("another worker's prefix route is refused, from the checked-in list and the live list", async () => {
  reset([{ pattern: 'jonmac.ai/newapp*', script: 'jonmac-newapp' }, { pattern: 'jonmac.ai/*', script: 'elevateapp' }]);
  const e = prodEnv();
  for (const slug of ['yt-hacks', 'tasks2', 'review-me', 'agency-x', 'clone-funnel', 'team', 'search', 'sign']) {
    const r = await add(e, slug);
    assert.equal(r.status, 409, slug);
    assert.match(r.body.error, /another app/);
  }
  assert.equal((await add(e, 'newapp-1')).status, 409); // only in the live list
  assert.equal((await add(e, 'searching')).status, 201); // jonmac.ai/search is exact, so this is free
  assert.deepEqual(writes().map((c) => c.body.pattern), ['jonmac.ai/searching']);
});

test('no token: the slug is saved and the reply warns the route was not made', async () => {
  reset();
  const e = prodEnv({ CF_ROUTES_TOKEN: undefined });
  const r = await add(e, 'no-token');
  assert.equal(r.status, 201);
  assert.equal(r.body.warning, 'route not created: token missing');
  assert.equal(await saved(e, 'no-token'), true);
  assert.equal(zone.calls.length, 0);
});

test('previews (no ROUTES_LIVE) never call the routes API, even with a token', async () => {
  reset();
  const e = prodEnv({ ROUTES_LIVE: undefined });
  const r = await add(e, 'preview-one');
  assert.equal(r.status, 201);
  assert.equal(r.body.route, 'dry-run');
  assert.match(r.body.warning, /dry run/);
  assert.equal((await add(e, 'dashboard')).status, 409); // checks still run
  assert.equal((await syncSlugRoutes(e)).created.length, 0);
  assert.equal((await removeSlugRoute(e, 'preview-one')).route, 'dry-run');
  assert.equal(zone.calls.length, 0);
});

test('cron self-heal re-creates a missing slug route and leaves present ones', async () => {
  reset([{ pattern: 'jonmac.ai/kept', script: ME }, { pattern: 'jonmac.ai/*', script: 'elevateapp' }]);
  const e = prodEnv({ APEX: apex(['/now-a-page']) });
  for (const s of ['kept', 'dropped', 'now-a-page', 'yt-old']) e.DB.sqlite.prepare("INSERT INTO skool_links (slug, title, created_at) VALUES (?, 't', '2026-11-21T00:00:00Z')").run(s);
  const r = await syncSlugRoutes(e);
  assert.deepEqual(r.created, ['dropped']);
  assert.deepEqual(r.skipped.sort(), ['now-a-page', 'yt-old']); // clashes are never routed
  assert.deepEqual(writes().map((c) => [c.method, c.body.pattern, c.body.script]), [['POST', 'jonmac.ai/dropped', ME]]);
  zone.calls = [];
  assert.deepEqual((await syncSlugRoutes(e)).created, []); // second run: nothing to do
  assert.equal(writes().length, 0);
  assert.match(readFileSync(new URL('../src/cron.js', import.meta.url), 'utf8'), /jobs\.push\(syncSlugRoutes\(env\)/);
});

test('the first request of a new version syncs once, then not again for that version', async () => {
  reset([{ pattern: 'jonmac.ai/*', script: 'elevateapp' }]);
  _resetVersionCheck();
  const e = prodEnv({ CF_VERSION_METADATA: { id: 'v-new', tag: 'abc1234', timestamp: '2026-11-21T00:00:00Z' } });
  e.DB.sqlite.prepare("INSERT INTO skool_links (slug, title, created_at) VALUES ('lost', 't', '2026-11-21T00:00:00Z')").run();
  const hit = async () => { const w = []; await worker.fetch(new Request('https://jonmac.ai/dash/version'), e, { waitUntil: (p) => w.push(p) }); await Promise.all(w); };
  await hit();
  assert.deepEqual(writes().map((c) => c.body.pattern), ['jonmac.ai/lost']);
  assert.equal((await e.DB.prepare("SELECT value FROM skool_settings WHERE key = 'routes_synced_version'").first()).value, 'v-new');
  zone.calls = [];
  _resetVersionCheck(); // a fresh isolate of the same version: reads the key, does nothing
  await hit();
  assert.equal(zone.calls.length, 0);
});

test('remove deletes only this worker\'s route for the slug', async () => {
  reset([{ pattern: 'jonmac.ai/gone', script: ME }, { pattern: 'jonmac.ai/other', script: ME }]);
  const e = prodEnv();
  assert.equal((await removeSlugRoute(e, 'gone')).route, 'removed');
  assert.deepEqual(writes().map((c) => [c.method, c.path]), [['DELETE', `/client/v4/zones/${ZONE}/workers/routes/seed0`]]);
  assert.deepEqual(zone.routes.map((r) => r.pattern), ['jonmac.ai/other']);
  assert.equal((await removeSlugRoute(e, 'gone')).route, 'absent');
});

test("every wildcard route of this worker in wrangler.jsonc is a reserved slug; prod writes routes, previews don't", () => {
  const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const dirs = [...cfg.matchAll(/"pattern":\s*"jonmac\.ai\/([^"/*]+)\/\*"/g)].map((m) => m[1]);
  assert.ok(dirs.length >= 6);
  for (const d of dirs) assert.ok(RESERVED.has(d), d);
  assert.equal([...cfg.matchAll(/"ROUTES_LIVE":\s*"1"/g)].length, 1); // production only
  assert.match(cfg, /"preview-track-autoroute":\s*\{[\s\S]*?"services":\s*\[\{ "binding": "APEX", "service": "elevateapp" \}\]/);
});
