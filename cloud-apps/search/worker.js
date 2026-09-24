// jonmac.ai/search: the Viral View Google Ads search plan, as static pages plus a PDF.
// Pages are rendered from the viralview.io repo (docs/marketing/google-ads-plan.md) into ./public/search.
const PREFIX = "/search";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
};

function withHeaders(response, path) {
  const headers = new Headers(response.headers);
  const ext = path.slice(path.lastIndexOf("."));
  if (TYPES[ext]) headers.set("content-type", TYPES[ext]);
  // Public but not for search engines.
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("cache-control", ext === ".html" ? "no-cache" : "public, max-age=300");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    if (url.pathname === PREFIX) {
      return Response.redirect(`${url.origin}${PREFIX}/${url.search}`, 301);
    }
    if (!url.pathname.startsWith(`${PREFIX}/`)) {
      return new Response("Not found", { status: 404 });
    }
    const path = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
    const asset = await env.ASSETS.fetch(new Request(new URL(path, url.origin), request));
    if (asset.status === 404) {
      return new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex, nofollow" } });
    }
    return withHeaders(asset, path);
  },
};
