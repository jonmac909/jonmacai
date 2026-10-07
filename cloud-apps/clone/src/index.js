// jonmac.ai/clone: static funnel pages from ./public plus the lead and purchase hooks.
// Recovered from the deployed jonmac-agency bundle (version 58, 2026-09-07).
import { cookieName, isSandbox, paymentConfig } from './payment-config.js';
import { publicConfig, sandboxAccess, sandboxEnv, sandboxPage } from './sandbox.js';
import { buyerSession, checkoutContext, recordPurchaseProof, sameOrigin, upsell, validWebhook } from './upsells.js';
import { deliverWhopEvent, enqueueWhopEvent, flushWhopEvents, whopAttribution, whopPurchaseFromVerifiedPayment } from './whop-events.js';
import { purchaseReminders, retryReminders, unsubscribeReminders } from './reminders.js';
import { consentEvidence, readinessConfig } from './readiness.js';
import { recordScorecardPayment, recordVisit, sessionDate } from './scorecard.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/agency" || url.pathname.startsWith("/agency/")) {
      const rest = url.pathname.replace(/^\/agency\/?/, "");
      return Response.redirect(url.origin + "/clone/" + rest + url.search, 301);
    }
    if (url.pathname !== "/clone" && !url.pathname.startsWith("/clone/")) {
      return fetch(request);
    }
    if (url.pathname === "/clone") {
      return Response.redirect(url.origin + "/clone/" + url.search, 301);
    }
    if (url.pathname === '/clone/api/reminders/unsubscribe') return unsubscribeReminders(request, env);
    // Sandbox hooks have a separate key/HMAC and never touch lead/email systems.
    if (url.pathname === '/clone/api/sandbox/purchase' && request.method === 'POST') {
      const testEnv = sandboxEnv(env);
      try { paymentConfig(testEnv); } catch { return json({ ok: false, error: 'sandbox_unconfigured' }, 503); }
      return handlePurchase(request, testEnv);
    }
    const access = await sandboxAccess(request, env);
    if (access.response) return access.response;
    env = access.env;
    if (url.pathname === '/clone/api/config' && isSandbox(env)) return json(publicConfig(access.config, env));
    if (url.pathname === '/clone/api/readiness' && request.method === 'GET') return json(readinessConfig(env));
    if (url.pathname === '/clone/api/visit' && request.method === 'POST') {
      if (!sameOrigin(request)) return json({ ok: false, error: 'origin' }, 403);
      let data;
      try { data = await request.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }
      if (!/^[a-f0-9-]{36}$/i.test(data?.id || '')) return json({ ok: false, error: 'invalid visit' }, 400);
      try { return json({ ok: true, recorded: await recordVisit(env, data.id) }); }
      catch { return json({ ok: false, error: 'metrics unavailable' }, 503); }
    }
    if (url.pathname === "/clone/api/lead" && request.method === "POST") {
      return handleLead(request, env);
    }
    if (url.pathname === "/clone/api/purchase" && request.method === "POST") {
      return handlePurchase(request, env);
    }
    if (url.pathname === "/clone/api/checkout-session" && request.method === "POST") {
      return handleCheckoutSession(request, env);
    }
    if (url.pathname === '/clone/api/buyer-session' && request.method === 'POST') return buyerSession(request, env);
    if (url.pathname === '/clone/api/upsell' && request.method === 'POST') return upsell(request, env);
    if (url.pathname.startsWith('/clone/api/')) return json({ ok: false, error: 'not found' }, 404);
    // The checkout now lives in the lander's popup; the old step-2 page sends people back there.
    if (url.pathname === "/clone/checkout.html") {
      return Response.redirect(url.origin + "/clone/" + url.search, 302);
    }
    let path = url.pathname.replace(/^\/clone/, "");
    if (path === "" || path === "/") path = "/index.html";
    const res = await env.ASSETS.fetch(new Request(new URL(path, url.origin), request));
    if (res.status === 404) {
      const fb = await env.ASSETS.fetch(new Request(new URL("/index.html", url.origin), request));
      const missing = new Response(fb.body, { status: 404, headers: fb.headers });
      return isSandbox(env) ? sandboxPage(missing, access.config, env) : missing;
    }
    const response = isSandbox(env) ? sandboxPage(res, access.config, env) : res;
    const headers = new Headers(response.headers);
    // Existing page scripts/SDK remain allowed. No default-src restriction is
    // introduced for the funnel's video, fonts, images or embedded checkout.
    headers.set('content-security-policy', "script-src 'self' 'unsafe-inline' https://t.whop.tw https://cdn.embedded.fanbasis.io https://connect.facebook.net https://www.googletagmanager.com");
    if (env.CLONE_VERSION?.id) headers.set('x-clone-version', env.CLONE_VERSION.id);
    if (env.CLONE_VERSION?.tag) headers.set('x-clone-commit', env.CLONE_VERSION.tag);
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(Promise.all([flushWhopEvents(env), retryReminders(env)]));
  },
};

