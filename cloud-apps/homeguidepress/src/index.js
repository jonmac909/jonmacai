// homeguidepress.com Worker: landing pages, checkout click tracking, Commas webhook, Resend delivery.
import { BY_KEY, BY_PATH } from './products.js';
import { download, index, landing, linkProblem, notFound, policy, thanks } from './pages.js';
import { commasWebhook, downloadFile, json, resendLink, retryUnsent } from './delivery.js';

export const TRACKED = ['src', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

const SECURITY = {
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
};

function html(body, status = 200, env = {}) {
  return new Response(body, { status, headers: {
    'content-type': 'text/html; charset=utf-8',
    // no-transform stops Cloudflare injecting its analytics beacon, which the CSP would block.
    'cache-control': 'no-store, no-transform',
    ...(env.INDEXING === 'true' ? {} : { 'x-robots-tag': 'noindex, nofollow' }),
    ...SECURITY,
  } });
}

// Keeps only the attribution params, trimmed, as a "?a=b" string (or '').
export function tracking(url) {
  const out = new URLSearchParams();
  for (const k of TRACKED) {
    const v = url.searchParams.get(k);
    if (v) out.set(k, v.replace(/[^\w .:/@+-]/g, '').slice(0, 100));
  }
  const s = out.toString();
  return s ? '?' + s : '';
}

function checkoutUrls(env) {
  try { return JSON.parse(env.CHECKOUT_URLS || '{}'); } catch { return {}; }
}
export function checkoutFor(env, key) {
  const u = checkoutUrls(env)[key];
  return typeof u === 'string' && /^https:\/\/(?:www\.)?commas\.com\/checkout\/[A-Za-z0-9]+$/.test(u) ? u : null;
}

function record(env, ctx, kind, key, request, url) {
  if (!env.DB) return;
  const p = Object.fromEntries(TRACKED.map(k => [k, url.searchParams.get(k)?.slice(0, 100) || null]));
  let ref = null;
  try { ref = new URL(request.headers.get('referer')).hostname.slice(0, 100); } catch {}
  ctx.waitUntil(env.DB.prepare(`INSERT INTO clicks (kind, slug, src, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer_host, country, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(kind, key, p.src, p.utm_source, p.utm_medium, p.utm_campaign, p.utm_content, p.utm_term,
    ref, request.cf?.country || null, new Date().toISOString()).run().catch(error => console.error('homeguidepress: click log failed', error.message)));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const parts = path.split('/').filter(Boolean);
    const method = request.method;

    if (method === 'POST') {
      if (path === '/api/commas/webhook') return commasWebhook(request, env);
      if (path === '/api/commas/test-webhook' && env.COMMAS_TEST_WEBHOOK_SECRET) return commasWebhook(request, env, { test: true });
      if (path === '/api/resend-link') return resendLink(request, env);
      return json({ ok: false }, 404);
    }
    if (method !== 'GET' && method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD, POST' } });

    if (path === '/') return html(index(), 200, env);
    if (path === '/robots.txt') return new Response(env.INDEXING === 'true' ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
    if (path === '/thanks') return html(thanks(url.searchParams.get('p'), url.searchParams.has('sent')), 200, env);
    if (path === '/privacy' || path === '/terms' || path === '/refunds') return html(policy(path.slice(1)), 200, env);
    if (parts[0] === 'go' && parts.length === 2 && BY_KEY[parts[1]]) {
      const p = BY_KEY[parts[1]];
      const target = checkoutFor(env, p.key);
      if (!target) return Response.redirect(`${url.origin}/${p.path}${tracking(url)}`, 302);
      record(env, ctx, 'buy', p.key, request, url);
      return new Response(null, { status: 302, headers: { location: target + tracking(url), 'cache-control': 'no-store' } });
    }
    if (parts[0] === 'download' && (parts.length === 2 || (parts.length === 3 && /^\d$/.test(parts[2])))) {
      const out = await downloadFile(env, parts[1], parts.length === 3 ? Number(parts[2]) : null);
      if (out.response) return out.response;
      if (out.page) return html(download(out.page.p, parts[1], out.page.files), 200, env);
      return html(linkProblem(out.problem, out.key), out.problem === 'unavailable' ? 503 : 410, env);
    }
    if (parts.length === 1 && BY_PATH[parts[0]]) {
      const p = BY_PATH[parts[0]];
      record(env, ctx, 'view', p.key, request, url);
      return html(landing(p, { checkoutReady: !!checkoutFor(env, p.key), query: tracking(url) }), 200, env);
    }
    if (parts.length === 1 && BY_KEY[parts[0]]) return Response.redirect(`${url.origin}/${BY_KEY[parts[0]].path}${tracking(url)}`, 301);
    return html(notFound(), 404, env);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(retryUnsent(env));
  },
};
