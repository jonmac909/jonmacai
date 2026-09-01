const PREFIX = "/yt2";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === PREFIX) {
      url.pathname = `${PREFIX}/`;
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) {
      return new Response("Not found", { status: 404 });
    }

    let assetPath = url.pathname.slice(PREFIX.length) || "/";
    if (assetPath === "/") assetPath = "/index.html";

    const assetUrl = new URL(request.url);
    assetUrl.pathname = assetPath;
    const assetRequest = new Request(assetUrl, request);
    const response = await env.ASSETS.fetch(assetRequest);

    const headers = new Headers(response.headers);
    headers.set("X-Robots-Tag", "noindex, nofollow");
    if (assetPath.endsWith("rows_data.js")) headers.set("Cache-Control", "no-cache");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
