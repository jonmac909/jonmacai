// Every Skool landing page sends people to https://www.skool.com/jonmac/about, not the email opt-in (Jon 2026-11-25).
// Planted check: walks every kind of Skool lander (social bio links, one-word video links on every platform, /track video
// links with the email step on and off, old /s/ links) and fails if a GET shows the opt-in or forwards anywhere else.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { SOCIAL } from '../src/skool.js';
import { SHORT_SLUGS } from '../src/skoolroutes.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const ABOUT = 'https://www.skool.com/jonmac/about';
async function get(e, path, w = worker) {
  const waits = [];
  const r = await w.fetch(new Request(`https://jonmac.ai${path}`, { redirect: 'manual' }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
async function landsOnAbout(e, path, w = worker) {
  let r = await get(e, path, w);
  if (r.status === 301) r = await get(e, r.headers.get('Location'), w); // old /s/ links move to the short link first
  const body = await r.text();
  assert.doesNotMatch(body, /<form|type="email"/i, `${path}: shows the email opt-in`);
  assert.equal(r.status, 302, `${path}: status ${r.status}, expected a forward to the Skool about page`);
  const to = new URL(r.headers.get('Location'));
  assert.equal(to.origin + to.pathname, ABOUT, `${path}: forwards to ${to.href}`);
  assert.ok(to.searchParams.get('utm_source') && to.searchParams.get('utm_campaign'), `${path}: tracking tags kept`);
  assert.equal(to.searchParams.has('ref'), false, `${path}: never Skool's affiliate tag`);
}

test('every Skool landing page forwards to the Skool about page, never the email opt-in', async () => {
  const e = { DB: sqliteD1() };
  await e.DB.prepare("INSERT INTO skool_links (slug, title, created_at, capture) VALUES ('video-on', 'On', '2026-11-25T00:00:00Z', 1), ('video-off', 'Off', '2026-11-25T00:00:00Z', 0)").run();
  const paths = [...Object.keys(SOCIAL).map((s) => `/${s}`), ...SHORT_SLUGS.map((s) => `/${s}`), '/neon/?utm_x=1', '/fb?fbclid=1',
    '/s/video-on', '/s/video-off', '/s/ig', '/s/neon', '/s/unknown-slug'];
  for (const p of paths) await landsOnAbout(e, p);
  assert.ok(paths.length >= 18);
});

test('planted fault: the check fails a lander that shows the opt-in or forwards to the group root', async () => {
  const fake = (res) => ({ fetch: async () => res() });
  const optIn = fake(() => new Response('<form method="post"><input type="email" name="email"></form>', { status: 200 }));
  const root = fake(() => new Response(null, { status: 302, headers: { Location: 'https://www.skool.com/jonmac?utm_source=x&utm_campaign=y' } }));
  const noTags = fake(() => new Response(null, { status: 302, headers: { Location: ABOUT } }));
  const good = fake(() => new Response(null, { status: 302, headers: { Location: `${ABOUT}?utm_source=x&utm_campaign=y` } }));
  await assert.rejects(landsOnAbout({}, '/ig', optIn), /email opt-in/);
  await assert.rejects(landsOnAbout({}, '/ig', root), /forwards to https:\/\/www\.skool\.com\/jonmac\?/);
  await assert.rejects(landsOnAbout({}, '/ig', noTags), /tracking tags kept/);
  await landsOnAbout({}, '/ig', good);
});
