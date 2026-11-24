// Social bio links (Jon 2026-11-24): six short links open the email lander with their own platform tracking,
// the old /s/ links 301 to them, /yt stays the AIOS app's, and the lander shows no price.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const SIX = { ig: 'instagram', tt: 'tiktok', x: 'x', fb: 'facebook', li: 'linkedin', youtube: 'youtube' };
const OLD = { ig: 'ig', tt: 'tt', x: 'x', fb: 'fb', li: 'li', yt: 'youtube' };
async function go(e, path, { method = 'GET', form } = {}) {
  const init = { method, redirect: 'manual' };
  if (form) { init.body = new URLSearchParams(form).toString(); init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; }
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, init), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}

test('six short links show the lander, record their own platform and forward with its utm tags', async () => {
  const e = { DB: sqliteD1() };
  for (const [short, source] of Object.entries(SIX)) {
    const page = await go(e, `/${short}`);
    assert.equal(page.status, 200, short);
    const html = await page.text();
    assert.match(html, /<title>AI Video Lab on Skool<\/title>/, short);
    assert.match(html, new RegExp(`action="/${short}"`), short);
    assert.doesNotMatch(html, /\$\s?\d|\/mo(nth)?\b|about-(desktop|mobile)\.jpg/i, `${short}: no price and no price screenshot`);
    const r = await go(e, `/${short}`, { method: 'POST', form: { email: `lander-test-${short}@gmail.com` } });
    assert.equal(r.status, 302, short);
    const to = new URL(r.headers.get('Location'));
    assert.equal(to.origin + to.pathname, 'https://www.skool.com/ai-ugc');
    assert.deepEqual(Object.fromEntries(to.searchParams), { utm_source: source, utm_medium: 'social', utm_campaign: 'bio' }, short);
    const lead = await e.DB.prepare('SELECT slug FROM skool_leads WHERE email = ?').bind(`lander-test-${short}@gmail.com`).first();
    assert.equal(lead?.slug, short, `${short}: lead stored under its own link`);
    const clicks = await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_clicks WHERE slug = ?').bind(short).first();
    assert.equal(clicks.n, 1, `${short}: one click counted under its own link`);
  }
});

test('old /s/ social links 301 to the short link and keep the query string', async () => {
  const e = { DB: sqliteD1() };
  for (const [old, short] of Object.entries(OLD)) {
    const r = await go(e, `/s/${old}?a=1&b=two`);
    assert.equal(r.status, 301, old);
    assert.equal(r.headers.get('Location'), `/${short}?a=1&b=two`, old);
    const bare = await go(e, `/s/${old}`);
    assert.equal(bare.headers.get('Location'), `/${short}`, old);
  }
});

test('/yt stays the AIOS app: this worker has no /yt route and does not answer it', async () => {
  const routes = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  for (const short of Object.keys(SIX)) assert.match(routes, new RegExp(`"pattern": "jonmac\\.ai/${short}"`), short);
  assert.doesNotMatch(routes, /"jonmac\.ai\/yt[^a-z]/);
  assert.equal((await go({ DB: sqliteD1() }, '/yt')).status, 404);
});
