export const COOKIE = '__Host-cc_session';
export const SESSION_DAYS = 30;
export const IP_WINDOW_MS = 15 * 60 * 1000;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
export const IP_LOCK_AFTER = 10;
export const GLOBAL_LOCK_AFTER = 50;

const enc = new TextEncoder();

export function timingSafeEqualString(a, b) {
  const aa = enc.encode(String(a));
  const bb = enc.encode(String(b));
  const n = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < n; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signSession(secret, exp) {
  return `${exp}.${await hmacHex(secret, String(exp))}`;
}

export async function verifySession(secret, token, nowMs = Date.now()) {
  if (!token || !secret) return null;
  const i = String(token).indexOf('.');
  if (i < 1) return null;
  const exp = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = await hmacHex(secret, exp);
  if (!timingSafeEqualString(sig, expect)) return null;
  const expN = Number(exp);
  if (!Number.isFinite(expN) || nowMs >= expN * 1000) return null;
  return expN;
}

export function sessionCookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function cookieValue(request, name = COOKIE) {
  const raw = request.headers.get('Cookie') || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
}

export async function readSession(request, env, nowMs = Date.now()) {
  return verifySession(env.SESSION_SECRET, cookieValue(request), nowMs);
}

async function bump(store, ip, now, windowMs) {
  const row = await store.get(ip);
  const start = row ? Number(row.window_start) : 0;
  const next = !row || now - start >= windowMs
    ? { ip, count: 1, window_start: String(now) }
    : { ip, count: row.count + 1, window_start: row.window_start };
  await store.put(ip, next);
  return next;
}

export async function checkLockout(store, ip, now) {
  const g = await store.get('*');
  if (g && g.count > GLOBAL_LOCK_AFTER && now - Number(g.window_start) < GLOBAL_WINDOW_MS) return 'global';
  const r = await store.get(ip);
  if (r && r.count >= IP_LOCK_AFTER && now - Number(r.window_start) < IP_WINDOW_MS) return 'ip';
  return null;
}

export async function recordLoginFailure(store, ip, now) {
  const ipRow = await bump(store, ip, now, IP_WINDOW_MS);
  let ipLocked = ipRow.count >= IP_LOCK_AFTER;
  if (ipRow.count === IP_LOCK_AFTER) {
    ipRow.window_start = String(now);
    await store.put(ip, ipRow);
    ipLocked = true;
  }
  const gRow = await bump(store, '*', now, GLOBAL_WINDOW_MS);
  let globalLocked = gRow.count > GLOBAL_LOCK_AFTER;
  let alert = false;
  if (gRow.count === GLOBAL_LOCK_AFTER + 1) {
    gRow.window_start = String(now);
    await store.put('*', gRow);
    globalLocked = true;
    alert = true;
  }
  return { ipLocked, globalLocked, alert };
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim()
    || '0.0.0.0';
}
