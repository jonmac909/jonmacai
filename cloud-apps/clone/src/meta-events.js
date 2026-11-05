// Meta Conversions API for the Clone funnel (pattern: ViralView lib/conversions.ts).
// One Purchase per Commas sale at the actual amount, with hashed email/phone and
// fbp/fbc. The event_id matches the browser pixel's eventID so Meta deduplicates.
// OFF unless META_PIXEL_ID and META_CAPI_TOKEN are both set. Sandbox only logs.
import { isSandbox, paymentConfig } from './payment-config.js';

const MAX_AGE_MS = 7 * 24 * 3600 * 1000; // Meta accepts events up to 7 days old
const enc = new TextEncoder();
async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
const FBP = /^fb\.[0-9]\.[0-9]{10,13}\.[0-9]{1,24}$/, FBC = /^fb\.[0-9]\.[0-9]{10,13}\.[A-Za-z0-9_-]{8,500}$/, FBCLID = /^[A-Za-z0-9_-]{8,500}$/;

// Page URL without query or fragment (never forwards tokens or personal data).
function cleanUrl(value) {
  try { const u = new URL(value); return u.hostname === 'jonmac.ai' ? u.origin + u.pathname : 'https://jonmac.ai/clone/'; }
  catch { return 'https://jonmac.ai/clone/'; }
}
export function metaConfigured(env) { return !!(env.META_PIXEL_ID && /^[0-9]{5,20}$/.test(env.META_PIXEL_ID) && env.META_CAPI_TOKEN); }
function active(env) { return isSandbox(env) || metaConfigured(env); }

// Browser identifiers captured at opt-in (cookies set by the pixel, or the ad click ID).
export function metaAttribution(data, request) {
  const cookies = Object.fromEntries((request?.headers.get('cookie') || '').split(';').map(c => c.trim().split('=')).filter(p => p.length === 2));
  const fbp = FBP.test(cookies._fbp || '') ? cookies._fbp : null;
  const fbclid = [data?.fbclid, data?.utm?.fbclid].find(v => FBCLID.test(String(v || ''))) || null;
  const fbc = FBC.test(cookies._fbc || '') ? cookies._fbc : fbclid ? `fb.1.${Date.now()}.${fbclid}` : null;
  return { fbp, fbc, ip: request?.headers.get('cf-connecting-ip') || null, ua: (request?.headers.get('user-agent') || '').slice(0, 400) || null };
}

// Seat event ID = our checkout reference (the browser knows it); one-click = charge ID.
export function metaPurchaseEventId(kind, ref) { return 'clone_purchase_' + kind + '_' + ref; }

export async function metaPurchase(env, { eventId, value, email, phone, pageUrl, at, lead = {} }) {
  if (!active(env) || !/^clone_purchase_[A-Za-z0-9_-]{3,200}$/.test(eventId || '') || !(Number(value) > 0)) return null;
  const meta = lead.meta || {}, user = {};
  const mail = String(email || '').trim().toLowerCase(), digits = String(phone || lead.phone || '').replace(/\D/g, '');
  if (mail) user.em = [await sha256(mail)];
  if (digits.length >= 10) user.ph = [await sha256(digits.length === 10 ? '1' + digits : digits)];
  if (meta.fbp) user.fbp = meta.fbp;
  if (meta.fbc) user.fbc = meta.fbc;
  if (meta.ip) user.client_ip_address = meta.ip;
  if (meta.ua) user.client_user_agent = meta.ua;
  if (!user.em && !user.fbc && !user.fbp) return null;
  return { data: [{ event_name: 'Purchase', event_time: Math.floor((at || Date.now()) / 1000), event_id: eventId, action_source: 'website',
    event_source_url: cleanUrl(pageUrl), user_data: user, custom_data: { currency: 'USD', value: Number(value) } }] };
}

