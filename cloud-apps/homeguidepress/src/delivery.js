// Commas webhook -> D1 order -> Resend email with a signed, 7-day download link to a private R2 file.
// Rules: one email per transaction (orders.transaction_id is the primary key and a claim
// column stops two senders), refunds and disputes revoke the link, secrets stay in Worker secrets.
import { BRAND, BY_KEY, LINK_DAYS, PRODUCTS, REFUND_DAYS, STATEMENT_NAME, SUPPORT_EMAIL, byline, fromName } from './products.js';
import { esc } from './pages.js';

const enc = new TextEncoder();
const DAY = 86400;
const CLAIM_MS = 5 * 60 * 1000;
const RELINK_MS = 10 * 60 * 1000;
export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function hmacKey(secret, usages) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}
const hex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
const b64url = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

// Same check as cloud-apps/clone: hex HMAC-SHA256 of the raw body, optional sha256= prefix, constant-time verify.
export async function validWebhook(raw, signature, secret) {
  const given = (signature || '').replace(/^sha256=/, '');
  if (!secret || !/^[a-fA-F0-9]{64}$/.test(given)) return false;
  const bytes = Uint8Array.from(given.match(/../g), s => parseInt(s, 16));
  return crypto.subtle.verify('HMAC', await hmacKey(secret, ['verify']), bytes, enc.encode(raw));
}

export async function makeToken(env, transactionId, key, now = Date.now()) {
  const data = b64url(JSON.stringify({ t: transactionId, k: key, e: Math.floor(now / 1000) + LINK_DAYS * DAY }));
  return data + '.' + hex(await crypto.subtle.sign('HMAC', await hmacKey(env.LINK_SECRET, ['sign']), enc.encode(data)));
}

// Returns { status: 'ok'|'expired'|'invalid', t, k }.
export async function readToken(env, token, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (!env.LINK_SECRET || parts.length !== 2 || parts[0].length > 400 || !await validWebhook(parts[0], parts[1], env.LINK_SECRET)) return { status: 'invalid' };
  let p;
  try { p = JSON.parse(unb64url(parts[0])); } catch { return { status: 'invalid' }; }
  if (typeof p.t !== 'string' || !BY_KEY[p.k] || !Number.isInteger(p.e)) return { status: 'invalid' };
  return { status: p.e * 1000 > now ? 'ok' : 'expired', t: p.t, k: p.k };
}

function parseJson(text, fallback) { try { return JSON.parse(text); } catch { return fallback; } }

// Commas product ID -> our key. PRODUCT_IDS var first; otherwise the checkout link,
// whose path starts with the product ID (https://commas.com/checkout/<id><suffix>).
export function keyForProduct(env, productId) {
  if (!productId) return null;
  const ids = parseJson(env.PRODUCT_IDS || '{}', {});
  const hit = Object.keys(ids).find(k => ids[k] === productId && BY_KEY[k]);
  if (hit) return hit;
  const urls = parseJson(env.CHECKOUT_URLS || '{}', {});
  const matches = Object.keys(urls).filter(k => BY_KEY[k] && /^https:\/\//.test(urls[k]) &&
    new URL(urls[k]).pathname.split('/').pop().startsWith(productId));
  return matches.length === 1 ? matches[0] : null;
}

const cents = amount => Number.isFinite(Number(amount)) ? Math.round(Number(amount) * 100) : null;
const nowIso = () => new Date().toISOString();

