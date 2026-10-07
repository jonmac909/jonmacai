import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import worker from '../src/index.js';
import { CONSENT_VERSION, readinessConfig } from '../src/readiness.js';
import { createSmsAdapter, smsReminderPlan } from '../src/sms.js';
import { recordScorecardPayment, recordVisit, sessionDate } from '../src/scorecard.js';

const origin = 'https://jonmac.ai';
function environment() {
  const db = new DatabaseSync(':memory:'), leads = new Map();
  for (const name of ['0001_upsells.sql', '0002_sandbox.sql', '0003_whop_events.sql', '0004_reminders.sql', '0005_launch_readiness.sql']) {
    db.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  }
  return { CLONE_SCORECARD_ENABLED: 'true', COMMAS_WEBHOOK_SECRET: 'mock-only-hmac', db, leads,
    CLONE_LEADS: { async get(key) { return leads.get(key); }, async put(key, value) { leads.set(key, value); } },
    CLONE_UPSELLS: { prepare(query) { const stmt = db.prepare(query); return { bind(...args) { return {
      async run() { return { meta: { changes: Number(stmt.run(...args).changes) } }; },
      async first() { return stmt.get(...args) || null; }, async all() { return { results: stmt.all(...args) }; },
    }; } }; } },
  };
}
function post(path, body, requestOrigin = origin) {
  return new Request(origin + '/clone/api/' + path, { method: 'POST', headers: { origin: requestOrigin,
    'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function payment(id = 'nmGzE', amount = 47, transaction = 'ORD-test-payment') {
  return { type: 'payment.succeeded', data: { item: { id }, amount, currency: 'USD', status: 'succeeded',
    transaction_history_id: transaction, created_at: '2026-10-07T18:00:00Z',
    api_metadata: { data: { clone_session_date: '2026-10-07' } } } };
}

test('optional phone, explicit checkbox/version and server timestamps; opt-in never confirms a number', async () => {
  const env = environment(), originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('No external requests permitted'); };
  try {
    for (const phone of ['', '+13055550100']) {
      assert.equal((await worker.fetch(post('lead', { email: 'test@example.test', phone }), env)).status, 200);
      const saved = JSON.parse(env.leads.get('lead:test@example.test'));
      assert.equal(saved.smsConsent, false); assert.equal(saved.smsConsentAt, null);
      assert.equal(saved.smsConsentVersion, null); assert.equal(saved.smsConsentStatus, 'not_requested');
    }
    for (const data of [
      { smsConsent: true }, { smsConsent: true, phone: '+13055550100' },
      { smsConsent: true, phone: '+13055550100', smsConsentVersion: 'outdated' }, { phone: 'not a number' },
    ]) assert.equal((await worker.fetch(post('lead', { email: 'test@example.test', ...data }), env)).status, 400);
    const before = Date.now();
    assert.equal((await worker.fetch(post('lead', { email: 'test@example.test', phone: '3055550100',
      smsConsent: true, smsConsentVersion: CONSENT_VERSION, smsConsentAt: '1990-01-01', smsConsentStatus: 'confirmed' }), env)).status, 200);
    const saved = JSON.parse(env.leads.get('lead:test@example.test'));
    assert.equal(saved.phone, '+13055550100'); assert.equal(saved.smsConsentPhone, saved.phone);
    assert.equal(saved.smsConsent, true); assert.equal(saved.smsConsentVersion, CONSENT_VERSION);
    assert.ok(Date.parse(saved.smsConsentAt) >= before); assert.equal(saved.smsConsentStatus, 'pending_confirmation');
    assert.equal(saved.smsConsentPage, '/clone/'); assert.ok(saved.sessionDate);
    // Legacy/string flags and a subsequent unchecked form never carry forward permission.
    await worker.fetch(post('lead', { email: 'test@example.test', phone: '+13055550100', smsConsent: 'true' }), env);
    assert.equal(JSON.parse(env.leads.get('lead:test@example.test')).smsConsent, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('SMS transport requires explicit activation, confirmed matching consent, STOP and no join links', async () => {
  const calls = [], providers = { mock: { async send(message) { calls.push(message); } } };
  const settings = { SMS_ENABLED: 'true', SMS_PROVIDER: 'mock', SMS_SENDER: '+13055550101' };
  const lead = { phone: '+13055550100', smsConsentPhone: '+13055550100', smsConsent: true,
    smsConsentVersion: CONSENT_VERSION, smsConsentStatus: 'confirmed', smsConsentConfirmedAt: '2026-10-07T18:00:00Z' };
  const message = { lead, text: 'Jon Mac: We are live. Check your email. Reply STOP to opt out.', idempotencyKey: 'session:S6:buyer' };
  for (const env of [{}, { ...settings, SMS_ENABLED: 'false' }, { ...settings, SMS_PROVIDER: '' },
    { ...settings, SMS_SENDER: '' }, { ...settings, CLONE_PAYMENT_MODE: 'sandbox' }]) {
    assert.equal((await createSmsAdapter(env, providers).sendReminder(message)).reason, 'disabled');
  }
  assert.equal(createSmsAdapter(settings).enabled, false, 'No production provider is installed');
  const adapter = createSmsAdapter(settings, providers);
  for (const change of [{ smsConsent: false }, { smsConsentStatus: 'pending_confirmation' },
    { smsConsentRevokedAt: '2026-10-07T18:01:00Z' }, { phone: '+13055550102' }, { smsConsentVersion: 'old' }]) {
    assert.equal((await adapter.sendReminder({ ...message, lead: { ...lead, ...change } })).reason, 'unconfirmed_consent');
  }
  for (const text of ['Join https://zoom.us/j/123 Reply STOP', 'Join zoom.us/j/123 Reply STOP', 'No opt-out']) {
    assert.equal((await adapter.sendReminder({ ...message, text })).reason, 'invalid_reminder');
  }
  assert.equal(calls.length, 0);
  assert.equal((await adapter.sendReminder(message)).sent, true);
  assert.equal(calls[0].to, lead.phone); assert.equal(calls[0].from, settings.SMS_SENDER);
  const plan = smsReminderPlan({ registeredAt: '2026-10-06T12:00:00Z', sessionAt: '2026-10-07T23:00:00Z' });
  assert.equal(plan.length, 6); assert.ok(plan.every(step => !step.text.includes('http') && step.text.includes('STOP')));
  const late = smsReminderPlan({ registeredAt: '2026-10-07T22:55:00Z', sessionAt: '2026-10-07T23:00:00Z', attended: false });
  assert.deepEqual(late.map(step => step.step), ['instant', 'live', 'help']);
});

test('FAQ IDs are validated, absent videos stay hidden, and public configuration cannot activate SMS', () => {
  assert.deepEqual(readinessConfig({}).faqVideos, { followers: null, camera: null, shop: null, time: null });
  const config = readinessConfig({ CLONE_FAQ_VIDEO_IDS: JSON.stringify({ followers: 'GP3NRg8NMY4', camera: '<script>', shop: 'https://evil.test' }), SMS_ENABLED: 'true' });
  assert.equal(config.faqVideos.followers, 'GP3NRg8NMY4'); assert.equal(config.faqVideos.camera, null);
  assert.equal(config.faqVideos.shop, null); assert.equal(config.smsSendingEnabled, false);
});

test('per-session ledger deduplicates visits and canonical payments, uses cents, and leaves unsupported sources null', async () => {
  const env = environment(), at = Date.parse('2026-10-07T18:00:00Z');
  const id = '00000000-0000-4000-8000-000000000000';
  await Promise.all([recordVisit(env, id, at), recordVisit(env, id, at)]);
  for (const [offer, amount] of [['nmGzE', 47], ['wg0E8', 97], ['XXYMA', 497], ['O9gZr', 297], ['jJYvv', 99]]) {
    const p = payment(offer, amount, 'ORD-' + offer);
    await Promise.all([recordScorecardPayment(p, env), recordScorecardPayment({ ...p, id: 'different-envelope' }, env)]);
  }
  await recordScorecardPayment(payment('2J89z', 0, 'ORD-free-trial'), env);
  const row = env.db.prepare('SELECT * FROM clone_session_scorecard WHERE session_date = ?').get('2026-10-07');
  assert.equal(row.lander_visits, 1); assert.equal(row.seat_purchases, 1);
  assert.equal(row.software_purchases, 1); assert.equal(row.audit_purchases, 1); assert.equal(row.vault_purchases, 1);
  assert.equal(row.gross_cash_cents, 103700); assert.equal(row.net_cash_cents, 103700);
  for (const key of ['ad_spend_cents', 'impressions', 'link_clicks', 'live_attendees', 'peak_concurrent', 'attendees_at_pitch']) assert.equal(row[key], null);
  assert.equal(sessionDate(Date.parse('2026-10-31T23:01:00Z')), '2026-11-01');
  assert.equal(sessionDate(Date.parse('2026-11-01T23:59:00Z')), '2026-11-01');
  await recordVisit({ ...env, CLONE_PAYMENT_MODE: 'sandbox' }, '11111111-1111-4111-8111-111111111111', at);
  assert.equal(env.db.prepare('SELECT COUNT(*) n FROM clone_session_events').get().n, 6);
  const columns = env.db.prepare('PRAGMA table_info(clone_session_events)').all().map(c => c.name);
  assert.ok(!columns.some(c => /email|phone|ip|user/.test(c)));
});

test('verified refund webhook is deduplicated, unassigned when order IDs differ, and never triggers purchase email', async () => {
  const env = environment(), originalFetch = globalThis.fetch;
  env.RESEND_API_KEY = 'mock-only-resend';
  globalThis.fetch = async () => { throw new Error('Refund must not contact email or payment providers'); };
  const refund = { type: 'refund.created', data: { item: { id: 'nmGzE' }, amount: 10, status: 'success',
    refund_id: 'fixture-refund', refund_transaction_id: 'hashid-original', transaction_history_id: 'ORD-existing-handler-ref',
    created_at: '2026-10-08T18:00:00Z', buyer: { email: 'test@example.test' } } };
  const webhook = valid => {
    const raw = JSON.stringify(refund);
    return new Request(origin + '/clone/api/purchase', { method: 'POST', body: raw,
      headers: { 'x-webhook-signature': createHmac('sha256', valid ? env.COMMAS_WEBHOOK_SECRET : 'wrong').update(raw).digest('hex') } });
  };
  try {
    assert.equal((await worker.fetch(webhook(false), env)).status, 401);
    assert.equal((await worker.fetch(webhook(true), env)).status, 200);
    assert.equal((await worker.fetch(webhook(true), env)).status, 200);
    const row = env.db.prepare('SELECT * FROM clone_session_scorecard').get();
    assert.equal(row.session_date, null); assert.equal(row.refunds_observed, 1);
    assert.equal(row.refund_cents, 1000); assert.equal(row.net_cash_cents, -1000);
    assert.equal((await worker.fetch(post('visit', { id: '00000000-0000-4000-8000-000000000000' }, 'https://evil.test'), env)).status, 403);
    assert.equal((await worker.fetch(post('visit', { id: 'bogus', kind: 'payment', amount: 47 }), env)).status, 400);
  } finally { globalThis.fetch = originalFetch; }
});

test('Worker accepts signed cash once; forged, failed and unrelated payloads cannot count purchases', async () => {
  const env = environment();
  const webhook = (payload, valid = true) => {
    const raw = JSON.stringify(payload);
    return new Request(origin + '/clone/api/purchase', { method: 'POST', body: raw,
      headers: { 'x-webhook-signature': createHmac('sha256', valid ? env.COMMAS_WEBHOOK_SECRET : 'wrong').update(raw).digest('hex') } });
  };
  const good = payment();
  assert.equal((await worker.fetch(webhook(good, false), env)).status, 401);
  for (const p of [payment('unrelated'), { ...good, data: { ...good.data, status: 'failed' } }]) {
    assert.equal((await worker.fetch(webhook(p), env)).status, 200);
  }
  assert.equal(env.db.prepare('SELECT COUNT(*) n FROM clone_session_events').get().n, 0);
  assert.equal((await worker.fetch(webhook(good), env)).status, 200);
  assert.equal((await worker.fetch(webhook({ ...good, id: 'repeated-envelope' }), env)).status, 200);
  assert.equal(env.db.prepare('SELECT seat_purchases FROM clone_session_scorecard').get().seat_purchases, 1);
});
