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
const browser = await chromium.launch({ headless: true });
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
  assert.equal(calendar.searchParams.get('dates'), '20261029T190000/20261029T210000');
  // The Worker's own clock decides sales; a real post-close run cannot take new leads.
  if (!realClosed) {
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
  } else console.log('SKIP: opt-in lead flow needs the Worker clock before the Oct 29 6:45 PM ET close; unit tests cover it with a shifted clock');
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
  // After sales close (6:45 PM ET Oct 29) sales are closed: no popup, no checkout, no Lead or cart event.
  const closed = await context.newPage(); closed.on('pageerror', error => errors.push(closed.url() + ' ' + error.stack));
  await closed.clock.install({ time: new Date('2026-10-29T22:50:00Z') });
  const apiCalls = []; closed.on('request', r => { if (/\/clone\/api\/(checkout-session|lead)/.test(r.url())) apiCalls.push(r.url()); });
  await closed.goto(new URL('/clone/', base).toString());
  await closed.waitForFunction(() => document.documentElement.classList.contains('sales-closed'));
  const cta = closed.locator('a.cta').first();
  assert.equal(await cta.innerText(), 'Registration Closed');
  assert.equal(await cta.getAttribute('href'), null);
  await cta.dispatchEvent('click');
  assert.equal(await closed.locator('#lead').evaluate(el => el.classList.contains('show')), false, 'No sign-up popup after close');
  assert.ok(!(await closed.locator('body').innerText()).match(/waitlist/i), 'No waitlist copy');
  assert.deepEqual(await closed.evaluate(() => window.whop.q.map(e => e[1]).filter(e => ['lead', 'complete_registration', 'add_to_cart'].includes(e))), []);
  assert.deepEqual(apiCalls, [], 'No checkout or lead call after close');
  console.log('PASS: after sales close the lander shows Registration Closed, with no popup, checkout or Lead event');
  // Post-purchase pages after close: unverified visitors see Registration Closed, verified buyers keep the page.
  for (const buyer of [false, true]) {
    const fresh = await browser.newContext(); await fresh.route('**/*', proxy);
    if (buyer) await fresh.route('**/clone/api/buyer-session', route => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
    const gated = await fresh.newPage(); gated.on('pageerror', error => errors.push(gated.url() + ' ' + error.stack));
    await gated.clock.install({ time: new Date('2026-10-29T22:50:00Z') });
    for (const name of ['welcome', 'survey', 'software', 'audit', 'vault']) {
      await gated.goto(new URL('/clone/' + name + '.html', base).toString());
      if (buyer) {
        await gated.waitForFunction(() => !document.documentElement.classList.contains('jm-gate-pending'));
        assert.equal(await gated.locator('#jm-closed').count(), 0, name + ' stays open for a verified buyer');
        assert.notEqual(await gated.evaluate(() => getComputedStyle(document.body).display), 'none');
      } else {
        await gated.locator('#jm-closed').waitFor();
        assert.equal(await gated.locator('#jm-closed h1').innerText(), 'Registration Closed');
        assert.equal(await gated.evaluate(() => getComputedStyle(document.body).display), 'none');
        assert.equal(await gated.locator('#jm-closed').evaluate(el => el.querySelectorAll('a[href]').length), 0, 'No checkout link');
      }
    }
    await fresh.close();
    console.log('PASS: after sales close the five buyer pages ' + (buyer ? 'stay open for a verified buyer' : 'show Registration Closed to an unverified visitor'));
  }
  {
    // A remembered browser whose session lapsed still cannot reach a checkout: the Worker answers 410.
    const fresh = await browser.newContext(); await fresh.route('**/*', proxy);
    await fresh.addInitScript(() => localStorage.setItem('jm_clone_buyer_seen', '1'));
    await fresh.route('**/clone/api/buyer-session', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false,"fallback":true}' }));
    await fresh.route('**/clone/api/upsell', route => route.fulfill({ status: 410, contentType: 'application/json',
      body: '{"ok":false,"error":"sales_closed","closed":true,"message":"Registration is closed for this session."}' }));
    const lapsed = await fresh.newPage(); await lapsed.clock.install({ time: new Date('2026-10-29T22:50:00Z') });
    const hostedHits = []; lapsed.on('request', r => { if (r.url().includes('commas.com/checkout')) hostedHits.push(r.url()); });
    await lapsed.goto(new URL('/clone/software.html', base).toString());
    await lapsed.locator('[data-upsell="software"]').first().click();
    await lapsed.locator('.upsell-result').waitFor();
    assert.match(await lapsed.locator('.upsell-result').innerText(), /closed/i);
    assert.equal(await lapsed.locator('.upsell-result a').count(), 0);
    assert.deepEqual(hostedHits, [], 'No hosted checkout after close');
    await fresh.close();
    console.log('PASS: after sales close an upsell click shows the closed message and never opens checkout');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: no browser runtime errors');
} finally { await browser.close(); await mf.dispose(); }
