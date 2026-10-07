import { isSandbox } from './payment-config.js';
import { CONSENT_VERSION, normalizePhone } from './readiness.js';

// No transports are installed and no Worker route/cron invokes this interface.
// A future provider must implement send({from,to,text,idempotencyKey}) and handle
// inbound confirmation, STOP/HELP and other revocation requests before activation.
export function createSmsAdapter(env, providers = {}) {
  const provider = providers[env.SMS_PROVIDER];
  const sender = normalizePhone(env.SMS_SENDER);
  const enabled = !isSandbox(env) && env.SMS_ENABLED === 'true' && sender &&
    env.SMS_PROVIDER && typeof provider?.send === 'function';
  return {
    enabled: Boolean(enabled),
    async sendReminder({ lead, text, idempotencyKey }) {
      if (!enabled) return { sent: false, reason: 'disabled' };
      if (lead?.smsConsent !== true || lead.smsConsentVersion !== CONSENT_VERSION ||
          lead.smsConsentStatus !== 'confirmed' || !Number.isFinite(Date.parse(lead.smsConsentConfirmedAt)) ||
          lead.smsConsentRevokedAt || normalizePhone(lead.phone) !== lead.smsConsentPhone || !lead.smsConsentPhone) {
        return { sent: false, reason: 'unconfirmed_consent' };
      }
      if (typeof text !== 'string' || !text.trim() || text.length > 480 ||
          /https?:|www\.|zoom\.(?:us|com)|\b[a-z0-9-]+\.(?:com|net|io|ai|org|us)\b/i.test(text) ||
          !/\bSTOP\b/.test(text) || !/^[A-Za-z0-9:_-]{1,150}$/.test(idempotencyKey || '')) {
        return { sent: false, reason: 'invalid_reminder' };
      }
      await provider.send({ from: sender, to: lead.smsConsentPhone, text, idempotencyKey });
      return { sent: true };
    },
  };
}

export function smsReminderPlan({ registeredAt, sessionAt, attended }) {
  const registered = Date.parse(registeredAt), session = Date.parse(sessionAt);
  if (!Number.isFinite(registered) || !Number.isFinite(session) || registered >= session) return [];
  const hour = 3600000;
  const reminders = [
    ['instant', registered, 'Jon Mac: You are registered for The Clone Method. Check your email for the session details.'],
    ['day_before', session - 24 * hour, 'Jon Mac: The Clone Method is tomorrow. Your session details are in your email.'],
    ['morning', session - 10 * hour, 'Jon Mac: The Clone Method is tonight. Plan to join from a computer; check your email for details.'],
    ['hour_before', session - hour, 'Jon Mac: The Clone Method starts in an hour. Your access details are in your email.'],
    ['ten_before', session - 10 * 60000, 'Jon Mac: The Clone Method starts in 10 minutes. Open your email on your computer for access.'],
    ['live', session, 'Jon Mac: The Clone Method is starting. Check your email on your computer for access.'],
    ...(attended === false ? [['help', session + 10 * 60000, 'Jon Mac: Having trouble joining The Clone Method? Reply here for help.']] : []),
  ];
  return reminders.filter(([step, at]) => step === 'instant' || at > registered)
    .map(([step, at, text]) => ({ step, scheduledAt: new Date(at).toISOString(), text: text + ' Reply STOP to opt out, HELP for help.' }));
}
