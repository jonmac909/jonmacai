// Skool group renamed AI Video Lab (skool.com/ai-ugc) -> AI Income Lab (skool.com/jonmac) (Jon 2026-11-27).
// Every forward must land on https://www.skool.com/jonmac/about; jonmac.ai/skool must forward there (was a 404).
// Planted check: a forward to the old skool.com/ai-ugc fails, the new /jonmac passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import worker from '../src/worker.js';
import { SKOOL } from '../src/skool.js';
import { SKOOL_ABOUT } from '../src/skoolmail.js';
import { RESERVED } from '../src/skoolroutes.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const NEW_ABOUT = 'https://www.skool.com/jonmac/about';
async function get(e, path, w = worker) {
  const waits = [];
  const r = await w.fetch(new Request(`https://jonmac.ai${path}`, { redirect: 'manual' }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
// The check: a 302 to the AI Income Lab about page with UTM tags, never the old group.
async function onNewGroup(e, path, w = worker) {
  const r = await get(e, path, w);
  assert.equal(r.status, 302, `${path}: status ${r.status}, expected a 302 forward`);
  const to = new URL(r.headers.get('Location'));
  assert.doesNotMatch(to.href, /skool\.com\/ai-ugc/i, `${path}: forwards to the old AI Video Lab group ${to.href}`);
  assert.equal(to.origin + to.pathname, NEW_ABOUT, `${path}: forwards to ${to.href}`);
  assert.ok(to.searchParams.get('utm_source') && to.searchParams.get('utm_medium') && to.searchParams.get('utm_campaign'), `${path}: UTM tags`);
  assert.equal(to.searchParams.has('ref'), false, `${path}: never Skool's affiliate tag`);
  return to;
}

test('constants point at the AI Income Lab group', () => {
  assert.equal(SKOOL, NEW_ABOUT);
  assert.equal(SKOOL_ABOUT, 'https://www.skool.com/jonmac');
});

test('jonmac.ai/skool forwards to the AI Income Lab (not a 404), with UTM tags', async () => {
  for (const p of ['/skool', '/skool/']) {
    const to = await onNewGroup({ DB: sqliteD1() }, p);
    assert.equal(to.searchParams.get('utm_source'), 'jonmacai');
    assert.equal(to.searchParams.get('utm_medium'), 'website');
    assert.equal(to.searchParams.get('utm_campaign'), 'skool');
  }
  const tagged = await onNewGroup({}, '/skool?utm_source=youtube&utm_medium=video&utm_campaign=bio');
  assert.equal(tagged.searchParams.get('utm_source'), 'youtube');
  assert.ok(RESERVED.has('skool'), 'skool is reserved, never a short-link slug');
  const routes = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(routes, /"pattern": "jonmac\.ai\/skool\*"/, 'wrangler routes /skool* to this worker (an exact route misses /skool?utm_source=x)');
});

test('jonmac.ai/skool with tracking tags forwards; /skoolxyz passes to the main site unchanged', async () => {
  const to = await onNewGroup({ DB: sqliteD1() }, '/skool?utm_source=x');
  assert.equal(to.searchParams.get('utm_source'), 'x');
  assert.equal((await onNewGroup({}, '/skool/?utm_source=x')).searchParams.get('utm_source'), 'x');
  const seen = [];
  const APEX = { fetch: async (req) => { seen.push(new URL(req.url).pathname + new URL(req.url).search); return new Response('site', { status: 200 }); } };
  for (const p of ['/skoolxyz', '/skool/about-x.jpg?v=1']) {
    const r = await get({ DB: sqliteD1(), APEX }, p);
    assert.equal(r.status, 200, `${p}: passes through`);
    assert.equal(await r.text(), 'site');
  }
  assert.deepEqual(seen, ['/skoolxyz', '/skool/about-x.jpg?v=1']);
});

test('bio, one-word and /s/ links land on the new group', async () => {
  for (const p of ['/ig', '/youtube', '/neon', '/s/unknown-slug']) await onNewGroup({}, p);
});

test('planted fault: a forward to the old skool.com/ai-ugc fails the check, /jonmac passes', async () => {
  const fake = (loc) => ({ fetch: async () => new Response(null, { status: 302, headers: { Location: loc } }) });
  const tags = '?utm_source=youtube&utm_medium=video&utm_campaign=x';
  await assert.rejects(onNewGroup({}, '/neon', fake(`https://www.skool.com/ai-ugc/about${tags}`)), /old AI Video Lab group/);
  await assert.rejects(onNewGroup({}, '/neon', fake(`https://www.skool.com/ai-ugc${tags}`)), /old AI Video Lab group/);
  await onNewGroup({}, '/neon', fake(`${NEW_ABOUT}${tags}`));
});

test('no old group link or name left in the worker source, pages or routes', () => {
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = [...walk(join(root, 'src')), ...walk(join(root, 'public')), join(root, 'wrangler.jsonc')]
    .filter((f) => /\.(m?js|html|jsonc?|css|txt)$/.test(f));
  const hits = files.filter((f) => /skool\.com\/ai-ugc|AI Video Lab/i.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
});
