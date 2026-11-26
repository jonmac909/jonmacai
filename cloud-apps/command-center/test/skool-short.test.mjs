// One-word video links (Jon 2026-11-24: "remove /s and make the tracking links as short as possible with one word"):
// jonmac.ai/neon is a video link with no skool_links row; clicks and leads count under "neon"; /s/ links keep working.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { trackerData, matchAnswer } from '../src/skool.js';
import { SHORT_LINKS, SHORT_VARIANTS, SHORT_PLATFORMS, SOCIAL_SLUGS, RESERVED, OTHER_ROUTES, routeClash, videoLinks, slugRefusal } from '../src/skoolroutes.js';
import { renderEmail } from '../src/skoolmail.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const WORDS = Object.keys(SHORT_LINKS);
const SLUGS = Object.keys(SHORT_VARIANTS); // every platform variant of every word
async function go(e, path, { method = 'GET', form } = {}) {
  const init = { method, redirect: 'manual' };
  if (form) { init.body = new URLSearchParams(form).toString(); init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; }
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, init), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
const clicks = async (e, slug) => (await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_clicks WHERE slug = ?').bind(slug).first()).n;

test('neon is in the table and has a wildcard route', () => {
  assert.ok(WORDS.includes('neon'));
  const routes = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  for (const w of WORDS) {
    assert.match(w, /^[a-z0-9]+$/, `${w}: one word, no dashes`);
    assert.match(routes, new RegExp(`"pattern": "jonmac\\.ai/${w}\\*"`), w);
  }
});

test('each platform link (/neon, /neonx, ...) shows the lander, counts under its own slug and forwards with its utm tags', async () => {
  const e = { DB: sqliteD1() };
  assert.deepEqual(SLUGS.filter((s) => SHORT_VARIANTS[s].word === 'neon'), ['neon', 'neonx', 'neonli', 'neonfb', 'neonig', 'neontt']);
  for (const w of SLUGS) {
    const v = SHORT_VARIANTS[w];
    const page = await go(e, `/${w}`); // no email step on GET (Jon 2026-11-25): straight to the Skool about page with the tags
    assert.equal(page.status, 302, w);
    const pg = new URL(page.headers.get('Location'));
    assert.equal(pg.origin + pg.pathname, 'https://www.skool.com/ai-ugc/about', w);
    assert.deepEqual(Object.fromEntries(pg.searchParams), { utm_source: v.platform, utm_medium: 'video', utm_campaign: v.word });
    assert.equal(await clicks(e, w), 1, `${w}: one click under the word`);
    const r = await go(e, `/${w}`, { method: 'POST', form: { email: `short-${w}@gmail.com` } });
    assert.equal(r.status, 302);
    const to = new URL(r.headers.get('Location'));
    assert.equal(to.origin + to.pathname, 'https://www.skool.com/ai-ugc/about');
    assert.deepEqual(Object.fromEntries(to.searchParams), { utm_source: v.platform, utm_medium: 'video', utm_campaign: v.word });
    const lead = await e.DB.prepare('SELECT slug FROM skool_leads WHERE email = ?').bind(`short-${w}@gmail.com`).first();
    assert.equal(lead?.slug, w);
    // Trailing slash and a query string are the same link; ?qc=1 is not counted.
    assert.equal((await go(e, `/${w}/?utm_x=1`)).status, 302);
    assert.equal((await go(e, `/${w}?qc=1`)).status, 302);
    assert.equal(await clicks(e, w), 2);
  }
  const src = Object.fromEntries(SLUGS.map((s) => [s, SHORT_VARIANTS[s].platform]));
  assert.deepEqual(src, { neon: 'youtube', neonx: 'x', neonli: 'linkedin', neonfb: 'facebook', neonig: 'instagram', neontt: 'tiktok' });
});

test('every variant is unique and clashes with no social slug, other route or dashboard path', async () => {
  assert.equal(new Set(SLUGS).size, SLUGS.length);
  assert.equal(SLUGS.length, WORDS.length * Object.keys(SHORT_PLATFORMS).length);
  const own = new Set(['dashboard', 'dashboard-2', 'dash', 'scripts', 'v', 's', 'track', 'monitor', 'twilio', 'api', 'www']);
  for (const s of SLUGS) {
    assert.ok(!SOCIAL_SLUGS.includes(s), `${s}: a social slug`);
    assert.ok(!own.has(s), `${s}: a dashboard path`);
    assert.ok(RESERVED.has(s), `${s}: reserved`);
    assert.equal(routeClash(OTHER_ROUTES, s), null, `${s}: another worker's route`);
    assert.match(await slugRefusal({}, s, null), /built-in short link/, s);
  }
});

test('videoLinks gives a video its six distinct links', () => {
  const l = videoLinks('neon');
  assert.deepEqual(l, { youtube: 'https://jonmac.ai/neon', x: 'https://jonmac.ai/neonx', linkedin: 'https://jonmac.ai/neonli', facebook: 'https://jonmac.ai/neonfb', instagram: 'https://jonmac.ai/neonig', tiktok: 'https://jonmac.ai/neontt' });
  assert.equal(new Set(Object.values(l)).size, 6);
  assert.equal(videoLinks('nope'), null);
});

test('/s/neon 301s to /neon; other /s/<slug> video links behave as before', async () => {
  const e = { DB: sqliteD1() };
  const r = await go(e, '/s/neon?a=1');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), '/neon?a=1');
  for (const v of SLUGS) {
    const x = await go(e, `/s/${v}`);
    assert.equal(x.status, 301, v);
    assert.equal(x.headers.get('Location'), `/${v}`);
  }
  // Unknown /s/ slug: forwards with its own campaign, counts nothing.
  const u = await go(e, '/s/gemini-4-neon');
  assert.equal(u.status, 302);
  assert.equal(new URL(u.headers.get('Location')).searchParams.get('utm_campaign'), 'gemini-4-neon');
  assert.equal(await clicks(e, 'gemini-4-neon'), 0);
  // A registered /s/ link with the email step still shows the lander and counts under its slug.
  await e.DB.prepare("INSERT INTO skool_links (slug, title, created_at, capture) VALUES ('gemini-4-neon', 'G', '2026-11-24T00:00:00Z', 1)").run();
  const k = await go(e, '/s/gemini-4-neon');
  assert.equal(k.status, 302); // straight to the Skool about page (Jon 2026-11-25)
  assert.equal(await clicks(e, 'gemini-4-neon'), 1);
  assert.equal(await clicks(e, 'neon'), 0);
});

