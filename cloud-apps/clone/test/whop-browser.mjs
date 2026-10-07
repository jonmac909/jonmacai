// Real Worker/assets + browser, with Whop, Commas and email requests intercepted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare, Response as MFResponse } from 'miniflare';
import { chromium } from 'playwright';
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
  const context = await browser.newContext();
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base.origin) {
      const request = route.request();
      const response = await mf.dispatchFetch(request.url(), { method: request.method(), headers: request.headers(), body: request.postData() || undefined });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    }
    // The production queue remains available for assertions. The remote loader is mocked.
    return route.fulfill({ body: '', contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  await context.addCookies([{ name: '_wuid', value: 'wuid_browser_fixture', url: base.origin }]);
  const page = await context.newPage();
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
  assert.equal(calendar.searchParams.get('recur'), 'RRULE:FREQ=DAILY');
  assert.equal(calendar.searchParams.get('ctz'), 'America/New_York');
  assert.match(calendar.searchParams.get('dates'), /T190000\/\d{8}T210000$/);
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
  assert.deepEqual(errors, []);
  console.log('PASS: no browser runtime errors');
} finally { await browser.close(); await mf.dispose(); }
