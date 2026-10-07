import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { assignSession, calendarUrl, reminderMessage, reminderPlan } from '../src/reminder-plan.js';
import { purchaseReminders, retryReminders, unsubscribeReminders } from '../src/reminders.js';

const join = 'https://example.zoom.us/j/123456789?pwd=mock-only';
const replay = 'https://example.com/replay';
const purchaseTime = '2026-10-07T21:01:00Z';
const ms = Date.parse(purchaseTime);

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const migration of ['0001_upsells', '0002_sandbox', '0003_reminders']) sql.exec(readFileSync(new URL(`../migrations/${migration}.sql`, import.meta.url), 'utf8'));
  const leads = new Map();
  const db = { prepare(query) {
    const stmt = sql.prepare(query);
    return { bind(...args) { return {
      async run() { return { meta: { changes: Number(stmt.run(...args).changes) } }; },
      async first() { return stmt.get(...args) || null; },
      async all() { return { results: stmt.all(...args) }; },
    }; } };
  } };
  return { sql, leads, env: { CLONE_UPSELLS: db,
    CLONE_LEADS: { async get(key) { return leads.get(key) || null; }, async put(key, value) { leads.set(key, value); } },
    COMMAS_WEBHOOK_SECRET: 'mock-only-webhook-key', RESEND_API_KEY: 'mock-only-resend-key',
    CLONE_ZOOM_JOIN_URL: join, CLONE_REPLAY_URL: replay } };
}

function seat(overrides = {}, transaction = 'ORD-mock-seat') {
  return { id: 'mock-webhook-event', type: 'payment.succeeded', data: {
    transaction_history_id: transaction, payment_id: transaction, status: 'succeeded',
    amount: 47, quantity: 1, currency: 'USD', created_at: purchaseTime,
    item: { id: 'nmGzE', type: 'onetime' }, buyer: { email: 'test_user_mock@example.com' }, ...overrides,
  } };
}

function provider(overrides = {}) {
  const calls = [], accepted = new Map();
  globalThis.fetch = async (url, init = {}) => {
    assert.ok(String(url).startsWith('https://api.resend.com/'), 'External provider calls must be mocked');
    const path = String(url).slice('https://api.resend.com'.length);
    calls.push({ path, ...init });
    if (overrides.intercept) {
      const intercepted = await overrides.intercept(path, init, accepted);
      if (intercepted) return intercepted;
    }
    if (path.startsWith('/contacts/')) return Response.json({ unsubscribed: !!overrides.unsubscribed });
    if (path === '/emails' || path === '/events/send') {
      const key = init.headers['Idempotency-Key'];
      if (!accepted.has(key)) accepted.set(key, { id: 'mock-email-' + (accepted.size + 1), payload: init.body });
      assert.equal(accepted.get(key).payload, init.body, 'Retries must reuse the exact payload');
      if (path === '/events/send') return Response.json({ object: 'event', event: 'clone.purchase' });
      return Response.json({ id: accepted.get(key).id });
    }
    if (path.endsWith('/cancel')) return Response.json({ id: path.split('/')[2], object: 'email' });
    return Response.json({ last_event: 'sent' });
  };
  return { calls, accepted };
}

test('session assignment uses the two-hour cutoff and local dates across DST', () => {
  const cases = [
    ['2026-10-07T20:59:59Z', '2026-10-07T23:00:00.000Z'],
    ['2026-10-07T21:00:00Z', '2026-10-07T23:00:00.000Z'],
    ['2026-10-07T21:00:00.001Z', '2026-10-08T23:00:00.000Z'],
    ['2026-10-08T01:00:00Z', '2026-10-08T23:00:00.000Z'],
    ['2026-03-07T22:01:00Z', '2026-03-08T23:00:00.000Z'],
    ['2026-03-08T21:00:00Z', '2026-03-08T23:00:00.000Z'],
    ['2026-03-08T21:01:00Z', '2026-03-09T23:00:00.000Z'],
    ['2026-10-31T21:01:00Z', '2026-11-02T00:00:00.000Z'],
    ['2026-11-01T22:00:00Z', '2026-11-02T00:00:00.000Z'],
    ['2026-11-01T22:01:00Z', '2026-11-03T00:00:00.000Z'],
  ];
  for (const [purchase, expected] of cases) assert.equal(assignSession(purchase).session_at, expected, purchase);
  assert.match(assignSession('2026-03-08T21:00:00Z').session_label, /7:00 PM EDT/);
  assert.match(assignSession('2026-11-01T22:00:00Z').session_label, /7:00 PM EST/);
  assert.throws(() => assignSession('invalid'));
});

