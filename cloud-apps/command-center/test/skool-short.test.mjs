// One-word video links (Jon 2026-11-24: "remove /s and make the tracking links as short as possible with one word"):
// jonmac.ai/neon is a video link with no skool_links row; clicks and leads count under "neon"; /s/ links keep working.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { trackerData, matchAnswer } from '../src/skool.js';
import { SHORT_LINKS, slugRefusal } from '../src/skoolroutes.js';
import { renderEmail } from '../src/skoolmail.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const WORDS = Object.keys(SHORT_LINKS);
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

test('/neon shows the lander, counts the click under neon and forwards with video utm tags', async () => {
  const e = { DB: sqliteD1() };
  for (const w of WORDS) {
    const page = await go(e, `/${w}`);
    assert.equal(page.status, 200, w);
    const html = await page.text();
    assert.match(html, /Enter your email to get access/);
    assert.match(html, new RegExp(`action="/${w}"`));
    assert.doesNotMatch(html, /\$\s?\d|\/mo(nth)?\b|about-(desktop|mobile)\.jpg/i, `${w}: no price`);
    assert.equal(await clicks(e, w), 1, `${w}: one click under the word`);
    const r = await go(e, `/${w}`, { method: 'POST', form: { email: `short-${w}@gmail.com` } });
    assert.equal(r.status, 302);
    const to = new URL(r.headers.get('Location'));
    assert.equal(to.origin + to.pathname, 'https://www.skool.com/ai-ugc');
    assert.deepEqual(Object.fromEntries(to.searchParams), { utm_source: 'youtube', utm_medium: 'video', utm_campaign: w });
    const lead = await e.DB.prepare('SELECT slug FROM skool_leads WHERE email = ?').bind(`short-${w}@gmail.com`).first();
    assert.equal(lead?.slug, w);
    // Trailing slash and a query string are the same link; ?qc=1 is not counted.
    assert.equal((await go(e, `/${w}/?utm_x=1`)).status, 200);
    assert.equal((await go(e, `/${w}?qc=1`)).status, 200);
    assert.equal(await clicks(e, w), 2);
  }
});

test('/s/neon 301s to /neon; other /s/<slug> video links behave as before', async () => {
  const e = { DB: sqliteD1() };
  const r = await go(e, '/s/neon?a=1');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('Location'), '/neon?a=1');
  // Unknown /s/ slug: forwards with its own campaign, counts nothing.
  const u = await go(e, '/s/gemini-4-neon');
  assert.equal(u.status, 302);
  assert.equal(new URL(u.headers.get('Location')).searchParams.get('utm_campaign'), 'gemini-4-neon');
  assert.equal(await clicks(e, 'gemini-4-neon'), 0);
  // A registered /s/ link with the email step still shows the lander and counts under its slug.
  await e.DB.prepare("INSERT INTO skool_links (slug, title, created_at, capture) VALUES ('gemini-4-neon', 'G', '2026-11-24T00:00:00Z', 1)").run();
  const k = await go(e, '/s/gemini-4-neon');
  assert.equal(k.status, 200);
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
  const row = d.rows.find((r) => r.slug === 'neon');
  assert.equal(row.title, SHORT_LINKS.neon.title);
  assert.equal(row.clicks.all, 1);
  assert.equal(matchAnswer('from jonmac.ai/neon', d.rows), 'neon');
  assert.match(await slugRefusal({}, 'neon', null), /built-in short link/);
});

test('email footer names jonmac.ai/neon, not /s/neon, and the video title', () => {
  const m = renderEmail(0, { slug: 'neon', title: SHORT_LINKS.neon.title, unsubUrl: 'u', business: 'B', address: 'A' });
  assert.match(m.text, /on jonmac\.ai\/neon to get/);
  assert.match(m.text, /my video "Gemini 4 Neon"/);
});