// Exactly once per event_id (D1 primary key), retried by the cron flush like Whop.
export async function enqueueMetaEvent(env, eventId, body) {
  if (!body || !env.CLONE_UPSELLS) return false;
  if (isSandbox(env)) {
    const saved = await env.CLONE_UPSELLS.prepare(`INSERT INTO clone_sandbox_meta_events (event_id, payload, created_at) VALUES (?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING`).bind(eventId, JSON.stringify(body), Date.now()).run();
    if (saved.meta?.changes === 1) console.info(JSON.stringify({ mode: 'sandbox-log-only', meta_event_id: eventId, payload: body }));
    return false; // never sent from sandbox
  }
  if (!metaConfigured(env)) return false;
  const saved = await env.CLONE_UPSELLS.prepare(`INSERT INTO clone_meta_events (event_id, payload, created_at) VALUES (?, ?, ?)
    ON CONFLICT(event_id) DO NOTHING`).bind(eventId, JSON.stringify(body), Date.now()).run();
  return saved.meta?.changes === 1;
}

export async function deliverMetaEvent(env, eventId) {
  if (isSandbox(env) || !metaConfigured(env)) return false;
  const db = env.CLONE_UPSELLS, now = Date.now(), owner = crypto.randomUUID();
  const claim = await db.prepare(`UPDATE clone_meta_events SET lease_owner = ?, lease_until = ?, attempts = attempts + 1
    WHERE event_id = ? AND sent_at IS NULL AND lease_until < ?`).bind(owner, now + 30000, eventId, now).run();
  if (claim.meta?.changes !== 1) return false;
  const row = await db.prepare('SELECT payload FROM clone_meta_events WHERE event_id = ? AND lease_owner = ?').bind(eventId, owner).first();
  let status = 0, ok = false;
  try {
    const version = /^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION || '') ? env.META_GRAPH_API_VERSION : 'v25.0';
    const response = await fetch(`https://graph.facebook.com/${version}/${env.META_PIXEL_ID}/events`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.META_CAPI_TOKEN}` },
      body: row.payload, signal: AbortSignal.timeout(5000) });
    status = response.status;
    const body = await response.json().catch(() => null);
    ok = response.ok && Number(body?.events_received) > 0;
  } catch { /* retried by the cron flush */ }
  await db.prepare(`UPDATE clone_meta_events SET sent_at = ?, last_status = ?, lease_until = ?, lease_owner = NULL WHERE event_id = ? AND lease_owner = ?`)
    .bind(ok ? Date.now() : null, status, ok ? 0 : Date.now() + 60000, eventId, owner).run();
  return ok;
}

export async function flushMetaEvents(env) {
  if (!env.CLONE_UPSELLS || !metaConfigured(env)) return;
  const pending = await env.CLONE_UPSELLS.prepare(`SELECT event_id FROM clone_meta_events
    WHERE sent_at IS NULL AND lease_until < ? AND created_at > ? ORDER BY created_at LIMIT 25`).bind(Date.now(), Date.now() - MAX_AGE_MS).all();
  await Promise.allSettled(pending.results.map(row => deliverMetaEvent(env, row.event_id)));
}

// A verified Commas payment for one of the configured products, as a Meta Purchase.
export function metaPaymentFromWebhook(payload, env) {
  const d = payload?.data, config = paymentConfig(env);
  const products = new Set([config.seat, ...Object.values(config.offers).map(o => o.service)]);
  const value = Number(d?.amount), transaction = String(d?.transaction_history_id || d?.payment_id || '');
  if (payload?.type !== 'payment.succeeded' || !products.has(d?.item?.id) || (d?.status && d.status !== 'succeeded') ||
      !(value > 0) || String(d?.currency || 'USD').toUpperCase() !== 'USD' || (Array.isArray(d?.refunds) && d.refunds.length) ||
      !/^[A-Za-z0-9_-]{3,100}$/.test(transaction)) return null;
  const ref = d?.api_metadata?.data?.clone_checkout_ref;
  // The $47 uses the checkout reference so the browser pixel's eventID matches.
  const eventId = d.item.id === config.seat && /^[A-Za-z0-9_-]{43}$/.test(ref || '') ?
    metaPurchaseEventId('seat', ref) : metaPurchaseEventId('order', transaction);
  return { eventId, value, email: d?.buyer?.email, phone: d?.buyer?.phone, at: Date.parse(d?.created_at || payload?.created_at) || Date.now() };
}
