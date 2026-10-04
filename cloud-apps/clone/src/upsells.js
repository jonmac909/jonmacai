const BASE = 'https://www.fanbasis.com/public-api';
const TTL = 30 * 60;
const enc = new TextEncoder();
const CHECKOUT_COOKIE = '__Secure-clone-checkout';
const BUYER_COOKIE = '__Secure-clone-buyer';

export const OFFERS = Object.freeze({
  software: { group: 'software', service: 'wg0E8', cents: 9700, recurring: true, description: 'Viral View Pro — $97/month', next: '/clone/audit.html', hosted: 'https://commas.com/checkout/wg0E8nj4FjdaJ6L' },
  trial: { group: 'software', service: '2J89z', cents: 0, trial: true, next: '/clone/audit.html', hosted: 'https://commas.com/checkout/2J89z1C1sozSM3' },
  audit: { group: 'audit', service: 'XXYMA', cents: 49700, description: 'TikTok Shop Audit — $497', next: '/clone/vault.html', hosted: 'https://commas.com/checkout/XXYMA1NymVQ5wpc' },
  vault: { group: 'vault', service: 'O9gZr', cents: 29700, description: 'The Vault — lifetime access — $297', next: '/clone/welcome.html', hosted: 'https://commas.com/checkout/O9gZrPCEazKZx1I' },
  vault_plan: { group: 'vault', service: 'jJYvv', cents: 9900, recurring: true, description: 'The Vault — 3 monthly payments of $99', next: '/clone/welcome.html', hosted: 'https://commas.com/checkout/jJYvvwCNDeq7PMsh' },
});

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json', 'cache-control': 'no-store',
    'referrer-policy': 'no-referrer', ...extra,
  } });
}

export function sameOrigin(request) {
  return request.headers.get('origin') === new URL(request.url).origin &&
    request.headers.get('sec-fetch-site') !== 'cross-site';
}

async function key(secret, usages) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}
function hex(bytes) { return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join(''); }
export async function hash(value) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(value))); }

export async function validWebhook(raw, signature, secret) {
  const given = (signature || '').replace(/^sha256=/, '');
  if (!secret || !/^[a-fA-F0-9]{64}$/.test(given)) return false;
  const bytes = Uint8Array.from(given.match(/../g), s => parseInt(s, 16));
  return crypto.subtle.verify('HMAC', await key(secret, ['verify']), bytes, enc.encode(raw));
}

export async function sign(payload, secret) {
  const data = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return data + '.' + hex(await crypto.subtle.sign('HMAC', await key(secret, ['sign']), enc.encode(data)));
}
async function readCookie(request, name, secret, kind, allowExpired = false) {
  if (!secret) return null;
  const token = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
  if (!token || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !await validWebhook(parts[0], parts[1], secret)) return null;
  try {
    const p = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    const now = Math.floor(Date.now() / 1000);
    return p.kind === kind && Number.isInteger(p.iat) && Number.isInteger(p.exp) &&
      p.iat <= now && (p.exp > now || allowExpired) && p.exp - p.iat === TTL ? p : null;
  } catch { return null; }
}
function cookie(name, token) { return `${name}=${token}; Path=/clone; Max-Age=${TTL}; HttpOnly; Secure; SameSite=Lax`; }

export async function checkoutContext(request, env) {
  if (!env.CLONE_TOKEN_SECRET) return null;
  const iat = Math.floor(Date.now() / 1000);
  const ref = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = await sign({ kind: 'checkout', ref, iat, exp: iat + TTL }, env.CLONE_TOKEN_SECRET);
  return { ref, cookie: cookie(CHECKOUT_COOKIE, token) };
}

