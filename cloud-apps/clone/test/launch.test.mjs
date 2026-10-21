import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import worker from '../src/index.js';
import { sandboxSettings, sandboxIds } from './sandbox-fixture.mjs';
import { assignSession, reminderPlan, SESSION_AT, SALES_CLOSE } from '../src/reminder-plan.js';
import { retryReminders } from '../src/reminders.js';
import { sandboxEnv } from '../src/sandbox.js';
import '../public/schedule.js';

// One live session only: Thu Oct 29 2026, 7 PM ET. Sales close at 6:45 PM ET.
const SESSION = '2026-10-29T23:00:00.000Z';
const oct20 = Date.parse('2026-10-20T14:00:00Z');       // Tue Oct 20, 10 AM ET
const oct29at4pm = Date.parse('2026-10-29T20:00:00Z');  // Thu Oct 29, 4 PM ET
const oct29at650pm = Date.parse('2026-10-29T22:50:00Z'); // Thu Oct 29, 6:50 PM ET, after close
const join = 'https://us02web.zoom.us/j/123456789?pwd=mock';
const replay = 'https://jonmac.ai/clone/replay-mock';

test('every buyer before 6:45 PM ET Oct 29 gets the single Oct 29 session; there is no later session', () => {
  assert.equal(new Date(SESSION_AT).toISOString(), SESSION);
  assert.equal(new Date(SALES_CLOSE).toISOString(), '2026-10-29T22:45:00.000Z');
  const page = globalThis.CloneSchedule;
  assert.equal(page.session.getTime(), SESSION_AT, 'page and worker share the session time');
  assert.equal(page.salesClose.getTime(), SALES_CLOSE, 'page and worker share the sales close');
  for (const at of [Date.parse('2026-10-15T18:00:00Z'), oct20, Date.parse('2026-10-22T23:30:00Z'), oct29at4pm, SALES_CLOSE - 1]) {
    const assigned = assignSession(at);
    assert.equal(assigned.session_at, SESSION, new Date(at).toISOString());
    assert.equal(assigned.closed, undefined);
    assert.equal(page.nextSession(new Date(at)).toISOString(), SESSION, 'page countdown');
    assert.equal(page.isClosed(new Date(at)), false);
  }
  assert.match(assignSession(oct20).session_label, /Thursday, October 29, 2026 at 7:00 PM EDT/);
  for (const at of [SALES_CLOSE, oct29at650pm, Date.parse('2026-10-30T15:00:00Z'), Date.parse('2026-11-05T23:30:00Z')]) {
    assert.deepEqual(assignSession(at), { ...assignSession(oct20), closed: true }, 'no Oct 30 or later session');
    assert.equal(page.isClosed(new Date(at)), true);
  }
  assert.equal(page.phase(new Date(SESSION_AT - 1)), 'before');
  assert.equal(page.phase(new Date(SESSION_AT)), 'live');
  assert.equal(page.phase(new Date(SESSION_AT + 2 * 3600000)), 'ended');
  assert.equal(page.calendarDates(page.nextSession()), '20261029T190000/20261029T210000');
  assert.throws(() => assignSession('invalid'));
});

test('an Oct 20 buyer gets the day-before email on Oct 28 and the morning-of email on Oct 29; late buyers get only L1', () => {
  const env = { CLONE_PAYMENT_MODE: 'production', CLONE_ZOOM_JOIN_URL: join, CLONE_REPLAY_URL: replay };
  const steps = Object.fromEntries(reminderPlan({ transaction_ref: 'T', purchased_at: oct20, session_at: SESSION }, env, oct20).map(s => [s.step, s]));
  assert.deepEqual(Object.keys(steps), ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']);
  assert.equal(steps.E2.scheduled_at, '2026-10-28T23:00:00.000Z'); assert.equal(steps.E2.skip, null);
  assert.equal(steps.E3.scheduled_at, '2026-10-29T13:00:00.000Z'); assert.equal(steps.E3.skip, null);
  assert.equal(steps.E8.scheduled_at, '2026-10-30T13:00:00.000Z');
  assert.ok(Object.values(steps).every(s => s.awaiting === null));
  const dayOf = Object.fromEntries(reminderPlan({ transaction_ref: 'T', purchased_at: oct29at4pm, session_at: SESSION }, env, oct29at4pm).map(s => [s.step, s]));
  assert.equal(dayOf.E2.skip, 'within_24_hours'); assert.equal(dayOf.E3.skip, 'past'); assert.equal(dayOf.E4.skip, null);
  const late = reminderPlan({ transaction_ref: 'T', purchased_at: oct29at650pm, session_at: SESSION }, env, oct29at650pm);
  assert.deepEqual(late.map(s => [s.step, s.scheduled_at, s.skip, s.awaiting]), [['L1', null, null, null]]);
  const lateNoReplay = reminderPlan({ transaction_ref: 'T', purchased_at: oct29at650pm, session_at: SESSION }, {}, oct29at650pm);
  assert.equal(lateNoReplay[0].awaiting, 'missing_replay_url');
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
  return { sql, env, leads };
}

function mockResend(t) {
  const saved = globalThis.fetch, sent = [];
  t.after(() => { globalThis.fetch = saved; mock.timers.reset(); });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url); assert.equal(u.origin, 'https://api.resend.com');
    sent.push({ path: u.pathname, body: init.body ? JSON.parse(init.body) : null });
    if (u.pathname.startsWith('/contacts/')) return Response.json({}, { status: 404 });
    if (u.pathname === '/emails') return Response.json({ id: 'mock-' + Math.random() });
    return Response.json({});
  };
  return sent;
}

