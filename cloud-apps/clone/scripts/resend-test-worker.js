// Remote-preview entry point only; the production Worker never imports this file.
// Uses the existing jonmac-agency secret binding without extracting its value.
import { assignSession, reminderMessage } from '../src/reminder-plan.js';
import { scheduleSession } from '../src/reminders.js';

const recipient = 'jon@thejonmac.com';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
async function api(env, path) {
  const response = await fetch('https://api.resend.com' + path, {
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, ok: response.ok, data: await response.json().catch(() => null) };
}

export default {
  async fetch(request, env) {
    if (!env.CLONE_EMAIL_TEST_ACCESS_TOKEN || request.headers.get('x-test-access') !== env.CLONE_EMAIL_TEST_ACCESS_TOKEN) return json({ error: 'forbidden' }, 403);
    const runId = env.CLONE_EMAIL_TEST_RUN_ID;
    if (!/^test_user_JON17_[a-f0-9]{32}$/.test(runId || '') || !env.RESEND_API_KEY || !env.CLONE_UPSELLS) return json({ error: 'test_unconfigured' }, 503);
    const path = new URL(request.url).pathname;
    if (path === '/preflight' && request.method === 'GET') {
      const automations = await api(env, '/automations?limit=100');
      const clone = [];
      for (const item of automations.data?.data || []) {
        if (!/clone/i.test(item.name)) continue;
        const detail = await api(env, '/automations/' + encodeURIComponent(item.id));
        clone.push({ id: item.id, name: item.name, status: item.status,
          steps: (detail.data?.steps || []).filter(s => ['trigger', 'wait_for_event', 'delay'].includes(s.type)) });
      }
      const event = await api(env, '/events/clone.purchase');
      return json({ recipient, test_user: runId, automations_status: automations.status,
        clone_automations: clone, purchase_event_status: event.status, purchase_event_schema: event.data?.schema });
    }
    if (path === '/send' && request.method === 'POST') {
      const now = Date.now(), assigned = assignSession(now);
      const token = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
      await env.CLONE_UPSELLS.prepare(`INSERT INTO clone_webinar_sessions
        (transaction_ref, payment_ref, email, purchased_at, session_at, session_label, unsubscribe_token, initialized)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(transaction_ref) DO NOTHING`).bind(
      runId, runId, `${runId}@example.invalid`, now, assigned.session_at, assigned.session_label, token).run();
      const session = await env.CLONE_UPSELLS.prepare('SELECT * FROM clone_webinar_sessions WHERE transaction_ref = ?').bind(runId).first();
      const scheduledAt = new Date(session.purchased_at + 3 * 60 * 1000).toISOString();
      const payload = reminderMessage(session, { step: 'E1', scheduled_at: scheduledAt }, env);
      payload.to = recipient;
      payload.subject = '[TEST] ' + payload.subject + ' — Clone webinar reminder';
      payload.tags.push({ name: 'test_user', value: runId });
      await env.CLONE_UPSELLS.prepare(`INSERT INTO clone_webinar_steps(transaction_ref, step, scheduled_at, payload)
        VALUES (?, 'E1', ?, ?) ON CONFLICT(transaction_ref, step) DO NOTHING`).bind(runId, scheduledAt, JSON.stringify(payload)).run();
      try { await scheduleSession(env, runId); }
      catch { return json({ error: 'test_submission_pending', test_user: runId }, 503); }
      // Only E1 exists. No purchase/lead event, no Whop conversion, no other recipient.
      const step = await env.CLONE_UPSELLS.prepare("SELECT email_id, scheduled_at, state FROM clone_webinar_steps WHERE transaction_ref = ? AND step = 'E1'").bind(runId).first();
      return json({ recipient, test_user: session.email, transaction_ref: runId, ...step });
    }
    if (path === '/status' && request.method === 'GET') {
      const step = await env.CLONE_UPSELLS.prepare("SELECT email_id, scheduled_at, state FROM clone_webinar_steps WHERE transaction_ref = ? AND step = 'E1'").bind(runId).first();
      if (!step?.email_id) return json({ error: 'test_not_submitted', ...step }, 404);
      const result = await api(env, '/emails/' + encodeURIComponent(step.email_id));
      return json({ recipient, transaction_ref: runId, email_id: step.email_id,
        api_status: result.status, scheduled_at: result.data?.scheduled_at,
        last_event: result.data?.last_event, to: result.data?.to, subject: result.data?.subject }, result.ok ? 200 : 502);
    }
    return json({ error: 'not_found' }, 404);
  },
};