// Called only after the existing purchase hook verifies its raw-body HMAC.
export async function recordPurchaseProof(payload, env) {
  const d = payload?.data;
  const ref = d?.api_metadata?.data?.clone_checkout_ref;
  const email = String(d?.buyer?.email || '').trim().toLowerCase();
  const paidAt = Date.parse(d?.created_at || payload?.created_at);
  if (!env.CLONE_UPSELLS || payload?.type !== 'payment.succeeded' ||
      d?.item?.id !== 'nmGzE' || Number(d?.amount) !== 47 || Number(d?.quantity || 1) !== 1 ||
      !/^[A-Za-z0-9_-]{43}$/.test(ref || '') || !email ||
      !/^[A-Za-z0-9-]{3,100}$/.test(d?.transaction_history_id || '') ||
      !Number.isFinite(paidAt) || Math.abs(Date.now() - paidAt) > TTL * 1000) return;
  await env.CLONE_UPSELLS.prepare(`INSERT INTO clone_purchase_proofs
    (checkout_ref, transaction_ref, email_hash, paid_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(checkout_ref) DO NOTHING`).bind(ref, d.transaction_history_id, await hash(email), paidAt).run();
  await env.CLONE_UPSELLS.prepare('DELETE FROM clone_purchase_proofs WHERE paid_at < ?').bind(Date.now() - TTL * 2000).run();
}

