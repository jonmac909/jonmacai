// Social bio links (Jon 2026-11-24): six short links open the email lander with their own platform tracking,
// the old /s/ links 301 to them, /yt stays the AIOS app's, and the lander shows no price.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { trackerData, matchAnswer } from '../src/skool.js';
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

test('/track counts a social link with no skool_links row: its lead credits the sale by email; "youtube" in an answer is not a match', async () => {
  const e = { DB: sqliteD1(), SKOOL_ZAP_TOKEN: 'tok' };
  await go(e, '/fb', { method: 'POST', form: { email: 'buyer-fb@gmail.com' } });
  const H = { 'X-Track-Token': 'tok', 'Content-Type': 'application/json' };
  await worker.fetch(new Request('https://jonmac.ai/track/api/sale', { method: 'POST', headers: H, body: JSON.stringify({ email: 'buyer-fb@gmail.com', transaction_id: 't1' }) }), e, { waitUntil() {} });
  const d = await trackerData(e.DB);
  const fb = d.rows.find((r) => r.slug === 'fb');
  assert.equal(fb.emails, 1);
  assert.equal(fb.sales, 1);
  assert.equal(d.sales[0].how, 'email');
  assert.equal(matchAnswer('found you on youtube', d.rows), null);
  // A longer slug that only starts with a social one is not that platform (jonmac.ai/xai-tips is not /x).
  assert.equal(matchAnswer('came from jonmac.ai/xai-tips', d.rows), null);
  assert.equal(matchAnswer('the /s/live-demo link', d.rows), null);
  assert.equal(matchAnswer('jonmac.ai/x', d.rows), 'x');
  assert.equal(matchAnswer('JONMAC.AI/FB?utm=1', d.rows), 'fb');
});

test('sequence footer names the short link the lead used', async () => {
  const { renderEmail } = await import('../src/skoolmail.js');
  const m = renderEmail(0, { slug: 'youtube', unsubUrl: 'https://jonmac.ai/u', business: 'B', address: 'A' });
  assert.match(m.text, /entered your email on jonmac\.ai\/youtube to get/);
});
