import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import worker from '../src/index.js';
import { sandboxSettings, sandboxIds } from './sandbox-fixture.mjs';
import { sandboxEnv } from '../src/sandbox.js';
import { retryReminders } from '../src/reminders.js';
import { sendWhopServerEvent, flushWhopEvents } from '../src/whop-events.js';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) sql.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const leads = new Map();
  const env = { ...sandboxSettings(), WHOP_API_KEY: 'live-key-must-never-be-used', RESEND_API_KEY: 'mock-resend',
    CLONE_LEADS: { async get(k) { assert.ok(k.startsWith('sandbox:')); return leads.get(k) || null; },
      async put(k, v) { assert.ok(k.startsWith('sandbox:')); leads.set(k, v); } },
    CLONE_UPSELLS: { prepare(q) { const s = sql.prepare(q); return { bind(...a) { return {
      async run() { return { meta: { changes: Number(s.run(...a).changes) } }; },
      async first() { return s.get(...a) || null; }, async all() { return { results: s.all(...a) }; },
    }; } }; } } };
  return { sql, env };
}
function payment(id = 'SIM-JON6-seat', product = sandboxIds.seat) {
  return { id: 'envelope-one', type: 'payment.succeeded', data: { transaction_history_id: id,
    payment_id: id + '-payment', status: 'succeeded', amount: product === sandboxIds.seat ? 47 : 97,
    quantity: 1, currency: 'USD', created_at: new Date().toISOString(), item: { id: product },
    buyer: { email: 'should-never-receive@example.test' },
    api_metadata: { data: { whop_page_url: 'https://jonmac.ai/clone/?utm_source=qa&token=private' } } } };
}
function hook(env, payload, secret = env.COMMAS_SANDBOX_WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  return new Request('https://jonmac.ai/clone/api/sandbox/purchase', { method: 'POST', body,
    headers: { 'x-webhook-signature': createHmac('sha256', secret).update(body).digest('hex') } });
}
test('signed sandbox deliveries log once, schedule only the test mailbox, retry and refund safely', async t => {
  const saved = globalThis.fetch, info = console.info, timer = globalThis.setTimeout;
  const logs = [], accepted = new Map(), calls = []; let loseFirstResponse = true, failCancel = true;
  console.info = line => logs.push(JSON.parse(line));
  globalThis.setTimeout = (fn, ms, ...args) => timer(fn, ms === 250 ? 0 : ms, ...args);
  t.after(() => { globalThis.fetch = saved; console.info = info; globalThis.setTimeout = timer; });
  globalThis.fetch = async (url, init = {}) => {
    assert.ok(String(url).startsWith('https://api.resend.com/'), 'Sandbox made a non-Resend network call');
    const path = new URL(url).pathname; calls.push({ path, init });
    if (path.startsWith('/contacts/')) { assert.ok(path.endsWith('jon%2Bvvtest%40thejonmac.com')); return Response.json({ unsubscribed: false }); }
    if (path === '/emails') {
      const payload = JSON.parse(init.body), key = init.headers['Idempotency-Key'];
      assert.equal(payload.to, 'jon+vvtest@thejonmac.com'); assert.ok(!payload.cc && !payload.bcc);
      assert.ok(payload.scheduled_at); assert.ok(key.startsWith('clone-sandbox-SIM-JON6-'));
      if (!accepted.has(key)) accepted.set(key, { id: 'mock-' + accepted.size, payload: init.body, last_event: 'scheduled' });
      assert.equal(accepted.get(key).payload, init.body);
      if (loseFirstResponse) { loseFirstResponse = false; throw Error('accepted response lost'); }
      return Response.json({ id: accepted.get(key).id });
    }
    const item = [...accepted.values()].find(v => path.includes(v.id)); assert.ok(item);
    if (path.endsWith('/cancel')) {
      if (failCancel) { failCancel = false; return Response.json({}, { status: 503 }); }
      item.last_event = 'canceled'; return Response.json({ id: item.id });
    }
    return Response.json({ last_event: item.last_event });
  };
  const { env, sql } = fixture(), p = payment();
  assert.equal((await worker.fetch(hook(env, p, env.COMMAS_WEBHOOK_SECRET), env)).status, 401);
  assert.equal(logs.length, 0); assert.equal(calls.length, 0);
  assert.equal((await worker.fetch(hook(env, p), env)).status, 503);
  await retryReminders(sandboxEnv(env));
  const duplicates = await Promise.all([p, { ...p, id: 'retry-envelope' }, p].map(v => worker.fetch(hook(env, v), env)));
  assert.ok(duplicates.every(r => r.status === 200));
  assert.equal(logs.length, 1); assert.equal(logs[0].dedup_key, 'sandbox_purchase_SIM-JON6-seat');
  const stored = sql.prepare('SELECT * FROM clone_sandbox_whop_events').all(); assert.equal(stored.length, 1);
  assert.deepEqual(JSON.parse(stored[0].payload), logs[0].payload); assert.ok(!stored[0].payload.includes('private'));
  assert.deepEqual(await sendWhopServerEvent(sandboxEnv(env), { eventName: 'purchase', eventId: 'x', value: 47 }), { ok: false, status: 0 });
  await flushWhopEvents(sandboxEnv(env));
  assert.ok(accepted.size >= 1); assert.ok(accepted.size <= 3); // E1, E2 if due, E3 if due; Zoom/replay gated.
  assert.equal(sql.prepare("SELECT state FROM clone_sandbox_webinar_steps WHERE step='event'").get().state, 'skipped');
  const refund = { type: 'refund.created', data: { original_transaction_id: p.data.payment_id } };
  assert.equal((await worker.fetch(hook(env, refund), env)).status, 503);
  await retryReminders(sandboxEnv(env));
  assert.equal((await worker.fetch(hook(env, refund), env)).status, 200);
  assert.equal((await worker.fetch(hook(env, p), env)).status, 200);
  assert.ok([...accepted.values()].every(v => v.last_event === 'canceled'));
  assert.equal(sql.prepare('SELECT state FROM clone_sandbox_webinar_sessions').get().state, 'cancelled');
  for (const table of ['clone_whop_events', 'clone_webinar_sessions', 'clone_purchase_proofs', 'clone_session_events']) {
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM ' + table).get().n, 0);
  }
  assert.equal(logs.length, 1);
  for (const name of ['software', 'trial', 'audit', 'vault', 'vault_plan']) {
    const current = payment('SIM-JON6-' + name, sandboxIds[name]);
    for (let i = 0; i < 2; i++) assert.equal((await worker.fetch(hook(env, current), env)).status, 200);
  }
  assert.equal(logs.length, 6); assert.equal(sql.prepare('SELECT COUNT(*) n FROM clone_sandbox_whop_events').get().n, 6);
});
