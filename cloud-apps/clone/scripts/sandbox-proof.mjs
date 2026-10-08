// Signed simulations exercise the real Worker handler; no provider payment occurs.
// Remote preview config is private/ignored and never printed by this runner.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const privateState = JSON.parse(readFileSync(process.env.JON6_PROOF_PRIVATE_CONFIG || '.wrangler/private-proof.json', 'utf8'));
const env = privateState.vars, ids = JSON.parse(env.COMMAS_SANDBOX_PRODUCT_IDS);
const base = process.env.JON6_PROOF_URL || 'http://127.0.0.1:8789';
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(base), 'Only the private loopback preview is accepted');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, payload, signingSecret = env.COMMAS_SANDBOX_WEBHOOK_SECRET) {
  const body = payload ? JSON.stringify(payload) : undefined;
  const response = await fetch(base + path, { method: body || path === '/proof/retry' ? 'POST' : 'GET', body,
    headers: { 'x-test-access': env.JON6_PROOF_ACCESS, ...(body ? { 'content-type': 'application/json',
      'x-webhook-signature': createHmac('sha256', signingSecret).update(body).digest('hex') } : {}) } });
  return { status: response.status, data: await response.json() };
}
const report = { kind: 'signed-simulation-with-real-resend', provider_payment: false, run: env.JON6_PROOF_RUN, purchases: [] };
const seatRef = env.JON6_PROOF_RUN + '-seat';
const refund = { type: 'refund.created', data: { original_transaction_id: seatRef + '-payment' } };
let error;
try {
  const preflight = await api('/proof/state'); assert.equal(preflight.status, 200); assert.equal(preflight.data.resend_configured, true);
  for (const [name, product] of Object.entries(ids)) {
    const ref = env.JON6_PROOF_RUN + '-' + name;
    const payload = { id: 'SIM-envelope-1', type: 'payment.succeeded', data: {
      transaction_history_id: ref, payment_id: ref + '-payment', status: 'succeeded',
      amount: ({ seat: 47, software: 97, trial: 97, audit: 497, vault: 297, vault_plan: 99 })[name],
      quantity: 1, currency: 'USD', created_at: new Date().toISOString(), item: { id: product },
      buyer: { email: 'jon+vvtest@thejonmac.com' },
      api_metadata: { data: { whop_page_url: 'https://jonmac.ai/clone/?utm_source=JON6-sandbox&token=removed' } },
    } };
    assert.equal((await api('/clone/api/sandbox/purchase', payload, 'wrong-sandbox-secret')).status, 401);
    let first = await api('/clone/api/sandbox/purchase', payload);
    for (let attempt = 0; first.status === 503 && attempt < 5; attempt++) {
      await delay(1200); await api('/proof/retry'); first = await api('/clone/api/sandbox/purchase', payload);
    }
    assert.equal(first.status, 200, 'Purchase simulation must be fully processed');
    const duplicates = await Promise.all([payload, { ...payload, id: 'SIM-envelope-retry' }, payload].map(p => api('/clone/api/sandbox/purchase', p)));
    assert.ok(duplicates.every(r => r.status === 200));
    report.purchases.push({ offer: name, transaction_ref: ref, deliveries: 4, invalid_signature_status: 401, duplicate_statuses: duplicates.map(r => r.status) });
  }
  report.before_refund = (await api('/proof/resend')).data;
  assert.equal(report.before_refund.events.length, 6);
  assert.equal(new Set(report.before_refund.events.map(e => e.dedup_key)).size, 6);
  assert.ok(report.before_refund.events.every(e => !JSON.stringify(e.payload).includes('removed')));
  assert.ok(report.before_refund.statuses.length > 0);
  for (const status of report.before_refund.statuses) {
    assert.equal(status.api_status, 200); assert.deepEqual(status.to, ['jon+vvtest@thejonmac.com']);
    assert.equal(status.last_event, 'scheduled'); assert.ok(status.scheduled_at);
  }
} catch (e) { error = e; }
finally {
  // Refund even after a failed assertion so the QA run leaves no unsent mail.
  let cancelled = await api('/clone/api/sandbox/purchase', refund);
  for (let attempt = 0; cancelled.status === 503 && attempt < 8; attempt++) {
    await delay(1200); await api('/proof/retry'); cancelled = await api('/clone/api/sandbox/purchase', refund);
  }
  report.refund_status = cancelled.status;
  report.after_refund = (await api('/proof/resend')).data;
  mkdirSync('.wrangler/proof', { recursive: true });
  writeFileSync('.wrangler/proof/signed-simulation.json', JSON.stringify(report, null, 2));
}
if (error) throw error;
assert.equal(report.refund_status, 200);
assert.ok(report.after_refund.statuses.every(s => s.api_status === 200 && ['canceled', 'cancelled'].includes(s.last_event)));
console.log(JSON.stringify({ pass: true, simulated_transactions: report.purchases.length,
  delivery_count: report.purchases.reduce((n, p) => n + p.deliveries, 0), whop_durable_logs: report.before_refund.events.length,
  resend_scheduled: report.before_refund.statuses.length, resend_cancelled: report.after_refund.statuses.length,
  recipient: 'jon+vvtest@thejonmac.com', report: '.wrangler/proof/signed-simulation.json' }));
