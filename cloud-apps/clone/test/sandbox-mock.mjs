// Real Worker + HTMLRewriter + D1 + browser; provider and embedded SDK are mocked.
// This script cannot access the network through the Worker or provider adapter.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { Miniflare, Response as MFResponse } from 'miniflare';
import { runSandbox, CASES } from './sandbox-e2e.mjs';
import { sandboxIds, sandboxSettings, mockProduct } from './sandbox-fixture.mjs';

const settings = sandboxSettings();
const buyers = [], transactions = [], subscriptions = [], charges = [];
let counter = 10000, omitSubscription = false, webhookUrl;
const reply = data => new MFResponse(JSON.stringify({ status: 'success', data }), { headers: { 'content-type': 'application/json' } });
const nameForId = id => Object.keys(sandboxIds).find(name => sandboxIds[name] === id);
async function provider(request) {
  const url = new URL(request.url), path = url.pathname.replace('/public-api', '');
  assert.equal(url.origin, 'https://api-sandbox.commas.net', 'Mock attempted a non-sandbox host');
  assert.equal(request.headers.get('x-api-key'), settings.COMMAS_SANDBOX_API_KEY, 'Mock attempted a non-sandbox key');
  if (path === '/webhook-subscriptions') return reply([{ webhook_url: webhookUrl, is_active: true, event_types: ['payment.succeeded'] }]);
  if (path === '/checkout-sessions/embedded') {
    const body = await request.json(); assert.equal(body.product_id, sandboxIds.seat); return reply({ checkout_session_secret: 'mock-sdk-session' });
  }
  if (path.startsWith('/transactions/')) return reply(transactions.find(t => String(t.id) === path.split('/').pop()) || null);
  if (path === '/customers') return reply({ customers: buyers.filter(b => b.email.includes(url.searchParams.get('search') || '')) });
  if (/\/payment-methods$/.test(path)) return reply({ customer: { id: Number(path.split('/')[2]) }, payment_methods: [{ id: 'mock-saved-card', type: 'card', is_default: true }] });
  if (/\/charge$/.test(path)) {
    const customer = buyers.find(b => b.id === Number(path.split('/')[2])), body = await request.json();
    const name = Object.keys(sandboxIds).find(n => mockProduct(n).product.id === body.service_id);
    assert.ok(customer && name); assert.equal(body.payment_method_id, 'mock-saved-card'); assert.equal(body.amount_cents, mockProduct(name).amount_cents);
    const idem = request.headers.get('Idempotency-Key'); assert.ok(!charges.some(c => c.idem === idem), 'Duplicate provider charge');
    const tx = { id: ++counter, product: { id: sandboxIds[name] }, fan: { email: customer.email }, amount: body.amount_cents / 100, refunds: [], transaction_date: new Date().toISOString() };
    transactions.push(tx); charges.push({ idem, customer: customer.id, name });
    if (mockProduct(name).type === 'subscription' && !omitSubscription) subscriptions.push({ id: ++counter, customer: { id: 'hashid', email: customer.email }, product: { id: sandboxIds[name] }, customerNumber: customer.id,
      subscription: { id: counter, status: 'active', payment_frequency: 'monthly', created_at: new Date().toISOString() },
      next_renewal_date: new Date(Date.now() + 30 * 86400000).toISOString() });
    return reply({ status: 'succeeded', charge_id: String(tx.id), amount: tx.amount });
  }
  if (path === '/subscribers') return reply({ subscribers: subscriptions.filter(s => s.customerNumber === Number(url.searchParams.get('customer_id')) && s.product.id === url.searchParams.get('product_id')), pagination: { has_more: false } });
  if (path.startsWith('/checkout-sessions/')) {
    const [, , id, suffix, subId] = path.split('/');
    const name = nameForId(id); assert.ok(name, 'Unknown mock product');
    if (suffix === 'transactions') return reply({ transactions: transactions.filter(t => t.product.id === id), pagination: { has_more: false } });
    if (suffix === 'subscriptions') {
      if (request.method === 'DELETE') {
        const subscription = subscriptions.find(s => String(s.id) === subId && s.product.id === id); assert.ok(subscription); subscription.subscription.status = 'cancelled';
        return reply({ id: subscription.id, subscription_status: 'cancelled' });
      }
      return reply({ subscriptions: subscriptions.filter(s => s.product.id === id).map(s => ({ id: s.id, email: s.customer.email, next_renewal_date: s.next_renewal_date, subscription_status: s.subscription.status })), pagination: { has_more: false } });
    }
    return reply(mockProduct(name));
  }
  throw new Error('Unexpected mock provider request');
}

