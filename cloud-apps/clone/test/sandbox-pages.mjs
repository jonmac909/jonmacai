// Real Worker HTML rewriting and six pages for each simulated purchase.
// --live-video permits only YouTube player/media requests. No payment or pixel sends.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare, Response as MFResponse } from 'miniflare';
import { chromium } from 'playwright';
import { sandboxSettings } from './sandbox-fixture.mjs';

const live = process.argv.includes('--live-video');
const proofFile = process.env.JON6_PURCHASE_PROOF;
const transactions = proofFile ? JSON.parse(readFileSync(proofFile, 'utf8')).purchases.map(p => p.transaction_ref) : ['SIM-JON6-pages-1', 'SIM-JON6-pages-2'];
const settings = sandboxSettings(), publicRoot = new URL('../public/', import.meta.url);
const report = { kind: 'per-simulated-purchase-browser-check', video_provider: live ? 'YouTube live' : 'mocked', purchases: [], gaps: [] };
const mf = new Miniflare({ modules: true, scriptPath: fileURLToPath(new URL('../src/index.js', import.meta.url)),
  compatibilityDate: '2026-08-01', modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], bindings: settings,
  kvNamespaces: ['CLONE_LEADS'], d1Databases: ['CLONE_UPSELLS'],
  outboundService: () => { throw Error('Page proof must not make server network calls'); },
  serviceBindings: { ASSETS: async request => {
    const path = new URL(request.url).pathname;
    try { return new MFResponse(readFileSync(new URL('.' + path, publicRoot)), {
      headers: { 'content-type': path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'text/css' } }); }
    catch { return new MFResponse('missing', { status: 404 }); }
  } } });
