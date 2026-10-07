// Port of viralview.io/lib/whop-events-api.ts and lib/whop-pixel.ts.
import { isSandbox, OFFERS } from './payment-config.js';

export const WHOP_ACCOUNT_ID = 'biz_7mMLeRhCNlr8Nl';
export const MAX_EVENT_AGE_MS = 28 * 24 * 60 * 60 * 1000;
const ATTR = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'vv_link',
  'utm_meta_ad_id', 'utm_meta_adset_id', 'utm_meta_campaign_id', 'utm_placement', 'utm_adset', 'utm_whop',
  'wacid', 'wasid', 'waid', 'fbclid', 'gclid', 'twclid', 'ttclid', 'gbraid', 'wbraid', 'msclkid']);
const EVENTS = new Set(['page', 'view_content', 'lead', 'complete_registration', 'add_to_cart', 'purchase']);
const PRODUCTS = new Set(['nmGzE', ...Object.values(OFFERS).map(o => o.service)]);

export function normalizeWhopAnonymousId(value) {
  return typeof value === 'string' && /^wuid_[a-z0-9_-]{1,128}$/i.test(value.trim()) ? value.trim() : null;
}
export function normalizeWhopPageUrl(value, fallback = 'https://jonmac.ai/clone/') {
  try {
    if (typeof value !== 'string' || value.length > 3000) throw new TypeError();
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== 'jonmac.ai' || u.port || u.username || u.password ||
        !(u.pathname === '/clone' || u.pathname.startsWith('/clone/'))) throw new TypeError();
    const params = new URLSearchParams();
    for (const [k, v] of u.searchParams) if (ATTR.has(k.toLowerCase()) && v.length <= 500) params.append(k.toLowerCase(), v);
    return u.origin + u.pathname + (params.size ? '?' + params : '');
  } catch { return fallback; }
}
export function whopAttribution(data, request) {
  let anonymousId = normalizeWhopAnonymousId(data?.anonymousId || data?.whop_anonymous_id);
  if (!anonymousId && request) {
    const cookie = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('_wuid='));
    try { anonymousId = normalizeWhopAnonymousId(cookie && decodeURIComponent(cookie.slice(6))); } catch {}
  }
  return { anonymousId, pageUrl: normalizeWhopPageUrl(data?.pageUrl || data?.whop_page_url) };
}
export function whopPurchaseFromVerifiedPayment(payload, attribution = {}) {
  const d = payload?.data;
  // Canonical Commas public order ID, never the webhook envelope or SDK charge ID.
  const transaction = String(d?.transaction_history_id || d?.payment_id || '');
  const value = Number(d?.amount);
  if (payload?.type !== 'payment.succeeded' || !PRODUCTS.has(d?.item?.id) ||
      (d?.status && d.status !== 'succeeded') || !/^[A-Za-z0-9_-]{3,100}$/.test(transaction) ||
      d?.amount == null || !Number.isFinite(value) || value <= 0 ||
      String(d?.currency || 'USD').toUpperCase() !== 'USD' || (Array.isArray(d?.refunds) && d.refunds.length)) return null;
  const meta = d?.api_metadata?.data || d?.metadata || {};
  const parsedTime = Date.parse(d?.created_at || payload?.created_at);
  if (!Number.isFinite(parsedTime)) return null;
  return { eventName: 'purchase', eventId: 'purchase_' + transaction, eventTime: parsedTime,
    url: normalizeWhopPageUrl(meta.whop_page_url || attribution.pageUrl),
    anonymousId: normalizeWhopAnonymousId(meta.whop_anonymous_id || attribution.anonymousId),
    email: String(d?.buyer?.email || '').trim().toLowerCase(), value, currency: 'USD' };
}
export function whopPayload(event) {
  const eventTime = event.eventTime ?? Date.now(), age = Date.now() - eventTime;
  if (!EVENTS.has(event.eventName) || typeof event.eventId !== 'string' || !event.eventId.trim() || event.eventId.length > 250 ||
      !Number.isFinite(eventTime) || age > MAX_EVENT_AGE_MS || age < -60000 ||
      (event.eventName === 'purchase' && (!Number.isFinite(event.value) || event.value <= 0))) return null;
  const anonymousId = normalizeWhopAnonymousId(event.anonymousId);
  const email = typeof event.email === 'string' ? event.email.trim().toLowerCase() : '';
  const url = normalizeWhopPageUrl(event.url);
  const params = new URL(url).searchParams;
  const context = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'fbclid', 'gclid', 'twclid', 'ttclid', 'gbraid', 'wbraid', 'msclkid']) {
    if (params.get(key)) context[key] = params.get(key);
  }
  for (const [key, param] of [['ad_campaign_id', 'wacid'], ['ad_set_id', 'wasid'], ['ad_id', 'waid']]) {
    if (params.get(param)) context[key] = params.get(param);
  }
  return { account_id: WHOP_ACCOUNT_ID, event_name: event.eventName, event_id: event.eventId,
    event_time: new Date(eventTime).toISOString(), action_source: 'website', url,
    ...(anonymousId || email ? { user: { ...(anonymousId ? { anonymous_id: anonymousId } : {}), ...(email ? { email } : {}) } } : {}),
    ...(Object.keys(context).length ? { context } : {}),
    ...(event.value != null ? { value: event.value, currency: (event.currency || 'USD').toLowerCase() } : {}) };
}
export async function sendWhopServerEvent(env, event) {
  const payload = whopPayload(event);
  if (isSandbox(env) || !env.WHOP_API_KEY || !payload) return { ok: false, status: 0 };
  try {
    const response = await fetch('https://api.whop.com/api/v1/events', {
      method: 'POST', headers: { authorization: `Bearer ${env.WHOP_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(3000),
    });
    // Never log response bodies, identity data or authorization headers.
    return { ok: response.ok, status: response.status };
  } catch { return { ok: false, status: 0 }; }
}

export async function enqueueWhopEvent(env, event) {
  if (isSandbox(env) || !env.WHOP_API_KEY || !whopPayload(event)) return false;
  if (!env.CLONE_UPSELLS) throw new Error('Whop event storage unavailable');
  await env.CLONE_UPSELLS.prepare(`INSERT INTO clone_whop_events (event_id, payload, created_at)
    VALUES (?, ?, ?) ON CONFLICT(event_id) DO NOTHING`).bind(event.eventId, JSON.stringify(event), Date.now()).run();
  return true;
}
export async function deliverWhopEvent(env, eventId) {
  if (isSandbox(env)) return true;
  const db = env.CLONE_UPSELLS, now = Date.now(), owner = crypto.randomUUID();
  const claim = await db.prepare(`UPDATE clone_whop_events SET lease_owner = ?, lease_until = ?, attempts = attempts + 1
    WHERE event_id = ? AND sent_at IS NULL AND lease_until < ?`).bind(owner, now + 30000, eventId, now).run();
  if (claim.meta?.changes !== 1) {
    const row = await db.prepare('SELECT sent_at FROM clone_whop_events WHERE event_id = ?').bind(eventId).first();
    return row?.sent_at != null;
  }
  const row = await db.prepare('SELECT payload FROM clone_whop_events WHERE event_id = ? AND lease_owner = ?').bind(eventId, owner).first();
  const result = await sendWhopServerEvent(env, JSON.parse(row.payload));
  await db.prepare(`UPDATE clone_whop_events SET sent_at = ?, last_status = ?, lease_until = ?, lease_owner = NULL
    WHERE event_id = ? AND lease_owner = ?`).bind(result.ok ? Date.now() : null, result.status, result.ok ? 0 : Date.now() + 60000, eventId, owner).run();
  return result.ok;
}
export async function flushWhopEvents(env) {
  if (!env.CLONE_UPSELLS || !env.WHOP_API_KEY) return;
  const pending = await env.CLONE_UPSELLS.prepare(`SELECT event_id FROM clone_whop_events
    WHERE sent_at IS NULL AND lease_until < ? AND created_at > ? ORDER BY created_at LIMIT 25`)
    .bind(Date.now(), Date.now() - MAX_EVENT_AGE_MS).all();
  await Promise.allSettled(pending.results.map(row => deliverWhopEvent(env, row.event_id)));
}
