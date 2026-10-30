import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import {
  SESSION_DAYS, timingSafeEqualString, signSession, readSession,
  sessionCookieHeader, checkLockout, recordLoginFailure, clientIp,
} from './auth.js';
import {
  loginStore, insertAction, actionByIdem, actionById, claimQueued, claimedVideo, completeAction,
  reportAction, upsertHabit, upsertSnapshot, listSnapshots, upsertDealStage, listDealStages, listIdeas, upsertIdea, listHabits,
} from './db.js';
import { mergeSnapshot } from './snapshot.js';
import { listFunnel } from './webinar.js';
import { boardStageFor, mapColumn } from './sponsors.js';
import { runMoneyMove } from './money.js';
import { exchangeGoogleCode, googleAuthUrl, runLife } from './life.js';
import { REVIEW_SOURCE, draftId, isIsolated, parseReview, plannerDestination, reviewMutate, upsertReview } from './review.js';
import { handleV1, todayData } from './bots.js';
import { monthWindow } from './today.js';

const PREFIX = '/dashboard/api';
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });


function safeName(name) {
  return String(name || 'video.mp4').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'video.mp4';
}

function uploadKey(id, filename) {
  return `uploads/${id}/${filename}`;
}
function ownedOutputKey(payload) {
  const id = payload && payload.id;
  return id && !String(id).includes('/') && !String(id).includes('..') ? `uploads/${id}/out.mp4` : null;
}
function targetFor(kind) {
  if (kind.startsWith('sponsor.') || kind.startsWith('bank.')) return 'mac';
  if (kind === 'mastermind.send_to_planner') return 'gpu2'; // Viral View's "Send to Planner"
  return 'worker';
}

