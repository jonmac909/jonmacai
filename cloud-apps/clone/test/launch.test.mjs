import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import worker from '../src/index.js';
import { sandboxSettings, sandboxIds } from './sandbox-fixture.mjs';
import { assignSession, reminderPlan, FIRST_SESSION } from '../src/reminder-plan.js';
import '../public/schedule.js';

// Launch: ads Oct 20-22 (stop 5 PM ET Oct 22), first live session Thu Oct 22 7 PM ET.
const FIRST = '2026-10-22T23:00:00.000Z';
const oct20 = Date.parse('2026-10-20T14:00:00Z');      // Tue Oct 20, 10 AM ET
const oct22at4pm = Date.parse('2026-10-22T20:00:00Z'); // Thu Oct 22, 4 PM ET
const oct22at6pm = Date.parse('2026-10-22T22:00:00Z'); // Thu Oct 22, 6 PM ET (after ads stop)

test('buyers before 5 PM ET on Oct 22 get the Oct 22 session; afterwards the daily rule applies', () => {
  assert.equal(new Date(FIRST_SESSION).toISOString(), FIRST);
  for (const at of [Date.parse('2026-10-15T18:00:00Z'), oct20, Date.parse('2026-10-21T23:30:00Z'), oct22at4pm, Date.parse('2026-10-22T20:59:59Z')]) {
    assert.equal(assignSession(at).session_at, FIRST, new Date(at).toISOString());
    assert.equal(globalThis.CloneSchedule.nextSession(new Date(at)).toISOString(), FIRST, 'page countdown ' + new Date(at).toISOString());
  }
  assert.match(assignSession(oct20).session_label, /Thursday, October 22, 2026 at 7:00 PM EDT/);
  assert.equal(assignSession(oct22at6pm).session_at, '2026-10-23T23:00:00.000Z');
  assert.equal(assignSession(Date.parse('2026-10-23T15:00:00Z')).session_at, '2026-10-23T23:00:00.000Z');
});

test('an Oct 20 buyer gets the day-before email on Oct 21 and the morning-of email on Oct 22', () => {
  const env = { CLONE_PAYMENT_MODE: 'production' };
  const steps = Object.fromEntries(reminderPlan({ transaction_ref: 'T', purchased_at: oct20, session_at: FIRST }, env, oct20).map(s => [s.step, s]));
  assert.equal(steps.E2.scheduled_at, '2026-10-21T23:00:00.000Z'); assert.equal(steps.E2.skip, null);
  assert.equal(steps.E3.scheduled_at, '2026-10-22T13:00:00.000Z'); assert.equal(steps.E3.skip, null);
  const late = Object.fromEntries(reminderPlan({ transaction_ref: 'T', purchased_at: oct22at4pm, session_at: FIRST }, env, oct22at4pm).map(s => [s.step, s]));
  assert.equal(late.E2.skip, 'within_24_hours'); assert.equal(late.E3.skip, 'past');
});

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) sql.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const leads = new Map();
  const env = { ...sandboxSettings(), RESEND_API_KEY: 'mock-resend',
    CLONE_LEADS: { async get(k) { return leads.get(k) || null; }, async put(k, v) { leads.set(k, v); } },
    CLONE_UPSELLS: { prepare(q) { const s = sql.prepare(q); return { bind(...a) { return {
      async run() { return { meta: { changes: Number(s.run(...a).changes) } }; },
      async first() { return s.get(...a) || null; }, async all() { return { results: s.all(...a) }; },
    }; } }; } } };
  return { sql, env };
}

test('sandbox: Oct 20 and Oct 22 4 PM ET buyers are booked into Oct 22 with emails on the right days', async t => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; mock.timers.reset(); });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url); assert.equal(u.origin, 'https://api.resend.com');
    if (u.pathname.startsWith('/contacts/')) return Response.json({}, { status: 404 });
    if (u.pathname === '/emails') { assert.equal(JSON.parse(init.body).to, 'delivered@resend.dev'); return Response.json({ id: 'mock-' + Math.random() }); }
    return Response.json({});
  };
  for (const [label, at] of [['oct20', oct20], ['oct22-4pm', oct22at4pm]]) {
    mock.timers.enable({ apis: ['Date'], now: at });
    const { env, sql } = fixture(), ref = 'SIM-LAUNCH-' + label;
    const body = JSON.stringify({ type: 'payment.succeeded', data: { transaction_history_id: ref, payment_id: ref, status: 'succeeded', amount: 47,
      quantity: 1, currency: 'USD', created_at: new Date(at).toISOString(), item: { id: sandboxIds.seat }, buyer: { email: 'launch@example.test' } } });
    const r = await worker.fetch(new Request('https://jonmac.ai/clone/api/sandbox/purchase', { method: 'POST', body,
      headers: { 'x-webhook-signature': createHmac('sha256', env.COMMAS_SANDBOX_WEBHOOK_SECRET).update(body).digest('hex') } }), env);
    assert.equal(r.status, 200, label);
    const session = sql.prepare('SELECT session_at, session_label FROM clone_sandbox_webinar_sessions WHERE transaction_ref = ?').get(ref);
    assert.equal(session.session_at, FIRST, label);
    const steps = Object.fromEntries(sql.prepare('SELECT step, scheduled_at, state FROM clone_sandbox_webinar_steps WHERE transaction_ref = ?').all(ref).map(s => [s.step, s]));
    if (label === 'oct20') {
      assert.equal(steps.E2.scheduled_at, '2026-10-21T23:00:00.000Z'); assert.notEqual(steps.E2.state, 'skipped');
      assert.equal(steps.E3.scheduled_at, '2026-10-22T13:00:00.000Z'); assert.notEqual(steps.E3.state, 'skipped');
    } else {
      assert.equal(steps.E2.state, 'skipped'); assert.equal(steps.E3.state, 'skipped');
    }
    mock.timers.reset();
  }
});