export async function commasWebhook(request, env, { test = false } = {}) {
  const raw = await request.text();
  const signature = request.headers.get('x-webhook-signature') || request.headers.get('x-signature') || request.headers.get('x-fanbasis-signature');
  if (!await validWebhook(raw, signature, test ? env.COMMAS_TEST_WEBHOOK_SECRET : env.COMMAS_WEBHOOK_SECRET)) return json({ ok: false, error: 'bad signature' }, 401);
  const payload = parseJson(raw, null);
  if (!payload || typeof payload !== 'object') return json({ ok: false, error: 'bad json' }, 400);
  // Real deliveries use { id, type, data, created_at }; the dashboard "Test Webhook" button sends a flat payload.
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const type = payload.type || payload.event_type || '';
  const eventId = String(payload.id || data.event_id || crypto.randomUUID()).slice(0, 200);
  const txid = String(data.transaction_history_id || data.payment_id || '').slice(0, 200) || null;
  const db = env.DB;
  const first = await db.prepare(`INSERT INTO webhook_events (event_id, type, transaction_id, is_test, received_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO NOTHING`).bind(eventId, type, txid, test ? 1 : 0, nowIso()).run();
  let result;
  if (type === 'payment.succeeded' || type === 'product.purchased') result = await paid(env, data, txid, test);
  else if ((type === 'refund.created' && (data.status || 'success') === 'success') || type === 'dispute.created') result = await revoke(env, data, txid, type, test);
  else result = { result: 'ignored' };
  if (first.meta.changes) await db.prepare('UPDATE webhook_events SET result = ? WHERE event_id = ?').bind(result.result, eventId).run();
  return json({ ok: true, ...result, duplicate_event: !first.meta.changes });
}

