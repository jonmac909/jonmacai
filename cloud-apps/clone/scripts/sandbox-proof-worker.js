// Private remote preview only. Never import this entry point in production.
// Uses the existing Resend binding in-place and an isolated QA D1 database.
import worker from '../src/index.js';
import { sandboxEnv } from '../src/sandbox.js';
import { retryReminders } from '../src/reminders.js';

const leads = new Map();
const json = (v, status = 200) => Response.json(v, { status, headers: { 'cache-control': 'no-store' } });
export default {
  async fetch(request, bindings, ctx) {
    if (!bindings.JON6_PROOF_ACCESS || request.headers.get('x-test-access') !== bindings.JON6_PROOF_ACCESS) return json({ error: 'forbidden' }, 403);
    if (!/^SIM-JON6-[a-f0-9]{20}$/.test(bindings.JON6_PROOF_RUN || '')) return json({ error: 'unconfigured' }, 503);
    const env = { ...bindings, CLONE_LEADS: { async get(k) { return leads.get(k) || null; }, async put(k, v) { leads.set(k, v); } } };
    const path = new URL(request.url).pathname;
    if (path === '/clone/api/sandbox/purchase' && request.method === 'POST') {
      let body;
      try { body = await request.clone().json(); } catch { return json({ error: 'bad_json' }, 400); }
      const d = body.data || {};
      const refs = [d.transaction_history_id, d.payment_id, d.original_transaction_id].filter(Boolean);
      if (!refs.length || refs.some(ref => !String(ref).startsWith(env.JON6_PROOF_RUN))) return json({ error: 'wrong_test_run' }, 403);
      return worker.fetch(request, env, ctx); // Real sandbox HMAC and production handler.
    }
    if (path === '/proof/retry' && request.method === 'POST') {
      await retryReminders(sandboxEnv(env)); return json({ ok: true });
    }
    if (path === '/proof/state' || path === '/proof/resend') {
      const sessions = (await env.CLONE_UPSELLS.prepare('SELECT transaction_ref, email, session_at, state, complete FROM clone_sandbox_webinar_sessions').bind().all()).results;
      const steps = (await env.CLONE_UPSELLS.prepare('SELECT transaction_ref, step, email_id, scheduled_at, state FROM clone_sandbox_webinar_steps ORDER BY transaction_ref, step').bind().all()).results;
      const events = (await env.CLONE_UPSELLS.prepare('SELECT event_id AS dedup_key, payload FROM clone_sandbox_whop_events ORDER BY event_id').bind().all()).results;
      const statuses = [];
      if (path === '/proof/resend') for (const step of steps.filter(s => s.email_id && s.step !== 'event')) {
        const response = await fetch('https://api.resend.com/emails/' + encodeURIComponent(step.email_id), {
          headers: { authorization: `Bearer ${env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(15000),
        });
        const data = await response.json().catch(() => ({}));
        statuses.push({ step: step.step, email_id: step.email_id, api_status: response.status,
          to: data.to, scheduled_at: data.scheduled_at, last_event: data.last_event, subject: data.subject });
        await new Promise(resolve => setTimeout(resolve, 600));
      }
      return json({ run: env.JON6_PROOF_RUN, resend_configured: !!env.RESEND_API_KEY, sessions, steps,
        events: events.map(e => ({ ...e, payload: JSON.parse(e.payload) })), statuses });
    }
    return json({ error: 'not_found' }, 404);
  },
};
