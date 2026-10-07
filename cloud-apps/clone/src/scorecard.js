import { isSandbox, OFFERS } from './payment-config.js';
import '../public/schedule.js';

export function sessionDate(at = Date.now()) {
  return easternDate(globalThis.CloneSchedule.nextSession(new Date(at)));
}
function easternDate(at) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at));
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key).value).join('-');
}
export function validSessionDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function enabled(env) { return !isSandbox(env) && env.CLONE_SCORECARD_ENABLED === 'true' && env.CLONE_UPSELLS; }
async function record(env, event) {
  await env.CLONE_UPSELLS.prepare(`INSERT INTO clone_session_events
    (event_id, session_date, kind, offer, amount_cents, transaction_ref, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING`)
    .bind(event.id, event.session, event.kind, event.offer || null, event.cents || 0, event.transaction || null, event.at).run();
}
export async function recordVisit(env, id, at = Date.now()) {
  if (!enabled(env)) return false;
  if (!/^[a-f0-9-]{36}$/i.test(id || '')) throw new Error('invalid visit');
  await record(env, { id: 'visit:' + id, session: sessionDate(at), kind: 'visit', at });
  return true;
}

// Only called after HMAC verification. The public visit endpoint cannot record money.
export async function recordScorecardPayment(payload, env, lead = {}) {
  if (!enabled(env)) return;
  const data = payload?.data;
  const offer = data?.item?.id === 'nmGzE' ? 'seat' :
    Object.keys(OFFERS).find(name => OFFERS[name].service === data?.item?.id);
  const cents = Math.round(Number(data?.amount) * 100);
  const at = Date.parse(data?.created_at || payload?.created_at);
  if (!offer || data?.amount == null || !Number.isSafeInteger(cents) || cents <= 0 ||
      String(data.currency || 'USD').toUpperCase() !== 'USD' || !Number.isFinite(at)) return;
  if (payload.type === 'payment.succeeded') {
    const transaction = String(data.transaction_history_id || data.payment_id || '');
    if ((data.status && data.status !== 'succeeded') || !/^[A-Za-z0-9_-]{3,100}$/.test(transaction) ||
        (Array.isArray(data.refunds) && data.refunds.length)) return;
    const hinted = Number.isFinite(Date.parse(lead.session_at)) ? easternDate(lead.session_at) :
      data.api_metadata?.data?.clone_session_date || lead.sessionDate;
    // Preserve checkout attribution only near the payment; renewals belong to their own date.
    const session = validSessionDate(hinted) && Math.abs(Date.parse(hinted) - at) < 5 * 86400000 ? hinted : sessionDate(at);
    await record(env, { id: 'payment:' + transaction, session, kind: 'payment', offer, cents, transaction, at });
  } else if (payload.type === 'refund.created') {
    if (data.status !== 'success' || !/^[A-Za-z0-9_-]{3,100}$/.test(data.refund_id || '')) return;
    const transaction = String(data.refund_transaction_id || '');
    const original = await env.CLONE_UPSELLS.prepare(`SELECT session_date FROM clone_session_events
      WHERE kind = 'payment' AND transaction_ref = ?`).bind(transaction).first();
    // Commas refund hashids and public order IDs differ. Never guess a session
    // from a customer's latest visit or silently attribute a refund to today's room.
    await record(env, { id: 'refund:' + data.refund_id, session: original?.session_date || null,
      kind: 'refund', offer, cents, transaction, at });
  }
}