async function sandboxBuy(env, ref, at) {
  const body = JSON.stringify({ type: 'payment.succeeded', data: { transaction_history_id: ref, payment_id: ref, status: 'succeeded', amount: 47,
    quantity: 1, currency: 'USD', created_at: new Date(at).toISOString(), item: { id: sandboxIds.seat }, buyer: { email: 'launch@example.test' } } });
  return worker.fetch(new Request('https://jonmac.ai/clone/api/sandbox/purchase', { method: 'POST', body,
    headers: { 'x-webhook-signature': createHmac('sha256', env.COMMAS_SANDBOX_WEBHOOK_SECRET).update(body).digest('hex') } }), env);
}
const stepsOf = (sql, ref) => Object.fromEntries(sql.prepare('SELECT step, scheduled_at, state, payload FROM clone_sandbox_webinar_steps WHERE transaction_ref = ?').all(ref).map(s => [s.step, s]));

test('sandbox: Oct 20 and Oct 29 4 PM ET buyers are booked into Oct 29 with emails on the right days', async t => {
  const sent = mockResend(t);
  for (const [label, at] of [['oct20', oct20], ['oct29-4pm', oct29at4pm]]) {
    mock.timers.enable({ apis: ['Date'], now: at });
    const { env, sql } = fixture(), ref = 'SIM-LAUNCH-' + label;
    Object.assign(env, { CLONE_ZOOM_JOIN_URL: join, CLONE_REPLAY_URL: replay });
    assert.equal((await sandboxBuy(env, ref, at)).status, 200, label);
    const session = sql.prepare('SELECT session_at FROM clone_sandbox_webinar_sessions WHERE transaction_ref = ?').get(ref);
    assert.equal(session.session_at, SESSION, label);
    const steps = stepsOf(sql, ref);
    assert.equal(steps.L1, undefined);
    if (label === 'oct20') {
      assert.equal(steps.E2.scheduled_at, '2026-10-28T23:00:00.000Z'); assert.equal(steps.E2.state, 'submitted');
      assert.equal(steps.E3.scheduled_at, '2026-10-29T13:00:00.000Z'); assert.equal(steps.E3.state, 'submitted');
    } else {
      assert.equal(steps.E2.state, 'skipped'); assert.equal(steps.E3.state, 'skipped'); assert.equal(steps.E4.state, 'submitted');
    }
    mock.timers.reset();
  }
  assert.ok(sent.filter(s => s.path === '/emails').every(s => s.body.to === 'delivered@resend.dev'));
});

test('sandbox: a buyer after sales close gets only the recording email, held until the replay link is set', async t => {
  const sent = mockResend(t);
  mock.timers.enable({ apis: ['Date'], now: oct29at650pm });
  const { env, sql, leads } = fixture(), ref = 'SIM-LATE';
  assert.equal((await sandboxBuy(env, ref, oct29at650pm)).status, 200);
  const steps = stepsOf(sql, ref);
  assert.deepEqual(Object.keys(steps).sort(), ['L1', 'event']);
  assert.equal(steps.event.state, 'skipped');
  assert.equal(steps.L1.state, 'awaiting_link');
  assert.equal(JSON.parse(leads.get('sandbox:lead:launch@example.test')).late, true);
  assert.equal(sent.filter(s => s.path === '/emails').length, 0);

  // The per-minute retry does not touch Resend while the link is still missing.
  const before = sent.length;
  await retryReminders(sandboxEnv(env));
  assert.equal(sent.length, before);

  env.CLONE_REPLAY_URL = replay;
  await retryReminders(sandboxEnv(env));
  const email = sent.filter(s => s.path === '/emails');
  assert.equal(email.length, 1);
  assert.equal(email[0].body.to, 'delivered@resend.dev');
  assert.match(email[0].body.subject, /Your Clone Method recording/);
  assert.ok(email[0].body.text.includes(replay));
  assert.match(email[0].body.text, /refund your \$47 in full/);
  assert.doesNotMatch(email[0].body.text, /Your live training:/);
  assert.equal(stepsOf(sql, ref).L1.state, 'submitted');
});