test('other paths under /neon pass to the main site; /track lists neon; neon cannot be added as a /track slug', async () => {
  const seen = [];
  const APEX = { fetch: async (req) => { seen.push(new URL(req.url).pathname); return new Response('apex', { status: 418 }); } };
  assert.equal((await go({ DB: sqliteD1(), APEX }, '/neon-lights')).status, 418);
  assert.deepEqual(seen, ['/neon-lights']);
  const e = { DB: sqliteD1() };
  await go(e, '/neon');
  const d = await trackerData(e.DB);
  await go(e, '/neonx');
  await go(e, '/neonx');
  const row = d.rows.find((r) => r.slug === 'neon');
  assert.equal(row.title, 'Gemini 4 Neon - YouTube');
  assert.equal(row.clicks.all, 1);
  const d2 = await trackerData(e.DB);
  const titles = Object.fromEntries(d2.rows.filter((r) => SHORT_VARIANTS[r.slug]).map((r) => [r.slug, r.title]));
  assert.deepEqual(titles, { neon: 'Gemini 4 Neon - YouTube', neonx: 'Gemini 4 Neon - X', neonli: 'Gemini 4 Neon - LinkedIn', neonfb: 'Gemini 4 Neon - Facebook', neonig: 'Gemini 4 Neon - Instagram', neontt: 'Gemini 4 Neon - TikTok' });
  assert.equal(d2.rows.find((r) => r.slug === 'neonx').clicks.all, 2);
  assert.equal(d2.rows.find((r) => r.slug === 'neon').clicks.all, 1);
  assert.deepEqual(Object.keys(d2.rows[0]).sort(), Object.keys(row).sort()); // same /track row shape
  assert.equal(matchAnswer('from jonmac.ai/neon', d.rows), 'neon');
  assert.match(await slugRefusal({}, 'neon', null), /built-in short link/);
  assert.equal(matchAnswer('jonmac.ai/neonx', d2.rows), 'neonx');
});

test('email footer names jonmac.ai/neon, not /s/neon, and the video title', () => {
  const m = renderEmail(0, { slug: 'neon', title: SHORT_LINKS.neon.title, unsubUrl: 'u', business: 'B', address: 'A' });
  assert.match(m.text, /on jonmac\.ai\/neon to get/);
  assert.match(m.text, /my video "Gemini 4 Neon"/);
  const x = renderEmail(0, { slug: 'neonx', title: SHORT_VARIANTS.neonx.video, unsubUrl: 'u', business: 'B', address: 'A' });
  assert.match(x.text, /on jonmac\.ai\/neonx to get/);
  assert.match(x.text, /my video "Gemini 4 Neon"/);
});
