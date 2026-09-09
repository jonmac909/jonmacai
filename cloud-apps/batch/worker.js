import { byteRange } from "../review/worker.js";

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
    if (url.pathname.startsWith("/sabri/") && url.pathname.endsWith(".mp4") && response.status === 200) {
      headers.set("Accept-Ranges", "bytes");
      const ifRange = request.headers.get("If-Range");
      const rangeHeader = request.method === "GET" && (!ifRange || ifRange === headers.get("ETag")) ? request.headers.get("Range") : null;
      if (rangeHeader) {
        // ponytail: buffer these <=5 MiB clips; use R2 ranges if the library grows to large media.
        const body = await response.arrayBuffer();
        const size = body.byteLength;
        let range;
        try {
          range = byteRange(rangeHeader, size);
        } catch {
          headers.set("Content-Range", `bytes */${size}`);
          headers.set("Content-Length", "0");
          return new Response(null, { status: 416, headers });
        }
        headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
        headers.set("Content-Length", String(range.length));
        return new Response(new Uint8Array(body, range.offset, range.length), { status: 206, headers });
      }
    }
    return new Response(response.body, { status: response.status, headers });
  },
};
