import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import worker from '../src/index.js';
import { deliverWhopEvent, enqueueWhopEvent, flushWhopEvents, MAX_EVENT_AGE_MS, normalizeWhopPageUrl,
  sendWhopServerEvent, whopPayload, whopPurchaseFromVerifiedPayment } from '../src/whop-events.js';
const origin = 'https://jonmac.ai';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/commas-payment.json', import.meta.url)));
function env() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['0001_upsells.sql', '0002_sandbox.sql', '0003_whop_events.sql']) db.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  const leads = new Map();
  return { WHOP_API_KEY: 'fixture-whop-key', COMMAS_WEBHOOK_SECRET: 'fixture-webhook-key',
    CLONE_LEADS: { async get(k) { return leads.get(k) || null; }, async put(k, v) { leads.set(k, v); } },
    CLONE_UPSELLS: { prepare(query) { const stmt = db.prepare(query); return { bind(...args) { return {
      async run() { return { meta: { changes: Number(stmt.run(...args).changes) } }; },
      async first() { return stmt.get(...args) || null; }, async all() { return { results: stmt.all(...args) }; },
    }; } }; } }, db };
}
function payment(change = {}) {
  const p = structuredClone(fixture); p.created_at = p.data.created_at = new Date().toISOString();
  Object.assign(p.data, change); return p;
}
function webhook(e, payload, valid = true) {
  const raw = JSON.stringify(payload);
  return new Request(origin + '/clone/api/purchase', { method: 'POST', body: raw,
    headers: { 'x-webhook-signature': createHmac('sha256', valid ? e.COMMAS_WEBHOOK_SECRET : 'wrong-key').update(raw).digest('hex') } });
}
test('daily Eastern schedule and recurring calendar stay at 19:00 over DST, weekends and year boundaries', () => {
  const scope = { Intl, Date }; vm.createContext(scope);
  vm.runInContext(readFileSync(new URL('../public/schedule.js', import.meta.url), 'utf8'), scope);
  for (const [now, expected] of [
    ['2026-10-09T22:59:59Z', '2026-10-09T23:00:00Z'], // Friday
    ['2026-10-09T23:00:00Z', '2026-10-10T23:00:00Z'], // Exact start -> Saturday
    ['2026-10-10T23:00:01Z', '2026-10-11T23:00:00Z'],
    ['2026-10-31T23:00:01Z', '2026-11-02T00:00:00Z'], // Fall DST tomorrow
    ['2026-03-08T00:00:01Z', '2026-03-08T23:00:00Z'], // Spring DST tomorrow
    ['2027-01-01T00:00:01Z', '2027-01-02T00:00:00Z'],
  ]) assert.equal(scope.CloneSchedule.nextSession(new Date(now)).toISOString(), new Date(expected).toISOString(), now);
  assert.equal(scope.CloneSchedule.calendarDates(new Date('2026-11-02T00:00:00Z')), '20261101T190000/20261101T210000');
});
test('Whop URL/identity normalisation excludes secrets and preserves Whop attribution', () => {
  assert.equal(normalizeWhopPageUrl('https://jonmac.ai/clone/?waid=a&wacid=c&wasid=s&email=private&token=private#hash'), 'https://jonmac.ai/clone/?waid=a&wacid=c&wasid=s');
  for (const url of ['http://jonmac.ai/clone/', 'https://evil.test/clone/', 'https://jonmac.ai/other', 'https://user:password@jonmac.ai/clone/']) {
    assert.equal(normalizeWhopPageUrl(url), origin + '/clone/');
  }
  const p = whopPayload({ eventName: 'lead', eventId: 'test', url: origin + '/clone/?wacid=c&wasid=s&waid=a', email: ' Test@Example.test ', anonymousId: 'bad' });
  assert.deepEqual(p.user, { email: 'test@example.test' });
  assert.deepEqual(p.context, { ad_campaign_id: 'c', ad_set_id: 's', ad_id: 'a' });
});
test('signed Commas fixtures: all six products, actual cash, canonical transaction dedup and failure recovery', async t => {
  const saved = globalThis.fetch; t.after(() => { globalThis.fetch = saved; });
  let calls = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.whop.com/api/v1/events');
    calls.push(JSON.parse(init.body)); return new Response('{"id":"fixture-event"}', { status: 200 });
  };
  await t.test('all funnel products and renewals send actual positive cash, not catalog price', async () => {
    const e = env(); calls = [];
    for (const [id, amount] of [['nmGzE', 42], ['wg0E8', 97], ['2J89z', 97], ['XXYMA', 450], ['O9gZr', 297], ['jJYvv', 99]]) {
      const p = payment({ item: { id }, amount, transaction_history_id: 'ORD-fixture-' + id });
      assert.equal((await worker.fetch(webhook(e, p), e)).status, 200);
      const event = calls.at(-1); assert.equal(event.value, amount); assert.equal(event.currency, 'usd');
      assert.equal(event.user.anonymous_id, 'wuid_jon16_fixture'); assert.ok(!event.url.includes('token'));
      assert.equal(event.event_id, 'purchase_ORD-fixture-' + id);
    }
    assert.equal(calls.length, 6);
    const trial = payment({ item: { id: '2J89z' }, amount: 0 });
    assert.equal((await worker.fetch(webhook(e, trial), e)).status, 200); assert.equal(calls.length, 6);
  });
  await t.test('unsigned, failed, refunded, unrelated and stale payments emit nothing', async () => {
    const e = env(); calls = [];
    assert.equal((await worker.fetch(webhook(e, payment(), false), e)).status, 401);
    for (const p of [payment({ status: 'failed' }), payment({ refunds: [{}] }), payment({ item: { id: 'other' } }),
      payment({ currency: 'EUR' }), payment({ created_at: new Date(Date.now() - MAX_EVENT_AGE_MS - 1000).toISOString() }),
      { ...payment(), type: 'refund.created' }]) assert.equal((await worker.fetch(webhook(e, p), e)).status, 200);
    assert.equal(calls.length, 0);
  });
  await t.test('parallel delivery and webhook envelope changes still count one transaction', async () => {
    const e = env(), p = payment(); calls = [];
    await Promise.all([worker.fetch(webhook(e, p), e), worker.fetch(webhook(e, { ...p, id: 'second-envelope' }), e)]);
    assert.equal((await worker.fetch(webhook(e, p), e)).status, 200); assert.equal(calls.length, 1);
    assert.equal(e.db.prepare('SELECT COUNT(*) n FROM clone_whop_events WHERE sent_at IS NOT NULL').get().n, 1);
  });
  await t.test('API failure returns retriable webhook response and cron retries the same event ID', async () => {
    const e = env(), p = payment(); calls = [];
    globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response('{}', { status: 503 }); };
    assert.equal((await worker.fetch(webhook(e, p), e)).status, 503);
    e.db.exec('UPDATE clone_whop_events SET lease_until=0');
    globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
    await flushWhopEvents(e);
    assert.equal(calls.length, 2); assert.equal(calls[0].event_id, calls[1].event_id);
    assert.equal((await worker.fetch(webhook(e, p), e)).status, 200); assert.equal(calls.length, 2);
  });
  await t.test('lead and registration share browser IDs, cookie identity and retained attribution', async () => {
    const e = env(); calls = [];
    const eventId = 'clone_lead_00000000-0000-4000-8000-000000000000';
    const r = await worker.fetch(new Request(origin + '/clone/api/lead', { method: 'POST', headers: { cookie: '_wuid=wuid_cookie_fixture' },
      body: JSON.stringify({ email: 'fixture@example.test', eventId, phone: '+13055550100', pageUrl: origin + '/clone/?waid=ad' }) }), e);
    assert.equal(r.status, 200); assert.deepEqual(calls.map(c => [c.event_name, c.event_id]), [['lead', eventId], ['complete_registration', eventId + '_registration']]);
    assert.equal(calls[0].user.anonymous_id, 'wuid_cookie_fixture'); assert.equal(calls[0].user.phone, undefined);
    const p = payment({ api_metadata: null });
    assert.equal((await worker.fetch(webhook(e, p), e)).status, 200);
    assert.equal(calls.at(-1).user.anonymous_id, 'wuid_cookie_fixture'); assert.equal(calls.at(-1).context.ad_id, 'ad');
  });
  await t.test('sandbox, invalid names/IDs/time and nonpositive purchases never contact Whop', async () => {
    calls = [];
    assert.equal(await enqueueWhopEvent({ ...env(), CLONE_PAYMENT_MODE: 'sandbox' }, whopPurchaseFromVerifiedPayment(payment())), false);
    for (const event of [{ eventName: 'purchase', value: 0 }, { eventName: 'refund' }, { eventName: 'lead', eventTime: Date.now() + 120000 },
      { eventName: 'lead', eventId: 'x'.repeat(251) }]) {
      assert.equal((await sendWhopServerEvent(env(), { eventId: 'fixture', url: origin + '/clone/', ...event })).status, 0);
    }
    assert.equal(calls.length, 0);
  });
});
