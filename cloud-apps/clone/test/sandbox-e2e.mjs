// No Commas CLI or environment-selection API. Every provider request uses the
// hard-coded sandbox host and the dedicated sandbox key. Never trace card entry.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { OFFERS } from '../src/payment-config.js';

export const CASES = [
  { name: 'full funnel', offers: ['software', 'audit', 'vault'] },
  { name: 'software replay', offers: ['software'] },
  { name: 'audit replay', offers: ['audit'] },
  { name: 'vault replay', offers: ['vault'] },
  { name: 'three-payment plan', offers: ['vault_plan'] },
  { name: 'trial fallback', offers: ['trial'] },
  { name: 'alternative plan deduplication', offers: ['vault'], alternative: 'vault_plan' },
];
const API = 'https://api-sandbox.commas.net/public-api';
const CARD = '4242424242424242'; // Official sandbox Visa, never configurable.
const DEFAULT_SELECTORS = {
  number: 'input[autocomplete="cc-number"], input[name="cardnumber"], input[name="cardNumber"], input[data-elements-stable-field-name="cardNumber"]',
  expiry: 'input[autocomplete="cc-exp"], input[name="exp-date"], input[name="expiry"], input[data-elements-stable-field-name="cardExpiry"]',
  month: 'input[autocomplete="cc-exp-month"]', year: 'input[autocomplete="cc-exp-year"]',
  cvc: 'input[autocomplete="cc-csc"], input[name="cvc"], input[name="cvv"], input[data-elements-stable-field-name="cardCvc"]',
  postal: 'input[autocomplete="postal-code"], input[name="postal"], input[name="postalCode"]',
};
const pages = { software: 'software.html', trial: 'software.html', audit: 'audit.html', vault: 'vault.html', vault_plan: 'vault.html' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runSandbox(options = {}) {
  const settings = options.settings || process.env;
  assert.equal(settings.COMMAS_ENV, 'sandbox', 'Set COMMAS_ENV=sandbox for the runner');
  const apiKey = settings.COMMAS_SANDBOX_API_KEY, token = settings.CLONE_SANDBOX_ACCESS_TOKEN;
  assert.ok(apiKey && token?.length >= 32, 'Separate sandbox key and access token are required');
  assert.notEqual(apiKey, settings.COMMAS_API_KEY, 'Sandbox key must differ from production key');
  const base = new URL(settings.CLONE_SANDBOX_URL || 'https://jonmac.ai/clone/');
  assert.ok(base.pathname === '/clone/' && !base.username && !base.password &&
    ((base.protocol === 'https:' && base.hostname === 'jonmac.ai') ||
     (['http:', 'https:'].includes(base.protocol) && ['localhost', '127.0.0.1'].includes(base.hostname))), 'Use the Clone test URL or local mock server');
  base.search = ''; base.hash = '';
  const pageUrl = file => new URL(file + '?sandbox=1', base).toString();
  const apiUrl = route => new URL('api/' + route + '?sandbox=1', base).toString();
  const selectors = { ...DEFAULT_SELECTORS, ...JSON.parse(settings.CLONE_SANDBOX_SELECTORS || '{}') };
  const report = { environment: 'sandbox', cases: [], checkoutCount: 0, cardEntries: 0, subscriptions: [] };
  const browser = await chromium.launch({ headless: true });
  const providerFetch = options.providerFetch || fetch;
  const createdSubscriptions = [];
  let stage = 'preflight';
  async function provider(path, method = 'GET') {
    assert.ok(path.startsWith('/') && !path.includes('..'), 'Invalid sandbox API path');
    const r = await providerFetch(API + path, { method, headers: { 'x-api-key': apiKey, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20000) });
    const b = await r.json(); assert.ok(r.ok && b.status === 'success', 'Sandbox API verification failed'); return b.data;
  }
  async function list(path, field) {
    const rows = [];
    for (let page = 1; page <= 100; page++) {
      const d = await provider(path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
      assert.ok(Array.isArray(d[field]), 'Unexpected sandbox list response'); rows.push(...d[field]);
      if (!d.pagination?.has_more) return rows;
    }
    throw new Error('Sandbox pagination limit exceeded');
  }
  async function until(fn, label, timeout = options.verifyTimeout ?? 45000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(500); }
    throw new Error(label);
  }
  async function field(page, selector, required = true) {
    const find = async () => {
      const found = [];
      for (const frame of page.frames()) {
        const inputs = frame.locator(selector);
        for (let i = 0; i < await inputs.count(); i++) if (await inputs.nth(i).isVisible()) found.push(inputs.nth(i));
      }
      assert.ok(found.length <= 1, 'Ambiguous sandbox card selector'); return found[0];
    };
    return required ? until(find, 'Sandbox checkout field not found') : find();
  }
  async function login(context) {
    const r = await context.request.post(new URL('api/sandbox/access', base).toString(), { headers: { origin: base.origin }, data: { token } });
    assert.equal(r.status(), 200, 'Sandbox access/configuration unavailable');
    const configResponse = await context.request.get(apiUrl('config'));
    assert.equal(configResponse.status(), 200, 'Sandbox configuration unavailable');
    const c = await configResponse.json();
    assert.equal(c.environment, 'sandbox'); assert.equal(c.rebillEnabled, true, 'Sandbox rebill gate must be enabled');
    assert.equal(c.subscriptionsEnabled, true, 'Sandbox subscription gate must be enabled');
    for (const name of ['seat', ...Object.keys(OFFERS)]) {
      assert.ok(c.products[name] && !['nmGzE', ...Object.values(OFFERS).map(o => o.service)].includes(c.products[name]), 'Sandbox product map required');
      assert.ok(c.hosted[name].startsWith('https://sandbox.commas.net/'), 'Sandbox hosted URL required');
    }
    return c;
  }
  try {
    const runId = Date.now().toString(36);
    const selected = options.cases || CASES;
    for (const [index, testCase] of selected.entries()) {
      stage = 'case ' + (index + 1) + ': ' + testCase.name;
      const context = await browser.newContext({ serviceWorkers: 'block', ignoreHTTPSErrors: ['localhost', '127.0.0.1'].includes(base.hostname) });
      try {
        const c = await login(context);
        const hooks = await provider('/webhook-subscriptions');
        const hookUrl = new URL('api/sandbox/purchase', base).toString();
        assert.ok(Array.isArray(hooks) && hooks.some(h => h.webhook_url === hookUrl && h.is_active &&
          h.event_types?.includes('payment.succeeded')), 'Active sandbox purchase webhook required before checkout');
        // Check product terms before the first checkout. Sandbox service_id support
        // is proved by the resulting provider subscription, not assumed on HTTP 200.
        for (const name of ['seat', ...new Set(testCase.offers.filter(n => n !== 'trial'))]) {
          const product = await provider('/checkout-sessions/' + c.products[name]);
          assert.equal(product.amount_cents, name === 'seat' ? 4700 : OFFERS[name].cents, 'Sandbox price mismatch');
          assert.equal(product.type, OFFERS[name]?.recurring ? 'subscription' : 'onetime');
          if (OFFERS[name]?.recurring) {
            assert.equal(product.subscription.frequency_days, 30); assert.ok(!product.subscription.free_trial_days);
            if (name === 'vault_plan') assert.equal(product.subscription.auto_expire_after_x_periods, 2);
          }
        }
        const page = await context.newPage();
        let blockedProduction = false, cardFrames = 0;
        page.on('framenavigated', frame => {
          if (/checkout|stripe/.test(frame.url()) || (frame.parentFrame() && frame.url() === 'about:srcdoc')) cardFrames++;
        });
        await context.route('**/*', async route => {
          const u = new URL(route.request().url());
          const live = ['commas.com', 'www.fanbasis.com', 'fanbasis.com', 'embedded.fanbasis.io'].includes(u.hostname);
          if (live) { blockedProduction = true; return route.abort(); }
          // Trial navigation is asserted without submitting another hosted payment.
          if (u.hostname === 'sandbox.commas.net' && route.request().isNavigationRequest()) {
            return route.fulfill({ contentType: 'text/html', body: '<p>Sandbox hosted fallback verified.</p>' });
          }
          return route.continue();
        });
        if (options.preparePage) await options.preparePage(page, context);
        const upsellResults = [];
        // Read the real response before the page's immediate success redirect
        // disposes it. Forward the unchanged response to the browser.
        await context.route(apiUrl('upsell'), async route => {
          const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
          upsellResults.push(await response.json());
          await route.fulfill({ response });
        });
        const nextUpsell = () => until(() => upsellResults.shift(), 'Upsell response timed out');
        const email = `clone-sandbox-${runId}-${index}@example.test`;
        await page.goto(pageUrl(''));
        assert.equal(await page.evaluate(() => window.CloneMode?.environment), 'sandbox');
        stage = testCase.name + ': open seat modal';
        const sessionResponse = page.waitForResponse(r => r.url() === apiUrl('checkout-session') && r.request().method() === 'POST');
        await page.locator('a[href^="https://sandbox.commas.net/"]').first().click();
        const session = await (await sessionResponse).json();
        assert.equal(session.environment, 'sandbox'); assert.equal(session.productId, c.products.seat);
        await page.locator('#lead_name').fill('Clone Sandbox'); await page.locator('#lead_email').fill(email);
        await page.locator('#lead_phone').fill('3055550100'); await page.locator('#leadf button[type="submit"]').click();
        stage = testCase.name + ': enter sandbox card';
        await page.waitForFunction(() => document.querySelector('#leadpay').classList.contains('ready'));
        await (await field(page, selectors.number)).fill(CARD);
        const expiry = await field(page, selectors.expiry, false);
        if (expiry) await expiry.fill('12' + String(new Date().getUTCFullYear() + 2).slice(-2));
        else { await (await field(page, selectors.month)).fill('12'); await (await field(page, selectors.year)).fill(String(new Date().getUTCFullYear() + 2)); }
        await (await field(page, selectors.cvc)).fill('123');
        const postal = await field(page, selectors.postal, false); if (postal) await postal.fill('33101');
        for (const frame of page.frames()) {
          const terms = frame.getByRole('checkbox', { name: /terms|agree|consent/i });
          for (let i = 0; i < await terms.count(); i++) if (await terms.nth(i).isVisible()) await terms.nth(i).check();
        }
        report.cardEntries++;
        stage = testCase.name + ': submit seat checkout';
        await page.locator('#paygo').click(); await page.waitForURL(pageUrl('software.html'));
        const transactionId = await page.evaluate(() => sessionStorage.getItem('jm_sandbox_clone_transaction'));
        assert.ok(transactionId, 'SDK purchase reference missing');
        const transaction = await provider('/transactions/' + transactionId);
        assert.equal((transaction.product || transaction.service).id, c.products.seat); assert.equal(Number(transaction.amount), 47);
        assert.equal(transaction.fan.email.toLowerCase(), email); assert.deepEqual(transaction.refunds, []);
        const customers = (await list('/customers?search=' + encodeURIComponent(email), 'customers')).filter(x => x.email.toLowerCase() === email);
        assert.equal(customers.length, 1); const customer = Number(customers[0].id); assert.ok(Number.isSafeInteger(customer) && customer > 0);
        const savedCards = await provider('/customers/' + customer + '/payment-methods');
        assert.ok(savedCards.payment_methods.some(x => x.type === 'card'), 'Checkout did not save sandbox card');
        const seatRows = (await list('/checkout-sessions/' + c.products.seat + '/transactions', 'transactions')).filter(x => x.fan?.email?.toLowerCase() === email);
        assert.equal(seatRows.length, 1, 'Initial checkout must create exactly one transaction');
        report.checkoutCount++;
        await until(async () => {
          const r = await context.request.post(apiUrl('buyer-session'), { headers: { origin: base.origin }, data: { transactionId } });
          const b = await r.json(); if (b.pending) return false; assert.equal(b.ok, true, 'Sandbox webhook identity verification failed'); return true;
        }, 'Sandbox buyer proof timed out');
        const result = { name: testCase.name, seatTransaction: transaction.id || transactionId, offers: [] };
        for (const name of testCase.offers) {
          stage = testCase.name + ': verify ' + name;
          await page.goto(pageUrl(pages[name]));
          const product = c.products[name];
          const transactions = () => list('/checkout-sessions/' + product + '/transactions', 'transactions');
          const forBuyer = rows => rows.filter(x => x.fan?.email?.toLowerCase() === email);
          const before = forBuyer(await transactions());
          const subsBefore = await list('/subscribers?customer_id=' + customer + '&product_id=' + product, 'subscribers');
          const framesBefore = cardFrames;
          const button = page.locator('[data-upsell="' + name + '"]').first();
          if (name === 'vault_plan') { await page.locator('[data-exit]').click(); }
          await button.click(); const outcome = await nextUpsell();
          stage = testCase.name + ': reconcile ' + name;
          if (name === 'trial') {
            assert.equal(outcome.reason, 'trial_hosted'); assert.equal(outcome.checkoutUrl, c.hosted.trial);
            await page.waitForURL(c.hosted.trial); assert.equal(forBuyer(await transactions()).length, before.length);
            result.offers.push({ offer: name, fallback: 'sandbox hosted trial; no trial submitted' }); continue;
          }
          assert.equal(outcome.ok, true, 'One-click sandbox charge failed; do not retry via hosted checkout');
          await page.waitForURL(new URL(outcome.next, base).toString());
          assert.equal(cardFrames, framesBefore, 'One-click upsell opened a card form');
          assert.equal(await page.locator('iframe[src*="checkout"], iframe[src*="stripe"], input[autocomplete^="cc-"]').count(), 0, 'Upsell requested card re-entry');
          const charged = await until(async () => {
            const rows = forBuyer(await transactions()).filter(x => !before.some(b => b.id === x.id)); return rows.length ? rows : false;
          }, 'Upsell transaction absent from sandbox ledger');
          assert.equal(charged.length, 1, 'More than one upsell charge'); assert.equal(Number(charged[0].amount) * 100, OFFERS[name].cents);
          let subscription;
          if (OFFERS[name].recurring) {
            stage = testCase.name + ': subscription creation ' + name;
            subscription = await until(async () => {
              const rows = (await list('/subscribers?customer_id=' + customer + '&product_id=' + product, 'subscribers'))
                .filter(x => x.customer?.email?.toLowerCase() === email && x.product?.id === product && !subsBefore.some(b => b.id === x.id));
              assert.ok(rows.length <= 1, 'Duplicate subscription created'); return rows[0];
            }, 'Saved-card charge did not create a subscription');
            const record = { product, id: subscription.subscription.id }; createdSubscriptions.push(record);
            assert.equal(subscription.subscription.status, 'active'); assert.equal(subscription.subscription.payment_frequency, 'monthly');
            assert.ok(Date.parse(subscription.subscription.created_at) >= Date.now() - 300000, 'Subscription was not created by this test');
            const rows = await list('/checkout-sessions/' + product + '/subscriptions', 'subscriptions');
            const renewal = rows.find(x => x.id === record.id); assert.ok(renewal, 'Subscription missing from product');
            const days = (Date.parse(renewal.next_renewal_date) - Date.now()) / 86400000;
            assert.ok(days > 29 && days < 31, 'Subscription next billing date must be 30 days out');
            report.subscriptions.push(record);
          }
          // Concurrent API repeats, refresh + UI repeat, and alternative plan all
          // reuse the permanent claim. Compare the provider ledger after settling.
          const replay = () => context.request.post(apiUrl('upsell'), { headers: { origin: base.origin }, data: { offer: name } });
          stage = testCase.name + ': idempotency ' + name;
          for (const r of await Promise.all([replay(), replay()])) assert.deepEqual(await r.json(), outcome);
          stage = testCase.name + ': UI replay ' + name;
          await page.goto(pageUrl(pages[name])); await page.reload();
          await page.locator('[data-upsell="' + name + '"][role="button"]').first().waitFor({ state: 'attached' });
          if (name === 'vault_plan') await page.locator('[data-exit]').click();
          await page.locator('[data-upsell="' + name + '"]').first().click(); assert.deepEqual(await nextUpsell(), outcome);
          await page.waitForURL(new URL(outcome.next, base).toString());
          if (testCase.alternative) {
            const r = await context.request.post(apiUrl('upsell'), { headers: { origin: base.origin }, data: { offer: testCase.alternative } });
            assert.deepEqual(await r.json(), outcome);
            const alternativeRows = forBuyer(await list('/checkout-sessions/' + c.products[testCase.alternative] + '/transactions', 'transactions'));
            assert.equal(alternativeRows.length, 0, 'Alternative plan charged the same buyer twice');
          }
          await sleep(options.settleMs ?? 3000);
          assert.equal(forBuyer(await transactions()).length, before.length + 1, 'Repeat requests duplicated a provider charge');
          if (subscription) {
            const rows = (await list('/subscribers?customer_id=' + customer + '&product_id=' + product, 'subscribers')).filter(x => x.customer?.email?.toLowerCase() === email);
            assert.equal(rows.length, subsBefore.length + 1, 'Repeat requests duplicated a subscription');
          }
          result.offers.push({ offer: name, transaction: charged[0].id, idempotent: true, cardReentry: false, subscription: subscription?.subscription.id });
        }
        assert.equal(blockedProduction, false, 'Funnel attempted a production payment host');
        report.cases.push(result); options.log?.('PASS sandbox case ' + (index + 1) + ': ' + testCase.name);
      } finally { await context.close(); }
    }
    assert.equal(report.cardEntries, report.checkoutCount, 'Card must be entered once per initial checkout only');
    return report;
  } catch {
    // Do not print Playwright/API errors, URLs, tokens, card fields or raw bodies.
    throw new Error('Sandbox E2E failed during ' + stage + '. No hosted payment retry was submitted.');
  } finally {
    let cleanupFailed = false;
    try {
      for (const subscription of createdSubscriptions) {
        try {
          const result = await provider('/checkout-sessions/' + subscription.product + '/subscriptions/' + subscription.id, 'DELETE');
          assert.equal(result.subscription_status, 'cancelled'); subscription.cancelled = true;
        } catch { cleanupFailed = true; }
      }
    } finally { await browser.close(); }
    if (cleanupFailed) throw new Error('Sandbox E2E failed during subscription cleanup. Reconcile these sandbox IDs: ' + createdSubscriptions.filter(s => !s.cancelled).map(s => s.product + '/' + s.id).join(', '));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--run')) {
    console.log('Prepared only: seven fresh $47 SANDBOX checkouts; all paid upsells, no card re-entry, concurrent/refresh repeats, subscription creation and cancellation; trial sandbox fallback.');
    console.log('To run after provisioning: COMMAS_ENV=sandbox, COMMAS_SANDBOX_API_KEY, CLONE_SANDBOX_ACCESS_TOKEN; then npm run test:sandbox -- --run. Never use the production key or Commas CLI.');
  } else {
    try { console.log(JSON.stringify(await runSandbox({ log: console.log }), null, 2)); }
    catch (e) { console.error(e.message.startsWith('Sandbox E2E failed') ? e.message : 'Sandbox E2E preflight failed. Check dedicated credentials and configuration.'); process.exitCode = 1; }
  }
}
