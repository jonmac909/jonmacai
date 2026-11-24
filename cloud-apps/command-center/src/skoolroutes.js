// Skool root links get their own Cloudflare route (Jon 2026-11-21): jonmac.ai/<slug> -> this worker, made when the link is
// added on /track. The apex site (worker "elevateapp", route jonmac.ai/*) owns every other path, so a slug is refused when it
// is one of our own paths, matches another worker's route, or is a real page on the apex site.
// Secret CF_ROUTES_TOKEN = a Cloudflare API token with Zone > Workers Routes > Edit on jonmac.ai; var CF_ZONE_ID.
// Routes are only written when var ROUTES_LIVE is "1" (production only); previews and tests run dry.
// `wrangler deploy` replaces the worker's route list with wrangler.jsonc's, which drops API-made routes: the 10-minute cron
// and the first request a new version serves put any missing slug route back (syncSlugRoutes / syncOnNewVersion).

export const HOST = 'jonmac.ai';
export const SCRIPT = 'jonmac-command-center';
const API = 'https://api.cloudflare.com/client/v4';
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
// This worker's own paths (wrangler.jsonc routes and src/worker.js) plus names that must never become a short link.
export const RESERVED = new Set(['dashboard', 'dashboard-2', 'dash', 'scripts', 'v', 's', 'track', 'monitor', 'twilio', 'api', 'www', 'guides', 'go', 'lab']);
// Other workers' routes on the zone (GET /zones/{zone}/workers/routes, 2026-11-21). Used when the live list can't be read,
// and always alongside it, so a slug is never let through just because the API was down.
export const OTHER_ROUTES = [
  'jonmac.ai/search', 'jonmac.ai/search/*', 'jonmac.ai/yt*', 'jonmac.ai/team*', 'jonmac.ai/batch', 'jonmac.ai/batch/*',
  'jonmac.ai/yt2', 'jonmac.ai/yt2/*', 'jonmac.ai/api/review/*', 'jonmac.ai/review*', 'jonmac.ai/tasks*', 'jonmac.ai/farm',
  'jonmac.ai/farm/*', 'jonmac.ai/watch', 'jonmac.ai/watch/*', 'jonmac.ai/frame', 'jonmac.ai/frame/*', 'jonmac.ai/sign',
  'jonmac.ai/sign/', 'jonmac.ai/sign/*', 'jonmac.ai/generator', 'jonmac.ai/generator/*', 'jonmac.ai/agency*', 'jonmac.ai/clone*',
].map((pattern) => ({ pattern, script: 'other' }));
const SYNC_KEY = 'routes_synced_version';

