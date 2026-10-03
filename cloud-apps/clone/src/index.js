// jonmac.ai/clone: static funnel pages from ./public plus the lead and purchase hooks.
// Recovered from the deployed jonmac-agency bundle (version 58, 2026-09-07).
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
    if (url.pathname === "/clone/api/lead" && request.method === "POST") {
      return handleLead(request, env);
    }
    if (url.pathname === "/clone/api/purchase" && request.method === "POST") {
      return handlePurchase(request, env);
    }
    if (url.pathname === "/clone/api/checkout-session" && request.method === "POST") {
      return handleCheckoutSession(env);
    }
    // The checkout now lives in the lander's popup; the old step-2 page sends people back there.
    if (url.pathname === "/clone/checkout.html") {
      return Response.redirect(url.origin + "/clone/" + url.search, 302);
    }
    let path = url.pathname.replace(/^\/clone/, "");
    if (path === "" || path === "/") path = "/index.html";
    const res = await env.ASSETS.fetch(new Request(new URL(path, url.origin), request));
    if (res.status === 404) {
      const fb = await env.ASSETS.fetch(new Request(new URL("/index.html", url.origin), request));
      return new Response(fb.body, { status: 404, headers: fb.headers });
    }
    return res;
  },
};

async function handleLead(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }
  const email = String(data.email || "").trim().toLowerCase();
  const name = String(data.name || "").trim().slice(0, 120);
  const phone = String(data.phone || "").trim().slice(0, 40);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, error: "invalid email" }, 400);
  }
  const record = {
    email,
    name,
    phone,
    utm: data.utm || null,
    page: "clone",
    ua: request.headers.get("user-agent") || "",
    ts: new Date().toISOString(),
  };
  await env.CLONE_LEADS.put(`lead:${email}`, JSON.stringify(record));
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
          unsubscribed: false,
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
        text: `${firstName ? firstName + " — " : ""}you're one step from your seat at The Clone Method live training (every Tuesday, Wednesday and Thursday at 7:00 PM ET).

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
const COMMAS_CREATOR_ID = "viralview";
const COMMAS_PRODUCT_ID = "nmGzE";
const SESSION_TTL_MS = 30 * 60 * 1000;
let cachedSession = null;

async function handleCheckoutSession(env) {
  if (!env.COMMAS_API_KEY) return json({ ok: false, error: "checkout not configured" }, 503);
  if (!cachedSession || Date.now() - cachedSession.at > SESSION_TTL_MS) {
    let secret = "";
    try {
      const res = await fetch("https://www.fanbasis.com/public-api/checkout-sessions/embedded", {
        method: "POST",
        headers: { "x-api-key": env.COMMAS_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          creator_id: COMMAS_CREATOR_ID,
          product_id: COMMAS_PRODUCT_ID,
          metadata: { source: "jonmac.ai/clone" },
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) secret = String(body?.data?.checkout_session_secret || "");
    } catch {}
    if (!secret) return json({ ok: false, error: "checkout session failed" }, 502);
    cachedSession = { secret, at: Date.now() };
  }
  return new Response(JSON.stringify({
    ok: true,
    creatorId: COMMAS_CREATOR_ID,
    productId: COMMAS_PRODUCT_ID,
    checkoutSessionSecret: cachedSession.secret,
  }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handlePurchase(request, env) {
  const body = await request.text();
  if (env.COMMAS_WEBHOOK_SECRET) {
    const sigHeader = request.headers.get("x-signature") || request.headers.get("x-fanbasis-signature") || request.headers.get("x-webhook-signature") || "";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.COMMAS_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const digest = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const given = sigHeader.trim().replace(/^sha256=/, "");
    if (given !== digest) return json({ ok: false, error: "bad signature" }, 401);
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }
  const email = String(
    payload?.data?.buyer?.email || payload?.customer?.email || payload?.data?.customer?.email || payload?.email || payload?.data?.email || "",
  ).trim().toLowerCase();
  if (!email) return json({ ok: true, note: "no email in payload" });
  const rec = await env.CLONE_LEADS.get(`lead:${email}`);
  if (rec) {
    try {
      const r = JSON.parse(rec);
      r.purchased = true;
      r.purchasedAt = new Date().toISOString();
      await env.CLONE_LEADS.put(`lead:${email}`, JSON.stringify(r));
    } catch {}
  }
  if (env.RESEND_API_KEY) {
    await fetch("https://api.resend.com/events/send", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ event: "clone.purchase", email, data: {} }),
    }).catch(() => {});
  }
  return json({ ok: true });
}
