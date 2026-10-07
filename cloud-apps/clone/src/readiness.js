import { isSandbox } from './payment-config.js';

export const CONSENT_VERSION = 'clone-sms-2026-10-07-v1';
export const FAQ_KEYS = ['followers', 'camera', 'shop', 'time'];

export function normalizePhone(raw) {
  const text = String(raw || '').trim();
  let digits = text.replace(/\D/g, '');
  if (/^(\+|00)/.test(text)) {
    if (text.startsWith('00')) digits = digits.slice(2);
    return /^[1-9]\d{7,14}$/.test(digits) ? '+' + digits : '';
  }
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? '+1' + digits : '';
}

export function consentEvidence(data, at = Date.now()) {
  const phone = normalizePhone(data.phone);
  const optedIn = data.smsConsent === true;
  if ((optedIn || String(data.phone || '').trim()) && !phone) throw new Error('invalid phone');
  if (optedIn && data.smsConsentVersion !== CONSENT_VERSION) throw new Error('consent version required');
  return {
    phone, smsConsent: optedIn, smsConsentAt: optedIn ? new Date(at).toISOString() : null,
    smsConsentVersion: optedIn ? CONSENT_VERSION : null,
    smsConsentPage: '/clone/', smsConsentPhone: optedIn ? phone : null,
    // Checkbox consent never stands in for a provider's double opt-in confirmation.
    smsConsentStatus: optedIn ? 'pending_confirmation' : 'not_requested',
  };
}

export function readinessConfig(env) {
  let configured = {};
  try { configured = JSON.parse(env.CLONE_FAQ_VIDEO_IDS || '{}'); } catch {}
  const faqVideos = Object.fromEntries(FAQ_KEYS.map(key => [key,
    typeof configured?.[key] === 'string' && /^[A-Za-z0-9_-]{11}$/.test(configured[key]) ? configured[key] : null,
  ]));
  return { consentVersion: CONSENT_VERSION, faqVideos, smsSendingEnabled: false,
    metricsEnabled: !isSandbox(env) && env.CLONE_SCORECARD_ENABLED === 'true',
    version: env.CLONE_VERSION?.id || null, commit: env.CLONE_VERSION?.tag || null };
}
