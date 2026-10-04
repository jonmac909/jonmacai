import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { buyerSession, checkoutContext, hash, OFFERS, sign, upsell } from '../src/upsells.js';

const origin = 'https://jonmac.ai';
const now = () => Math.floor(Date.now() / 1000);
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_upsells.sql', import.meta.url), 'utf8'));
  return {
    prepare(query) {
      const stmt = sql.prepare(query);
      return { bind(...args) { return {
        async run() { return { meta: { changes: Number(stmt.run(...args).changes) } }; },
        async first() { return stmt.get(...args) || null; },
      }; } };
    },
  };
}
function env() { return { CLONE_UPSELLS: database(), CLONE_TOKEN_SECRET: 'mock-only-signing-key',
  COMMAS_API_KEY: 'mock-only-api-key', COMMAS_WEBHOOK_SECRET: 'mock-only-webhook-key',
  CLONE_REBILL_ENABLED: 'true', CLONE_SUBSCRIPTIONS_ENABLED: 'true',
  CLONE_REBILL_ENABLED_AT: new Date(Date.now() - 60000).toISOString(),
  CLONE_LEADS: { async get() { return null; } } }; }
function request(path, body = {}, cookie = '', requestOrigin = origin) {
  return new Request(origin + '/clone/api/' + path, { method: 'POST',
    headers: { origin: requestOrigin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function buyerCookie(e, extras = {}) {
  const token = await sign({ kind: 'buyer', buyer: 12345, purchased: Date.now(), iat: now(), exp: now() + 1800, ...extras }, e.CLONE_TOKEN_SECRET);
  return '__Secure-clone-buyer=' + token;
}
function response(data, status = 200, apiStatus = 'success') {
  return new Response(JSON.stringify({ status: apiStatus, data }), { status });
}
function mockCommas(overrides = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    assert.ok(String(url).startsWith('https://www.fanbasis.com/public-api/'), 'Only mocked Commas requests allowed');
    calls.push({ url: String(url), ...init });
    if (String(url).endsWith('/charge')) {
      if (overrides.charge) return overrides.charge(url, init);
      const b = JSON.parse(init.body);
      return response({ status: 'succeeded', charge_id: 'mock-charge', amount: b.amount_cents / 100 });
    }
    if (String(url).endsWith('/payment-methods')) return overrides.methods || response({ customer: { id: 12345 }, payment_methods: [{ id: 'mock-card', type: 'card', is_default: true }] });
    if (String(url).includes('/checkout-sessions/')) {
      const service = String(url).split('/').pop();
      const o = Object.values(OFFERS).find(o => o.service === service);
      if (o) return overrides.product || response({ product: { id: { wg0E8: 1287855, XXYMA: 1382675, O9gZr: 1287825, jJYvv: 1287845 }[service] },
        amount_cents: o.cents, type: o.recurring ? 'subscription' : 'onetime', subscription: { frequency_days: 30, free_trial_days: null, auto_expire_after_x_periods: service === 'jJYvv' ? 2 : null } });
    }
    if (overrides.other) return overrides.other(url, init);
    throw new Error('Unexpected mocked request');
  };
  return calls;
}

test('Clone one-click payments: verified identity, durable claims and safe fallbacks', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  await t.test('all paid offers charge the exact service/amount and advance', async () => {
    for (const name of ['software', 'audit', 'vault', 'vault_plan']) {
      const e = env(), cookie = await buyerCookie(e), calls = mockCommas();
      const r = await upsell(request('upsell', { offer: name, amount_cents: 1, customerId: 99999 }, cookie), e);
      assert.deepEqual(await r.json(), { ok: true, next: OFFERS[name].next });
      const charge = calls.find(c => c.url.endsWith('/charge'));
      const b = JSON.parse(charge.body);
      assert.equal(b.amount_cents, OFFERS[name].cents);
      assert.ok(Number.isSafeInteger(b.service_id));
      assert.equal(b.payment_method_id, 'mock-card');
      assert.ok(charge.url.endsWith('/customers/12345/charge'));
      assert.match(charge.headers['Idempotency-Key'], /^clone-[a-f0-9]{64}$/);
      assert.equal((await (await upsell(request('upsell', { offer: name }, cookie), e)).json()).ok, true);
      assert.equal(calls.filter(c => c.url.endsWith('/charge')).length, 1);
    }
  });
  await t.test('atomic SQLite claim blocks concurrent clicks and alternate vault plan', async () => {
    const e = env(), cookie = await buyerCookie(e); let release;
    const calls = mockCommas({ charge: () => new Promise(resolve => { release = () => resolve(response({ status: 'succeeded', charge_id: 'mock', amount: 297 })); }) });
    const first = upsell(request('upsell', { offer: 'vault' }, cookie), e);
    while (!release) await new Promise(resolve => setImmediate(resolve));
    const duplicate = await upsell(request('upsell', { offer: 'vault_plan' }, cookie), e);
    assert.equal(duplicate.status, 202);
    release(); assert.equal((await (await first).json()).ok, true);
    assert.equal((await (await upsell(request('upsell', { offer: 'vault_plan' }, cookie), e)).json()).ok, true);
    assert.equal(calls.filter(c => c.url.endsWith('/charge')).length, 1);
  });
  await t.test('missing, tampered, expired and cross-origin identity cannot charge', async () => {
    const e = env(), calls = mockCommas();
    for (const c of ['', (await buyerCookie(e)) + 'x', await buyerCookie(e, { iat: now() - 1900, exp: now() - 100 })]) {
      assert.equal((await (await upsell(request('upsell', { offer: 'audit', customerId: 12345 }, c), e)).json()).fallback, true);
    }
    assert.equal((await upsell(request('upsell', { offer: 'audit' }, await buyerCookie(e), 'https://evil.example'), e)).status, 403);
    assert.equal((await upsell(request('upsell', { offer: 'constructor' }, await buyerCookie(e)), e)).status, 400);
    assert.equal(calls.length, 0);
  });
  await t.test('activation flag, older buyer, unconfirmed subscriptions, and trial use hosted checkout', async () => {
    for (const setup of [e => { e.CLONE_REBILL_ENABLED = 'false'; }, e => { e.CLONE_REBILL_ENABLED_AT = ''; }, e => { e.CLONE_REBILL_ENABLED_AT = new Date(Date.now() + 10000).toISOString(); }, e => { e.CLONE_SUBSCRIPTIONS_ENABLED = 'false'; }]) {
      const e = env(); setup(e); const calls = mockCommas();
      const r = await upsell(request('upsell', { offer: 'software' }, await buyerCookie(e)), e);
      assert.equal((await r.json()).checkoutUrl, OFFERS.software.hosted); assert.equal(calls.length, 0);
    }
    const e = env(), calls = mockCommas();
    assert.equal((await (await upsell(request('upsell', { offer: 'trial' }, await buyerCookie(e)), e)).json()).checkoutUrl, OFFERS.trial.hosted);
    assert.equal(calls.length, 0);
  });
  await t.test('production activation charges only one-time offers after the confirmed purchase cutoff', async () => {
    const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const vars = JSON.parse(config.match(/"vars":\s*(\{[\s\S]*?\})/)[1].replace(/^\s*\/\/.*$/gm, ''));
    const cutoff = Date.parse(vars.CLONE_REBILL_ENABLED_AT);
    assert.equal(vars.CLONE_REBILL_ENABLED, 'true');
    assert.ok(Number.isFinite(cutoff));
    for (const purchased of [Date.parse('2026-10-03T23:59:59Z'), cutoff - 1, cutoff, null, cutoff + 1]) {
      for (const offer of ['audit', 'vault']) {
        const e = { ...env(), ...vars }, calls = mockCommas();
        const r = await (await upsell(request('upsell', { offer }, await buyerCookie(e, { purchased })), e)).json();
        if (purchased === cutoff + 1) {
          assert.equal(r.ok, true);
          assert.equal(calls.filter(c => c.url.endsWith('/charge')).length, 1);
        } else {
          assert.equal(r.reason, 'rebill_unavailable');
          assert.equal(r.checkoutUrl, OFFERS[offer].hosted);
          assert.equal(calls.length, 0);
        }
      }
    }
    for (const offer of ['software', 'vault_plan', 'trial']) {
      const e = { ...env(), ...vars }, calls = mockCommas();
      const r = await (await upsell(request('upsell', { offer }, await buyerCookie(e, { purchased: cutoff + 1 })), e)).json();
      assert.equal(r.fallback, true);
      assert.equal(calls.length, 0);
    }
  });
  await t.test('no saved card and changed product terms cannot charge', async () => {
    for (const overrides of [{ methods: response({ customer: { id: 12345 }, payment_methods: [] }) }, { product: response({ product: { id: 1382675 }, amount_cents: 99900, type: 'onetime' }) }, { methods: response({ customer: { id: 99999 }, payment_methods: [{ id: 'other-card', type: 'card' }] }) }]) {
      const e = env(), calls = mockCommas(overrides);
      assert.equal((await (await upsell(request('upsell', { offer: 'audit' }, await buyerCookie(e)), e)).json()).fallback, true);
      assert.equal(calls.filter(c => c.url.endsWith('/charge')).length, 0);
    }
  });
  await t.test('explicit rebill rejection falls back and is never charged again', async () => {
    const e = env(), cookie = await buyerCookie(e), calls = mockCommas({ charge: () => new Response(JSON.stringify({ status: 'error', message: 'No authorized subscription found for customer' }), { status: 404 }) });
    assert.equal((await (await upsell(request('upsell', { offer: 'audit' }, cookie), e)).json()).reason, 'rebill_unavailable');
    assert.equal((await (await upsell(request('upsell', { offer: 'audit' }, cookie), e)).json()).fallback, true);
    assert.equal(calls.filter(c => c.url.endsWith('/charge')).length, 1);
  });
  await t.test('disabled rebill errors auto-fallback while card declines still show a retry checkout button', async () => {
    for (const [message, code, reason] of [
      ['Manual rebilling is not enabled for organization', undefined, 'rebill_unavailable'],
      ['Manual rebill has not been enabled', undefined, 'rebill_unavailable'],
      ['This organization cannot use this feature', 'REBILL_NOT_ENABLED', 'rebill_unavailable'],
      ['Card declined by issuer', undefined, 'payment_rejected'],
    ]) {
      const e = env(), cookie = await buyerCookie(e);
      const calls = mockCommas({ charge: () => new Response(JSON.stringify({ status: 'error', message, code }), { status: 403 }) });
      const r = await (await upsell(request('upsell', { offer: 'audit' }, cookie), e)).json();
      assert.equal(r.reason, reason); assert.equal(r.checkoutUrl, OFFERS.audit.hosted);
      assert.equal((await (await upsell(request('upsell', { offer: 'audit' }, cookie), e)).json()).reason, 'previous_fallback');
      assert.equal(calls.filter(c => c.url.endsWith('/charge')).length, 1);
    }
  });
  await t.test('timeouts, 409, malformed successes and 5xx remain locked without a second checkout', async () => {
    for (const charge of [() => { throw new Error('network timeout'); }, () => response([], 409, 'error'), () => response([], 500, 'error'), () => response({ status: 'processing' }), () => response({ status: 'succeeded', charge_id: 'mock', amount: 1 })]) {
      const e = env(), cookie = await buyerCookie(e), calls = mockCommas({ charge });
      for (let i = 0; i < 2; i++) {
        const result = await (await upsell(request('upsell', { offer: 'audit' }, cookie), e)).json();
        assert.equal(result.pending, true); assert.equal(result.checkoutUrl, undefined);
      }
      assert.equal(calls.filter(c => c.url.endsWith('/charge')).length, 1);
    }
  });
  await t.test('a persistence failure after billing leaves the claim locked', async () => {
    const e = env(), cookie = await buyerCookie(e), real = e.CLONE_UPSELLS.prepare.bind(e.CLONE_UPSELLS);
    e.CLONE_UPSELLS.prepare = query => query.startsWith('UPDATE') ? { bind() { return { run() { throw new Error('DB unavailable'); } }; } } : real(query);
    const calls = mockCommas();
    for (let i = 0; i < 2; i++) assert.equal((await (await upsell(request('upsell', { offer: 'audit' }, cookie), e)).json()).pending, true);
    assert.equal(calls.filter(c => c.url.endsWith('/charge')).length, 1);
  });
  await t.test('expired signed identity may read a prior unresolved claim but never authorize new billing', async () => {
    const e = env(), calls = mockCommas({ charge: () => { throw new Error('timeout'); } });
    await upsell(request('upsell', { offer: 'audit' }, await buyerCookie(e)), e);
    const expired = await buyerCookie(e, { iat: now() - 1900, exp: now() - 100 });
    const r = await (await upsell(request('upsell', { offer: 'audit' }, expired), e)).json();
    assert.equal(r.pending, true); assert.equal(r.checkoutUrl, undefined);
    assert.equal((await (await upsell(request('upsell', { offer: 'vault' }, expired), e)).json()).fallback, true);
    assert.equal(calls.filter(c => c.url.endsWith('/charge')).length, 1);
  });

  async function proof(e, change = {}) {
    const intent = await checkoutContext(request('checkout-session'), e);
    const payload = { type: 'payment.succeeded', created_at: new Date().toISOString(), data: {
      item: { id: 'nmGzE' }, amount: 47, quantity: 1, buyer: { email: 'mock@example.test' },
      transaction_history_id: 'ORD-MOCK-PAID', api_metadata: { data: { clone_checkout_ref: intent.ref } }, ...change,
    } };
    const raw = JSON.stringify(payload);
    const signature = createHmac('sha256', e.COMMAS_WEBHOOK_SECRET).update(raw).digest('hex');
    assert.equal((await worker.fetch(new Request(origin + '/clone/api/purchase', { method: 'POST', headers: { 'x-webhook-signature': signature }, body: raw }), e)).status, 200);
    return intent.cookie.split(';')[0];
  }
  function identityMock(change = {}, customers = [{ id: 12345, email: 'mock@example.test' }]) {
    return mockCommas({ other: (url) => {
      if (String(url).includes('/transactions/')) return response({ id: 919049, product: { id: 'nmGzE' }, amount: 47,
        refunds: [], transaction_date: new Date().toISOString(), fan: { email: 'mock@example.test', id: 'different-public-id' }, ...change });
      if (String(url).includes('/customers?')) return response({ customers });
      if (String(url).includes('/transactions?')) return response({ transactions: [] });
      throw new Error('Unexpected identity lookup');
    } });
  }
  await t.test('signed webhook plus verified $47 transaction resolves numeric customer, with secure cookie', async () => {
    const e = env(), cookie = await proof(e), calls = identityMock();
    const r = await buyerSession(request('buyer-session', { transactionId: 'tx-mock', customerId: 99999 }, cookie), e);
    assert.equal((await r.json()).ok, true);
    const buyer = r.headers.get('set-cookie');
    assert.match(buyer, /HttpOnly; Secure; SameSite=Lax/); assert.match(buyer, /Max-Age=1800/);
    assert.equal((await (await upsell(request('upsell', { offer: 'audit' }, buyer.split(';')[0]), e)).json()).ok, true);
    assert.ok(calls.find(c => c.url.endsWith('/customers/12345/charge')));
  });
  await t.test('webhook order reference reconciles through the product ledger when direct lookup does not resolve', async () => {
    const e = env(), cookie = await proof(e);
    mockCommas({ other: url => {
      if (String(url).includes('/transactions/')) return response([], 404, 'error');
      if (String(url).includes('/transactions?')) return response({ transactions: [{ product: { id: 'nmGzE' }, amount: 47, refunds: [], transaction_date: new Date().toISOString(), fan: { email: 'mock@example.test' } }] });
      if (String(url).includes('/customers?')) return response({ customers: [{ id: 12345, email: 'mock@example.test' }] });
      throw new Error('Unexpected ledger request');
    } });
    assert.equal((await (await buyerSession(request('buyer-session', {}, cookie), e)).json()).ok, true);
  });
  await t.test('new checkout provides a unique browser binding and clears any previous billing identity', async () => {
    const e = env();
    mockCommas({ other: url => {
      assert.ok(String(url).endsWith('/checkout-sessions/embedded'));
      return response({ checkout_session_secret: 'mock-embedded-secret' });
    } });
    const first = await worker.fetch(request('checkout-session'), e), firstBody = await first.json();
    const second = await worker.fetch(request('checkout-session'), e), secondBody = await second.json();
    assert.notEqual(firstBody.checkoutRef, secondBody.checkoutRef);
    assert.match(firstBody.checkoutRef, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(second.headers.getSetCookie().some(c => c.startsWith('__Secure-clone-buyer=;') && c.includes('Max-Age=0')));
    assert.equal(JSON.stringify(secondBody).includes(e.COMMAS_API_KEY), false);
  });
  await t.test('an unrelated browser cannot claim a known transaction', async () => {
    const e = env(); await proof(e); const calls = identityMock();
    const other = await checkoutContext(request('checkout-session'), e);
    assert.equal((await buyerSession(request('buyer-session', { transactionId: 'tx-mock' }, other.cookie.split(';')[0]), e)).status, 202);
    assert.equal(calls.length, 0);
  });
  await t.test('wrong buyer/product/amount, refunded or old transaction and duplicate customer matches fail closed', async () => {
    for (const change of [{ fan: { email: 'victim@example.test' } }, { product: { id: 'another' } }, { amount: 1 }, { refunds: [{}] }, { transaction_date: new Date(Date.now() - 1900000).toISOString() }]) {
      const e = env(), cookie = await proof(e); identityMock(change);
      assert.equal((await (await buyerSession(request('buyer-session', { transactionId: 'tx-mock' }, cookie), e)).json()).ok, false);
    }
    const e = env(), cookie = await proof(e); identityMock({}, [{ id: 1, email: 'mock@example.test' }, { id: 2, email: 'mock@example.test' }]);
    assert.equal((await (await buyerSession(request('buyer-session', {}, cookie), e)).json()).ok, false);
  });
  await t.test('webhooks must have a valid signature and a paid Clone seat', async () => {
    const e = env();
    for (const secret of [undefined, 'wrong-key']) {
      const x = { ...e, COMMAS_WEBHOOK_SECRET: secret };
      assert.equal((await worker.fetch(new Request(origin + '/clone/api/purchase', { method: 'POST', body: '{}' }), x)).status, 401);
    }
    for (const change of [{ amount: 0 }, { item: { id: 'wrong-product' } }]) {
      const cookie = await proof(e, change);
      assert.equal((await buyerSession(request('buyer-session', {}, cookie), e)).status, 202);
    }
  });
});
