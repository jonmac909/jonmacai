import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import worker from '../src/index.js';
import { sign, upsell } from '../src/upsells.js';
import { sandboxSettings, sandboxIds } from './sandbox-fixture.mjs';

const DUMMY = { META_PIXEL_ID: '1234567890', META_CAPI_TOKEN: 'dummy-capi-token' };
const REF = 'A'.repeat(43), sha = v => createHash('sha256').update(v).digest('hex');

function db() {
  const sql = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) sql.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  return { sql, d1: { prepare(q) { const s = sql.prepare(q); return { bind(...a) { return {
    async run() { return { meta: { changes: Number(s.run(...a).changes) } }; },
    async first() { return s.get(...a) || null; }, async all() { return { results: s.all(...a) }; } }; } }; } } };
}
function env(extra = {}) {
  const { sql, d1 } = db(), leads = new Map();
  leads.set('lead:buyer@example.test', JSON.stringify({ email: 'buyer@example.test', phone: '3055550100',
    meta: { fbp: 'fb.1.1792000000000.123456789', fbc: 'fb.1.1792000000000.IwAR0abcdefgh', ip: '203.0.113.9', ua: 'Mozilla/5.0 test' } }));
  return { sql, e: { CLONE_UPSELLS: d1, CLONE_LEADS: { async get(k) { return leads.get(k) || null; }, async put(k, v) { leads.set(k, v); } },
    COMMAS_WEBHOOK_SECRET: 'mock-hook', COMMAS_API_KEY: 'mock-live-key', CLONE_TOKEN_SECRET: 'mock-sign',
    CLONE_REBILL_ENABLED: 'true', CLONE_REBILL_ENABLED_AT: new Date(Date.now() - 60000).toISOString(), CLONE_CHARGE_GAP_MS: '0', ...extra } };
}
function seatHook(secret) {
  const body = JSON.stringify({ type: 'payment.succeeded', data: { transaction_history_id: 'ORD-META-1', payment_id: 'ORD-META-1', status: 'succeeded',
    amount: 47, quantity: 1, currency: 'USD', created_at: new Date().toISOString(), item: { id: 'nmGzE' }, buyer: { email: 'buyer@example.test' },
    api_metadata: { data: { clone_checkout_ref: REF, whop_page_url: 'https://jonmac.ai/clone/?fbclid=x&token=secret' } } } });
  return new Request('https://jonmac.ai/clone/api/purchase', { method: 'POST', body, headers: { 'x-webhook-signature': createHmac('sha256', secret).update(body).digest('hex') } });
}
function captureGraph(t) {
  const saved = globalThis.fetch, graph = [];
  t.after(() => { globalThis.fetch = saved; });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://graph.facebook.com/')) { graph.push({ url: u, init }); return Response.json({ events_received: 1 }); }
    if (u.includes('/checkout-sessions/XXYMA')) return Response.json({ status: 'success', data: { product: { id: 1382675 }, amount_cents: 49700, type: 'onetime_reusable' } });
    if (u.endsWith('/payment-methods')) return Response.json({ status: 'success', data: { customer: { id: 'user_Meta1', email: 'buyer@example.test' }, payment_methods: [{ id: 'pm', type: 'card', is_default: true }] } });
    if (u.endsWith('/charge')) return Response.json({ status: 'success', data: { status: 'succeeded', charge_id: 'pi_meta', amount: 497 } });
    return Response.json({}, { status: 503 }); // Resend, Whop: unavailable in this test
  };
  return graph;
}

test('Meta is OFF until both the pixel ID and the CAPI token are set', async t => {
  const graph = captureGraph(t), { e, sql } = env();
  await worker.fetch(seatHook(e.COMMAS_WEBHOOK_SECRET), e);
  assert.equal(graph.length, 0); assert.equal(sql.prepare('SELECT COUNT(*) n FROM clone_meta_events').get().n, 0);
  const { e: half } = env({ META_PIXEL_ID: DUMMY.META_PIXEL_ID });
  await worker.fetch(seatHook(half.COMMAS_WEBHOOK_SECRET), half);
  assert.equal(graph.length, 0);
});