async function paid(env, data, txid, test) {
  const email = String(data.buyer?.email || data.fan?.email || '').trim().toLowerCase();
  if (!txid || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { result: 'missing fields' };
  const productId = String(data.item?.id || data.productID || data.product?.id || '') || null;
  const key = keyForProduct(env, productId);
  const src = data.api_metadata?.data?.src || data.metadata?.src || null;
  const inserted = await env.DB.prepare(`INSERT INTO orders (transaction_id, slug, product_id, email, name, amount_cents, currency, is_test, src, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(transaction_id) DO NOTHING`)
    .bind(txid, key, productId, email, String(data.buyer?.name || '').slice(0, 200) || null, cents(data.amount),
      data.currency || null, test ? 1 : 0, src ? String(src).slice(0, 100) : null, nowIso()).run();
  if (!key) { console.warn('homeguidepress: unknown Commas product', productId); return { result: 'unknown product' }; }
  const sent = await deliver(env, txid);
  return { result: inserted.meta.changes ? sent : 'duplicate transaction: ' + sent };
}

// Claim the order, send once, record the Resend ID. Returns a short status.
export async function deliver(env, txid) {
  const now = Date.now();
  const claim = await env.DB.prepare(`UPDATE orders SET email_claimed_at = ? WHERE transaction_id = ? AND email_sent_at IS NULL
    AND revoked_at IS NULL AND slug IS NOT NULL AND (email_claimed_at IS NULL OR email_claimed_at < ?)`)
    .bind(new Date(now).toISOString(), txid, new Date(now - CLAIM_MS).toISOString()).run();
  if (!claim.meta.changes) return 'already sent';
  const order = await env.DB.prepare('SELECT * FROM orders WHERE transaction_id = ?').bind(txid).first();
  try {
    const id = await sendLinkEmail(env, order, { first: true, idempotency: `hgp-delivery-${txid}` });
    await env.DB.prepare('UPDATE orders SET email_sent_at = ?, email_id = ?, email_error = NULL WHERE transaction_id = ?')
      .bind(nowIso(), id, txid).run();
    return 'sent';
  } catch (error) {
    console.error('homeguidepress: delivery email failed', txid, error.message);
    await env.DB.prepare('UPDATE orders SET email_claimed_at = NULL, email_error = ? WHERE transaction_id = ?').bind(String(error.message).slice(0, 300), txid).run();
    return 'send failed';
  }
}

// Refunds carry a refund hashid, not the ORD- order ID, so fall back to buyer email + product.
async function revoke(env, data, txid, type, test) {
  const reason = type === 'dispute.created' ? 'dispute' : 'refund';
  let row = txid ? await env.DB.prepare('SELECT transaction_id FROM orders WHERE transaction_id = ? AND revoked_at IS NULL').bind(txid).first() : null;
  if (!row) {
    const email = String(data.buyer?.email || data.fan?.email || '').trim().toLowerCase();
    const productId = String(data.item?.id || data.productID || data.product?.id || '');
    if (email) row = await env.DB.prepare(`SELECT transaction_id FROM orders WHERE email = ? AND revoked_at IS NULL AND is_test = ?
      AND (? = '' OR product_id = ?) ORDER BY created_at DESC LIMIT 1`).bind(email, test ? 1 : 0, productId, productId).first();
  }
  if (!row) { console.warn('homeguidepress: no order to revoke for', type); return { result: 'no matching order' }; }
  await env.DB.prepare('UPDATE orders SET revoked_at = ?, revoke_reason = ? WHERE transaction_id = ?').bind(nowIso(), reason, row.transaction_id).run();
  return { result: 'revoked' };
}

function testRecipientAllowed(env, order) {
  if (!order.is_test) return true;
  const allowed = String(env.TEST_RECIPIENTS || 'delivered@resend.dev').toLowerCase().split(',').map(s => s.trim());
  return allowed.includes(order.email);
}

export async function sendLinkEmail(env, order, { first, idempotency }) {
  const p = BY_KEY[order.slug];
  if (!env.RESEND_API_KEY || !env.LINK_SECRET) throw new Error('email not configured');
  if (!testRecipientAllowed(env, order)) throw new Error('test order to a non-test address');
  const link = `${env.SITE_URL}/download/${await makeToken(env, order.transaction_id, order.slug)}`;
  const message = email(p, link, first, env.SITE_URL);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'Idempotency-Key': idempotency },
    body: JSON.stringify({
      from: `${fromName(p)} <${env.RESEND_FROM_ADDRESS}>`, to: [order.email], reply_to: SUPPORT_EMAIL,
      subject: message.subject, html: message.html, text: message.text,
      tags: [{ name: 'product', value: p.key }, { name: 'kind', value: first ? 'delivery' : 'relink' }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.id) throw new Error(`resend ${response.status} ${body.name || ''}`.trim());
  return body.id;
}

export function email(p, link, first, site = 'https://homeguidepress.com') {
  const who = p.persona ? p.persona.host.split(' ')[0] : BRAND;
  const subject = first ? `Your copy of ${p.title}` : `Your new download link for ${p.title}`;
  const opening = first ? `Thank you for buying ${p.title}. Your copy is ready.` : `Here is the fresh download link you asked for.`;
  const text = `${opening}

Download it here: ${link}

Save the file to your computer, phone or tablet. This link works for ${LINK_DAYS} days. After that, you can get a new one at ${site}/thanks?p=${p.key}

Your card statement shows this charge as ${STATEMENT_NAME}.

If it isn't for you, just reply within ${REFUND_DAYS} days of buying and we'll refund you in full.

${who}
${byline(p)}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f1e7">
<div style="max-width:560px;margin:0 auto;padding:28px 22px;font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.55;color:#231b14">
<p style="margin:0 0 18px">${esc(opening)}</p>
<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#1f5f3a;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;font-size:20px;padding:16px 28px;border-radius:8px">Download ${esc(p.title)}</a></p>
<p style="margin:0 0 18px">Save the file to your computer, phone or tablet. This link works for ${LINK_DAYS} days. After that, you can <a href="${esc(site)}/thanks?p=${p.key}" style="color:#1f5f3a">get a new link here</a>.</p>
<p style="margin:0 0 18px">Your card statement shows this charge as ${STATEMENT_NAME}.</p>
<p style="margin:0 0 18px">If it isn't for you, just reply within ${REFUND_DAYS} days of buying and we'll refund you in full.</p>
<p style="margin:0">${esc(who)}<br><span style="color:#6b5d4f">${esc(byline(p))}</span></p>
</div></body></html>`;
  return { subject, text, html };
}

// POST /api/resend-link (form). Always answers the same way, so it never reveals who bought what.
export async function resendLink(request, env) {
  const form = await request.formData().catch(() => null);
  const emailAddr = String(form?.get('email') || '').trim().toLowerCase().slice(0, 254);
  const key = BY_KEY[String(form?.get('p') || '')] ? String(form.get('p')) : '';
  const done = Response.redirect(`${new URL(request.url).origin}/thanks?${key ? `p=${key}&` : ''}sent=1`, 303);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddr)) return done;
  const rows = (await env.DB.prepare(`SELECT * FROM orders WHERE email = ? AND revoked_at IS NULL AND slug IS NOT NULL
    AND (? = '' OR slug = ?) ORDER BY created_at DESC LIMIT 7`).bind(emailAddr, key, key).all()).results;
  const cutoff = new Date(Date.now() - RELINK_MS).toISOString();
  for (const order of rows) {
    // The first email never went out (Resend was down): send it now instead of a "new link" email.
    if (!order.email_sent_at) { await deliver(env, order.transaction_id); continue; }
    if (order.last_link_sent_at && order.last_link_sent_at > cutoff) continue;
    const claim = await env.DB.prepare('UPDATE orders SET last_link_sent_at = ? WHERE transaction_id = ? AND (last_link_sent_at IS NULL OR last_link_sent_at <= ?)')
      .bind(nowIso(), order.transaction_id, cutoff).run();
    if (!claim.meta.changes) continue;
    try { await sendLinkEmail(env, order, { first: false, idempotency: `hgp-relink-${order.transaction_id}-${Math.floor(Date.now() / RELINK_MS)}` }); }
    catch (error) { console.error('homeguidepress: relink failed', order.transaction_id, error.message); }
  }
  return done;
}

