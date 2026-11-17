// NEXT_SESSION is null (no live date yet, Jon Nov 16): nothing says "Registration Closed", every CTA opens the
// email pop-over, /api/lead answers 200 and stores the lead, step 2 is a thank-you, and nothing sells.
// Runs the real Worker + public files in Miniflare, so it sees the shipped null (not the dated test loader).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare, Response as MFResponse } from 'miniflare';
import { chromium } from 'playwright';

const publicRoot = new URL('../public/', import.meta.url);
const outbound = [];
const mf = new Miniflare({ modules: true, scriptPath: fileURLToPath(new URL('../src/index.js', import.meta.url)),
  compatibilityDate: '2026-07-01', modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  host: '127.0.0.1', port: 0, kvNamespaces: ['CLONE_LEADS'], d1Databases: ['CLONE_UPSELLS'],
  bindings: { CHECKOUT_URL: 'https://commas.com/checkout/test' },
  outboundService: async request => { outbound.push(request.url); return new MFResponse('{}'); },
  serviceBindings: { ASSETS: async request => {
    const path = new URL(request.url).pathname;
    try { return new MFResponse(readFileSync(new URL('.' + path, publicRoot)), { headers: { 'content-type': path.endsWith('.html') ? 'text/html' : 'text/javascript' } }); }
    catch { return new MFResponse('missing', { status: 404 }); }
  } },
});
after(() => mf.dispose());
const base = 'https://jonmac.ai';
const post = (path, body) => mf.dispatchFetch(base + path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('no live date: lead accepted and stored, nothing sells, no Registration Closed anywhere', async t => {
  await mf.ready;
  const lead = await post('/clone/api/lead', { name: 'No Session', email: 'no-session@example.test' });
  assert.equal(lead.status, 200); assert.equal((await lead.json()).ok, true);
  const kv = await mf.getKVNamespace('CLONE_LEADS');
  assert.ok(await kv.get('lead:no-session@example.test'), 'lead stored');
  assert.equal((await post('/clone/api/checkout-session', {})).status, 410, 'checkout does not sell');
  const seat = await mf.dispatchFetch(base + '/clone/seat', { redirect: 'manual' });
  assert.equal(seat.status, 302); assert.equal(seat.headers.get('location'), base + '/clone/', 'seat link goes to the lander, not Commas');
  for (const name of ['index', 'welcome', 'survey', 'software', 'audit', 'vault'])
    assert.ok(!/Registration Closed/i.test(readFileSync(new URL(name + '.html', publicRoot), 'utf8')), name);
  assert.ok(!/Registration Closed/i.test(readFileSync(new URL('closed-gate.js', publicRoot), 'utf8')));
  const index = readFileSync(new URL('index.html', publicRoot), 'utf8');
  assert.ok(!/pointer-events:\s*none/.test(index.slice(index.indexOf('.cta'), index.indexOf('.cta') + 4000).match(/[^}]*a\.cta[^}]*}/g)?.join('') || ''), 'CTA is clickable');
  assert.ok(!/Nov 12|November 12/.test(index), 'no past date in the page');
});

test('no live date: lander in a browser shows "date coming soon", CTA opens the pop-over, step 2 is the thank-you', async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true, executablePath: process.env.CLONE_TEST_CHROMIUM || undefined }); }
  catch (error) { t.skip('no Chromium available: ' + error.message.split('\n')[0]); return; }
  t.after(() => browser.close());
  await mf.ready;
  const context = await browser.newContext();
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) return route.fulfill({ body: '', contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html' });
    const response = await mf.dispatchFetch(request.url(), { method: request.method(), headers: request.headers(), body: request.postData() || undefined });
    return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  const page = await context.newPage(), errors = [], api = [];
  page.on('pageerror', e => errors.push(e.stack)); page.on('request', r => { if (/\/clone\/api\//.test(r.url())) api.push(new URL(r.url()).pathname); });
  await page.goto(base + '/clone/');
  const body = await page.locator('body').innerText();
  assert.ok(!/Registration Closed/i.test(body), 'no Registration Closed text');
  assert.match(body, /Next live session:\s*date coming soon/i);
  assert.ok(!/Nov(ember)? 12/.test(body), 'no past date');
  const ctas = page.locator('a.cta:not(#leadhosted)'), count = await ctas.count();
  assert.ok(count >= 3, 'the lander has several CTAs');
  for (let i = 0; i < count; i++) {
    await ctas.nth(i).scrollIntoViewIfNeeded(); await ctas.nth(i).click();
    assert.equal(await page.locator('#lead').evaluate(el => el.classList.contains('show')), true, 'CTA ' + i + ' opens the pop-over');
    assert.equal(await page.locator('#lead').getAttribute('data-step'), '1');
    await page.locator('#leadx').click();
  }
  await ctas.first().click();
  await page.fill('#lead_name', 'No Session'); await page.fill('#lead_email', 'test+clone@jonmac.ai');
  await page.click('.lead-go');
  assert.equal(await page.locator('#lead').getAttribute('data-step'), '2');
  assert.match(await page.locator('.lead-thanks').innerText(), /Thanks, you.re on the list\. We.ll email you the next live date\./);
  assert.equal(await page.locator('#paygo').isVisible(), false, 'no checkout button');
  assert.ok(!api.includes('/clone/api/checkout-session'), 'no checkout session requested');
  await page.waitForTimeout(300);
  assert.ok(await (await mf.getKVNamespace('CLONE_LEADS')).get('lead:test+clone@jonmac.ai'), 'pop-over stored the lead');
  assert.deepEqual(errors, []);
});