test('dummy ID: the $47 sends one hashed Purchase with the browser eventID, deduped across webhook retries', async t => {
  const graph = captureGraph(t), { e, sql } = env(DUMMY);
  for (let i = 0; i < 3; i++) await worker.fetch(seatHook(e.COMMAS_WEBHOOK_SECRET), e);
  assert.equal(graph.length, 1);
  assert.equal(graph[0].url, 'https://graph.facebook.com/v25.0/1234567890/events');
  assert.equal(graph[0].init.headers.authorization, 'Bearer dummy-capi-token');
  const [event] = JSON.parse(graph[0].init.body).data;
  console.log('dummy-ID CAPI payload:', JSON.stringify(event));
  assert.equal(event.event_name, 'Purchase'); assert.equal(event.event_id, 'clone_purchase_seat_' + REF);
  assert.deepEqual(event.custom_data, { currency: 'USD', value: 47 });
  assert.deepEqual(event.user_data.em, [sha('buyer@example.test')]); assert.deepEqual(event.user_data.ph, [sha('13055550100')]);
  assert.equal(event.user_data.fbp, 'fb.1.1792000000000.123456789'); assert.equal(event.user_data.fbc, 'fb.1.1792000000000.IwAR0abcdefgh');
  assert.equal(event.event_source_url, 'https://jonmac.ai/clone/');
  assert.ok(!JSON.stringify(event).includes('buyer@example.test') && !JSON.stringify(event).includes('secret'));
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM clone_meta_events WHERE sent_at IS NOT NULL').get().n, 1);
});

test('dummy ID: a one-click upsell sends one Purchase whose eventID the page receives', async t => {
  const graph = captureGraph(t), { e } = env(DUMMY);
  const iat = Math.floor(Date.now() / 1000);
  const cookie = '__Secure-clone-buyer=' + await sign({ kind: 'buyer', buyer: 'user_Meta1', purchased: Date.now(), iat, exp: iat + 1800 }, e.CLONE_TOKEN_SECRET);
  const req = () => new Request('https://jonmac.ai/clone/api/upsell', { method: 'POST', headers: { origin: 'https://jonmac.ai', cookie, 'content-type': 'application/json' }, body: JSON.stringify({ offer: 'audit' }) });
  const r = await (await upsell(req(), e)).json();
  assert.equal(r.ok, true); assert.equal(r.purchaseEventId, 'clone_purchase_oneclick_pi_meta'); assert.equal(r.value, 497);
  await upsell(req(), e);
  assert.equal(graph.length, 1);
  const [event] = JSON.parse(graph[0].init.body).data;
  assert.equal(event.event_id, 'clone_purchase_oneclick_pi_meta'); assert.equal(event.custom_data.value, 497);
});

test('sandbox only logs Meta events and never sends them, even with an ID configured', async t => {
  const graph = captureGraph(t), { sql, d1 } = db();
  const e = { ...sandboxSettings(), ...DUMMY, CLONE_UPSELLS: d1, CLONE_LEADS: { async get() { return null; }, async put() {} } };
  const body = JSON.stringify({ type: 'payment.succeeded', data: { transaction_history_id: 'SIM-META', status: 'succeeded', amount: 47, quantity: 1, currency: 'USD',
    created_at: new Date().toISOString(), item: { id: sandboxIds.seat }, buyer: { email: 'sb@example.test' }, api_metadata: { data: { clone_checkout_ref: REF } } } });
  for (let i = 0; i < 2; i++) await worker.fetch(new Request('https://jonmac.ai/clone/api/sandbox/purchase', { method: 'POST', body,
    headers: { 'x-webhook-signature': createHmac('sha256', e.COMMAS_SANDBOX_WEBHOOK_SECRET).update(body).digest('hex') } }), e);
  assert.equal(graph.length, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM clone_sandbox_meta_events').get().n, 1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM clone_meta_events').get().n, 0);
});

test('the pixel ID is injected into pages only when Meta is configured', async () => {
  const assets = { async fetch(req) { const path = new URL(req.url).pathname;
    return new Response(readFileSync(new URL('../public' + path, import.meta.url)), { headers: { 'content-type': 'text/html' } }); } };
  for (const page of ['/clone/', '/clone/software.html', '/clone/refund.html']) {
    const on = await (await worker.fetch(new Request('https://jonmac.ai' + page), { ...env(DUMMY).e, ASSETS: assets })).text();
    assert.ok(on.includes('window.CLONE_META={"pixelId":"1234567890"}') && on.includes('meta-pixel.js'), page);
    const off = await (await worker.fetch(new Request('https://jonmac.ai' + page), { ...env().e, ASSETS: assets })).text();
    assert.ok(!off.includes('CLONE_META='), page);
  }
});