function machineOf(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const hits = [
    ['mac', env.MACHINE_TOKEN_MAC],
    ['gpu2', env.MACHINE_TOKEN_GPU2],
    ['gpu1', env.MACHINE_TOKEN_GPU1],
  ].filter(([, secret]) => secret && timingSafeEqualString(token, secret));
  return hits.length === 1 ? hits[0][0] : null;
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

// The dashboard's pages, in nav order. Today, Projects and Webinar have no fixture numbers at all.
export const PAGES = ['today', 'projects', 'sponsors', 'viral', 'webinar', 'money', 'life'];

function filterSnapshot(pages) {
  const want = pages ? pages.split(',').map((s) => s.trim()).filter((id) => PAGES.includes(id)) : PAGES;
  const out = {};
  for (const id of want) out[id] = snapshot.pages[id] || {};
  return JSON.parse(JSON.stringify({ pages: out, nav: liveNav(snapshot.nav), sources: snapshot.sources }));
}

// Retired 2026-10-29: the old MausBot team's feeds and the pages they fed. A collector still
// running somewhere gets 200 so it stops retrying, and nothing is stored.
export const RETIRED_SOURCES = new Set([
  'team', 'agents_gpu2', 'agents_mac', 'jon_tasks', 'needs_jon', 'partners_report', 'content_queue', 'support',
  'video', 'videos', 'mastermind', 'youtube', 'cc_review_drafts', 'health', 'probe', 'webinar', 'post',
]);

export function liveNav(orig) {
  // Drop the fixture's sidebar badges: they were mockup counts (85 sponsor emails,
  // 4 money items). Counts now live on the pages themselves.
  const { badges, ...nav } = orig;
  return {
    ...nav,
    groups: [
      { title: 'Today', items: [{ id: 'today', label: 'Today', icon: 'home' }, { id: 'projects', label: 'Projects', icon: 'board' }] },
      { title: 'Business', items: [
        { id: 'sponsors', label: 'Sponsors', icon: 'mail' },
        { id: 'viral', label: 'Viral View', icon: 'chart' },
        { id: 'webinar', label: 'Webinar', icon: 'clock' },
        { id: 'money', label: 'Money', icon: 'wallet' },
      ] },
      { title: 'Life', items: [{ id: 'life', label: 'Life', icon: 'heart' }] },
    ],
  };
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
  let target = targetFor(kind);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let result = payload.msg || 'Done';
  let status = target === 'worker' ? 'done' : 'queued';
  if (kind === 'sponsor.move_stage' && env.DB && payload.id && payload.stage) {
    await upsertDealStage(env.DB, String(payload.id), asBoardStage(payload.stage), now);
  }
  if (kind === 'mastermind.send_to_planner' && env.DB && payload.id) {
    const ideas = await listIdeas(env.DB);
    const existing = ideas.find((i) => i.id === payload.id);
    const dest = plannerDestination(payload.title);
    if (existing && ['sent', 'building', 'built'].includes(existing.status)) {
      return json({ id: existing.id, status: 'done', result: `Already in Planner. ${dest}` });
    }
    await upsertIdea(env.DB, { id: payload.id, title: payload.title, body: payload.body, area: payload.area, verdict: payload.verdict || 'implement', status: 'sent' });
    result = dest;
  }
  const mutate = reviewMutate(kind);
  if (mutate === 'send' && isIsolated(payload)) {
    return json({ id, status: 'done', result: 'Not sent · isolated draft' });
  }
  if ((mutate === 'save' || mutate === 'drop') && env.DB && draftId(payload)) {
    const stored = (await listSnapshots(env.DB)).find((r) => r.source === REVIEW_SOURCE);
    const rows = parseReview(stored?.data);
    const idKey = draftId(payload);
    const next = mutate === 'drop'
      ? rows.filter((r) => r.id !== idKey)
      : upsertReview(rows, {
        id: idKey, kind, recipient: payload.to || '', subject: payload.subject || '', body: payload.body || '',
        isolated: isIsolated(payload), updated_at: now,
      });
    await upsertSnapshot(env.DB, REVIEW_SOURCE, JSON.stringify(next), now, now);
    if (isIsolated(payload)) {
      target = 'worker';
      status = 'done';
      result = mutate === 'drop' ? 'Draft discarded' : 'Draft saved';
    }
  }
  if (kind === 'money.move_and_remember') {
    try {
      result = await runMoneyMove(env, payload);
      status = 'done';
    } catch (err) {
      result = err.message || 'Failed';
      status = 'failed';
    }
  }
  if (kind.startsWith('life.')) {
    try {
      result = await runLife(env, kind, payload);
      status = 'done';
    } catch (err) {
      result = err.message || 'Failed';
      status = 'failed';
    }
  }
  if (env.DB) {
    await insertAction(env.DB, {
      id, kind, target, payload: JSON.stringify(payload), status,
      result: status === 'queued' ? null : result, idem_key: idem, created_at: now,
      finished_at: status === 'queued' ? null : now,
    });
  }
  return json({ id, status, result: status === 'queued' ? null : result });
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

export async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
  if (!path.startsWith(PREFIX)) return json({ error: 'Not found' }, 404);

  const rest = path.slice(PREFIX.length) || '/';
  const method = request.method;

  // Per-bot API (bot tokens or Jon's session); see src/bots.js.
  if (rest === '/v1' || rest.startsWith('/v1/')) return handleV1(request, env, rest.slice(3), ctx);

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
  if (rest === '/google/callback' && method === 'GET') {
    const ok = await exchangeGoogleCode(env, url.origin, url.searchParams.get('code'), url.searchParams.get('state'));
    return Response.redirect(`${url.origin}/dashboard/#life${ok ? '' : '?cal=err'}`, 302);
  }
  if (rest === '/snapshot' && method === 'GET') {
    const denied = await needSession(request, env);
    if (denied) return denied;
    const base = filterSnapshot(url.searchParams.get('pages'));
    if (!env.DB) return json(base);
    const now = Date.now();
    const extra = { habits: await listHabits(env.DB), funnel: await listFunnel(env.CLONE_DB) };
    if (base.pages.today || base.pages.projects) extra.today = await todayData(env.DB, now, monthWindow(now).key);
    return json(mergeSnapshot(base, await listSnapshots(env.DB), now, await listDealStages(env.DB), extra));
  }

  if (rest === '/ingest' && method === 'POST') {
    const who = machineOf(request, env);
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    if (!who || (body.machine && body.machine !== who)) return json({ error: 'Unauthorized' }, 401);
    const source = String(body.source || '').trim();
    if (RETIRED_SOURCES.has(source) || source.startsWith('agents_')) return json({ ok: true, ignored: true });
    const collectedAt = String(body.collectedAt || '');
    if (!source || !Date.parse(collectedAt)) return json({ error: 'Bad ingest' }, 400);
    if (source === 'webinar_funnel' // written only by the Worker's own cron
      || (source.startsWith('machine_') && source !== `machine_${who}`)) {
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
    const fresh = env.DB ? await claimQueued(env.DB, who, new Date().toISOString()) : [];
    const stuck = env.DB ? await claimedVideo(env.DB, who) : [];
    const seen = new Set(fresh.map((row) => row.id));
    return json({ actions: fresh.concat(stuck.filter((row) => !seen.has(row.id))) });
  }


  const progress = rest.match(/^\/actions\/([^/]+)\/progress$/);
  if (progress && method === 'POST') {
    const who = machineOf(request, env);
    if (!who) return json({ error: 'Unauthorized' }, 401);
    const row = env.DB ? await actionById(env.DB, progress[1]) : null;
    if (!row || row.target !== who) return json({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const payload = JSON.parse(row.payload || '{}');
    const result = {
      host: who,
      stage: body.stage || 'prep',
      device: body.device === 'cuda' ? 'cpu' : (body.device || 'cpu'),
      encoder: body.encoder || 'libx264',
      failure: body.failure || null,
      retry: Number(body.retry) || 0,
      validated: Boolean(body.validated),
      outputKey: body.validated ? ownedOutputKey(payload) : null,
      segments: Array.isArray(body.segments) ? body.segments.filter((k) => k && Number.isFinite(Number(k.cs)) && Number.isFinite(Number(k.ce))) : [],
    };
    const status = result.stage === 'waiting-for-review' ? 'waiting' : 'claimed';
    await reportAction(env.DB, row.id, status, JSON.stringify(result));
    return json({ ok: true, id: row.id, status });
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

  const up = rest.match(/^\/uploads\/([^/]+)$/);
  if (up && method === 'GET') {
    const who = machineOf(request, env);
    if (!who) return json({ error: 'Unauthorized' }, 401);
    const id = up[1];
    const key = url.searchParams.get('key') || uploadKey(id, safeName(url.searchParams.get('filename')));
    if (!key.startsWith(`uploads/${id}/`) || key.includes('..')) return json({ error: 'Bad path' }, 400);
    const row = env.DB ? await actionByIdem(env.DB, `upload-${id}`) : null;
    if (!row || row.target !== who) return json({ error: 'Unauthorized' }, 401);
    const obj = env.UPLOADS ? await env.UPLOADS.get(key) : null;
    if (!obj) return json({ error: 'Not found' }, 404);
    return new Response(obj.body, { headers: { 'Content-Type': 'application/octet-stream' } });
  }
  const output = rest.match(/^\/uploads\/([^/]+)\/output$/);
  if (output && method === 'PUT') {
    const who = machineOf(request, env);
    if (who !== 'gpu1') return json({ error: 'Unauthorized' }, 401);
    const row = env.DB ? await actionByIdem(env.DB, `upload-${output[1]}`) : null;
    if (!row || row.target !== 'gpu1') return json({ error: 'Unauthorized' }, 401);
    const key = `uploads/${output[1]}/out.mp4`;
    if (env.UPLOADS) await env.UPLOADS.put(key, await request.arrayBuffer());
    return json({ ok: true, outputKey: key });
  }


  const denied = await needSession(request, env);
  if (denied) return denied;
  if (method !== 'GET') {
    const cc = needCc(request);
    if (cc) return cc;
  }
  if (rest === '/google/start' && method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) return json({ error: 'Google Calendar is not connected yet' }, 501);
    return Response.redirect(await googleAuthUrl(env, url.origin), 302);
  }

  if (rest === '/actions' && method === 'POST') return postAction(request, env);
  const one = rest.match(/^\/actions\/([^/]+)$/);
  if (one && method === 'GET') {
    if (!env.DB) return json({ id: one[1], status: 'done', result: 'Done' });
    const row = await actionById(env.DB, one[1]);
    if (!row) return json({ error: 'Not found' }, 404);
    return json({ id: row.id, status: row.status, result: row.result });
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
