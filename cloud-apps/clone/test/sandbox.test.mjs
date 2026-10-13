import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import worker from '../src/index.js';
import { paymentConfig, cookieName, tokenKind } from '../src/payment-config.js';
import { sandboxAccess, sandboxEnv } from '../src/sandbox.js';
import { sign, upsell } from '../src/upsells.js';
import { mockProduct, sandboxIds, sandboxSettings, sandboxUrls } from './sandbox-fixture.mjs';

const origin = 'https://jonmac.ai';
function env() {
  const db = new DatabaseSync(':memory:');
  for (const migration of ['0001_upsells.sql', '0002_sandbox.sql', '0006_sandbox_observability.sql']) db.exec(readFileSync(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
  const leads = new Map();
  return { ...sandboxSettings(), CLONE_UPSELLS: { prepare(query) {
    const stmt = db.prepare(query); return { bind(...args) { return {
      async run() { return { meta: { changes: Number(stmt.run(...args).changes) } }; },
      async first() { return stmt.get(...args) || null; },
    }; } };
  } }, CLONE_LEADS: { async get(k) { assert.ok(k.startsWith('sandbox:lead:')); return leads.get(k) || null; },
    async put(k, v) { assert.ok(k.startsWith('sandbox:lead:')); leads.set(k, v); } } };
}
function req(path, body = {}, cookie = '', method = 'POST') { return new Request(origin + '/clone/' + path, {
  method, headers: { origin, cookie, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
}); }
async function access(e) {
  const result = await sandboxAccess(req('api/sandbox/access', { token: e.CLONE_SANDBOX_ACCESS_TOKEN }), e);
  assert.equal(result.response.status, 200); return result.response.headers.get('set-cookie').split(';')[0];
}
async function buyer(e) {
  const iat = Math.floor(Date.now() / 1000);
  return cookieName(e, 'buyer') + '=' + await sign({ kind: tokenKind(e, 'buyer'), buyer: 123, purchased: Date.now(), iat, exp: iat + 1800 }, e.CLONE_TOKEN_SECRET);
}
function success(data) { return new Response(JSON.stringify({ status: 'success', data })); }

test('sandbox isolation and access controls', async t => {
  const saved = globalThis.fetch; t.after(() => { globalThis.fetch = saved; });
  await t.test('COMMAS_ENV alone leaves public production URLs, credentials and products intact', () => {
    const e = env(), config = paymentConfig(e);
    assert.equal(config.environment, 'production'); assert.equal(config.apiKey, e.COMMAS_API_KEY);
    assert.equal(config.seat, 'nmGzE'); assert.equal(config.offers.audit.service, 'XXYMA');
  });
  await t.test('missing sandbox settings, reused live key/IDs/URLs fail closed without outbound requests', async () => {
    globalThis.fetch = () => { throw new Error('unexpected outbound request'); };
    for (const change of [ { COMMAS_ENV: 'production' }, { COMMAS_SANDBOX_API_KEY: '' },
      { COMMAS_SANDBOX_API_KEY: 'mock-production-key' }, { COMMAS_SANDBOX_PRODUCT_IDS: '{}' },
      { COMMAS_SANDBOX_PRODUCT_IDS: JSON.stringify({ ...sandboxIds, seat: 'nmGzE' }) },
      { COMMAS_SANDBOX_CHECKOUT_URLS: JSON.stringify({ ...sandboxUrls, audit: 'https://commas.com/checkout/XXYMA' }) },
      { CLONE_SANDBOX_ACCESS_TOKEN: 'short' }, { COMMAS_SANDBOX_WEBHOOK_SECRET: '' } ]) {
      const e = { ...env(), ...change };
      const r = await worker.fetch(req('api/checkout-session?sandbox=1'), e);
      assert.ok([403, 503].includes(r.status)); assert.equal((await r.json()).ok, false);
    }
  });
  await t.test('query token is scrubbed, cookie expires, wrong/missing token and cross-origin login are denied', async () => {
    const e = env();
    assert.equal((await worker.fetch(req('api/config?sandbox=1', {}, '', 'GET'), e)).status, 403);
    assert.equal((await sandboxAccess(req('?sandbox=1&token=wrong', {}, '', 'GET'), e)).response.status, 403);
    const entry = await sandboxAccess(req('?sandbox=1&token=' + e.CLONE_SANDBOX_ACCESS_TOKEN, {}, '', 'GET'), e);
    assert.equal(entry.response.status, 303); assert.ok(!entry.response.headers.get('location').includes('token'));
    assert.match(entry.response.headers.get('set-cookie'), /Max-Age=1800; HttpOnly; Secure; SameSite=Lax/);
    const cookie = await access(e);
    assert.equal((await sandboxAccess(req('api/config?sandbox=1', {}, cookie, 'GET'), e)).env.CLONE_PAYMENT_MODE, 'sandbox');
    assert.equal((await sandboxAccess(req('api/config', {}, cookie, 'GET'), e)).env.CLONE_PAYMENT_MODE, 'production');
    const now = Math.floor(Date.now() / 1000);
    const expired = '__Secure-clone-sandbox-access=' + await sign({ kind: 'sandbox-access', access: 'expired', iat: now - 1900, exp: now - 100 }, e.CLONE_TOKEN_SECRET);
    assert.equal((await sandboxAccess(req('api/config?sandbox=1', {}, expired, 'GET'), e)).response.status, 403);
    assert.equal((await sandboxAccess(new Request(origin + '/clone/api/sandbox/access', { method: 'POST', headers: { origin: 'https://evil.test' }, body: JSON.stringify({ token: e.CLONE_SANDBOX_ACCESS_TOKEN }) }), e)).response.status, 403);
    assert.equal((await sandboxAccess(req('api/config?sandbox=0', {}, cookie, 'GET'), e)).response.status, 403);
  });
  await t.test('sandbox API and SDK sessions use only separate key/products and never reuse production cache', async () => {
    const e = env(), auth = await access(e), calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init }); return success({ checkout_session_secret: init.headers['x-api-key'] === e.COMMAS_API_KEY ? 'prod-secret' : 'sandbox-secret' });
    };
    for (const sandbox of [false, true, false, true]) {
      const r = await worker.fetch(req('api/checkout-session' + (sandbox ? '?sandbox=1' : ''), {}, auth), e);
      const b = await r.json();
      assert.equal(b.environment, sandbox ? 'sandbox' : 'production');
      assert.equal(b.checkoutSessionSecret, sandbox ? 'sandbox-secret' : 'prod-secret');
      assert.equal(b.productId, sandbox ? sandboxIds.seat : 'nmGzE');
      assert.ok(r.headers.getSetCookie().some(c => c.startsWith(sandbox ? '__Secure-clone-sandbox-buyer=;' : '__Secure-clone-buyer=;')));
      assert.ok(!JSON.stringify(b).includes(e.COMMAS_SANDBOX_API_KEY));
    }
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, 'https://api-sandbox.commas.net/public-api/checkout-sessions/embedded');
    assert.equal(calls[1].init.headers['x-api-key'], e.COMMAS_SANDBOX_API_KEY);
    assert.equal(JSON.parse(calls[1].init.body).product_id, sandboxIds.seat);
  });
  await t.test('colliding numeric buyers have separate durable claims and idempotency keys; cookies cannot cross environments', async () => {
    const e = env(), testEnv = sandboxEnv(e), calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      const sandbox = String(url).includes('api-sandbox.commas.net');
      assert.equal(init.headers['x-api-key'], sandbox ? e.COMMAS_SANDBOX_API_KEY : e.COMMAS_API_KEY);
      if (String(url).endsWith('/charge')) return success({ charge_id: 'mock-charge', status: 'succeeded', amount: 497 });
      if (String(url).endsWith('/payment-methods')) return success({ customer: { id: 123 }, payment_methods: [{ id: 'mock-card', type: 'card' }] });
      return success(mockProduct('audit'));
    };
    const prodCookie = await buyer(e), sandboxCookie = await buyer(testEnv);
    assert.equal((await (await upsell(req('api/upsell', { offer: 'audit' }, sandboxCookie.replace('sandbox-', '')), e)).json()).reason, 'buyer_unverified');
    assert.equal((await (await upsell(req('api/upsell', { offer: 'audit' }, prodCookie.replace('clone-buyer', 'clone-sandbox-buyer')), testEnv)).json()).reason, 'buyer_unverified');
    for (const current of [e, testEnv]) {
      for (let i = 0; i < 2; i++) assert.equal((await (await upsell(req('api/upsell', { offer: 'audit' }, await buyer(current)), current)).json()).ok, true);
    }
    const charges = calls.filter(c => c.url.endsWith('/charge'));
    assert.equal(charges.length, 2); assert.notEqual(charges[0].init.headers['Idempotency-Key'], charges[1].init.headers['Idempotency-Key']);
  });
  await t.test('sandbox webhook uses only sandbox HMAC/product/table and sandbox lead skips live email', async () => {
    const e = env(), auth = await access(e), ref = 'a'.repeat(43);
    const body = JSON.stringify({ type: 'payment.succeeded', created_at: new Date().toISOString(), data: {
      item: { id: sandboxIds.seat }, amount: 47, buyer: { email: 'sandbox@example.test' }, transaction_history_id: 'ORD-MOCK', api_metadata: { data: { clone_checkout_ref: ref } },
    } });
    for (const secret of [e.COMMAS_WEBHOOK_SECRET, e.COMMAS_SANDBOX_WEBHOOK_SECRET]) {
      const r = await worker.fetch(new Request(origin + '/clone/api/sandbox/purchase', { method: 'POST', headers: { 'x-webhook-signature': createHmac('sha256', secret).update(body).digest('hex') }, body }), e);
      assert.equal(r.status, secret === e.COMMAS_SANDBOX_WEBHOOK_SECRET ? 200 : 401);
    }
    assert.equal((await e.CLONE_UPSELLS.prepare('SELECT COUNT(*) AS n FROM clone_purchase_proofs').bind().first()).n, 0);
    assert.equal((await e.CLONE_UPSELLS.prepare('SELECT COUNT(*) AS n FROM clone_sandbox_purchase_proofs').bind().first()).n, 1);
    assert.equal((await worker.fetch(req('api/lead?sandbox=1', { email: 'sandbox@example.test' }, auth), e)).status, 200);
  });
  await t.test('sandbox subscription gate is independent and trial fallback uses sandbox URL', async () => {
    const e = sandboxEnv(env()); e.CLONE_SANDBOX_SUBSCRIPTIONS_ENABLED = 'false';
    globalThis.fetch = () => { throw new Error('gated offer made outbound request'); };
    assert.equal((await (await upsell(req('api/upsell', { offer: 'software' }, await buyer(e)), e)).json()).reason, 'rebill_unavailable');
    const trialEnv = sandboxEnv(env());
    const trial = await (await upsell(req('api/upsell', { offer: 'trial' }, await buyer(trialEnv)), trialEnv)).json();
    assert.equal(trial.reason, 'trial_hosted'); assert.equal(trial.checkoutUrl, sandboxUrls.trial);
  });
});