test('sandbox: Zoom and replay links set after booking reach the held reminders on the next retry', async t => {
  const sent = mockResend(t);
  mock.timers.enable({ apis: ['Date'], now: oct20 });
  const { env, sql } = fixture(), ref = 'SIM-LINKS';
  assert.equal((await sandboxBuy(env, ref, oct20)).status, 200);
  let steps = stepsOf(sql, ref);
  for (const step of ['E4', 'E5', 'E6', 'E7', 'E8']) assert.equal(steps[step].state, 'awaiting_link', step);
  for (const step of ['E1', 'E2', 'E3']) assert.equal(steps[step].state, 'submitted', step);
  assert.equal(sql.prepare('SELECT complete FROM clone_sandbox_webinar_sessions WHERE transaction_ref = ?').get(ref).complete, 0);
  const before = sent.length;
  await retryReminders(sandboxEnv(env));
  assert.equal(sent.length, before, 'no Resend calls while links are blank');

  Object.assign(env, { CLONE_ZOOM_JOIN_URL: join, CLONE_REPLAY_URL: replay });
  await retryReminders(sandboxEnv(env));
  steps = stepsOf(sql, ref);
  for (const step of ['E4', 'E5', 'E6', 'E7']) {
    assert.equal(steps[step].state, 'submitted', step);
    assert.ok(JSON.parse(steps[step].payload).text.includes(join), step);
  }
  assert.equal(steps.E8.state, 'submitted');
  assert.ok(JSON.parse(steps.E8.payload).text.includes(replay));
  assert.equal(JSON.parse(steps.E8.payload).scheduled_at, '2026-10-30T13:00:00.000Z');
  assert.equal(sql.prepare('SELECT complete FROM clone_sandbox_webinar_sessions WHERE transaction_ref = ?').get(ref).complete, 1);
});

test('sandbox: a payment made at 6:44 PM ET but delivered after close still gets the live seat', async t => {
  mockResend(t);
  const paid = Date.parse('2026-10-29T22:44:00Z');
  mock.timers.enable({ apis: ['Date'], now: oct29at650pm });
  const { env, sql, leads } = fixture(), ref = 'SIM-SLOW-WEBHOOK';
  Object.assign(env, { CLONE_ZOOM_JOIN_URL: join, CLONE_REPLAY_URL: replay });
  assert.equal((await sandboxBuy(env, ref, paid)).status, 200);
  const steps = stepsOf(sql, ref);
  assert.equal(steps.L1, undefined, 'paid in time: no late-buyer email');
  assert.equal(steps.E6.state, 'submitted');
  assert.equal(JSON.parse(leads.get('sandbox:lead:launch@example.test')).late, undefined);
});

test('after sales close: no checkout session and no sign-ups (no waitlist)', async t => {
  const sent = mockResend(t);
  const origin = 'https://jonmac.ai';
  const lead = email => new Request(origin + '/clone/api/lead', { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Wait List', email }) });
  const { env, leads } = fixture();
  env.RESEND_AUDIENCE_ID = 'mock-audience';

  mock.timers.enable({ apis: ['Date'], now: oct29at4pm });
  assert.deepEqual(await (await worker.fetch(lead('open@example.test'), env)).json(), { ok: true });
  assert.ok(sent.some(s => s.path === '/emails'), 'seat email while open');
  mock.timers.reset();

  mock.timers.enable({ apis: ['Date'], now: oct29at650pm });
  const checkout = await worker.fetch(new Request(origin + '/clone/api/checkout-session', { method: 'POST', headers: { origin } }), env);
  assert.equal(checkout.status, 410);
  assert.deepEqual(await checkout.json(), { ok: false, error: 'sales_closed' });
  sent.length = 0;
  const late = await worker.fetch(lead('late@example.test'), env);
  assert.equal(late.status, 410);
  assert.deepEqual(await late.json(), { ok: false, error: 'sales_closed' });
  assert.deepEqual(sent, [], 'no audience, seat email or lead automation after close');
  assert.equal(leads.get('lead:late@example.test'), undefined);
});