const publicRoot = new URL('../public/', import.meta.url);
const mf = new Miniflare({
  modules: true, scriptPath: fileURLToPath(new URL('../src/index.js', import.meta.url)), compatibilityDate: '2026-07-01',
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  host: '127.0.0.1', port: 0, https: true, bindings: settings, d1Databases: ['CLONE_UPSELLS'], kvNamespaces: ['CLONE_LEADS'],
  outboundService: provider,
  serviceBindings: { ASSETS: async request => {
    const path = new URL(request.url).pathname;
    if (path.includes('..')) return new MFResponse('missing', { status: 404 });
    try {
      const body = readFileSync(new URL('.' + path, publicRoot));
      const type = path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      return new MFResponse(body, { headers: { 'content-type': type } });
    } catch { return new MFResponse('missing', { status: 404 }); }
  } },
});

const mockSDK = `window.PaymentCheckout={create:function(opts){
  if(opts.environment!=='sandbox'||opts.productId!=='SBseat')throw Error('Wrong SDK environment/product');
  window.mockSdkConfig=opts; var handlers={},frame,email='';
  return {on:function(n,f){handlers[n]=f;},attachToElement:function(el){frame=document.createElement('iframe');frame.srcdoc='<input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc"><input autocomplete="postal-code">';el.appendChild(frame);},
    init:async function(){handlers['form:ready']();},isFormReady:function(){return true;},setFirstName:async function(){},setLastName:async function(){},setEmail:async function(e){email=e;},setPhone:async function(){},
    submitForm:async function(){var d=frame.contentDocument;if(d.querySelector('[autocomplete="cc-number"]').value.length!==16)throw Error('Test card not entered');handlers['form:submitting']();var tx=await window.mockPurchase(email,opts.metadata.clone_checkout_ref);handlers['checkout:success']({transactionId:tx});}
  };
}};`;

try {
  const base = await mf.ready;
  webhookUrl = new URL('/clone/api/sandbox/purchase', base).toString();
  const db = await mf.getD1Database('CLONE_UPSELLS');
  for (const migration of ['0001_upsells.sql', '0002_sandbox.sql', '0006_sandbox_observability.sql']) {
    const sql = readFileSync(new URL('../migrations/' + migration, import.meta.url), 'utf8');
    for (const statement of sql.split(';').filter(s => s.trim())) await db.prepare(statement).run();
  }
  // Verify real HTML rewriting, access denial and production default in workerd.
  const unauthenticated = await mf.dispatchFetch(new URL('/clone/?sandbox=1', base)); assert.equal(unauthenticated.status, 403);
  const plain = await (await mf.dispatchFetch(new URL('/clone/', base))).text(); assert.ok(!plain.includes('window.CloneMode='));
  const runnerSettings = { ...settings, CLONE_SANDBOX_URL: new URL('/clone/', base).toString() };
  const options = { settings: runnerSettings, settleMs: 0,
    providerFetch: (url, init) => provider(new Request(url, init)), log: console.log,
    preparePage: async (page, context) => {
      // All browser external resources are intercepted, including video/fonts.
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === base.origin || url.hostname === 'sandbox.commas.net') return route.fallback();
        return route.fulfill({ contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html', body: url.href === 'https://cdn.embedded.fanbasis.io/embed/index.js' ? mockSDK : '' });
      });
      await page.exposeFunction('mockPurchase', async (email, ref) => {
        assert.match(email, /^clone-sandbox-/); assert.match(ref, /^[A-Za-z0-9_-]{43}$/);
        const buyer = { id: ++counter, email }; buyers.push(buyer);
        const tx = { id: ++counter, product: { id: sandboxIds.seat }, amount: 47, fan: { email }, refunds: [], transaction_date: new Date().toISOString() }; transactions.push(tx);
        const body = JSON.stringify({ type: 'payment.succeeded', created_at: tx.transaction_date, data: { item: tx.product, amount: 47, quantity: 1, buyer: { email }, transaction_history_id: String(tx.id), api_metadata: { data: { clone_checkout_ref: ref } } } });
        const r = await mf.dispatchFetch(new URL('/clone/api/sandbox/purchase', base), { method: 'POST', headers: { 'x-webhook-signature': createHmac('sha256', settings.COMMAS_SANDBOX_WEBHOOK_SECRET).update(body).digest('hex') }, body });
        assert.equal(r.status, 200); return String(tx.id);
      });
    },
  };
  const report = await runSandbox(options);
  assert.equal(report.checkoutCount, 7); assert.equal(report.cardEntries, 7); assert.equal(charges.length, 8);
  assert.equal(report.subscriptions.length, 3); assert.ok(subscriptions.every(s => s.subscription.status === 'cancelled'));
  const liveClaims = await db.prepare('SELECT COUNT(*) AS n FROM clone_upsell_claims').first(); assert.equal(liveClaims.n, 0);
  console.log('PASS: seven mock checkouts, eight one-click charges, three verified/cancelled subscriptions, no production claims');
  // Prove the runner rejects the undocumented capability if charge succeeds but
  // Commas does not actually create the subscription.
  omitSubscription = true;
  await assert.rejects(runSandbox({ ...options, cases: [CASES[1]], verifyTimeout: 1000 }), /subscription creation software/);
  console.log('PASS: runner rejects a successful charge without subscription creation');
} finally { await mf.dispose(); }