// GET /download/<token>[/<n>]
export async function downloadFile(env, token, index) {
  const t = await readToken(env, token);
  if (t.status !== 'ok') return { problem: t.status, key: t.k };
  const order = await env.DB.prepare('SELECT * FROM orders WHERE transaction_id = ?').bind(t.t).first();
  if (!order || order.slug !== t.k) return { problem: 'invalid', key: t.k };
  if (order.revoked_at) return { problem: 'revoked', key: t.k };
  const p = BY_KEY[t.k];
  const files = filesFor(env, p);
  if (index === null) return { page: { p, files } };
  const file = files[index];
  const object = file && await env.BOOKS.get(file.object);
  if (!object) return { problem: 'unavailable', key: t.k };
  await env.DB.prepare('UPDATE orders SET downloads = downloads + 1 WHERE transaction_id = ?').bind(t.t).run();
  return { response: new Response(object.body, { headers: {
    'content-type': object.httpMetadata?.contentType || 'application/pdf',
    'content-disposition': `attachment; filename="${file.name.replace(/[^\w .()-]/g, '')}"`,
    'cache-control': 'private, no-store', 'x-robots-tag': 'noindex',
  } }) };
}

// FILES var can override a product's file list once the ebook worker uploads the PDFs.
export function filesFor(env, p) {
  const override = parseJson(env.FILES || '{}', {})[p.key];
  return Array.isArray(override) && override.length ? override : p.files;
}

// Cron: retry delivery emails that failed (Commas never retries a webhook).
export async function retryUnsent(env) {
  const cutoff = new Date(Date.now() - CLAIM_MS).toISOString();
  const rows = (await env.DB.prepare(`SELECT transaction_id FROM orders WHERE email_sent_at IS NULL AND revoked_at IS NULL AND slug IS NOT NULL
    AND (email_claimed_at IS NULL OR email_claimed_at < ?) AND created_at > ? LIMIT 20`)
    .bind(cutoff, new Date(Date.now() - 3 * DAY * 1000).toISOString()).all()).results;
  for (const row of rows) await deliver(env, row.transaction_id);
  return rows.length;
}

export const productKeys = PRODUCTS.map(p => p.key);