test('plans skip past steps, gate links, and keep keys stable', () => {
  const session = { transaction_ref: 'ORD-mock', purchased_at: ms, ...assignSession(ms) };
  const env = { CLONE_ZOOM_JOIN_URL: join, CLONE_REPLAY_URL: replay };
  const plan = reminderPlan(session, env, ms);
  assert.ok(plan.every(p => !p.skip));
  assert.equal(plan[2].scheduled_at, '2026-10-08T13:00:00.000Z');
  assert.equal(plan[7].scheduled_at, '2026-10-09T13:00:00.000Z');
  assert.equal(plan[0].scheduled_at, null);
  assert.deepEqual(plan.map(p => p.idempotency_key), reminderPlan(session, env, ms + 1000).map(p => p.idempotency_key));
  const late = reminderPlan(session, env, Date.parse('2026-10-08T22:55:00Z'));
  assert.deepEqual(late.filter(p => !p.skip).map(p => p.step), ['E1', 'E6', 'E7', 'E8']);
  const noLinks = reminderPlan(session, {}, ms);
  assert.deepEqual(noLinks.filter(p => p.skip).map(p => p.step), ['E4', 'E5', 'E6', 'E7', 'E8']);
  assert.equal(reminderPlan(session, { CLONE_ZOOM_JOIN_URL: 'https://zoom.us.evil.example/j/1' }, ms)[3].skip, 'missing_join_url');
  assert.equal(reminderPlan(session, { CLONE_REPLAY_URL: 'javascript:alert(1)' }, ms)[7].skip, 'missing_replay_url');
  assert.equal(reminderPlan({ ...session, purchased_at: Date.parse('2026-10-07T21:00:00Z'), ...assignSession('2026-10-07T21:00:00Z') }, env, ms)[1].skip, 'within_24_hours');
});

test('morning reminders and E2 use the right DST offsets', () => {
  for (const [at, morning, replayAt, e2] of [
    ['2026-03-07T22:01:00Z', '2026-03-08T13:00:00.000Z', '2026-03-09T13:00:00.000Z', '2026-03-07T23:00:00.000Z'],
    ['2026-10-31T21:01:00Z', '2026-11-01T14:00:00.000Z', '2026-11-02T14:00:00.000Z', '2026-11-01T00:00:00.000Z'],
  ]) {
    const session = { transaction_ref: 'ORD-mock', purchased_at: Date.parse(at), ...assignSession(at) };
    const plan = reminderPlan(session, {}, Date.parse(at));
    assert.equal(plan[1].scheduled_at, e2);
    assert.equal(plan[2].scheduled_at, morning);
    assert.equal(plan[7].scheduled_at, replayAt);
  }
});

