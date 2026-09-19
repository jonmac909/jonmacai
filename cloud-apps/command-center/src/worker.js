import { handleApi } from './api.js';
import { handleCron } from './cron.js';
import { readSession } from './auth.js';

const PREFIX = '/dashboard';

async function asset(request, env, assetPath) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = assetPath;
  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (assetPath.endsWith('.html')) headers.set('Cache-Control', 'no-cache');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === PREFIX) {
      url.pathname = `${PREFIX}/`;
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) {
      return new Response('Not found', { status: 404 });
    }
    if (url.pathname.startsWith(`${PREFIX}/api/`)) return handleApi(request, env);

    let assetPath = url.pathname.slice(PREFIX.length) || '/';
    if (assetPath === '/') assetPath = '/index.html';
    const html = assetPath === '/index.html' || assetPath === '/login.html';
    if (html && assetPath !== '/login.html') {
      const session = await readSession(request, env);
      if (!session) assetPath = '/login.html';
    }
    return asset(request, env, assetPath);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(handleCron(env));
  },
};
