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
        text: `${firstName ? firstName + " — " : ""}you're one step from your seat at The Clone Method live training (every day at 8:00 PM ET).

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
