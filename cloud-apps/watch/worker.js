import { byteRange } from '../review/worker.js';

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
    if (url.pathname === '/watch/viralview-launch.mp4') {
      const info = await env.MEDIA.head(env.VIDEO_KEY);
      if (!info) return new Response('Video unavailable', { status: 404 });
      const headers = new Headers({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ETag: info.httpEtag, 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' });
      if (request.headers.get('If-None-Match') === info.httpEtag) return new Response(null, { status: 304, headers });
      let range;
      try {
        const ifRange = request.headers.get('If-Range');
        range = byteRange(!ifRange || ifRange === info.httpEtag ? request.headers.get('Range') : null, info.size);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        headers.set('Content-Range', 'bytes */' + info.size);
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Length', String(range ? range.length : info.size));
      if (range) headers.set('Content-Range', 'bytes ' + range.offset + '-' + (range.offset + range.length - 1) + '/' + info.size);
      if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
      const object = await env.MEDIA.get(env.VIDEO_KEY, range ? { range } : undefined);
      if (!object) return new Response('Video unavailable', { status: 404 });
      return new Response(object.body, { status: range ? 206 : 200, headers });
    }
    url.pathname = assets[url.pathname];
    const response = await env.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(response.headers);
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    headers.set('X-Content-Type-Options', 'nosniff');
    if (url.pathname === '/index.html') headers.set('Cache-Control', 'no-cache');
    return new Response(response.body, { status: response.status, headers });
  },
};