test('every email has simple HTML, text, unsubscribe and email-only join links', () => {
  const session = { transaction_ref: 'ORD-mock', email: 'test_user_mock@example.com', purchased_at: ms, unsubscribe_token: 'a'.repeat(64), ...assignSession(ms) };
  for (const p of reminderPlan(session, { CLONE_ZOOM_JOIN_URL: join, CLONE_REPLAY_URL: replay }, ms)) {
    const message = reminderMessage(session, p, {});
    assert.match(message.text, /Unsubscribe from webinar reminders/);
    assert.match(message.html, /<p>/);
    assert.match(message.headers['List-Unsubscribe'], /https:\/\/jonmac.ai\//);
    assert.equal(message.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.equal(message.reply_to, 'jon@thejonmac.com');
    assert.equal(message.text.includes(join), ['E4', 'E5', 'E6', 'E7'].includes(p.step));
    assert.equal((message.text.match(/Your live training:|Your session was/g) || []).length, 1);
  }
  const calendar = new URL(calendarUrl(session.session_at));
  assert.equal(calendar.searchParams.get('dates'), '20261008T230000Z/20261009T010000Z');
  assert.ok(!calendar.href.includes('zoom'));
});

test('durable scheduling, authenticated hooks, retries and cancellation', async t => {
  const originalFetch = globalThis.fetch, originalNow = Date.now, originalTimer = globalThis.setTimeout;
  Date.now = () => ms;
  globalThis.setTimeout = callback => originalTimer(callback, 0);
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; globalThis.setTimeout = originalTimer; });

  await t.test('one verified purchase persists the lead and sends all eight steps plus event', async () => {
    const f = fixture(), p = provider();
    await purchaseReminders(seat(), f.env);
    assert.equal(p.calls.filter(c => c.path === '/emails').length, 8);
    const event = JSON.parse(p.calls.find(c => c.path === '/events/send').body);
    const lead = JSON.parse(f.leads.get('lead:test_user_mock@example.com'));
    assert.equal(event.payload.session_at, lead.session_at);
    assert.equal(lead.session_at, '2026-10-08T23:00:00.000Z');
    assert.ok(lead.purchased);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM clone_webinar_steps WHERE email_id IS NOT NULL').get().n, 9);
  });

  await t.test('duplicate/concurrent deliveries and deliveries after 24 hours never duplicate', async () => {
    const f = fixture(), p = provider();
    await Promise.allSettled([purchaseReminders(seat(), f.env), purchaseReminders(seat(), f.env)]);
    await purchaseReminders(seat(), f.env);
    Date.now = () => ms + 2 * 24 * 3600000;
    await purchaseReminders(seat(), f.env);
    Date.now = () => ms;
    assert.equal(p.calls.filter(c => c.path === '/emails').length, 8);
    assert.equal(p.calls.filter(c => c.path === '/events/send').length, 1);
    assert.equal(JSON.parse(f.leads.get('lead:test_user_mock@example.com')).session_at, '2026-10-08T23:00:00.000Z');
  });

  await t.test('partial failure retries only unfinished steps with exact stored bodies', async () => {
    const f = fixture();
    let reject = true;
    const p = provider({ intercept(path, init) {
      if (path === '/emails' && init.headers['Idempotency-Key'].endsWith('-E3') && reject) { reject = false; return Response.json({ name: 'rate_limit_exceeded' }, { status: 429 }); }
    } });
    await assert.rejects(() => purchaseReminders(seat(), f.env));
    await retryReminders(f.env);
    assert.equal(p.calls.filter(c => c.path === '/emails' && c.headers['Idempotency-Key'].endsWith('-E1')).length, 1);
    assert.equal(p.accepted.size, 9);
  });

  await t.test('a lost accepted response recovers the same email with the same key', async () => {
    const f = fixture();
    let lost = true;
    const p = provider({ intercept(path, init, accepted) {
      if (path === '/emails' && init.headers['Idempotency-Key'].endsWith('-E1') && lost) {
        lost = false; accepted.set(init.headers['Idempotency-Key'], { id: 'mock-lost-email', payload: init.body }); throw new Error('mock network timeout');
      }
    } });
    await assert.rejects(() => purchaseReminders(seat(), f.env));
    await purchaseReminders(seat(), f.env);
    assert.equal(f.sql.prepare("SELECT email_id FROM clone_webinar_steps WHERE step = 'E1'").get().email_id, 'mock-lost-email');
    assert.equal(p.accepted.size, 9);
  });

  await t.test('an ambiguous submission older than 24 hours requires reconciliation', async () => {
    const f = fixture(), p = provider({ intercept(path) { if (path === '/emails') throw new Error('mock timeout'); } });
    await assert.rejects(() => purchaseReminders(seat(), f.env));
    Date.now = () => ms + 24 * 3600000;
    await assert.rejects(() => purchaseReminders(seat(), f.env), /reconciliation/);
    Date.now = () => ms;
    assert.equal(p.calls.filter(c => c.path === '/emails').length, 1);
    assert.equal(f.sql.prepare("SELECT state FROM clone_webinar_steps WHERE step = 'E1'").get().state, 'unknown');
  });

  await t.test('an ambiguous purchase event is held for review instead of triggering twice', async () => {
    const f = fixture(), p = provider({ intercept(path) {
      if (path === '/events/send') throw new Error('mock event response lost');
    } });
    await assert.rejects(() => purchaseReminders(seat(), f.env));
    await assert.rejects(() => purchaseReminders(seat(), f.env), /event_needs_reconciliation/);
    assert.equal(p.calls.filter(c => c.path === '/events/send').length, 1);
    assert.equal(p.calls.filter(c => c.path === '/emails').length, 8);
  });

  await t.test('late retries skip past unsent reminders', async () => {
    const f = fixture(), p = provider({ intercept(path, init) {
      if (path === '/emails' && init.headers['Idempotency-Key'].endsWith('-E2')) return Response.json({}, { status: 429 });
    } });
    await assert.rejects(() => purchaseReminders(seat(), f.env));
    Date.now = () => Date.parse('2026-10-08T22:55:00Z');
    await purchaseReminders(seat(), f.env);
    Date.now = () => ms;
    assert.deepEqual(p.calls.filter(c => c.path === '/emails' && p.accepted.has(c.headers['Idempotency-Key'])).map(c => c.headers['Idempotency-Key'].split('-').pop()), ['E1', 'E6', 'E7', 'E8']);
  });

  await t.test('missing links disable E4-E8', async () => {
    const f = fixture(), p = provider();
    delete f.env.CLONE_ZOOM_JOIN_URL; delete f.env.CLONE_REPLAY_URL;
    await purchaseReminders(seat(), f.env);
    assert.deepEqual(p.calls.filter(c => c.path === '/emails').map(c => JSON.parse(c.body).tags[1].value), ['E1', 'E2', 'E3']);
  });

  await t.test('refunds cancel only the matching transaction and survive redelivery', async () => {
    const f = fixture(), p = provider();
    await purchaseReminders(seat(), f.env);
    const refund = { type: 'refund.created', data: { transaction_history_id: 'ORD-mock-seat' } };
    await purchaseReminders(refund, f.env);
    await purchaseReminders(refund, f.env);
    await purchaseReminders(seat(), f.env);
    assert.equal(p.calls.filter(c => c.path.endsWith('/cancel')).length, 7);
    assert.equal(p.calls.filter(c => c.path === '/emails').length, 8);
    assert.equal(JSON.parse(f.leads.get('lead:test_user_mock@example.com')).purchased, false);
    await purchaseReminders({ type: 'refund.created', data: { transaction_history_id: 'ORD-mock-upsell' } }, f.env);
    assert.equal(p.calls.filter(c => c.path.endsWith('/cancel')).length, 7);
  });

  await t.test('a refund delivered before the purchase prevents all sends', async () => {
    const f = fixture(), p = provider();
    await purchaseReminders({ type: 'refund.created', data: { payment_id: 'ORD-mock-seat' } }, f.env);
    await purchaseReminders(seat(), f.env);
    assert.equal(p.calls.length, 0);
  });

  await t.test('refund recovers and cancels an accepted schedule whose response was lost', async () => {
    const f = fixture(); let lost = true;
    const p = provider({ intercept(path, init, accepted) {
      if (path === '/emails' && init.headers['Idempotency-Key'].endsWith('-E2') && lost) {
        lost = false; accepted.set(init.headers['Idempotency-Key'], { id: 'mock-lost-schedule', payload: init.body }); throw new Error('mock timeout');
      }
    } });
    await assert.rejects(() => purchaseReminders(seat(), f.env));
    await purchaseReminders({ type: 'refund.created', data: { payment_id: 'ORD-mock-seat' } }, f.env);
    assert.ok(p.calls.some(c => c.path === '/emails/mock-lost-schedule/cancel'));
    assert.equal(p.accepted.size, 2);
    assert.equal(JSON.parse(f.leads.get('lead:test_user_mock@example.com')).purchased, false);
  });

  await t.test('refund during submission cancels the newly accepted ID', async () => {
    const f = fixture();
    let refunded = false;
    const p = provider({ async intercept(path, init) {
      if (path === '/emails' && init.headers['Idempotency-Key'].endsWith('-E2') && !refunded) {
        refunded = true; await purchaseReminders({ type: 'refund.created', data: { payment_id: 'ORD-mock-seat' } }, f.env);
      }
    } });
    await purchaseReminders(seat(), f.env);
    assert.equal(p.accepted.size, 2, 'Idempotent recovery must not create another email');
    assert.equal(p.calls.filter(c => c.path.endsWith('/cancel')).length, 1);
  });

  await t.test('cancellation failures persist and the retry hook cancels remaining emails', async () => {
    const f = fixture(); let fail = true;
    const p = provider({ intercept(path) {
      if (path.endsWith('/cancel') && fail) return Response.json({}, { status: 500 });
      if (path.startsWith('/emails/') && !path.endsWith('/cancel') && fail) return Response.json({ last_event: 'scheduled' });
    } });
    await purchaseReminders(seat(), f.env);
    await assert.rejects(() => purchaseReminders({ type: 'refund.created', data: { payment_id: 'ORD-mock-seat' } }, f.env));
    fail = false; await retryReminders(f.env);
    assert.equal(p.calls.filter(c => c.path.endsWith('/cancel')).length, 8);
    assert.equal(f.sql.prepare('SELECT complete FROM clone_webinar_sessions').get().complete, 1);
  });

  await t.test('unsubscribe GET is safe for scanners; one-click POST cancels and suppresses future seats', async () => {
    const f = fixture(), p = provider();
    await purchaseReminders(seat(), f.env);
    const token = f.sql.prepare('SELECT unsubscribe_token FROM clone_webinar_sessions').get().unsubscribe_token;
    const url = 'https://jonmac.ai/clone/api/reminders/unsubscribe?token=' + token;
    assert.equal((await unsubscribeReminders(new Request(url), f.env)).status, 200);
    assert.equal(p.calls.filter(c => c.path.endsWith('/cancel')).length, 0);
    assert.equal((await unsubscribeReminders(new Request(url, { method: 'POST', body: 'List-Unsubscribe=One-Click' }), f.env)).status, 200);
    assert.equal(p.calls.filter(c => c.path.endsWith('/cancel')).length, 7);
    await purchaseReminders(seat({}, 'ORD-mock-new'), f.env);
    assert.equal(p.calls.filter(c => c.path === '/emails').length, 8);
    assert.equal((await unsubscribeReminders(new Request(url + 'bad'), f.env)).status, 404);
  });

  await t.test('existing Resend opt-outs suppress every reminder', async () => {
    const f = fixture(), p = provider({ unsubscribed: true });
    await purchaseReminders(seat(), f.env);
    assert.equal(p.calls.filter(c => c.path === '/emails' || c.path === '/events/send').length, 0);
  });

  await t.test('unverified, failed, wrong-product and wrong-amount events send nothing', async () => {
    const f = fixture(), p = provider();
    for (const input of [seat({ amount: 97 }), seat({ status: 'failed' }), seat({ currency: 'CAD' }), seat({ item: { id: 'wg0E8' } }), seat({ quantity: 2 }), seat({ buyer: { email: 'bad' } }), { ...seat(), type: 'subscription.created' }]) {
      assert.deepEqual(await purchaseReminders(input, f.env), { ignored: true });
    }
    const body = JSON.stringify(seat());
    assert.equal((await worker.fetch(new Request('https://jonmac.ai/clone/api/purchase', { method: 'POST', body }), f.env)).status, 401);
    assert.equal(p.calls.length, 0);
  });

  await t.test('the real Worker route verifies HMAC and returns a retriable error on provider failure', async () => {
    const f = fixture(), p = provider({ intercept(path) { if (path === '/emails') return Response.json({}, { status: 429 }); } });
    const body = JSON.stringify(seat());
    const signature = createHmac('sha256', f.env.COMMAS_WEBHOOK_SECRET).update(body).digest('hex');
    const response = await worker.fetch(new Request('https://jonmac.ai/clone/api/purchase', { method: 'POST', headers: { 'x-webhook-signature': signature }, body }), f.env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'reminders_pending' });
    assert.equal(p.calls.filter(c => c.path === '/emails').length, 1);
  });

  await t.test('sandbox purchases never call production reminder providers or tables', async () => {
    const f = fixture(), p = provider();
    f.env.CLONE_PAYMENT_MODE = 'sandbox';
    assert.deepEqual(await purchaseReminders(seat(), f.env), { ignored: true });
    await retryReminders(f.env);
    assert.equal(p.calls.length, 0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM clone_webinar_sessions').get().n, 0);
  });
});
