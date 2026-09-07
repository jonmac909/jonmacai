export function byteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size <= 0) throw new RangeError("Invalid range");
  const first = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const last = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (![first, last, ...(match[2] ? [Number(match[2])] : [])].every(Number.isSafeInteger) ||
      first < 0 || first >= size || last < first || (!match[1] && Number(match[2]) === 0)) {
    throw new RangeError("Unsatisfiable range");
  }
  return { offset: first, length: last - first + 1 };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (env.REVIEW_WITHDRAWN === "true") {
      return new Response("This review has been withdrawn. A replacement is being rebuilt.", {
        status: 410,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
      });
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    if (url.pathname === "/review/video.mp4") {
      const info = await env.MEDIA.head(env.VIDEO_KEY);
      if (!info) return new Response("Video unavailable", { status: 404 });
      const headers = new Headers({
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "ETag": info.httpEtag,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      });
      if (request.headers.get("If-None-Match") === info.httpEtag) {
        return new Response(null, { status: 304, headers });
      }
      let range;
      const ifRange = request.headers.get("If-Range");
      try {
        range = byteRange(!ifRange || ifRange === info.httpEtag ? request.headers.get("Range") : null, info.size);
      } catch {
        headers.set("Content-Range", `bytes */${info.size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set("Content-Length", String(range ? range.length : info.size));
      if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${info.size}`);
      if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
      const object = await env.MEDIA.get(env.VIDEO_KEY, range ? { range } : undefined);
      if (!object) return new Response("Video unavailable", { status: 404 });
      return new Response(object.body, { status: range ? 206 : 200, headers });
    }
    const assets = { "/review": "/index.html", "/review/": "/index.html", "/review/poster.jpg": "/poster.jpg" };
    if (!Object.hasOwn(assets, url.pathname)) return new Response("Not found", { status: 404 });
    url.pathname = assets[url.pathname];
    const response = await env.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(response.headers);
    headers.set("X-Robots-Tag", "noindex, nofollow");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", url.pathname.endsWith(".html") ? "no-cache" : "public, max-age=3600");
    return new Response(response.body, { status: response.status, headers });
  },
};
