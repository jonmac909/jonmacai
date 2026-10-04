import { cookie, hash, json, readCookie, sameOrigin, sign } from './upsells.js';
import { OFFERS, paymentConfig } from './payment-config.js';

const ACCESS_COOKIE = '__Secure-clone-sandbox-access';

async function validToken(value, secret) {
  if (typeof value !== 'string' || value.length > 1024 || !secret || secret.length < 32) return false;
  const a = await hash(value), b = await hash(secret);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export function sandboxEnv(env) { return { ...env, CLONE_PAYMENT_MODE: 'sandbox' }; }

export async function sandboxAccess(request, env) {
  const url = new URL(request.url);
  const login = url.pathname === '/clone/api/sandbox/access';
  if (!login && !url.searchParams.has('sandbox')) return { env: { ...env, CLONE_PAYMENT_MODE: 'production' } };
  if ((!login && url.searchParams.get('sandbox') !== '1') || env.COMMAS_ENV !== 'sandbox') {
    return { response: json({ ok: false, error: 'sandbox_disabled' }, 403) };
  }
  const testEnv = sandboxEnv(env);
  let config;
  try { config = paymentConfig(testEnv); } catch {
    return { response: json({ ok: false, error: 'sandbox_unconfigured' }, 503) };
  }
  if (!env.CLONE_TOKEN_SECRET || !env.CLONE_UPSELLS || !env.COMMAS_SANDBOX_WEBHOOK_SECRET ||
      !env.CLONE_SANDBOX_ACCESS_TOKEN || env.CLONE_SANDBOX_ACCESS_TOKEN.length < 32) {
    return { response: json({ ok: false, error: 'sandbox_unconfigured' }, 503) };
  }
  let token = url.searchParams.get('token');
  if (login) {
    if (request.method !== 'POST' || !sameOrigin(request)) return { response: json({ ok: false, error: 'origin' }, 403) };
    try { token = (await request.json()).token; } catch { return { response: json({ ok: false }, 400) }; }
  }
  if (token !== null && token !== undefined) {
    if (!await validToken(token, env.CLONE_SANDBOX_ACCESS_TOKEN)) return { response: json({ ok: false, error: 'sandbox_forbidden' }, 403) };
    const iat = Math.floor(Date.now() / 1000);
    const signed = await sign({ kind: 'sandbox-access', access: await hash(env.CLONE_SANDBOX_ACCESS_TOKEN), iat, exp: iat + 1800 }, env.CLONE_TOKEN_SECRET);
    if (login) return { response: json({ ok: true, environment: 'sandbox' }, 200, { 'set-cookie': cookie(ACCESS_COOKIE, signed) }) };
    // Strip the entry secret before assets, SDK code or external resources load.
    url.searchParams.delete('token');
    return { response: new Response(null, { status: 303, headers: {
      location: url.toString(), 'set-cookie': cookie(ACCESS_COOKIE, signed),
      'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
    } }) };
  }
  const access = await readCookie(request, ACCESS_COOKIE, env.CLONE_TOKEN_SECRET, 'sandbox-access');
  if (!access || access.access !== await hash(env.CLONE_SANDBOX_ACCESS_TOKEN)) {
    return { response: json({ ok: false, error: 'sandbox_forbidden' }, 403) };
  }
  return { env: testEnv, config };
}

export function publicConfig(config, env) {
  return {
    environment: config.environment, creatorId: config.creator, productId: config.seat,
    products: { seat: config.seat, ...Object.fromEntries(Object.entries(config.offers).map(([n, o]) => [n, o.service])) },
    hosted: { seat: config.hostedSeat, ...Object.fromEntries(Object.entries(config.offers).map(([n, o]) => [n, o.hosted])) },
    rebillEnabled: env.CLONE_SANDBOX_REBILL_ENABLED === 'true',
    subscriptionsEnabled: env.CLONE_SANDBOX_SUBSCRIPTIONS_ENABLED === 'true',
  };
}

export function sandboxPage(response, config, env) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-robots-tag', 'noindex, nofollow');
  let result = new Response(response.body, { status: response.status, headers });
  if (!(headers.get('content-type') || '').includes('text/html')) return result;
  const replacements = new Map([
    ['https://commas.com/checkout/nmGzEY7RCWcGOKl', config.hostedSeat],
    ...Object.entries(OFFERS).map(([n, o]) => [o.hosted, config.offers[n].hosted]),
  ]);
  const script = '<script>window.CloneMode=' + JSON.stringify(publicConfig(config, env)).replace(/</g, '\\u003c') + ';</script>';
  // Upsell pages are HTML fragments with no explicit <head>. Insert after their
  // charset meta, which exists on every funnel page, before any page scripts.
  return new HTMLRewriter().on('meta[charset]', { element(el) { el.after(script, { html: true }); } })
    .on('a[href]', { element(el) {
      const href = el.getAttribute('href');
      if (replacements.has(href)) el.setAttribute('href', replacements.get(href));
      else if (/^(?:https:\/\/jonmac\.ai)?\/clone(?:\/|$)/.test(href) || /^[A-Za-z0-9_-]+\.html(?:[?#]|$)/.test(href)) {
        const url = new URL(href, 'https://jonmac.ai/clone/'); url.searchParams.set('sandbox', '1');
        el.setAttribute('href', url.pathname + url.search + url.hash);
      } else if (/commas\.com\/checkout|fanbasis\.com\/agency-checkout/.test(href)) el.removeAttribute('href');
    } }).transform(result);
}
