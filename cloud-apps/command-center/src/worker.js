import { handleApi } from './api.js';
import { handleCron } from './cron.js';
import { readSession } from './auth.js';
import { handleCall } from './call.js';
import { reviewProxy } from './videoreview.js';
import { reviewHook } from './reviewhook.js';
import { trackRedirect } from './track.js';
import { skoolRedirect, handleTracker, isBuiltIn } from './skool.js';
import { syncOnNewVersion, BUILT_IN_SLUGS } from './skoolroutes.js';
import { runSequence, SEQ_CRON } from './skoolseq.js';
import { FILE_PREFIX, serveProofFile, uploadProofFile } from './prooffiles.js';
import { MONITOR, handleMonitor } from './monitor.js';
import { handleTwilioAnswer, ROUTE as TWILIO_ANSWER } from './twilioanswer.js';

export { CallRelay } from './call.js';
export { GpuMonitor } from './monitor.js';

const PREFIX = '/dashboard';
const D2 = '/dashboard-2';
const D3 = '/dash';

async function asset(request, env, assetPath) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = assetPath;
  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (/\.(html|js|css)$/.test(assetPath)) headers.set('Cache-Control', 'no-cache');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const notFound = () => new Response('Not found', { status: 404 });
// The asset a path could reach: decoded, with repeated slashes and dot segments folded.
function assetTarget(p) {
  try { return new URL(decodeURIComponent(p).replace(/[\\/]+/g, '/'), 'https://a').pathname; } catch { return p; }
}
// Dashboards 2 and 3 serve their two pages and their own css and js, nothing else.
const D2_FILE = /^\/(login\.html|css\/[\w-]+\.css|js\/(?:[\w-]+\/)*[\w-]+\.js|img\/bots\/[a-z]+\.webp)$/;

// /scripts: Jon's private script review pages. Kept out of git (paid course text): they live in R2
// under private/scripts/ and are served only with a dashboard session. Allowlist names only, so no listing or traversal.
const SCRIPTS = '/scripts';
const SCRIPTS_FILE = /^\/(index\.html|course-\d{1,2}\.html|counts\.json)$/;
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
async function serveScripts(request, env, path) {
  if (!(await readSession(request, env))) {
    return new Response(null, { status: 302, headers: { Location: new URL('/dash/', request.url).toString(), ...PRIVATE_HEADERS } });
  }
  if (path === '/') path = '/index.html';
  const obj = SCRIPTS_FILE.test(path) ? await env.UPLOADS.get(`private/scripts${path}`) : null;
  if (!obj) return new Response('Not found', { status: 404, headers: PRIVATE_HEADERS });
  const type = path.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8';
  return new Response(obj.body, { headers: { 'Content-Type': type, ...PRIVATE_HEADERS } });
}

