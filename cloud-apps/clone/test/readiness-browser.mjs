// Actual Worker/KV/D1 and checkout UI; every external resource is intercepted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Miniflare, Response as MFResponse } from 'miniflare';
import { chromium } from 'playwright';
import { preCloseClock, realClosed } from './clock.mjs';

const publicRoot = new URL('../public/', import.meta.url);
const mf = new Miniflare({ modules: true, scriptPath: fileURLToPath(new URL('../src/index.js', import.meta.url)),
  compatibilityDate: '2026-07-01', modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  host: '127.0.0.1', port: 0, bindings: { CLONE_SCORECARD_ENABLED: 'true' },
  kvNamespaces: ['CLONE_LEADS'], d1Databases: ['CLONE_UPSELLS'],
  outboundService: () => { throw new Error('No external server requests allowed'); },
  serviceBindings: { ASSETS: async request => {
    const path = new URL(request.url).pathname;
    try {
      return new MFResponse(readFileSync(new URL('.' + path, publicRoot)),
        { headers: { 'content-type': path.endsWith('.html') ? 'text/html' : 'text/javascript' } });
    } catch { return new MFResponse('missing', { status: 404 }); }
  } },
});
const sdk = `window.PaymentCheckout={create:function(options){window.mockCheckoutOptions=options;var events={};return {
 attachToElement:function(){},on:function(name,fn){events[name]=fn;},init:async function(){events['form:ready']();},
 setFirstName:async function(){},setLastName:async function(){},setEmail:async function(){},setPhone:async function(){},
 isFormReady:function(){return true;},submitForm:function(){throw Error('No payment submission allowed');}
};}};`;
const browser = await chromium.launch({ headless: true });
try {
  await mf.ready;
  const db = await mf.getD1Database('CLONE_UPSELLS'), kv = await mf.getKVNamespace('CLONE_LEADS');
  for (const name of ['0001_upsells.sql', '0002_sandbox.sql', '0003_whop_events.sql', '0004_reminders.sql', '0005_launch_readiness.sql']) {
    for (const sql of readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8').split(';').filter(s => s.trim())) await db.prepare(sql).run();
  }
  const context = await browser.newContext(), errors = [];
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === 'https://jonmac.ai') {
      if (url.pathname === '/clone/api/checkout-session') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        ok: true, checkoutSessionSecret: 'mock-only-session', creatorId: 'mock', productId: 'nmGzE', environment: 'production',
        hostedCheckoutUrl: 'https://commas.com/checkout/nmGzEY7RCWcGOKl', checkoutRef: 'mock-only-ref',
      }) });
      const response = await mf.dispatchFetch(request.url(), { method: request.method(), headers: request.headers(), body: request.postData() || undefined });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    }
    return route.fulfill({ body: url.hostname === 'cdn.embedded.fanbasis.io' ? sdk : '',
      contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  const page = await context.newPage(); await preCloseClock(page); page.on('pageerror', error => errors.push(error.message));
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/clone/api/visit')), page.goto('https://jonmac.ai/clone/')]);
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/clone/api/visit')), page.reload()]);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM clone_session_events WHERE kind='visit'").first()).n, 1);
  // The Worker's own clock decides sales; after the Oct 29 5:30 PM PT close it answers 410 to every lead.
  if (realClosed) {
    const closedLead = await page.evaluate(() => fetch('/clone/api/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.status));
    assert.equal(closedLead, 410);
    console.log('PASS: sales closed, lead API answers 410 (lead and consent flow skipped; unit tests cover it with a shifted clock)');
  } else {
    await page.locator('a.cta').first().click();
    // SMS is disabled, so the checkout must not offer or collect text consent.
    assert.equal(await page.locator('#lead_sms_consent').isVisible(), false);
    assert.equal(await page.locator('.lead-consent').isVisible(), false);
    assert.equal(await page.locator('#lead_sms_consent').isChecked(), false);
    await page.locator('#lead_name').fill('Fixture Buyer'); await page.locator('#lead_email').fill('optional@example.test');
    const leadSaved = page.waitForResponse(response => response.url().endsWith('/clone/api/lead'));
    await page.locator('#leadf').evaluate(form => form.requestSubmit()); assert.equal((await leadSaved).status(), 200);
    await page.waitForFunction(() => window.mockCheckoutOptions);
    assert.equal(await page.evaluate(() => mockCheckoutOptions.collectPhone), false);
    assert.match(await page.evaluate(() => mockCheckoutOptions.metadata.clone_session_date), /^\d{4}-\d{2}-\d{2}$/);
    const noPhone = JSON.parse(await kv.get('lead:optional@example.test'));
    assert.equal(noPhone.phone, ''); assert.equal(noPhone.smsConsent, false);
    console.log('PASS: checkout without a phone or SMS consent, and deduplicated first-party visits');
  
    await page.locator('#leadback').click();
    await page.locator('#lead_phone').fill('3055550100');
    const phoneSaved = page.waitForResponse(response => response.url().endsWith('/clone/api/lead'));
    await page.locator('#leadf').evaluate(form => form.requestSubmit()); assert.equal((await phoneSaved).status(), 200);
    const withPhone = JSON.parse(await kv.get('lead:optional@example.test'));
    assert.equal(withPhone.phone, '+13055550100'); assert.equal(withPhone.smsConsent, false);
    assert.equal(withPhone.smsConsentStatus, 'not_requested'); assert.equal(withPhone.smsConsentAt, null);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#leadback').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(tmpdir(), 'clone-readiness-consent-mobile.png') });
    await page.reload(); await page.locator('a.cta').first().click();
    assert.equal(await page.locator('.lead-consent').isVisible(), false);
    assert.equal(await page.locator('#lead_sms_consent').isChecked(), false);
    console.log('PASS: no SMS consent collected or shown, phone optional, mobile fits, reload never opts in');
  }

  await Promise.all([page.waitForResponse(response => response.url().endsWith('/clone/api/readiness')), page.goto('https://jonmac.ai/clone/welcome.html')]);
  assert.equal(await page.locator('#breakout-faq .faq-answer').count(), 4);
  assert.equal(await page.locator('[data-faq-video]:visible').count(), 0);
  assert.equal(await page.locator('[data-faq-video] iframe').count(), 0);
  await page.locator('#breakout-faq').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(tmpdir(), 'clone-readiness-faq-mobile.png') });
  await page.route('**/clone/api/readiness', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ faqVideos: { followers: 'GP3NRg8NMY4', camera: 'https://evil.test' }, metricsEnabled: false }) }));
  await page.reload(); await page.waitForSelector('[data-faq-video="followers"] iframe');
  assert.equal(await page.locator('[data-faq-video]:visible').count(), 1);
  assert.match(await page.locator('[data-faq-video="followers"] iframe').getAttribute('src'), /^https:\/\/www.youtube-nocookie.com\/embed\/GP3NRg8NMY4/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: four FAQ answers, hidden empty slots, validated video configuration, no browser errors');

  // Fullscreen: the custom control must fill the viewport and exit at phone width.
  const fsPage = await context.newPage();
  fsPage.on('pageerror', error => errors.push(error.message));
  await fsPage.setViewportSize({ width: 390, height: 844 });
  await fsPage.goto('https://jonmac.ai/clone/');
  await fsPage.locator('.vv-fs').scrollIntoViewIfNeeded();
  await fsPage.locator('.vv-fs').click();
  await fsPage.waitForFunction(() => document.fullscreenElement?.classList.contains('vv-hero'));
  const nativeFs = await fsPage.evaluate(() => {
    const hero = document.querySelector('.vv-hero'), rect = hero.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height), innerWidth, innerHeight,
      pressed: document.querySelector('.vv-fs').getAttribute('aria-pressed') };
  });
  assert.deepEqual(nativeFs, { width: 390, height: 844, innerWidth: 390, innerHeight: 844, pressed: 'true' });
  await fsPage.locator('.vv-fs').click();
  await fsPage.waitForFunction(() => !document.fullscreenElement);
  await fsPage.close();

  // iPhone Safari has no element Fullscreen API: the same button fills the viewport in-page.
  const iosPage = await context.newPage();
  iosPage.on('pageerror', error => errors.push(error.message));
  await iosPage.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', { value: undefined, configurable: true });
    Object.defineProperty(Element.prototype, 'webkitRequestFullscreen', { value: undefined, configurable: true });
  });
  await iosPage.setViewportSize({ width: 390, height: 844 });
  await iosPage.goto('https://jonmac.ai/clone/');
  await iosPage.locator('.vv-fs').scrollIntoViewIfNeeded();
  await iosPage.locator('.vv-fs').click();
  assert.equal(await iosPage.locator('.vv-hero.vv-fs-fallback').count(), 1);
  const fallbackFs = await iosPage.evaluate(() => {
    const hero = document.querySelector('.vv-hero'), rect = hero.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height), innerWidth, innerHeight,
      position: getComputedStyle(hero).position, pressed: document.querySelector('.vv-fs').getAttribute('aria-pressed') };
  });
  assert.deepEqual(fallbackFs, { width: 390, height: 844, innerWidth: 390, innerHeight: 844, position: 'fixed', pressed: 'true' });
  await iosPage.locator('.vv-fs').click();
  assert.equal(await iosPage.locator('.vv-hero.vv-fs-fallback').count(), 0);
  await iosPage.evaluate(() => {
    const video = document.createElement('video');
    video.webkitEnterFullscreen = () => { window.__videoFullscreen = true; };
    document.querySelector('.vv-hero').appendChild(video);
  });
  await iosPage.locator('.vv-fs').click();
  assert.equal(await iosPage.evaluate(() => window.__videoFullscreen), true);
  await iosPage.close();
  assert.deepEqual(errors, []);
  console.log('PASS: video fullscreen fills the viewport and exits; iPhone fallback and video fullscreen path work');
} finally { await browser.close(); await mf.dispose(); }