async function handleLead(request, env) {
  if (isSandbox(env)) return json({ ok: true, environment: 'sandbox' });
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }
  if (!data || typeof data !== 'object') return json({ ok: false, error: 'bad json' }, 400);
  const email = String(data.email || "").trim().toLowerCase();
  const name = String(data.name || "").trim().slice(0, 120);
  let consent;
  try { consent = consentEvidence(data); }
  catch (error) { return json({ ok: false, error: error.message }, 400); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, error: "invalid email" }, 400);
  }
  const previous = await env.CLONE_LEADS.get(`lead:${email}`);
  let saved = {};
  try { saved = previous ? JSON.parse(previous) : {}; } catch {}
  const record = {
    ...saved,
    email,
    name,
    ...consent,
    utm: data.utm || null,
    page: "clone",
    ua: request.headers.get("user-agent") || "",
    ts: new Date().toISOString(),
    whop: whopAttribution(data, request),
    sessionDate: sessionDate(),
  };
  await env.CLONE_LEADS.put(`lead:${email}`, JSON.stringify(record));
  // The browser supplies the same IDs for deduplication. A server ID also covers
  // browsers whose pixel was blocked. Email delivery is independent of CAPI.
  const eventId = typeof data.eventId === 'string' && /^clone_lead_[a-z0-9-]{36}$/i.test(data.eventId)
    ? data.eventId : 'clone_lead_' + crypto.randomUUID();
  for (const [eventName, id] of [['lead', eventId], ['complete_registration', eventId + '_registration']]) {
    const event = { eventName, eventId: id, url: record.whop.pageUrl, anonymousId: record.whop.anonymousId, email, eventTime: Date.now() };
    try {
      if (await enqueueWhopEvent(env, event)) await deliverWhopEvent(env, id);
    } catch { console.error('Whop lead delivery pending'); }
  }
  if (env.RESEND_API_KEY) {
    const headers = {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    };
    const firstName = name.split(/\s+/)[0] || "";
    const jobs = [];
    if (env.RESEND_AUDIENCE_ID) {
      jobs.push(fetch(`https://api.resend.com/audiences/${env.RESEND_AUDIENCE_ID}/contacts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: name.slice(firstName.length).trim(),
        }),
      }));
    }
    jobs.push(fetch("https://api.resend.com/events/send", {
      method: "POST",
      headers,
      body: JSON.stringify({
        event: "clone.lead",
        email,
        data: { first_name: firstName || "there", name },
      }),
    }));
    const checkout = env.CHECKOUT_URL || "https://jonmac.ai/clone/";
    jobs.push(fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: env.RESEND_FROM || "Jon Mac <support@viralview.io>",
        to: email,
        reply_to: env.RESEND_REPLY_TO || undefined,
        subject: "Your seat isn't saved yet",
        text: `${firstName ? firstName + " — " : ""}you're one step from your seat at The Clone Method live training (daily at 7:00 PM ET).

Finish here, it takes under a minute:
${checkout}

The $47 covers the 2-hour live session, the recording forever, and the live exercise where you build your first clone with me watching.

If you hit any trouble checking out, just reply to this email.

— Jon`,
      }),
    }));
    try {
      await Promise.allSettled(jobs);
    } catch {}
  }
  return json({ ok: true });
}

// Commas embedded checkout for the $47 seat. The session secret is seller-scoped and
// reusable, so one per isolate every 30 minutes is plenty; the API key never leaves here.
const SESSION_TTL_MS = 30 * 60 * 1000;
const cachedSessions = new Map();

async function handleCheckoutSession(request, env) {
  if (!sameOrigin(request)) return json({ ok: false, error: 'origin' }, 403);
  const config = paymentConfig(env);
  if (!config.apiKey) return json({ ok: false, error: "checkout not configured" }, 503);
  const context = await checkoutContext(request, env);
  let cachedSession = cachedSessions.get(config.environment);
  if (!cachedSession || cachedSession.key !== config.apiKey || cachedSession.creator !== config.creator ||
      cachedSession.product !== config.seat || Date.now() - cachedSession.at > SESSION_TTL_MS) {
    let secret = "";
    try {
      const res = await fetch(config.base + "/checkout-sessions/embedded", {
        method: "POST",
        headers: { "x-api-key": config.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          creator_id: config.creator,
          product_id: config.seat,
          metadata: { source: "jonmac.ai/clone" },
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) secret = String(body?.data?.checkout_session_secret || "");
    } catch {}
    if (!secret) return json({ ok: false, error: "checkout session failed" }, 502);
    cachedSession = { secret, at: Date.now(), key: config.apiKey, creator: config.creator, product: config.seat };
    cachedSessions.set(config.environment, cachedSession);
  }
  const responseHeaders = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  if (context) {
    responseHeaders.append('set-cookie', context.cookie);
    // A new checkout must never reuse a previous buyer's signed billing identity.
    responseHeaders.append('set-cookie', cookieName(env, 'buyer') + '=; Path=/clone; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  }
  return new Response(JSON.stringify({
    ok: true,
    creatorId: config.creator,
    productId: config.seat,
    environment: config.environment,
    hostedCheckoutUrl: config.hostedSeat,
    checkoutSessionSecret: cachedSession.secret,
    checkoutRef: context?.ref || null,
  }), {
    headers: responseHeaders,
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function handlePurchase(request, env) {
  const body = await request.text();
  const sigHeader = request.headers.get('x-webhook-signature') || request.headers.get('x-signature') || request.headers.get('x-fanbasis-signature');
  if (!await validWebhook(body, sigHeader, (isSandbox(env) ? env.COMMAS_SANDBOX_WEBHOOK_SECRET : env.COMMAS_WEBHOOK_SECRET))) return json({ ok: false, error: 'bad signature' }, 401);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }
  await recordPurchaseProof(payload, env);
  if (isSandbox(env)) return json({ ok: true, environment: 'sandbox' });
  // Only a signed successful payment for one of the six Clone products may emit
  // a purchase. No checkout/thank-you/browser endpoint can manufacture one.
  const buyerEmail = String(payload?.data?.buyer?.email || '').trim().toLowerCase();
  let attribution = {};
  if (buyerEmail) {
    const lead = await env.CLONE_LEADS.get(`lead:${buyerEmail}`);
    try { attribution = JSON.parse(lead || '{}').whop || {}; } catch {}
  }
  const event = whopPurchaseFromVerifiedPayment(payload, attribution);
  let conversionPending = false;
  if (event) {
    try {
      if (await enqueueWhopEvent(env, event) && !await deliverWhopEvent(env, event.eventId)) {
        conversionPending = true;
      }
    } catch { conversionPending = true; }
  }
  let outcome;
  try {
    const reminders = await purchaseReminders(payload, env);
    outcome = conversionPending ? json({ ok: false, error: 'conversion_pending' }, 503) : json({ ok: true, ...reminders });
  }
  catch { outcome = json({ ok: false, error: 'reminders_pending' }, 503); }
  // Observe after the existing reminder handler: preserve its cancellation and
  // scheduling behavior and use the session it assigned to the paid registrant.
  let scoreLead = {};
  if (buyerEmail) {
    try { scoreLead = JSON.parse(await env.CLONE_LEADS.get(`lead:${buyerEmail}`) || '{}'); } catch {}
  }
  try { await recordScorecardPayment(payload, env, scoreLead); }
  catch { return json({ ok: false, error: 'scorecard_pending' }, 503); }
  return outcome;
}