// {commit, deployedAt} from the version metadata the deploy sets. Nothing else is exposed.
function versionResponse(env) {
  const m = env.CF_VERSION_METADATA || {};
  const commit = /^[0-9a-f]{7,40}$/i.test(m.tag || '') ? m.tag.toLowerCase() : null;
  const t = m.timestamp ? new Date(m.timestamp) : null;
  const deployedAt = t && !isNaN(t) ? t.toISOString() : null;
  return new Response(JSON.stringify({ commit, deployedAt }), {
    status: commit && deployedAt ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}

export default {
  async fetch(request, env, ctx) {
    syncOnNewVersion(env, ctx); // once per isolate: a new version puts back the Skool slug routes its deploy dropped
    const url = new URL(request.url);
    // Only the separate preview Worker (wrangler --env preview, its own D1) answers on workers.dev.
    if (url.hostname.endsWith('.workers.dev') && env.PREVIEW !== '1') return new Response('Not found', { status: 404 });
    if (url.pathname.startsWith('/v/')) return trackRedirect(request, env, ctx);
    // Skool short links and the /track page (src/skool.js).
    if (url.pathname.startsWith('/s/')) return skoolRedirect(request, env, ctx);
    if (url.pathname === '/track' || url.pathname.startsWith('/track/')) return handleTracker(request, env);
    // Dashboard 2 (docs/dashboard-2.md): its own pages under public/d2; data comes from /dashboard/api/d2.
    if (url.pathname === D2) {
      url.pathname = `${D2}/`;
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname.startsWith(`${D2}/`)) {
      const path = url.pathname.slice(D2.length);
      if (path === '/' || path === '/index.html') return asset(request, env, (await readSession(request, env)) ? '/d2/index.html' : '/d2/login.html');
      return D2_FILE.test(path) ? asset(request, env, `/d2${path}`) : notFound();
    }
    // Public deploy check: exactly this path, answered before any sign-in. Commit = the deploy's version tag (wrangler deploy --tag <sha>).
    if (url.pathname === `${D3}/version` && (request.method === 'GET' || request.method === 'HEAD')) return versionResponse(env);
    // Dashboard 3 (docs/dashboard-3.md): its own pages under public/d3; data from /dashboard/api/d2 and /dashboard/api/d3.
    // Exact matches only, so /dashboard and /dashboard-2 never land here.
    if (url.pathname === D3) {
      url.pathname = `${D3}/`;
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname.startsWith(`${D3}/`)) {
      const path = url.pathname.slice(D3.length);
      // The Cards page is a hash route inside Dashboard 3; /dash/cards is its plain address: signed out goes to sign-in, signed in to the page.
      if (path === '/cards' || path === '/cards/') {
        const to = (await readSession(request, env)) ? `${D3}/#cards` : `${D3}/`;
        return new Response(null, { status: 302, headers: { Location: new URL(to, request.url).toString(), ...PRIVATE_HEADERS } });
      }
      if (path === '/' || path === '/index.html') return asset(request, env, (await readSession(request, env)) ? '/d3/index.html' : '/d3/login.html');
      return D2_FILE.test(path) ? asset(request, env, `/d3${path}`) : notFound();
    }
    // Ana phones Jon: Twilio's keypad answer in, Ana's poll out (src/twilioanswer.js).
    if (url.pathname === TWILIO_ANSWER || url.pathname.startsWith(`${TWILIO_ANSWER}/`)) return handleTwilioAnswer(request, env);
    // Live GPU Monitor (src/monitor.js): signed-in page and data, pusher-only POST.
    if (url.pathname === MONITOR || url.pathname.startsWith(`${MONITOR}/`)) return handleMonitor(request, env, asset);
    if (url.pathname === SCRIPTS) {
      url.pathname = `${SCRIPTS}/`;
      return new Response(null, { status: 308, headers: { Location: url.toString(), ...PRIVATE_HEADERS } });
    }
    if (url.pathname.startsWith(`${SCRIPTS}/`)) return serveScripts(request, env, url.pathname.slice(SCRIPTS.length));
    if (url.pathname === PREFIX) {
      url.pathname = `${PREFIX}/`;
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) {
      // Skool short links at the root, jonmac.ai/<slug> (Jon 2026-11-21): only after every route above, only known slugs.
      const m = /^\/([a-z0-9][a-z0-9-]{0,38}[a-z0-9])$/i.exec(url.pathname);
      if (isBuiltIn(url.pathname.slice(1).replace(/\/$/, '').toLowerCase())) return skoolRedirect(request, env, ctx); // social bio links and one-word video links, no DB row needed
      if (m && env.DB) {
        let known = null;
        try { known = await env.DB.prepare('SELECT slug FROM skool_links WHERE slug = ?').bind(m[1].toLowerCase()).first(); } catch { /* table missing: 404 */ }
        if (known) return skoolRedirect(request, env, ctx);
      }
      // The built-in routes are wildcards (jonmac.ai/x* so /x?fbclid=1 reaches us); any other path under them is the main site's, unchanged.
      if (env.APEX && BUILT_IN_SLUGS.some((s) => url.pathname.toLowerCase().startsWith(`/${s}`))) {
        try { return await env.APEX.fetch(request); } catch (err) { console.error('apex pass-through', err.message); return new Response('Bad gateway', { status: 502 }); }
      }
      return new Response('Not found', { status: 404 });
    }
    if (url.pathname.startsWith(FILE_PREFIX)) return serveProofFile(request, env);
    if (url.pathname === `${PREFIX}/api/v1/files`) return uploadProofFile(request, env);
    if (url.pathname.startsWith(`${PREFIX}/api/call/`)) return handleCall(request, env);
    if (url.pathname.startsWith(`${PREFIX}/api/review-hook/`)) return reviewHook(request, env, ctx);
    if (url.pathname === `${PREFIX}/review` || url.pathname.startsWith(`${PREFIX}/review/`) || url.pathname.startsWith(`${PREFIX}/api/review/`)) {
      return reviewProxy(request, env, ctx);
    }
    if (url.pathname.startsWith(`${PREFIX}/api/`)) return handleApi(request, env, ctx);

    let assetPath = url.pathname.slice(PREFIX.length) || '/';
    if (/^\/(d[23]|monitor)(\/|$)/i.test(assetTarget(assetPath))) return notFound(); // Dashboard 2's and 3's files only behind /dashboard-2 and /dash, the monitor's behind /monitor
    if (assetPath === '/') assetPath = '/index.html';
    if (assetPath === '/call') assetPath = '/call.html';
    if (assetPath === '/privacy') assetPath = '/privacy.html'; // public: Google's consent screen links here
    const html = assetPath === '/index.html' || assetPath === '/login.html' || assetPath === '/call.html';
    if (html && assetPath !== '/login.html') {
      const session = await readSession(request, env);
      if (!session) assetPath = '/login.html';
    }
    return asset(request, env, assetPath);
  },
  async scheduled(event, env, ctx) {
    // The Skool email sequence has its own 15-minute trigger (src/skoolseq.js); everything else runs on the 10-minute one.
    if (event?.cron === SEQ_CRON) ctx.waitUntil(runSequence(env));
    else ctx.waitUntil(handleCron(env));
  },
};
