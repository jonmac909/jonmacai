// Canonicalize www without forwarding requests to the retired Vercel origin.
export default {
  fetch(request, env) {
    const destination = new URL(request.url);
    destination.protocol = "https:";
    destination.hostname = "jonmac.ai";
    destination.port = "";

    const headers = new Headers({
      Location: destination.href,
      "Cache-Control": "no-store",
    });
    if (env?.SITE_VERSION?.tag) headers.set("X-Site-Commit", env.SITE_VERSION.tag);
    if (env?.SITE_VERSION?.id) headers.set("X-Site-Version", env.SITE_VERSION.id);

    // 308 preserves the method and body for forms and API requests.
    return new Response(null, { status: 308, headers });
  },
};
