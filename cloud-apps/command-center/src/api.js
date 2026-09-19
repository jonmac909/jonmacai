import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import {
  COOKIE, SESSION_DAYS, timingSafeEqualString, signSession, readSession,
  sessionCookieHeader, checkLockout, recordLoginFailure, clientIp,
} from './auth.js';
import {
  loginStore, insertAction, actionByIdem, actionById, claimQueued, completeAction,
  upsertChecklist, upsertHabit,
} from './db.js';

const PREFIX = '/dashboard/api';
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function targetFor(kind) {
  if (kind.startsWith('sponsor.') || kind.startsWith('bank.')) return 'mac';
  if (kind.startsWith('support.') || kind.startsWith('mastermind.') || kind.startsWith('content.') || kind.startsWith('video.') || kind.startsWith('agent.')) return 'gpu2';
  return 'worker';
}

function machineOk(request, env, machine) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (machine === 'mac') return token && env.MACHINE_TOKEN_MAC && timingSafeEqualString(token, env.MACHINE_TOKEN_MAC);
  if (machine === 'gpu2') return token && env.MACHINE_TOKEN_GPU2 && timingSafeEqualString(token, env.MACHINE_TOKEN_GPU2);
  return false;
}

async function needSession(request, env) {
  const exp = await readSession(request, env);
  return exp ? null : json({ error: 'Sign in' }, 401);
}

function needCc(request) {
  return request.headers.get('X-CC') === '1' ? null : json({ error: 'Missing header' }, 403);
}

async function telegramAlert(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  }).catch(() => {});
}

async function login(request, env) {
  const ip = clientIp(request);
  const store = loginStore(env.DB);
  const locked = await checkLockout(store, ip, Date.now());
  if (locked) return json({ error: locked === 'global' ? 'Sign-in is paused for an hour.' : 'Too many tries. Wait 15 minutes.' }, 429);
  let password = '';
  try { password = String((await request.json()).password || ''); } catch { password = ''; }
  if (!timingSafeEqualString(password, env.DASHBOARD_PASSWORD || '')) {
    const r = await recordLoginFailure(store, ip, Date.now());
    if (r.alert) await telegramAlert(env, 'Command center: too many failed sign-ins. Locked for an hour.');
    if (r.globalLocked) return json({ error: 'Sign-in is paused for an hour.' }, 429);
    if (r.ipLocked) return json({ error: 'Too many tries. Wait 15 minutes.' }, 429);
    return json({ error: 'Wrong password. Try again.' }, 401);
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600;
  const token = await signSession(env.SESSION_SECRET, exp);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader(token, SESSION_DAYS * 24 * 3600) });
}

function filterSnapshot(pages) {
  const want = pages ? pages.split(',').map((s) => s.trim()).filter(Boolean) : Object.keys(snapshot.pages);
  const out = {};
  for (const id of want) if (snapshot.pages[id]) out[id] = snapshot.pages[id];
  return { pages: out, nav: snapshot.nav, goal: snapshot.goal, sources: snapshot.sources };
}

async function postAction(request, env) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const kind = String(body.kind || 'ui.toast');
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  const idem = String(body.idemKey || crypto.randomUUID());
  if (env.DB) {
    const existing = await actionByIdem(env.DB, idem);
    if (existing) return json({ id: existing.id, status: existing.status, result: existing.result });
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = payload.msg || 'Done';
  const target = targetFor(kind);
  const status = target === 'worker' ? 'done' : 'queued';
  if (env.DB) {
    await insertAction(env.DB, {
      id, kind, target, payload: JSON.stringify(payload), status,
      result: status === 'done' ? result : null, idem_key: idem, created_at: now,
      finished_at: status === 'done' ? now : null,
    });
  }
  return json({ id, status, result: status === 'done' ? result : null });
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
  if (!path.startsWith(PREFIX)) return json({ error: 'Not found' }, 404);

  const rest = path.slice(PREFIX.length) || '/';
  const method = request.method;

  if (rest === '/login' && method === 'POST') return login(request, env);
  if (rest === '/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader('', 0) });
  }
  if (rest === '/snapshot' && method === 'GET') {
    const denied = await needSession(request, env);
    if (denied) return denied;
    return json(filterSnapshot(url.searchParams.get('pages')));
  }

  if (rest === '/ingest' && method === 'POST') {
    const machine = (await request.json().catch(() => ({}))).machine;
    if (!machineOk(request, env, machine === 'gpu2' ? 'gpu2' : 'mac')) return json({ error: 'Unauthorized' }, 401);
    return json({ ok: true });
  }
  if (rest === '/actions/claim' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (!machineOk(request, env, body.machine)) return json({ error: 'Unauthorized' }, 401);
    const rows = env.DB ? await claimQueued(env.DB, body.machine, new Date().toISOString()) : [];
    return json({ actions: rows });
  }

  const complete = rest.match(/^\/actions\/([^/]+)\/complete$/);
  if (complete && method === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const okMac = env.MACHINE_TOKEN_MAC && timingSafeEqualString(token, env.MACHINE_TOKEN_MAC);
    const okGpu = env.MACHINE_TOKEN_GPU2 && timingSafeEqualString(token, env.MACHINE_TOKEN_GPU2);
    if (!okMac && !okGpu) return json({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    if (env.DB) await completeAction(env.DB, complete[1], body.ok ? 'done' : 'failed', JSON.stringify(body.result || {}), new Date().toISOString());
    return json({ ok: true });
  }

  const denied = await needSession(request, env);
  if (denied) return denied;
  if (method !== 'GET') {
    const cc = needCc(request);
    if (cc) return cc;
  }

  if (rest === '/actions' && method === 'POST') return postAction(request, env);
  const one = rest.match(/^\/actions\/([^/]+)$/);
  if (one && method === 'GET') {
    if (!env.DB) return json({ id: one[1], status: 'done', result: 'Done' });
    const row = await actionById(env.DB, one[1]);
    if (!row) return json({ error: 'Not found' }, 404);
    return json({ id: row.id, status: row.status, result: row.result });
  }
  if (rest === '/checklist' && method === 'POST' && env.DB) {
    const b = await request.json().catch(() => ({}));
    await upsertChecklist(env.DB, b.day, b.item, b.done_at || new Date().toISOString(), b.how || 'manual');
    return json({ ok: true });
  }
  if (rest === '/habits' && method === 'POST' && env.DB) {
    const b = await request.json().catch(() => ({}));
    await upsertHabit(env.DB, b.day, b.kind, b.done ? 1 : 0, b.note || '');
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}