const live = (env) => env?.ROUTES_LIVE === '1';
const patternOf = (slug) => `${HOST}/${slug}`;
const globRe = (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

async function cf(env, path, init = {}) {
  const r = await fetch(`${API}/zones/${env.CF_ZONE_ID}/workers/routes${path}`, {
    ...init, headers: { Authorization: `Bearer ${env.CF_ROUTES_TOKEN}`, 'Content-Type': 'application/json' },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`Cloudflare routes API ${r.status}: ${(j.errors || []).map((e) => e.message).join('; ') || 'no detail'}`);
  return j.result;
}

// The zone's route list, or null off production, without a token, or when the API fails.
export async function listRoutes(env) {
  if (!live(env) || !env.CF_ROUTES_TOKEN || !env.CF_ZONE_ID) return null;
  try { return await cf(env, ''); } catch (err) { console.error('list routes', err.message); return null; }
}

// The other worker whose route would catch jonmac.ai/<slug>, or null. The apex catch-all (jonmac.ai/*) is checked through APEX instead.
export function routeClash(routes, slug) {
  const url = patternOf(slug);
  for (const r of routes || []) {
    if (!r?.pattern || r.script === SCRIPT || r.pattern === `${HOST}/*`) continue;
    if (globRe(r.pattern).test(url)) return r.pattern;
  }
  return null;
}

// Why the slug can't be a root link, or null. routes = the live zone list (null: the checked-in list only).
export async function slugRefusal(env, slug, routes) {
  if (!SLUG_RE.test(slug)) return 'Slug: 2 to 40 lower-case letters, numbers or dashes';
  if (RESERVED.has(slug)) return `"${slug}" is a dashboard path`;
  const clash = routeClash(OTHER_ROUTES, slug) || routeClash(routes, slug);
  if (clash) return `"${slug}" is taken by another app on jonmac.ai (${clash})`;
  if (!env?.APEX) return live(env) ? 'Could not check the jonmac.ai site (APEX binding missing)' : null;
  try {
    const r = await env.APEX.fetch(new Request(`https://${patternOf(slug)}`, { redirect: 'manual', signal: AbortSignal.timeout(5000) }));
    if (r.status !== 404) return `jonmac.ai/${slug} is already a page on the site`;
  } catch (err) {
    return 'Could not check the jonmac.ai site, try again';
  }
  return null;
}

// Makes the route jonmac.ai/<slug> -> this worker if it isn't there. Never throws: {route, warning?}.
export async function ensureSlugRoute(env, slug, routes) {
  const pattern = patternOf(slug);
  if (!live(env)) return { route: 'dry-run', pattern, warning: 'route not created: dry run (not production)' };
  if (!env.CF_ROUTES_TOKEN || !env.CF_ZONE_ID) return { route: 'none', pattern, warning: 'route not created: token missing' };
  try {
    const list = routes || await cf(env, '');
    if (list.some((r) => r.pattern === pattern && r.script === SCRIPT)) return { route: 'exists', pattern };
    await cf(env, '', { method: 'POST', body: JSON.stringify({ pattern, script: SCRIPT }) });
    return { route: 'created', pattern };
  } catch (err) {
    console.error('route create', slug, err.message);
    return { route: 'none', pattern, warning: `route not created: ${err.message}` };
  }
}

// Removes this worker's route for the slug (no delete API for links yet). {route: 'removed' | 'absent' | 'dry-run'}.
export async function removeSlugRoute(env, slug) {
  const pattern = patternOf(slug);
  if (!live(env) || !env.CF_ROUTES_TOKEN || !env.CF_ZONE_ID) return { route: 'dry-run', pattern };
  const hit = (await cf(env, '')).find((r) => r.pattern === pattern && r.script === SCRIPT);
  if (!hit) return { route: 'absent', pattern };
  await cf(env, `/${encodeURIComponent(hit.id)}`, { method: 'DELETE' });
  return { route: 'removed', pattern };
}

// Re-creates every missing slug route (a deploy drops them). Slugs that now clash are skipped, never routed.
export async function syncSlugRoutes(env) {
  if (!live(env) || !env.CF_ROUTES_TOKEN || !env.CF_ZONE_ID || !env.DB) return { created: [], skipped: [] };
  const routes = await cf(env, '');
  const have = new Set(routes.filter((r) => r.script === SCRIPT).map((r) => r.pattern));
  const { results } = await env.DB.prepare('SELECT slug FROM skool_links').all();
  const created = [], skipped = [];
  for (const { slug } of results || []) {
    if (have.has(patternOf(slug))) continue;
    const why = await slugRefusal(env, slug, routes);
    if (why) { skipped.push(slug); console.error('route sync skipped', slug, why); continue; }
    // One failed create (e.g. a duplicate from a parallel sync) must not stop the rest.
    try { await cf(env, '', { method: 'POST', body: JSON.stringify({ pattern: patternOf(slug), script: SCRIPT }) }); }
    catch (err) { skipped.push(slug); console.error('route sync create failed', slug, err.message); continue; }
    created.push(slug);
  }
  return { created, skipped };
}

// Once per isolate: if this version hasn't synced the slug routes yet, do it in the background (the deploy's own
// /dash/version check is usually that first request, so routes come back seconds after a deploy, not at the next cron).
let checked = false;
export function syncOnNewVersion(env, ctx) {
  if (checked || !live(env) || !env.CF_ROUTES_TOKEN || !env.DB || !ctx?.waitUntil) return;
  checked = true;
  const version = env.CF_VERSION_METADATA?.id;
  if (!version) return;
  ctx.waitUntil((async () => {
    const row = await env.DB.prepare('SELECT value FROM skool_settings WHERE key = ?').bind(SYNC_KEY).first();
    if (row?.value === version) return;
    await syncSlugRoutes(env);
    const at = new Date().toISOString();
    await env.DB.prepare('INSERT INTO skool_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .bind(SYNC_KEY, version, at).run();
  })().catch((err) => console.error('route sync on new version', err.message)));
}
export const _resetVersionCheck = () => { checked = false; };
