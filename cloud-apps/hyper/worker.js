// hyper.jonmac.ai: the gate in front of the HyperFrames app that runs on GPU1 (docs: ./README.md).
//
// The app is a local server with no sign-in of its own, and it can run an agent on that PC, so nothing reaches it
// except through this Worker:
//   1. The dashboard's Hyper page (jonmac.ai/dash/#hyper) gets a 60-second ticket from the dashboard Worker and
//      opens /__enter?t=<ticket> here.
//   2. This Worker asks the dashboard Worker whether the ticket is real (service binding DASH), then sets its own
//      12-hour cookie, signed with GATE_SECRET.
//   3. Every other request needs that cookie, and is passed to the app over a private tunnel (binding STUDIO, a
//      Workers VPC service). The PC has no public address.
const COOKIE = '__Host-hyper';
const SESSION_HOURS = 12;
const LOCAL = 'http://localhost:5191'; // the address the app believes it is served from
const DASH_ORIGIN = 'https://jonmac.ai';
const DASH_PAGE = `${DASH_ORIGIN}/dash/#hyper`;
const FRAME_RULE = `frame-ancestors ${DASH_ORIGIN}`;

const enc = new TextEncoder();

function sameText(a, b) {
  const aa = enc.encode(String(a));
  const bb = enc.encode(String(b));
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const sign = (env, exp) => hmacHex(env.GATE_SECRET, `hyper-gate.${exp}`);

function cookieOf(request) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`));
  return m ? m[1] : '';
}

export async function readPass(request, env, nowMs = Date.now()) {
  const m = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(cookieOf(request));
  if (!m || !env.GATE_SECRET) return false;
  if (!sameText(m[2], await sign(env, m[1]))) return false;
  return nowMs < Number(m[1]) * 1000;
}

function page(status, title, body) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef0f3;color:#101216;font:15px/1.5 system-ui,sans-serif}
main{max-width:440px;padding:28px;border:1px solid #e1e4ea;border-radius:22px;background:#fff}h1{margin:0 0 8px;font-size:20px;font-weight:600}
p{margin:0 0 14px;color:#474c56}a,button{display:inline-block;padding:8px 16px;border:0;border-radius:999px;background:#2563eb;color:#fff;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}</style>
</head><body><main><h1>${title}</h1>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; ${FRAME_RULE}`,
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

const wantsPage = (request) => request.method === 'GET' && (request.headers.get('Accept') || '').includes('text/html');

function signedOut(request) {
  if (!wantsPage(request)) return new Response('Sign in at the dashboard', { status: 401, headers: { 'Cache-Control': 'no-store' } });
  return page(401, 'Open Hyper from the dashboard',
    `<p>This app opens from your dashboard, after you sign in there.</p><a href="${DASH_PAGE}" target="_top">Go to the dashboard</a>`);
}

function offline(request) {
  if (!wantsPage(request)) return new Response('The app is not reachable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  return page(502, 'Hyper is not reachable',
    '<p>The app runs on GPU1. That PC is off or asleep, or the app or its tunnel is not running there.</p><a href="">Try again</a>');
}

// /__enter?t=<ticket>: trade a dashboard ticket for this host's own cookie.
async function enter(request, env, url) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  if (!env.GATE_SECRET || !env.DASH) return new Response('The gate is not set up', { status: 503 });
  const ticket = url.searchParams.get('t') || '';
  let ok = false;
  if (/^\d{1,12}\.[0-9a-f]{64}$/.test(ticket)) {
    try {
      const res = await env.DASH.fetch(`${DASH_ORIGIN}/dashboard/api/hyper/check?t=${ticket}`);
      ok = res.ok && (await res.json()).ok === true;
    } catch { ok = false; }
  }
  if (!ok) return signedOut(request);
  const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.origin}/`,
      'Set-Cookie': `${COOKIE}=${exp}.${await sign(env, exp)}; Path=/; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; Secure; SameSite=Strict`, // the dashboard is the same site, so its frame and links carry it
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

// A write or a socket must come from this host's own pages: another site (or another jonmac.ai app) cannot drive it.
function fromOwnPage(request, url) {
  const socket = (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
  if (!socket && ['GET', 'HEAD'].includes(request.method)) return true;
  return request.headers.get('Origin') === url.origin;
}

// The app sees a plain local request: no gate cookie, no visitor headers, and no Origin (this Worker checked it).
function localHeaders(request) {
  const headers = new Headers(request.headers);
  const rest = (headers.get('Cookie') || '').split(/;\s*/).filter((c) => c && !c.startsWith(`${COOKIE}=`));
  if (rest.length) headers.set('Cookie', rest.join('; ')); else headers.delete('Cookie');
  for (const name of [...headers.keys()]) {
    if (/^(cf-|x-forwarded-|x-real-ip$|cdn-loop$|origin$|host$)/i.test(name)) headers.delete(name);
  }
  if (headers.has('Referer')) {
    try {
      const ref = new URL(headers.get('Referer'));
      headers.set('Referer', `${LOCAL}${ref.pathname}${ref.search}`);
    } catch { headers.delete('Referer'); }
  }
  return headers;
}

async function pass(request, env, url) {
  if (!env.STUDIO) return offline(request);
  const init = { method: request.method, headers: localHeaders(request), redirect: 'manual' };
  if (request.body) Object.assign(init, { body: request.body, duplex: 'half' });
  let res;
  try {
    res = await env.STUDIO.fetch(new Request(`${LOCAL}${url.pathname}${url.search}`, init));
  } catch {
    return offline(request);
  }
  if (res.status === 101) return res; // an open socket goes straight back
  const out = new Response(res.body, res);
  const to = out.headers.get('Location');
  if (to && to.startsWith(LOCAL)) out.headers.set('Location', `${url.origin}${to.slice(LOCAL.length)}`);
  out.headers.append('Content-Security-Policy', FRAME_RULE); // only the dashboard may frame the app
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/__enter') return enter(request, env, url);
    if (!(await readPass(request, env))) return signedOut(request);
    if (!fromOwnPage(request, url)) return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    return pass(request, env, url);
  },
};
