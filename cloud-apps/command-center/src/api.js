import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import {
  SESSION_DAYS, timingSafeEqualString, signSession, readSession,
  sessionCookieHeader, checkLockout, recordLoginFailure, clientIp,
} from './auth.js';
import {
  loginStore, insertAction, actionByIdem, actionById, claimQueued, completeAction,
  upsertChecklist, upsertHabit, upsertSnapshot, listSnapshots, upsertDealStage, listDealStages,
} from './db.js';
import { mergeSnapshot } from './snapshot.js';
import { boardStageFor, mapColumn } from './sponsors.js';

const PREFIX = '/dashboard/api';
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function targetFor(kind, payload = {}) {
  if (kind === 'ping') return payload.machine === 'mac' || payload.machine === 'gpu2' ? payload.machine : null;
  if (kind.startsWith('sponsor.') || kind.startsWith('bank.')) return 'mac';
  if (kind.startsWith('support.') || kind.startsWith('mastermind.') || kind.startsWith('content.') || kind.startsWith('video.') || kind.startsWith('agent.')) return 'gpu2';
  return 'worker';
}

function machineOf(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const mac = token && env.MACHINE_TOKEN_MAC && timingSafeEqualString(token, env.MACHINE_TOKEN_MAC);
  const gpu = token && env.MACHINE_TOKEN_GPU2 && timingSafeEqualString(token, env.MACHINE_TOKEN_GPU2);
  if (mac && !gpu) return 'mac';
  if (gpu && !mac) return 'gpu2';
  return null;
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
  if (!env.DASHBOARD_PASSWORD || !env.SESSION_SECRET || !timingSafeEqualString(password, env.DASHBOARD_PASSWORD)) {
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
  return JSON.parse(JSON.stringify({ pages: out, nav: snapshot.nav, goal: snapshot.goal, sources: snapshot.sources }));
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
  const target = targetFor(kind, payload);
  if (!target) return json({ error: 'Bad target' }, 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = payload.msg || 'Done';
  const status = target === 'worker' ? 'done' : 'queued';
  if (kind === 'sponsor.move_stage' && env.DB && payload.id && payload.stage) {
    await upsertDealStage(env.DB, String(payload.id), asBoardStage(payload.stage), now);
  }
  if (env.DB) {
    await insertAction(env.DB, {
      id, kind, target, payload: JSON.stringify(payload), status,
      result: status === 'done' ? result : null, idem_key: idem, created_at: now,
      finished_at: status === 'done' ? now : null,
    });
  }
  return json({ id, status, result: status === 'done' ? result : null });
}

function asBoardStage(stage) {
  const s = String(stage || '');
  return mapColumn(s) !== 'New inquiry' || s === 'drafts' || s === 'new-lead' ? s : boardStageFor(s);
}

function resultText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value);
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
  if (!path.startsWith(PREFIX)) return json({ error: 'Not found' }, 404);

  const rest = path.slice(PREFIX.length) || '/';
  const method = request.method;

  if (rest === '/login' && method === 'POST') {
    const cc = needCc(request);
    if (cc) return cc;
    return login(request, env);
  }
  if (rest === '/logout' && method === 'POST') {
    const cc = needCc(request);
    if (cc) return cc;
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader('', 0) });
  }
  if (rest === '/snapshot' && method === 'GET') {
    const denied = await needSession(request, env);
    if (denied) return denied;
    const base = filterSnapshot(url.searchParams.get('pages'));
    if (!env.DB) return json(base);
    const overrides = await listDealStages(env.DB);
    return json(mergeSnapshot(base, await listSnapshots(env.DB), Date.now(), overrides));
  }

  if (rest === '/ingest' && method === 'POST') {
    const who = machineOf(request, env);
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    if (!who || (body.machine && body.machine !== who)) return json({ error: 'Unauthorized' }, 401);
    const source = String(body.source || '').trim();
    const collectedAt = String(body.collectedAt || '');
    if (!source || !Date.parse(collectedAt)) return json({ error: 'Bad ingest' }, 400);
    if ((source === 'agents_mac' && who !== 'mac') || (source === 'agents_gpu2' && who !== 'gpu2')) {
      return json({ error: 'Unauthorized' }, 401);
    }
    const data = body.data && typeof body.data === 'object' ? body.data : {};
    if (env.DB) await upsertSnapshot(env.DB, source, JSON.stringify(data), collectedAt, new Date().toISOString());
    return json({ ok: true });
  }
  if (rest === '/actions/claim' && method === 'POST') {
    const who = machineOf(request, env);
    const body = await request.json().catch(() => ({}));
    if (!who || who !== body.machine) return json({ error: 'Unauthorized' }, 401);
    const rows = env.DB ? await claimQueued(env.DB, who, new Date().toISOString()) : [];
    return json({ actions: rows });
  }

  const complete = rest.match(/^\/actions\/([^/]+)\/complete$/);
  if (complete && method === 'POST') {
    const who = machineOf(request, env);
    if (!who) return json({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    if (!env.DB) return json({ ok: true });
    const row = await actionById(env.DB, complete[1]);
    if (!row || row.target !== who) return json({ error: 'Unauthorized' }, 401);
    await completeAction(env.DB, complete[1], body.ok ? 'done' : 'failed', resultText(body.result), new Date().toISOString());
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
  const deal = rest.match(/^\/deals\/([^/]+)\/stage$/);
  if (deal && method === 'POST' && env.DB) {
    const b = await request.json().catch(() => ({}));
    const stage = asBoardStage(b.stage);
    const now = new Date().toISOString();
    const dealId = decodeURIComponent(deal[1]);
    await upsertDealStage(env.DB, dealId, stage, now);
    const id = crypto.randomUUID();
    await insertAction(env.DB, {
      id, kind: 'sponsor.move_stage', target: 'mac',
      payload: JSON.stringify({ id: dealId, stage }),
      status: 'queued', result: null, idem_key: id, created_at: now, finished_at: null,
    });
    return json({ ok: true, id });
  }
  return json({ error: 'Not found' }, 404);
}
