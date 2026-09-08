export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const assets = {
      '/watch': '/index.html',
      '/watch/': '/index.html',
      '/watch/viralview-launch.mp4': '/viralview-launch.mp4',
      '/watch/poster.png': '/poster.png',
    };
    if (!Object.hasOwn(assets, url.pathname)) return new Response('Not found', { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    url.pathname = assets[url.pathname];
    const response = await env.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(response.headers);
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    headers.set('X-Content-Type-Options', 'nosniff');
    if (url.pathname === '/index.html') headers.set('Cache-Control', 'no-cache');
    return new Response(response.body, { status: response.status, headers });
  },
};