async function commas(env, path, init = {}) {
  if (!env.COMMAS_API_KEY) throw new Error('unconfigured');
  const response = await fetch(BASE + path, { ...init, headers: {
    'x-api-key': env.COMMAS_API_KEY, 'content-type': 'application/json', ...init.headers,
  }, signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => null);
  return { response, body };
}
function success(result) { return result.response.ok && result.body?.status === 'success'; }

async function matchesPurchase(tx, proof, intent) {
  const paidAt = Date.parse(tx?.transaction_date);
  const email = String(tx?.fan?.email || '').trim().toLowerCase();
  return tx && (tx.product?.id || tx.service?.id) === 'nmGzE' && Number(tx.amount) === 47 &&
    Array.isArray(tx.refunds) && tx.refunds.length === 0 && email &&
    Number.isFinite(paidAt) && paidAt >= intent.iat * 1000 - 5000 &&
    Math.abs(paidAt - proof.paid_at) <= 60000 && Date.now() - paidAt < TTL * 1000 &&
    paidAt <= Date.now() + 5000 && await hash(email) === proof.email_hash;
}

export async function buyerSession(request, env) {
  if (!sameOrigin(request)) return json({ ok: false, error: 'origin' }, 403);
  if (!env.CLONE_UPSELLS || !env.CLONE_TOKEN_SECRET) return json({ ok: false, fallback: true }, 503);
  const existing = await readCookie(request, BUYER_COOKIE, env.CLONE_TOKEN_SECRET, 'buyer');
  if (existing) return json({ ok: true });
  const intent = await readCookie(request, CHECKOUT_COOKIE, env.CLONE_TOKEN_SECRET, 'checkout');
  if (!intent) return json({ ok: false, fallback: true }, 401);
  try {
    const proof = await env.CLONE_UPSELLS.prepare('SELECT * FROM clone_purchase_proofs WHERE checkout_ref = ?').bind(intent.ref).first();
    if (!proof) return json({ ok: false, pending: true }, 202);
    // Webhook order IDs and SDK transaction hashids differ. Try the exact reference,
    // then reconcile the recent product ledger against the signed webhook identity/time.
    let input;
    try { input = await request.json(); } catch { return json({ ok: false }, 400); }
    const ref = input?.transactionId || proof.transaction_ref;
    if (!/^[A-Za-z0-9-]{3,100}$/.test(ref)) return json({ ok: false }, 400);
    const direct = await commas(env, '/transactions/' + encodeURIComponent(ref));
    let tx = success(direct) && await matchesPurchase(direct.body.data, proof, intent) ? direct.body.data : null;
    if (!tx) {
      const ledger = await commas(env, '/checkout-sessions/nmGzE/transactions?per_page=100');
      if (success(ledger)) {
        for (const row of ledger.body.data?.transactions || []) {
          if (await matchesPurchase(row, proof, intent)) { tx = row; break; }
        }
      }
    }
    if (!tx) return json({ ok: false, fallback: true }, 401);
    const email = tx.fan.email.trim().toLowerCase();
    const result = await commas(env, '/customers?per_page=100&search=' + encodeURIComponent(email));
    const customers = success(result) ? (result.body.data?.customers || []).filter(c =>
      String(c.email).trim().toLowerCase() === email && Number.isSafeInteger(Number(c.id)) && Number(c.id) > 0) : [];
    if (customers.length !== 1) return json({ ok: false, fallback: true }, 401);
    const iat = Math.floor(Date.now() / 1000);
    const token = await sign({ kind: 'buyer', buyer: Number(customers[0].id), purchased: proof.paid_at, iat, exp: iat + TTL }, env.CLONE_TOKEN_SECRET);
    return json({ ok: true }, 200, { 'set-cookie': cookie(BUYER_COOKIE, token) });
  } catch { return json({ ok: false, fallback: true }, 503); }
}

function fallback(offer, reason = 'unavailable') {
  return json({ ok: false, fallback: true, reason, checkoutUrl: offer.hosted,
    message: 'This offer needs secure checkout to finish. Continue with Commas below.' });
}
function pending() {
  return json({ ok: false, pending: true, message: 'Your payment is still being confirmed. Check again before placing another order.' }, 202);
}
function existingClaim(claim) {
  const offer = OFFERS[claim.offer];
  if (claim.state === 'charged') return json({ ok: true, next: offer.next });
  if (claim.state === 'fallback') return fallback(offer, 'previous_fallback');
  return pending();
}

export async function upsell(request, env) {
  if (!sameOrigin(request)) return json({ ok: false, error: 'origin' }, 403);
  let input;
  try { input = await request.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }
  const offer = Object.hasOwn(OFFERS, input?.offer) ? OFFERS[input.offer] : null;
  if (!offer) return json({ ok: false, error: 'invalid offer' }, 400);
  if (!env.CLONE_UPSELLS || !env.CLONE_TOKEN_SECRET) return fallback(offer);
  const buyer = await readCookie(request, BUYER_COOKIE, env.CLONE_TOKEN_SECRET, 'buyer');
  const db = env.CLONE_UPSELLS;
  if (!buyer || !Number.isSafeInteger(buyer.buyer) || buyer.buyer <= 0) {
    // An expired, authentic token may only inspect its prior claim. It cannot
    // authorize billing, but must not send an unresolved payment to checkout.
    const expired = await readCookie(request, BUYER_COOKIE, env.CLONE_TOKEN_SECRET, 'buyer', true);
    if (expired && Number.isSafeInteger(expired.buyer)) {
      try {
        const prior = await db.prepare('SELECT * FROM clone_upsell_claims WHERE buyer_id = ? AND offer_group = ?').bind(expired.buyer, offer.group).first();
        if (prior) return existingClaim(prior);
      } catch { return pending(); }
    }
    return fallback(offer, 'buyer_unverified');
  }
  let claimed = false, sent = false;
  try {
    const previous = await db.prepare('SELECT * FROM clone_upsell_claims WHERE buyer_id = ? AND offer_group = ?').bind(buyer.buyer, offer.group).first();
    if (previous) return existingClaim(previous);
    // Atomic uniqueness across isolates, double clicks, sessions and alternative plans.
    const insert = await db.prepare(`INSERT INTO clone_upsell_claims
      (buyer_id, offer_group, offer, state, created_at) VALUES (?, ?, ?, 'processing', ?)
      ON CONFLICT(buyer_id, offer_group) DO NOTHING`).bind(buyer.buyer, offer.group, input.offer, Date.now()).run();
    claimed = insert.meta?.changes === 1;
    if (!claimed) {
      const row = await db.prepare('SELECT * FROM clone_upsell_claims WHERE buyer_id = ? AND offer_group = ?').bind(buyer.buyer, offer.group).first();
      return row ? existingClaim(row) : pending();
    }
    const finish = async (state, ref = null) => {
      await db.prepare('UPDATE clone_upsell_claims SET state = ?, charge_ref = ? WHERE buyer_id = ? AND offer_group = ?').bind(state, ref, buyer.buyer, offer.group).run();
    };
    const enabledAt = Date.parse(env.CLONE_REBILL_ENABLED_AT || '');
    if (env.CLONE_REBILL_ENABLED !== 'true' || !Number.isFinite(enabledAt) ||
        !Number.isFinite(buyer.purchased) || buyer.purchased <= enabledAt ||
        offer.trial || (offer.recurring && env.CLONE_SUBSCRIPTIONS_ENABLED !== 'true')) {
      await finish('fallback');
      return fallback(offer, offer.trial ? 'trial_hosted' : 'rebill_unavailable');
    }
    // Resolve public service ID to numeric ID and verify the live terms before billing.
    const product = await commas(env, '/checkout-sessions/' + offer.service);
    const p = product.body?.data;
    if (!success(product) || !Number.isSafeInteger(p?.product?.id) || p.amount_cents !== offer.cents ||
        p.type !== (offer.recurring ? 'subscription' : 'onetime') ||
        (offer.recurring && (p.subscription?.frequency_days !== 30 || p.subscription?.free_trial_days ||
          (offer.group === 'vault' && p.subscription?.auto_expire_after_x_periods !== 2)))) {
      await finish('fallback'); return fallback(offer, 'product_terms_changed');
    }
    const methods = await commas(env, '/customers/' + buyer.buyer + '/payment-methods');
    const cards = success(methods) && Number(methods.body.data?.customer?.id) === buyer.buyer ?
      (methods.body.data.payment_methods || []).filter(m => m.type === 'card' && typeof m.id === 'string') : [];
    const card = cards.find(m => m.is_default) || cards[0];
    if (!card) { await finish('fallback'); return fallback(offer, 'no_saved_card'); }
    const idempotency = 'clone-' + await hash(`${buyer.buyer}:${offer.group}`);
    sent = true;
    const charge = await commas(env, '/customers/' + buyer.buyer + '/charge', {
      method: 'POST', headers: { 'Idempotency-Key': idempotency }, body: JSON.stringify({
        payment_method_id: card.id, amount_cents: offer.cents, description: offer.description,
        service_id: p.product.id,
      }),
    });
    const d = charge.body?.data;
    if (success(charge) && d?.status === 'succeeded' && d.charge_id && Number(d.amount) * 100 === offer.cents) {
      await finish('charged', String(d.charge_id));
      return json({ ok: true, next: offer.next });
    }
    // Only explicit rejection is safe to send to a second checkout. Timeouts, 409,
    // malformed success, 5xx or pending gateway outcomes must stay permanently locked.
    if ([400, 402, 403, 404, 422].includes(charge.response.status) && charge.body?.status === 'error') {
      const code = String(charge.body.code || '').toLowerCase();
      const message = String(charge.body.message || '');
      const unavailable = ['rebill_not_enabled', 'no_authorized_subscription', 'card_on_file_not_enabled'].includes(code) ||
        /no authorized subscription found|(?:manual\s+)?rebill(?:ing)?\b.{0,100}(?:not\s+(?:been\s+)?enabled|disabled)|card\s+on\s+file\b.{0,100}(?:not\s+enabled|disabled)/i.test(message);
      await finish('fallback'); return fallback(offer, unavailable ? 'rebill_unavailable' : 'payment_rejected');
    }
    await finish('unknown'); return pending();
  } catch {
    if (claimed && !sent) {
      try {
        await db.prepare('UPDATE clone_upsell_claims SET state = ?, charge_ref = ? WHERE buyer_id = ? AND offer_group = ?').bind('fallback', null, buyer.buyer, offer.group).run();
        return fallback(offer);
      } catch { /* Durable claim stays locked if persistence failed. */ }
    }
    return pending();
  }
}