const browser = await chromium.launch({ headless: true });
try {
  await mf.ready; const db = await mf.getD1Database('CLONE_UPSELLS');
  for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
    for (const sql of readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8').split(';').filter(s => s.trim())) await db.prepare(sql).run();
  }
  const context = await browser.newContext({ ignoreHTTPSErrors: true }), pixelRequests = [], errors = [], logs = [];
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (/whop\.(?:tw|com)$/.test(url.hostname)) { pixelRequests.push(url.origin); return route.abort(); }
    if (url.origin === 'https://jonmac.ai') {
      const response = await mf.dispatchFetch(request.url(), { method: request.method(), headers: request.headers(), body: request.postData() || undefined });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    }
    if (live && /(?:^|\.)(youtube-nocookie\.com|youtube\.com|googlevideo\.com|ytimg\.com|gstatic\.com)$/.test(url.hostname)) return route.continue();
    return route.fulfill({ body: url.pathname.endsWith('.js') ? '' : '<html><body>Mock external asset</body></html>', contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { try { const entry = JSON.parse(msg.text()); if (entry.mode === 'sandbox-log-only') logs.push(entry); } catch {} });
  // Get the real signed access cookie through the Worker and browser.
  await page.goto('https://jonmac.ai/clone/?sandbox=1');
  assert.equal(await page.evaluate(() => document.body.textContent.includes('sandbox_forbidden')), true);
  const login = await page.evaluate(async token => {
    const r = await fetch('/clone/api/sandbox/access', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); return r.status;
  }, settings.CLONE_SANDBOX_ACCESS_TOKEN); assert.equal(login, 200);
  mkdirSync('.wrangler/proof/pages', { recursive: true });
  for (const transaction of transactions) {
    await page.evaluate(id => sessionStorage.setItem('jm_sandbox_clone_transaction', id), transaction);
    const purchase = { transaction_ref: transaction, pages: [] };
    for (const name of ['index', 'software', 'audit', 'vault', 'welcome', 'survey']) {
      const path = '/clone/' + (name === 'index' ? '' : name + '.html');
      const response = await page.goto('https://jonmac.ai' + path + '?sandbox=1&utm_source=JON6-sandbox', { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200); assert.equal(await page.evaluate(() => CloneMode.environment), 'sandbox');
      assert.equal(await page.evaluate(() => !!window.whop), false);
      assert.match(await page.locator('body').innerText(), /daily at 7:(?:00) PM (?:ET|Eastern)/i);
      const frames = page.locator('iframe[src*="youtube-nocookie.com/embed/"]');
      const videos = [];
      for (let i = 0; i < await frames.count(); i++) {
        const iframe = frames.nth(i), src = await iframe.getAttribute('src');
        assert.ok(await iframe.isVisible());
        const video = { id: new URL(src).pathname.split('/').pop(), src, visible: true, playback_verified: false };
        if (live) {
          await iframe.scrollIntoViewIfNeeded();
          const handle = await iframe.elementHandle(), frame = await handle.contentFrame();
          try {
            await frame.waitForFunction(() => !!document.querySelector('video'), null, { timeout: 20000 });
            // Exercise the same Watch button a buyer uses; below-fold muted
            // autoplay is browser-dependent and does not prove the control works.
            const toggle = iframe.locator('..').locator('.vv-toggle');
            await toggle.click();
            await frame.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.readyState >= 2 && v.currentTime > 0.5; }, null, { timeout: 20000 });
            Object.assign(video, await frame.evaluate(() => { const v = document.querySelector('video'); return { playback_verified: true, current_time: v.currentTime, duration: v.duration, ready_state: v.readyState }; }));
            await iframe.screenshot({ path: '.wrangler/proof/pages/' + transaction + '-' + name + '-video-' + i + '.png' });
            await toggle.click();
            await frame.waitForFunction(() => document.querySelector('video')?.paused, null, { timeout: 10000 });
            video.pause_verified = true;
            await toggle.click();
            await frame.waitForFunction(() => !document.querySelector('video')?.paused, null, { timeout: 10000 });
            video.resume_verified = true;
          } catch { video.error = await frame.locator('body').innerText().catch(() => 'Player unavailable'); }
        }
        videos.push(video);
      }
      assert.equal(videos.length > 0, name !== 'survey');
      // Reload must not create a second page event for the same transaction.
      await page.reload({ waitUntil: 'domcontentloaded' });
      const dedup = transaction + ':page:' + path;
      assert.equal(logs.filter(l => l.dedup_key === dedup).length, 1);
      const record = await page.evaluate(key => JSON.parse(sessionStorage.getItem('clone_sandbox_whop_event:' + key)), dedup);
      assert.equal(record.payload.event_name, 'page'); assert.ok(!record.payload.url.includes('sandbox='));
      await page.screenshot({ path: '.wrangler/proof/pages/' + transaction + '-' + name + '.png' });
      purchase.pages.push({ page: name, status: response.status(), daily_7pm_et: true, videos, whop: record, reload_deduplicated: true });
      console.log('PASS page/copy/log-dedup: ' + transaction + '/' + name + (name === 'survey' ? ' (known missing video)' : ''));
    }
    report.purchases.push(purchase);
  }
  assert.deepEqual(pixelRequests, []); assert.deepEqual(errors, []);
  report.whop_network_requests = pixelRequests.length;
  report.gaps.push('Survey has no video; Jon must supply the intended video.');
  if (live) for (const purchase of report.purchases) for (const page of purchase.pages) {
    if (page.videos.some(v => !v.playback_verified || !v.pause_verified || !v.resume_verified)) report.gaps.push(purchase.transaction_ref + '/' + page.page + ': video playback/controls were not verified.');
  }
} finally {
  writeFileSync('.wrangler/proof/pages-' + (live ? 'live' : 'mock') + '.json', JSON.stringify(report, null, 2));
  await browser.close(); await mf.dispose();
}
console.log(JSON.stringify({ page_checks: report.purchases.length * 6, whop_network_requests: report.whop_network_requests, gaps: report.gaps }));
if (live && report.gaps.length > 1) process.exitCode = 1;
