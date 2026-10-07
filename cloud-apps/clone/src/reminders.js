import { isSandbox, paymentConfig } from './payment-config.js';
import { assignSession, escapeHtml, reminderMessage, reminderPlan } from './reminder-plan.js';

const DAY = 24 * 60 * 60 * 1000;
const LOCK = 5 * 60 * 1000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const referencePattern = /^[A-Za-z0-9_-]{3,100}$/;
const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();

export function verifiedSeat(payload, env) {
  const d = payload?.data;
  const email = String(d?.buyer?.email || '').trim().toLowerCase();
  const transaction_ref = String(d?.transaction_history_id || d?.payment_id || '');
  if (payload?.type !== 'payment.succeeded' || d?.status !== 'succeeded' ||
      d?.item?.id !== paymentConfig(env).seat || Number(d?.amount) !== 47 ||
      Number(d?.quantity ?? 1) !== 1 || d?.currency !== 'USD' ||
      !emailPattern.test(email) || !referencePattern.test(transaction_ref) ||
      !Number.isFinite(Date.parse(d?.created_at)) || Date.parse(d.created_at) > Date.now() + 300000) return null;
  return { transaction_ref, payment_ref: String(d.payment_id || transaction_ref), email };
}

async function resend(env, path, init = {}) {
  if (!env.RESEND_API_KEY) throw new Error('resend_unconfigured');
  const response = await fetch('https://api.resend.com' + path, {
    ...init, headers: { authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function optedOut(db, email) {
  return !!(await first(db, 'SELECT unsubscribed FROM clone_webinar_preferences WHERE email = ?', email))?.unsubscribed;
}

async function stopSession(env, session) {
  const db = env.CLONE_UPSELLS;
  await run(db, "UPDATE clone_webinar_sessions SET state = 'cancelled', complete = 0 WHERE transaction_ref = ?", session.transaction_ref);
  let needsReview = false, pendingFailure = false;
  const uncertain = await rows(db, "SELECT * FROM clone_webinar_steps WHERE transaction_ref = ? AND attempted_at IS NOT NULL AND email_id IS NULL AND scheduled_at IS NOT NULL AND state != 'cancelled'", session.transaction_ref);
  for (const step of uncertain) {
    // Recover a lost scheduling response while the original idempotency key is valid.
    // Never recreate an immediate/past email during refund or unsubscribe handling.
    if (Date.now() - step.attempted_at >= DAY - 60000 || Date.parse(step.scheduled_at) <= Date.now() + 60000) {
      await run(db, "UPDATE clone_webinar_steps SET state = 'unknown' WHERE transaction_ref = ? AND step = ?", session.transaction_ref, step.step);
      needsReview = true;
      continue;
    }
    try {
      const recovered = await resend(env, '/emails', { method: 'POST',
        headers: { 'Idempotency-Key': `${session.transaction_ref}-${step.step}` }, body: step.payload });
      if (!recovered.response.ok || !recovered.body?.id) throw new Error('reminder_cancel_recovery_failed');
      await run(db, "UPDATE clone_webinar_steps SET email_id = ?, state = 'submitted' WHERE transaction_ref = ? AND step = ?", recovered.body.id, session.transaction_ref, step.step);
    } catch { pendingFailure = true; }
  }
  const steps = await rows(db, "SELECT * FROM clone_webinar_steps WHERE transaction_ref = ? AND email_id IS NOT NULL AND state != 'cancelled' AND step != 'event'", session.transaction_ref);
  for (const step of steps) {
    // Delivered/immediate emails cannot be recalled. Retry actual cancellation failures.
    if (!step.scheduled_at) continue;
    try {
      const result = await resend(env, '/emails/' + encodeURIComponent(step.email_id) + '/cancel', { method: 'POST' });
      if (!result.response.ok) {
        const status = await resend(env, '/emails/' + encodeURIComponent(step.email_id));
        if (!status.response.ok || !['canceled', 'cancelled', 'sent', 'delivered', 'bounced', 'failed', 'suppressed'].includes(status.body?.last_event)) {
          throw new Error('reminder_cancel_failed');
        }
      }
      await run(db, "UPDATE clone_webinar_steps SET state = 'cancelled' WHERE transaction_ref = ? AND step = ?", session.transaction_ref, step.step);
    } catch { pendingFailure = true; }
  }
  if (pendingFailure) throw new Error('reminder_cancel_failed');
  if (needsReview) {
    await run(db, 'UPDATE clone_webinar_sessions SET complete = 2 WHERE transaction_ref = ?', session.transaction_ref);
    throw new Error('reminder_cancel_needs_reconciliation');
  }
  // A concurrent scheduler will notice the tombstone, save its ID, and cancel it.
  await run(db, 'UPDATE clone_webinar_sessions SET complete = 1 WHERE transaction_ref = ? AND locked_until = 0', session.transaction_ref);
}

async function scheduleSession(env, transactionRef) {
  const db = env.CLONE_UPSELLS;
  let session = await first(db, 'SELECT * FROM clone_webinar_sessions WHERE transaction_ref = ?', transactionRef);
  if (session?.complete === 2) throw new Error('reminder_needs_reconciliation');
  if (!session || session.complete) return;
  if (session.state === 'cancelled' || await optedOut(db, session.email)) return stopSession(env, session);
  if (!session.initialized) await initializeSteps(env, session);
  const lockUntil = Date.now() + LOCK;
  const claimed = await run(db, 'UPDATE clone_webinar_sessions SET locked_until = ? WHERE transaction_ref = ? AND locked_until < ? AND complete = 0 AND state = ?', lockUntil, transactionRef, Date.now(), 'active');
  if (claimed.meta.changes !== 1) throw new Error('reminders_processing');
  try {
    const contact = await resend(env, '/contacts/' + encodeURIComponent(session.email));
    if (contact.response.status !== 404 && !contact.response.ok) throw new Error('contact_lookup_failed');
    if (contact.body?.unsubscribed) {
      await run(db, 'INSERT INTO clone_webinar_preferences(email) VALUES (?) ON CONFLICT(email) DO UPDATE SET unsubscribed = 1', session.email);
      return await stopSession(env, session);
    }
    const steps = await rows(db, 'SELECT * FROM clone_webinar_steps WHERE transaction_ref = ? ORDER BY step', transactionRef);
    for (const step of steps) {
      if (['submitted', 'skipped', 'cancelled'].includes(step.state)) continue;
      session = await first(db, 'SELECT * FROM clone_webinar_sessions WHERE transaction_ref = ?', transactionRef);
      if (session.state !== 'active' || await optedOut(db, session.email)) return await stopSession(env, session);
      // Retrying an uncertain submission reuses the exact stored body and key.
      // After Resend forgets that key, stop for reconciliation rather than duplicate E1.
      if (step.attempted_at && Date.now() - step.attempted_at >= DAY - 60000) {
        await run(db, "UPDATE clone_webinar_steps SET state = 'unknown' WHERE transaction_ref = ? AND step = ?", transactionRef, step.step);
        await run(db, 'UPDATE clone_webinar_sessions SET complete = 2 WHERE transaction_ref = ?', transactionRef);
        throw new Error('reminder_needs_reconciliation');
      }
      // Events have no documented idempotency support. Do not fire an ambiguous
      // event twice and accidentally trigger another automation run.
      if (step.step === 'event' && step.attempted_at) {
        await run(db, "UPDATE clone_webinar_steps SET state = 'unknown' WHERE transaction_ref = ? AND step = 'event'", transactionRef);
        await run(db, 'UPDATE clone_webinar_sessions SET complete = 2 WHERE transaction_ref = ?', transactionRef);
        throw new Error('event_needs_reconciliation');
      }
      if (!step.attempted_at && step.scheduled_at && Date.parse(step.scheduled_at) <= Date.now()) {
        await run(db, "UPDATE clone_webinar_steps SET state = 'skipped' WHERE transaction_ref = ? AND step = ?", transactionRef, step.step);
        continue;
      }
      await run(db, "UPDATE clone_webinar_steps SET attempted_at = COALESCE(attempted_at, ?), state = 'processing' WHERE transaction_ref = ? AND step = ?", Date.now(), transactionRef, step.step);
      const result = await resend(env, step.step === 'event' ? '/events/send' : '/emails', {
        method: 'POST', headers: { 'Idempotency-Key': `${transactionRef}-${step.step}` }, body: step.payload,
      });
      const submittedId = step.step === 'event' ?
        (result.body?.object === 'event' && result.body?.event === 'clone.purchase' ? result.body.event : null) : result.body?.id;
      if (!result.response.ok || !submittedId) {
        // A definitive API rejection created no email, so an expired schedule may be skipped.
        if ([400, 401, 403, 404, 422, 429].includes(result.response.status)) {
          await run(db, "UPDATE clone_webinar_steps SET attempted_at = NULL, state = 'pending' WHERE transaction_ref = ? AND step = ?", transactionRef, step.step);
        }
        throw new Error('reminder_submission_failed');
      }
      await run(db, "UPDATE clone_webinar_steps SET email_id = ?, state = CASE WHEN state = 'cancelled' THEN state ELSE 'submitted' END WHERE transaction_ref = ? AND step = ?", submittedId, transactionRef, step.step);
      const current = await first(db, 'SELECT state FROM clone_webinar_sessions WHERE transaction_ref = ?', transactionRef);
      if (current.state !== 'active' || await optedOut(db, session.email)) return await stopSession(env, session);
      // Stay below the default Resend account rate limit; 429s remain retriable.
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await run(db, 'UPDATE clone_webinar_sessions SET complete = 1 WHERE transaction_ref = ?', transactionRef);
  } finally {
    await run(db, 'UPDATE clone_webinar_sessions SET locked_until = 0 WHERE transaction_ref = ? AND locked_until = ?', transactionRef, lockUntil);
  }
}

export async function purchaseReminders(payload, env) {
  if (isSandbox(env)) return { ignored: true };
  const seat = verifiedSeat(payload, env);
  const refunded = ['refund.created', 'refund.succeeded', 'payment.refunded', 'payment.canceled', 'payment.cancelled'].includes(payload?.type);
  if (!seat && !refunded) return { ignored: true };
  if (!env.CLONE_UPSELLS) throw new Error('reminder_store_unconfigured');
  const db = env.CLONE_UPSELLS;
  if (refunded) {
    const d = payload.data;
    const references = [...new Set([d?.transaction_history_id, d?.payment_id, d?.transaction_id, d?.original_transaction_id].filter(v => referencePattern.test(String(v || ''))).map(String))];
    if (!references.length) throw new Error('refund_missing_transaction');
    for (const ref of references) {
      await run(db, 'INSERT INTO clone_webinar_refunds(transaction_ref) VALUES (?) ON CONFLICT DO NOTHING', ref);
      await run(db, "UPDATE clone_webinar_sessions SET state = 'cancelled', complete = 0 WHERE transaction_ref = ? OR payment_ref = ?", ref, ref);
      for (const session of await rows(db, 'SELECT * FROM clone_webinar_sessions WHERE transaction_ref = ? OR payment_ref = ?', ref, ref)) {
        const raw = await env.CLONE_LEADS.get('lead:' + session.email);
        const lead = raw ? JSON.parse(raw) : { email: session.email };
        if (lead.commas_txn === session.transaction_ref) {
          await env.CLONE_LEADS.put('lead:' + session.email, JSON.stringify({ ...lead, purchased: false, refundedAt: new Date().toISOString() }));
        }
        await stopSession(env, session);
      }
    }
    return { cancelled: true };
  }
  const at = Date.now();
  const assigned = assignSession(at);
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
  const refund = await first(db, 'SELECT transaction_ref FROM clone_webinar_refunds WHERE transaction_ref IN (?, ?)', seat.transaction_ref, seat.payment_ref);
  await run(db, `INSERT INTO clone_webinar_sessions
    (transaction_ref, payment_ref, email, purchased_at, session_at, session_label, unsubscribe_token, state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(transaction_ref) DO NOTHING`,
  seat.transaction_ref, seat.payment_ref, seat.email, at, assigned.session_at, assigned.session_label, token, refund ? 'cancelled' : 'active');
  const session = await first(db, 'SELECT * FROM clone_webinar_sessions WHERE transaction_ref = ?', seat.transaction_ref);
  if (session.email !== seat.email) throw new Error('reminder_identity_mismatch');
  // Check again to cover a refund delivered during the initial insert.
  if (await first(db, 'SELECT transaction_ref FROM clone_webinar_refunds WHERE transaction_ref IN (?, ?)', seat.transaction_ref, seat.payment_ref)) {
    await run(db, "UPDATE clone_webinar_sessions SET state = 'cancelled', complete = 0 WHERE transaction_ref = ?", seat.transaction_ref);
    await stopSession(env, session);
    return { cancelled: true };
  }
  if (session.state !== 'active') return { cancelled: true };
  const raw = await env.CLONE_LEADS.get('lead:' + seat.email);
  const lead = raw ? JSON.parse(raw) : { email: seat.email };
  await env.CLONE_LEADS.put('lead:' + seat.email, JSON.stringify({ ...lead, purchased: true,
    purchasedAt: new Date(session.purchased_at).toISOString(), commas_txn: session.transaction_ref,
    session_at: session.session_at, session_label: session.session_label }));
  await initializeSteps(env, session);
  await scheduleSession(env, session.transaction_ref);
  return { scheduled: true };
}

async function initializeSteps(env, session) {
  const db = env.CLONE_UPSELLS;
  for (const plan of reminderPlan(session, env)) {
    await run(db, `INSERT INTO clone_webinar_steps(transaction_ref, step, scheduled_at, payload, state)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(transaction_ref, step) DO NOTHING`,
    session.transaction_ref, plan.step, plan.scheduled_at, JSON.stringify(reminderMessage(session, plan, env)), plan.skip ? 'skipped' : 'pending');
  }
  // Resend calls this event data "payload" in its current API contract.
  await run(db, `INSERT INTO clone_webinar_steps(transaction_ref, step, payload)
    VALUES (?, 'event', ?) ON CONFLICT(transaction_ref, step) DO NOTHING`, session.transaction_ref, JSON.stringify({
    event: 'clone.purchase', email: session.email,
    payload: { session_at: session.session_at, session_label: session.session_label, commas_txn: session.transaction_ref },
  }));
  await run(db, 'UPDATE clone_webinar_sessions SET initialized = 1 WHERE transaction_ref = ?', session.transaction_ref);
}

export async function retryReminders(env) {
  if (!env.CLONE_UPSELLS || isSandbox(env)) return;
  const sessions = await rows(env.CLONE_UPSELLS, 'SELECT transaction_ref FROM clone_webinar_sessions WHERE complete = 0 AND locked_until < ? LIMIT 50', Date.now());
  for (const session of sessions) {
    try { await scheduleSession(env, session.transaction_ref); }
    catch { console.error('Clone reminder retry pending; inspect durable step records.'); }
  }
}

export async function unsubscribeReminders(request, env) {
  const token = new URL(request.url).searchParams.get('token');
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex', 'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'" };
  const session = /^[a-f0-9]{64}$/.test(token || '') && env.CLONE_UPSELLS &&
    await first(env.CLONE_UPSELLS, 'SELECT * FROM clone_webinar_sessions WHERE unsubscribe_token = ?', token);
  if (!session) return new Response('This unsubscribe link is invalid.', { status: 404, headers });
  if (request.method === 'GET') return new Response(`<!doctype html><title>Webinar reminders</title><h1>Stop webinar reminders</h1><form method="post" action="/clone/api/reminders/unsubscribe?token=${escapeHtml(token)}"><button>Unsubscribe</button></form>`, { headers });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });
  await run(env.CLONE_UPSELLS, 'INSERT INTO clone_webinar_preferences(email) VALUES (?) ON CONFLICT(email) DO UPDATE SET unsubscribed = 1', session.email);
  await run(env.CLONE_UPSELLS, "UPDATE clone_webinar_sessions SET state = 'cancelled', complete = 0 WHERE email = ?", session.email);
  try {
    for (const buyerSession of await rows(env.CLONE_UPSELLS, 'SELECT * FROM clone_webinar_sessions WHERE email = ?', session.email)) await stopSession(env, buyerSession);
  } catch { return new Response('Your preference is saved. Cancellation is being retried.', { status: 503, headers }); }
  return new Response('<!doctype html><title>Unsubscribed</title><h1>You are unsubscribed from webinar reminders.</h1>', { headers });
}
