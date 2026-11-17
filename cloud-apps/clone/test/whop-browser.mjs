// Real Worker/assets + browser, with Whop, Commas and email requests intercepted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare, Response as MFResponse } from 'miniflare';
import { chromium } from 'playwright';
import { preCloseClock, realClosed } from './clock.mjs';
const publicRoot = new URL('../public/', import.meta.url);
const serverEvents = [];
const mf = new Miniflare({ modules: true, scriptPath: fileURLToPath(new URL('../src/index.js', import.meta.url)),
  compatibilityDate: '2026-07-01', modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  host: '127.0.0.1', port: 0, bindings: { WHOP_API_KEY: 'mock-key' },
  kvNamespaces: ['CLONE_LEADS'], d1Databases: ['CLONE_UPSELLS'],
  outboundService: async request => {
    assert.equal(new URL(request.url).origin, 'https://api.whop.com');
    serverEvents.push(await request.json()); return new MFResponse('{"id":"mock-whop-event"}');
  },
  serviceBindings: { ASSETS: async request => {
    const path = new URL(request.url).pathname;
    try {
      const body = readFileSync(new URL('.' + path, publicRoot));
      return new MFResponse(body, { headers: { 'content-type': path.endsWith('.html') ? 'text/html' : 'text/javascript' } });
    } catch { return new MFResponse('missing', { status: 404 }); }
  } },
});
const browser = await chromium.launch({ headless: true, channel: 'chrome', chromiumSandbox: process.env.CHROME_NO_SANDBOX !== '1' });
try {
  await mf.ready;
  const base = new URL('https://jonmac.ai'), db = await mf.getD1Database('CLONE_UPSELLS');
  for (const name of ['0001_upsells.sql', '0002_sandbox.sql', '0003_whop_events.sql']) {
    for (const sql of readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8').split(';').filter(s => s.trim())) await db.prepare(sql).run();
  }
  const proxy = async route => {
    const url = new URL(route.request().url());
    if (url.origin === base.origin) {
      const request = route.request();
      const response = await mf.dispatchFetch(request.url(), { method: request.method(), headers: request.headers(), body: request.postData() || undefined });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    }
    // The production queue remains available for assertions. The remote loader is mocked.
    return route.fulfill({ body: '', contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html' });
  };
  const context = await browser.newContext(); await context.route('**/*', proxy);
  await context.addCookies([{ name: '_wuid', value: 'wuid_browser_fixture', url: base.origin }]);
  const page = await context.newPage(); await preCloseClock(page);
  const errors = []; page.on('pageerror', error => errors.push(page.url() + ' ' + error.stack));
  for (const name of ['index', 'software', 'audit', 'vault', 'welcome', 'survey', 'terms', 'privacy', 'refund']) {
    const response = await page.goto(new URL('/clone/' + name + '.html', base).toString());
    assert.equal(response.status(), 200);
    assert.ok(response.headers()['content-security-policy'].includes('https://t.whop.tw'));
    const events = await page.evaluate(() => window.whop.q.map(entry => entry[1]));
    assert.equal(events.filter(e => e === 'page').length, 1, name);
    assert.ok(!events.includes('purchase'), 'Page load must not count revenue');
    console.log('PASS: ' + name + ' has one page event, no purchase, and Whop CSP');
  }
  await page.goto(new URL('/clone/welcome.html', base).toString());
  assert.deepEqual(errors, [], 'Browser runtime errors before calendar');
  const calendar = new URL(await page.locator('#cal').getAttribute('href'));
  assert.equal(calendar.searchParams.get('recur'), null, 'One live session: no recurring calendar');
  assert.equal(calendar.searchParams.get('ctz'), 'America/New_York');
  assert.equal(calendar.searchParams.get('dates'), '20261112T190000/20261112T210000');
  // Leads are always accepted (Jon, Nov 16); only the checkout flow depends on NEXT_SESSION.
  {
    await page.goto(new URL('/clone/?wacid=campaign&wasid=adset&waid=ad', base).toString());
    await page.locator('a.cta').first().click();
    await page.locator('#lead_name').fill('Fixture Buyer'); await page.locator('#lead_email').fill('fixture@example.test');
    await page.locator('#lead_phone').fill('3055550100');
    await page.locator('#leadf').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => window.whop.q.some(e => e[1] === 'lead'));
    for (let i = 0; i < 50 && serverEvents.length < 2; i++) await new Promise(r => setTimeout(r, 100));
    const leadId = await page.evaluate(() => whop.q.find(e => e[1] === 'lead')[2].event_id);
    assert.deepEqual(serverEvents.map(e => e.event_id), [leadId, leadId + '_registration']);
    assert.equal(serverEvents[0].user.anonymous_id, 'wuid_browser_fixture');
    assert.equal(serverEvents[0].context.ad_id, 'ad');
    console.log('PASS: opt-in browser/server IDs match, with _wuid and Whop ad attribution; no email dispatch');
  }
  // Lead events (Whop lead + complete_registration, Meta Lead) wait for a 2xx from /api/lead.
  for (const [label, status, fires] of [['accepted 200', 200, true], ['closed 410', 410, false], ['server error 500', 500, false], ['network failure', 0, false]]) {
    const fresh = await browser.newContext(); await fresh.route('**/*', proxy);
    await fresh.addInitScript(() => { window.fbqCalls = []; window.fbq = function () { window.fbqCalls.push([].slice.call(arguments)); }; });
    const lp = await fresh.newPage(); lp.on('pageerror', error => errors.push(lp.url() + ' ' + error.stack));
    await preCloseClock(lp);
    let leadCalls = 0;
    await lp.route('**/clone/api/lead*', route => { leadCalls++; return status ? route.fulfill({ status, contentType: 'application/json',
      body: JSON.stringify(status === 200 ? { ok: true } : { ok: false, error: status === 410 ? 'sales_closed' : 'server_error' }) }) : route.abort(); });
    await lp.goto(new URL('/clone/', base).toString());
    await lp.locator('a.cta').first().click();
    await lp.locator('#lead_name').fill('Pixel Buyer'); await lp.locator('#lead_email').fill('pixel@example.test');
    await lp.locator('#leadf').evaluate(form => form.requestSubmit());
    for (let i = 0; i < 50 && !leadCalls; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(leadCalls, 1, label);
    await new Promise(r => setTimeout(r, 800));
    const seen = await lp.evaluate(() => ({ whop: whop.q.map(e => e[1]).filter(e => ['lead', 'complete_registration'].includes(e)),
      meta: fbqCalls.filter(c => c[0] === 'track' && c[1] === 'Lead').length, custom: fbqCalls.filter(c => c[0] === 'trackCustom' && c[1] === 'Lead').length }));
    assert.deepEqual(seen, fires ? { whop: ['lead', 'complete_registration'], meta: 1, custom: 1 } : { whop: [], meta: 0, custom: 0 }, 'Lead events after ' + label);
    await fresh.close();
  }
  console.log('PASS: Lead pixel and Whop lead events fire only on a 2xx from /api/lead, not on 410, 500 or a network failure');
  await page.goto(new URL('/clone/software.html', base).toString());
  await page.route('**/clone/api/upsell', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    ok: false, fallback: true, reason: 'buyer_unverified', checkoutUrl: 'https://commas.com/checkout/wg0E8nj4FjdaJ6L'
  }) }));
  await page.route('https://commas.com/checkout/**', route => route.fulfill({ body: '<html>Hosted checkout intercepted</html>', contentType: 'text/html' }));
  const navigation = page.waitForURL('https://commas.com/checkout/**');
  await page.locator('[data-upsell="software"]').first().click(); await navigation;
  const hosted = new URL(page.url());
  assert.equal(hosted.searchParams.get('whop_anonymous_id'), 'wuid_browser_fixture');
  assert.equal(hosted.searchParams.get('waid'), 'ad');
  console.log('PASS: hosted upsell fallback carries retained _wuid and Whop campaign parameters');
  // NEXT_SESSION is null (no live date): no closed message, CTAs open the pop-over, step 2 is the thank-you, no checkout or cart event.
  const dateless = await context.newPage(); dateless.on('pageerror', error => errors.push(dateless.url() + ' ' + error.stack));
  const apiCalls = []; dateless.on('request', r => { if (/\/clone\/api\/checkout-session/.test(r.url())) apiCalls.push(r.url()); });
  await dateless.goto(new URL('/clone/', base).toString());
  assert.ok(!(await dateless.locator('body').innerText()).match(/Registration Closed/i), 'No closed text');
  await dateless.locator('a.cta').first().click();
  assert.equal(await dateless.locator('#lead').evaluate(el => el.classList.contains('show')), true, 'CTA opens the sign-up pop-over');
  await dateless.locator('#lead_name').fill('Fixture Buyer'); await dateless.locator('#lead_email').fill('dateless@example.test');
  await dateless.locator('#leadf').evaluate(form => form.requestSubmit());
  await dateless.locator('.lead-thanks').waitFor();
  assert.deepEqual(apiCalls, [], 'No checkout call without a live date');
  console.log('PASS: with no live date the lander opens the pop-over, shows the thank-you and never starts a checkout');
  // Post-purchase pages are open to every visitor, verified buyer or not.
  for (const buyer of [false, true]) {
    const fresh = await browser.newContext(); await fresh.route('**/*', proxy);
    if (buyer) await fresh.route('**/clone/api/buyer-session', route => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
    const gated = await fresh.newPage(); gated.on('pageerror', error => errors.push(gated.url() + ' ' + error.stack));
    for (const name of ['welcome', 'survey', 'software', 'audit', 'vault']) {
      await gated.goto(new URL('/clone/' + name + '.html', base).toString());
      assert.equal(await gated.locator('#jm-closed').count(), 0, name + ' has no closed panel');
      assert.notEqual(await gated.evaluate(() => getComputedStyle(document.body).display), 'none');
      assert.ok(!(await gated.locator('body').innerText()).match(/Registration Closed/i), name);
    }
    await fresh.close();
    console.log('PASS: the five buyer pages are open to ' + (buyer ? 'a verified buyer' : 'an unverified visitor'));
  }
  {
    // A remembered browser whose session lapsed still cannot reach a checkout: the Worker answers 410.
    const fresh = await browser.newContext(); await fresh.route('**/*', proxy);
    await fresh.addInitScript(() => localStorage.setItem('jm_clone_buyer_seen', '1'));
    await fresh.route('**/clone/api/buyer-session', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false,"fallback":true}' }));
    await fresh.route('**/clone/api/upsell', route => route.fulfill({ status: 410, contentType: 'application/json',
      body: '{"ok":false,"error":"sales_closed","closed":true,"message":"Registration is closed for this session."}' }));
    const lapsed = await fresh.newPage();
    const hostedHits = []; lapsed.on('request', r => { if (r.url().includes('commas.com/checkout')) hostedHits.push(r.url()); });
    await lapsed.goto(new URL('/clone/software.html', base).toString());
    await lapsed.locator('[data-upsell="software"]').first().click();
    await lapsed.locator('.upsell-result').waitFor();
    assert.match(await lapsed.locator('.upsell-result').innerText(), /closed/i);
    assert.equal(await lapsed.locator('.upsell-result a').count(), 0);
    assert.deepEqual(hostedHits, [], 'No hosted checkout without a verified buyer');
    await fresh.close();
    console.log('PASS: an unverified upsell click shows the closed message and never opens checkout');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: no browser runtime errors');
} finally { await browser.close(); await mf.dispose(); }
