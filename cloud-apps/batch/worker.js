export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/batch" && !url.pathname.startsWith("/batch/")) {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    if (url.pathname === "/batch") {
      url.pathname = "/batch/";
      return Response.redirect(url.href, 308);
    }
    url.pathname = url.pathname === "/batch/" ? "/index.html" : url.pathname.slice("/batch".length);
    const response = await env.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Robots-Tag", "noindex, nofollow");
    headers.set("Referrer-Policy", "same-origin");
    headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; media-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
    return new Response(response.body, { status: response.status, headers });
  },
};
