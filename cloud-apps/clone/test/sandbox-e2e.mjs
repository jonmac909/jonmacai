// No Commas CLI or environment-selection API. Every provider request uses the
// hard-coded sandbox host and the dedicated sandbox key. Never trace card entry.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { OFFERS } from '../src/payment-config.js';
import { customerId } from '../src/upsells.js';

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
  const report = { environment: 'sandbox', cases: [], checkoutCount: 0, cardEntries: 0, subscriptions: [], simulatedWebhooks: [] };
  const simulateWebhooks = settings.CLONE_SANDBOX_SIMULATE_WEBHOOKS === '1';
  let currentPage = null, allowHosted = false, lastCharge = 0;
  // Test a not-yet-live Worker version (0% traffic) via Cloudflare's version override, jonmac.ai only.
  const versionHeader = /^[0-9a-f-]{36}$/.test(settings.CLONE_SANDBOX_VERSION_OVERRIDE || '') ?
    { 'Cloudflare-Workers-Version-Overrides': 'jonmac-agency="' + settings.CLONE_SANDBOX_VERSION_OVERRIDE + '"' } : null;
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
  // Commas embedded checkout requires a billing address (autocomplete).
  async function address(page, selector = settings.CLONE_SANDBOX_ADDRESS_SELECTOR || 'input[placeholder*="address" i]') {
    const input = await field(page, selector, false);
    if (!input) return false;
    await input.click(); await input.pressSequentially('1600 Amphitheatre Parkway', { delay: 40 });
    const pick = await until(async () => {
      for (const frame of page.frames()) {
        const option = frame.locator('[role="option"], .pac-item, li[id*="option" i]').filter({ hasText: /Amphitheatre/i }).first();
        if (await option.count() && await option.isVisible()) return option;
      }
      return false;
    }, 'Address suggestion not shown', 15000).catch(() => null);
    if (pick) await pick.click(); else { await input.press('ArrowDown'); await input.press('Enter'); }
    await sleep(1500); return true;
  }
  // Sandbox Commas sends no real webhook events yet. When enabled, replay the
  // same signed payment/refund event the Worker expects, marked simulated.
  async function simulate(context, hook, type, data) {
    if (!simulateWebhooks) return null;
    assert.ok(hook?.secret_key, 'Sandbox webhook secret unavailable');
    const body = JSON.stringify({ id: 'simulated-' + type + '-' + (data.transaction_history_id || data.payment_id), type, simulated: true, created_at: new Date().toISOString(), data });
    const signature = createHmac('sha256', hook.secret_key).update(body).digest('hex');
    const r = await context.request.post(hook.webhook_url, { headers: { 'content-type': 'application/json', 'x-webhook-signature': signature }, data: body });
    const result = { simulated: true, type, item: data.item?.id || null, ref: data.transaction_history_id || data.payment_id, status: r.status(), body: await r.json().catch(() => null) };
    report.simulatedWebhooks.push(result); return result;
  }
  function paymentEvent(tx, productId, email, extra = {}) {
    const ref = tx.public_transaction_id || String(tx.id);
    return { payment_id: ref, transaction_history_id: ref, status: 'succeeded', created_at: tx.transaction_date || new Date().toISOString(),
      amount: Number(tx.amount), currency: 'USD', quantity: 1, refunds: [], buyer: { email }, item: { id: productId }, ...extra };
  }
  // Real hosted sandbox subscription purchase (card re-entry by design), then
  // verify the subscription and its 30-day renewal. Cancelled in cleanup.
  async function hostedSubscription(context, c, name, email) {
    const product = c.products[name];
    const subsBefore = await list('/checkout-sessions/' + product + '/subscriptions', 'subscriptions');
    const page = await context.newPage(); currentPage = page;
    allowHosted = true;
    try {
      await page.goto(c.hosted[name]);
      const commas = () => page.frames().find(f => /commas\.net/.test(f.url())) || page.mainFrame();
      await until(async () => (await commas().getByLabel(/first name/i).count()) > 0, 'Hosted checkout form not shown', 60000);
      const byLabel = async (label, value) => { const el = commas().getByLabel(label).first(); if (await el.count() && !(await el.inputValue())) await el.fill(value); };
      await byLabel(/first name/i, 'Clone'); await byLabel(/last name/i, 'Sandbox'); await byLabel(/^email/i, email);
      await byLabel(/phone/i, '3055550100');
      // Hosted checkout: street autocomplete fills city, ZIP and state.
      if (await commas().locator('input[name="addressLine1"]').count()) {
        await address(page, 'input[name="addressLine1"]');
        for (const [n, v] of [['city', 'Mountain View'], ['zip', '94043'], ['state', 'CA']]) {
          const el = commas().locator('input[name="' + n + '"]');
          if (await el.count() && await el.isVisible() && !(await el.inputValue())) await el.fill(v);
        }
      } else await address(page);
      await (await field(page, selectors.number)).fill(CARD);
      await (await field(page, selectors.expiry)).fill('12' + String(new Date().getUTCFullYear() + 2).slice(-2));
      await (await field(page, selectors.cvc)).fill('123');
      for (const frame of page.frames()) {
        const terms = frame.getByRole('checkbox', { name: /terms|agree|consent/i });
        for (let i = 0; i < await terms.count(); i++) if (await terms.nth(i).isVisible()) await terms.nth(i).check();
      }
      report.cardEntries++; report.checkoutCount++;
      const pay = commas().getByRole('button', { name: /pay|subscribe|complete|start/i }).last();
      for (let attempt = 0; ; attempt++) {
        await pay.click({ timeout: 5000 }).catch(() => {});
        if (await page.waitForURL(u => u.hostname === base.hostname, { timeout: 5000 }).then(() => true, () => false)) break;
        assert.ok(attempt < 12, 'Hosted subscription checkout never completed');
      }
      const sub = await until(async () => {
        const rows = (await list('/checkout-sessions/' + product + '/subscriptions', 'subscriptions')).filter(x => !subsBefore.some(b => b.id === x.id) && String(x.email).toLowerCase() === email);
        assert.ok(rows.length <= 1, 'Duplicate subscription created'); return rows[0];
      }, 'Hosted checkout did not create a subscription');
      const record = { product, id: sub.id }; createdSubscriptions.push(record); report.subscriptions.push(record);
      const days = (Date.parse(sub.next_renewal_date) - Date.now()) / 86400000;
      assert.ok(days > 29 && days < 31, 'Subscription next billing date must be 30 days out');
      return { id: sub.id, status: sub.subscription_status, nextRenewal: sub.next_renewal_date, landed: new URL(page.url()).pathname };
    } catch (error) {
      if (settings.CLONE_SANDBOX_ARTIFACTS) {
        try {
          mkdirSync(settings.CLONE_SANDBOX_ARTIFACTS, { recursive: true });
          await page.screenshot({ path: settings.CLONE_SANDBOX_ARTIFACTS + '/hosted.png', fullPage: true });
          const fields = await page.mainFrame().evaluate(() => [...document.querySelectorAll('input,select,button,[role=alert],[class*=error i]')].map(e => ({
            tag: e.tagName, label: e.getAttribute('aria-label') || e.name || e.id || '', value: e.tagName === 'INPUT' || e.tagName === 'SELECT' ? (e.type === 'checkbox' ? String(e.checked) : e.value) : '',
            text: (e.innerText || '').slice(0, 120), disabled: !!e.disabled }))).catch(() => []);
          writeFileSync(settings.CLONE_SANDBOX_ARTIFACTS + '/hosted-fields.json', JSON.stringify({ url: page.url().split('?')[0], fields }, null, 1));
        } catch { /* best effort */ }
      }
      throw error;
    } finally { allowHosted = false; await page.close(); }
  }
  async function login(context) {
    const r = await context.request.post(new URL('api/sandbox/access', base).toString(), { headers: { origin: base.origin }, data: { token } });
    assert.equal(r.status(), 200, 'Sandbox access/configuration unavailable');
    const configResponse = await context.request.get(apiUrl('config'));
    assert.equal(configResponse.status(), 200, 'Sandbox configuration unavailable');
    const c = await configResponse.json();
    assert.equal(c.environment, 'sandbox'); assert.equal(c.rebillEnabled, true, 'Sandbox rebill gate must be enabled');
    for (const name of ['seat', ...Object.keys(OFFERS)]) {
      assert.ok(c.products[name] && !['nmGzE', ...Object.values(OFFERS).map(o => o.service)].includes(c.products[name]), 'Sandbox product map required');
      assert.ok(c.hosted[name].startsWith('https://sandbox.commas.net/'), 'Sandbox hosted URL required');
    }
    return c;
  }
  try {
    const runId = Date.now().toString(36);
    // Stress mode: N fresh buyers, each one-clicking every upsell at buyer speed.
    // Even buyers take $97/mo + $497 + $297; odd buyers take the $1 trial + $497 + 3 x $99.
    const stress = Number(settings.CLONE_SANDBOX_STRESS || 0), stressOffset = Number(settings.CLONE_SANDBOX_STRESS_OFFSET || 0);
    const selected = options.cases || (stress ? Array.from({ length: stress }, (_, i) => ({ name: 'stress ' + (stressOffset + i + 1),
      offers: (stressOffset + i) % 2 ? ['trial', 'audit', 'vault_plan'] : ['software', 'audit', 'vault'] })) :
      settings.CLONE_SANDBOX_CASES ? settings.CLONE_SANDBOX_CASES.split(',').map(n => CASES[Number(n)]).filter(Boolean) : CASES);
    for (const [index, testCase] of selected.entries()) {
      stage = 'case ' + (index + 1) + ': ' + testCase.name;
      const context = await browser.newContext({ serviceWorkers: 'block', ignoreHTTPSErrors: ['localhost', '127.0.0.1'].includes(base.hostname) });
      if (versionHeader) {
        for (const method of ['get', 'post']) {
          const original = context.request[method].bind(context.request);
          context.request[method] = (url, opts = {}) => original(url, { ...opts,
            headers: { ...(opts.headers || {}), ...(new URL(url).hostname === base.hostname ? versionHeader : {}) } });
        }
      }
      try {
        const c = await login(context);
        const hooks = await provider('/webhook-subscriptions');
        const hookUrl = new URL('api/sandbox/purchase', base).toString();
        const hook = hooks.find(h => h.webhook_url === hookUrl && h.is_active);
        assert.ok(Array.isArray(hooks) && hooks.some(h => h.webhook_url === hookUrl && h.is_active &&
          h.event_types?.includes('payment.succeeded')), 'Active sandbox purchase webhook required before checkout');
        // Check product terms before the first checkout. Sandbox service_id support
        // is proved by the resulting provider subscription, not assumed on HTTP 200.
        for (const name of ['seat', ...new Set(testCase.offers.filter(n => n !== 'trial'))]) {
          const product = await provider('/checkout-sessions/' + c.products[name]);
          assert.equal(product.amount_cents, name === 'seat' ? 4700 : OFFERS[name].cents, 'Sandbox price mismatch');
          if (OFFERS[name]?.recurring) assert.equal(product.type, 'subscription'); else assert.ok(['onetime', 'onetime_reusable'].includes(product.type), 'Sandbox type mismatch');
          if (OFFERS[name]?.recurring) {
            assert.equal(product.subscription.frequency_days, 30); assert.ok(!product.subscription.free_trial_days);
            if (name === 'vault_plan') assert.equal(product.subscription.auto_expire_after_x_periods, 2);
          }
        }
        const page = await context.newPage(); currentPage = page;
        const consoleLines = []; page.on('console', m => consoleLines.push(m.type() + ': ' + m.text().slice(0, 300)));
        page.on('pageerror', e => consoleLines.push('pageerror: ' + String(e).slice(0, 300)));
        currentPage.consoleLines = consoleLines;
        if (settings.CLONE_SANDBOX_ARTIFACTS) await page.addInitScript(() => {
          window.__checkoutMessages = [];
          addEventListener('message', e => { try { const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (d && d.type && !/stripe/i.test(String(e.origin))) window.__checkoutMessages.push(JSON.stringify(d).replace(/4242[ 0-9]*/g, '[card]').slice(0, 600)); } catch {} });
        });
        let blockedProduction = false, cardFrames = 0;
        page.on('framenavigated', frame => {
          if (/checkout|stripe/.test(frame.url()) || (frame.parentFrame() && frame.url() === 'about:srcdoc')) cardFrames++;
        });
        await context.route('**/*', async route => {
          const u = new URL(route.request().url());
          const live = ['commas.com', 'www.fanbasis.com', 'fanbasis.com', 'embedded.fanbasis.io'].includes(u.hostname);
          if (live) { blockedProduction = true; return route.abort(); }
          // Trial navigation is asserted without submitting another hosted payment.
          if (u.hostname === 'sandbox.commas.net' && route.request().isNavigationRequest() && !allowHosted) {
            return route.fulfill({ contentType: 'text/html', body: '<p>Sandbox hosted fallback verified.</p>' });
          }
          return route.continue(versionHeader && u.hostname === base.hostname ? { headers: { ...route.request().headers(), ...versionHeader } } : undefined);
        });
        if (options.preparePage) await options.preparePage(page, context);
        const upsellResults = [];
        // Read the real response before the page's immediate success redirect
        // disposes it. Forward the unchanged response to the browser.
        await context.route(apiUrl('upsell'), async route => {
          const response = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 120000,
            ...(versionHeader ? { headers: { ...route.request().headers(), ...versionHeader } } : {}) });
          upsellResults.push(await response.json());
          await route.fulfill({ response });
        });
        const nextUpsell = () => until(() => upsellResults.shift(), 'Upsell response timed out', 120000);
        const email = `clone-sandbox-${runId}-${index}@example.test`;
        await page.goto(pageUrl(''));
        assert.equal(await page.evaluate(() => window.CloneMode?.environment), 'sandbox');
        stage = testCase.name + ': open seat modal';
        const sessionResponse = page.waitForResponse(r => r.url() === apiUrl('checkout-session') && r.request().method() === 'POST');
        await page.locator('a[href^="https://sandbox.commas.net/"]').first().click();
        const session = await (await sessionResponse).json();
        assert.equal(session.environment, 'sandbox'); assert.equal(session.productId, c.products.seat);
        // Fill until the values stick (the modal can still be animating focus).
        await until(async () => {
          for (const [sel, v] of [['#lead_name', 'Clone Sandbox'], ['#lead_email', email], ['#lead_phone', '3055550100']]) {
            if (await page.locator(sel).inputValue() !== v) await page.locator(sel).fill(v);
          }
          return await page.locator('#lead_name').inputValue() === 'Clone Sandbox' && await page.locator('#lead_email').inputValue() === email;
        }, 'Lead form did not accept values', 15000);
        await page.locator('#leadf button[type="submit"]').click();
        stage = testCase.name + ': enter sandbox card';
        await page.waitForFunction(() => document.querySelector('#leadpay').classList.contains('ready'), null, { timeout: 60000 });
        await address(page);
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
        // The page ignores clicks until Commas reports a valid form (a few seconds
        // after typing). Retry the click; once submitting, the button disables itself.
        for (let attempt = 0; ; attempt++) {
          await page.locator('#paygo').click({ timeout: 5000 }).catch(() => {});
          const submitted = await page.waitForURL(pageUrl('software.html'), { timeout: 4000 }).then(() => true, () => false);
          if (submitted) break;
          if (await page.locator('#paygo').isDisabled().catch(() => false)) { await page.waitForURL(pageUrl('software.html'), { timeout: 90000 }); break; }
          assert.ok(attempt < 10, 'Seat checkout never became submittable');
        }
        const transactionId = await page.evaluate(() => sessionStorage.getItem('jm_sandbox_clone_transaction'));
        assert.ok(transactionId, 'SDK purchase reference missing');
        const transaction = await provider('/transactions/' + transactionId);
        assert.equal((transaction.product || transaction.service).id, c.products.seat); assert.equal(Number(transaction.amount), 47);
        assert.equal(transaction.fan.email.toLowerCase(), email); assert.deepEqual(transaction.refunds, []);
        const customers = (await list('/customers?search=' + encodeURIComponent(email), 'customers')).filter(x => x.email.toLowerCase() === email);
        assert.equal(customers.length, 1); const customer = customerId(customers[0].id); assert.ok(customer, 'Unexpected customer ID format');
        const savedCards = await provider('/customers/' + customer + '/payment-methods');
        assert.ok(savedCards.payment_methods.some(x => x.type === 'card'), 'Checkout did not save sandbox card');
        const seatRows = (await list('/checkout-sessions/' + c.products.seat + '/transactions', 'transactions')).filter(x => x.fan?.email?.toLowerCase() === email);
        assert.equal(seatRows.length, 1, 'Initial checkout must create exactly one transaction');
        report.checkoutCount++;
        stage = testCase.name + ': seat webhook';
        const seatEvent = paymentEvent(transaction, c.products.seat, email, { api_metadata: { data: { clone_checkout_ref: session.checkoutRef } } });
        for (let i = 0; i < 2; i++) { const s = await simulate(context, hook, 'payment.succeeded', seatEvent); if (s) assert.equal(s.status, 200, 'Simulated seat webhook rejected'); }
        stage = testCase.name + ': buyer proof';
        await until(async () => {
          const r = await context.request.post(apiUrl('buyer-session'), { headers: { origin: base.origin }, data: { transactionId } });
          const b = await r.json(); if (b.pending) return false; assert.equal(b.ok, true, 'Sandbox webhook identity verification failed'); return true;
        }, 'Sandbox buyer proof timed out');
        const result = { name: testCase.name, email, seatTransaction: transaction.public_transaction_id || transaction.id || transactionId, customer, offers: [] };
        if (stress) {
          // Record every click (first try and final) instead of stopping at the first refusal.
          const records = () => list('/subscribers?customer_id=' + customer, 'subscribers');
          const recordsBefore = await records();
          for (const name of testCase.offers) {
            stage = testCase.name + ': stress ' + name;
            await page.goto(pageUrl(pages[name]));
            await page.locator('[data-upsell="' + name + '"][role="button"]').first().waitFor({ state: 'attached' });
            if (name === 'vault_plan') await page.locator('[data-exit]').click();
            const clicked = Date.now();
            await page.locator('[data-upsell="' + name + '"]').first().click();
            const outcome = await nextUpsell();
            result.offers.push({ offer: name, clickedAt: new Date(clicked).toISOString(), ms: Date.now() - clicked,
              ok: outcome.ok === true, firstTry: outcome.ok === true && outcome.attempts === 1, attempts: outcome.attempts ?? null,
              reason: outcome.reason || null, refusals: outcome.refusals || [], provider: outcome.provider || null });
            if (outcome.ok) await page.waitForURL(new URL(outcome.next, base).toString()).catch(() => {});
          }
          await sleep(3000);
          const added = (await records()).filter(x => !recordsBefore.some(b => b.id === x.id));
          for (const entry of result.offers) {
            const title = OFFERS[entry.offer].chargeDescription || OFFERS[entry.offer].description;
            entry.providerCharges = added.filter(x => x.product?.title === title).length;
            entry.exactlyOnce = entry.providerCharges === (entry.ok ? 1 : 0);
          }
          report.cases.push(result); options.log?.('STRESS ' + testCase.name + ': ' + result.offers.map(o => o.offer + '=' + (o.firstTry ? 'first-try' : o.ok ? 'retry-ok' : 'REFUSED')).join(' '));
          continue;
        }
        for (const name of testCase.offers) {
          stage = testCase.name + ': verify ' + name;
          await page.goto(pageUrl(pages[name]));
          const product = c.products[name];
          const transactions = (id = product) => list('/checkout-sessions/' + id + '/transactions', 'transactions');
          const forBuyer = rows => rows.filter(x => x.fan?.email?.toLowerCase() === email);
          const records = () => list('/subscribers?customer_id=' + customer, 'subscribers');
          const before = forBuyer(await transactions());
          const recordsBefore = await records();
          const framesBefore = cardFrames;
          const button = page.locator('[data-upsell="' + name + '"]').first();
          if (name === 'vault_plan') { await page.locator('[data-exit]').click(); }
          // Sandbox refuses a burst of saved-card charges (about 3 per 2 minutes
          // account-wide, generic 400). Space one-click charges when configured.
          if (!OFFERS[name].recurring && name !== 'trial' && lastCharge) await sleep(Math.max(0, lastCharge + Number(settings.CLONE_SANDBOX_CHARGE_GAP_MS || 0) - Date.now()));
          await button.click(); const outcome = await nextUpsell();
          if (outcome.ok) lastCharge = Date.now();
          stage = testCase.name + ': reconcile ' + name;
          const replay = () => context.request.post(apiUrl('upsell'), { headers: { origin: base.origin }, data: { offer: name } });
          if (name === 'trial' || (OFFERS[name].recurring && !c.subscriptionsEnabled)) {
            // Commas' saved-card charge cannot create a subscription (docs: no product
            // or plan field), so recurring offers and the trial always use hosted checkout.
            assert.equal(outcome.fallback, true); assert.equal(outcome.reason, name === 'trial' ? 'trial_hosted' : 'rebill_unavailable');
            assert.equal(outcome.checkoutUrl, c.hosted[name]);
            const hosted = new URL(c.hosted[name]);
            await page.waitForURL(url => url.origin === hosted.origin && url.pathname === hosted.pathname);
            for (const r of await Promise.all([replay(), replay()])) assert.equal((await r.json()).checkoutUrl, c.hosted[name]);
            assert.equal(forBuyer(await transactions()).length, before.length, 'Hosted fallback must not charge');
            assert.equal((await records()).length, recordsBefore.length, 'Hosted fallback must not charge a saved card');
            const entry = { offer: name, fallback: outcome.reason, hosted: c.hosted[name], charged: false };
            if (name === 'software' && settings.CLONE_SANDBOX_HOSTED_SUBSCRIPTION === '1' && !report.hostedSubscription) {
              stage = testCase.name + ': hosted subscription ' + name;
              entry.subscription = await hostedSubscription(context, c, name, email); report.hostedSubscription = entry.subscription;
            }
            result.offers.push(entry); continue;
          }
          assert.equal(outcome.ok, true, 'One-click sandbox charge failed; do not retry via hosted checkout');
          await page.waitForURL(new URL(outcome.next, base).toString());
          assert.equal(cardFrames, framesBefore, 'One-click upsell opened a card form');
          assert.equal(await page.locator('iframe[src*="checkout"], iframe[src*="stripe"], input[autocomplete^="cc-"]').count(), 0, 'Upsell requested card re-entry');
          // Commas files saved-card charges under an ad-hoc one-time product named
          // after the charge description, not under the configured product.
          const isNew = x => !recordsBefore.some(b => b.id === x.id);
          const charged = await until(async () => {
            const rows = (await records()).filter(x => isNew(x) && x.product?.title === OFFERS[name].description); return rows.length ? rows : false;
          }, 'Upsell charge absent from sandbox records');
          assert.equal(charged.length, 1, 'More than one upsell charge');
          const adhoc = charged[0].product.id;
          const adhocRows = forBuyer(await transactions(adhoc)); assert.equal(adhocRows.length, 1, 'Upsell ledger row missing');
          assert.equal(Number(adhocRows[0].amount) * 100, OFFERS[name].cents);
          assert.equal(forBuyer(await transactions()).length, before.length, 'Charge unexpectedly filed under the configured product');
          for (let i = 0; i < 2; i++) { const s = await simulate(context, hook, 'payment.succeeded', paymentEvent(adhocRows[0], adhoc, email)); if (s) assert.equal(s.status, 200, 'Simulated upsell webhook rejected'); }
          // Concurrent API repeats, refresh + UI repeat, and alternative plan all
          // reuse the permanent claim. Compare the provider records after settling.
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
          }
          await sleep(options.settleMs ?? 3000);
          assert.equal((await records()).filter(isNew).length, 1, 'Repeat requests duplicated a provider charge');
          result.offers.push({ offer: name, adhocProduct: adhoc, transaction: adhocRows[0].public_transaction_id || adhocRows[0].id, idempotent: true, cardReentry: false });
        }
        assert.equal(blockedProduction, false, 'Funnel attempted a production payment host');
        report.cases.push(result); options.log?.('PASS sandbox case ' + (index + 1) + ': ' + testCase.name);
      } catch (error) {
        if (settings.CLONE_SANDBOX_ARTIFACTS && currentPage) {
          try {
            mkdirSync(settings.CLONE_SANDBOX_ARTIFACTS, { recursive: true });
            await currentPage.screenshot({ path: settings.CLONE_SANDBOX_ARTIFACTS + '/failure.png', fullPage: false });
            writeFileSync(settings.CLONE_SANDBOX_ARTIFACTS + '/console.txt', (currentPage.consoleLines || []).join(String.fromCharCode(10)));
            writeFileSync(settings.CLONE_SANDBOX_ARTIFACTS + '/messages.txt', (await currentPage.evaluate(() => window.__checkoutMessages || []).catch(() => [])).join(String.fromCharCode(10)));
            for (const [i, frame] of currentPage.frames().entries()) {
              const text = await frame.locator('body').innerText({ timeout: 2000 }).catch(() => '');
              writeFileSync(settings.CLONE_SANDBOX_ARTIFACTS + '/frame-' + i + '.txt', frame.url().split('?')[0] + String.fromCharCode(10) + text.slice(0, 4000));
              if (/commas\.net/.test(frame.url())) {
                const fields = await frame.evaluate(() => [...document.querySelectorAll('input,select,[role=alert],[class*=error i]')].map(e => ({
                  tag: e.tagName, name: e.name || e.id || '', placeholder: e.placeholder || '', value: e.tagName === 'INPUT' || e.tagName === 'SELECT' ? (e.type === 'checkbox' ? String(e.checked) : e.value) : '',
                  invalid: e.getAttribute('aria-invalid'), text: e.tagName === 'INPUT' || e.tagName === 'SELECT' ? '' : (e.innerText || '').slice(0, 200) }))).catch(() => []);
                writeFileSync(settings.CLONE_SANDBOX_ARTIFACTS + '/fields-' + i + '.json', JSON.stringify(fields, null, 1));
              }
            }
          } catch { /* artifacts are best effort */ }
        }
        throw error;
      } finally { await context.close(); }
    }
    assert.equal(report.cardEntries, report.checkoutCount, 'Card must be entered once per initial checkout only');
    return report;
  } catch (error) {
    if (settings.CLONE_SANDBOX_ARTIFACTS) {
      // Local debugging only: never contains the access token (login is an API request).
      try {
        mkdirSync(settings.CLONE_SANDBOX_ARTIFACTS, { recursive: true });
        writeFileSync(settings.CLONE_SANDBOX_ARTIFACTS + '/failure.txt', stage + String.fromCharCode(10) + String(error?.stack || error).replaceAll(apiKey, '[key]').replaceAll(token, '[token]'));
        if (currentPage) await currentPage.screenshot({ path: settings.CLONE_SANDBOX_ARTIFACTS + '/failure.png', fullPage: false });
      } catch { /* artifacts are best effort */ }
    }
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
