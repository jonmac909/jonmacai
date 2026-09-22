import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import {
  SESSION_DAYS, timingSafeEqualString, signSession, readSession,
  sessionCookieHeader, checkLockout, recordLoginFailure, clientIp, hmacHex,
} from './auth.js';
import {
  loginStore, insertAction, actionByIdem, actionById, claimQueued, completeAction, latestAction,
  reportAction, requeueAction, listVideoJobs,
  upsertChecklist, upsertHabit, upsertSnapshot, listSnapshots, upsertDealStage, listDealStages, listIdeas, upsertIdea,
  listVideoProjects, replaceVideoProjects,
  upsertPost, listPosts, listChecklist, listHabits, deleteChecklist,
} from './db.js';
import { mergeSnapshot } from './snapshot.js';
import { overlayVideo } from './video.js';
import { boardStageFor, mapColumn } from './sponsors.js';
import { normalizePost } from './content.js';
import { runMoneyMove } from './money.js';
import { finishMastermindScan } from './mastermind-scan.js';
import { applyOutreachStatus, finishOutreachCheck, runOutreach } from './outreach.js';
import { exchangeGoogleCode, googleAuthUrl, runLife, ymd } from './life.js';
import {
  approveDraft, configuredPlatforms, fillFromEnv, listDrafts, saveDraft, tenantOf, unavailablePlatforms, vancouverDay,
} from './daily-drafts.js';
import { REVIEW_SOURCE, draftId, isIsolated, parseReview, plannerDestination, reviewMutate, upsertReview } from './review.js';

const PREFIX = '/dashboard/api';
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });


function safeName(name) {
  return String(name || 'video.mp4').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'video.mp4';
}

function uploadKey(id, filename) {
  return `uploads/${id}/${filename}`;
}
function keepersOk(keepers) {
  return Array.isArray(keepers) && keepers.length > 0 && keepers.every((k) =>
    k && Number.isFinite(Number(k.cs)) && Number.isFinite(Number(k.ce)) && Number(k.ce) > Number(k.cs)
    && typeof k.label === 'string' && k.label.trim());
}
function ownedOutputKey(payload) {
  const id = payload && payload.id;
  return id && !String(id).includes('/') && !String(id).includes('..') ? `uploads/${id}/out.mp4` : null;
}
function videoQueueItem(row) {
  let payload = {};
  let result = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { payload = {}; }
  try { result = row.result ? JSON.parse(row.result) : {}; } catch { result = {}; }
  const stage = row.status === 'queued' && payload.keepers ? 'resume' : (result.stage || row.status);
  return {
    id: payload.id || row.id,
    title: payload.title || 'Upload',
    status: row.status === 'done' ? 'ready' : row.status === 'waiting' ? 'waiting' : 'queued',
    host: result.host || 'gpu1',
    stage,
    failure: result.failure || '',
    readyPath: result.outputKey ? `/dashboard/api/uploads/${payload.id}/output` : '',
  };
}
function targetFor(kind, payload = {}) {
  if (kind === 'ping') return payload.machine === 'mac' || payload.machine === 'gpu2' ? payload.machine : null;
  if (kind === 'mastermind.park' || kind === 'mastermind.scan') return 'worker';
  if (kind === 'content.save_draft' || kind === 'content.approve_draft' || kind === 'content.generate_drafts') return 'worker';
  if (kind === 'agent.restart') return payload.machine === 'mac' ? 'mac' : 'gpu2';
  if (kind.startsWith('sponsor.') || kind.startsWith('bank.')) return 'mac';
  if (kind === 'video.start_edit') return 'gpu1';
  if (kind.startsWith('support.') || kind.startsWith('mastermind.') || kind.startsWith('content.') || kind.startsWith('video.') || kind.startsWith('agent.')) return 'gpu2';
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

function filterSnapshot(pages) {
  const want = pages ? pages.split(',').map((s) => s.trim()).filter(Boolean) : Object.keys(snapshot.pages);
  const out = {};
  for (const id of want) if (snapshot.pages[id]) out[id] = snapshot.pages[id];
  return JSON.parse(JSON.stringify({ pages: out, nav: snapshot.nav, goal: snapshot.goal, sources: snapshot.sources }));
}

async function postAction(request, env, ctx) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const kind = String(body.kind || 'ui.toast');
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  const idem = String(body.idemKey || crypto.randomUUID());
  if (env.DB) {
    const existing = await actionByIdem(env.DB, idem);
    if (existing) return json({ id: existing.id, status: existing.status, result: existing.result });
  }
  let target = targetFor(kind, payload);
  if (!target) return json({ error: 'Bad target' }, 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let result = payload.msg || 'Done';
  let status = target === 'worker' ? 'done' : 'queued';
  if (kind === 'sponsor.move_stage' && env.DB && payload.id && payload.stage) {
    await upsertDealStage(env.DB, String(payload.id), asBoardStage(payload.stage), now);
  }
  if (kind === 'mastermind.park') {
    result = 'Parked for later';
    status = 'done';
    if (env.DB && payload.id) {
      await upsertIdea(env.DB, { id: payload.id, title: payload.title, body: payload.body, area: payload.area, verdict: 'park', status: 'parked' });
    }
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
  if (kind === 'mastermind.scan') {
    if (!env.DB) return json({ error: 'Scan store is not available' }, 500);
    const id = crypto.randomUUID();
    await insertAction(env.DB, {
      id, kind, target: 'worker', payload: '{}', status: 'running',
      result: null, idem_key: idem, created_at: now, finished_at: null,
    });
    const work = finishMastermindScan(env, id);
    if (ctx?.waitUntil) ctx.waitUntil(work);
    else await work;
    if (ctx?.waitUntil) return json({ id, status: 'running', result: null });
    const row = await actionById(env.DB, id);
    return json({ id, status: row?.status || 'failed', result: row?.result ?? null });
  }
  if (kind === 'outreach.refresh') {
    if (!env.DB) return json({ error: 'Instantly store is not available' }, 500);
    const id = crypto.randomUUID();
    await insertAction(env.DB, {
      id, kind, target: 'worker', payload: '{}', status: 'running',
      result: null, idem_key: idem, created_at: now, finished_at: null,
    });
    const work = finishOutreachCheck(env, id);
    if (ctx?.waitUntil) ctx.waitUntil(work);
    else await work;
    if (ctx?.waitUntil) return json({ id, status: 'running', result: null });
    const row = await actionById(env.DB, id);
    return json({ id, status: row?.status || 'failed', result: row?.result ?? null });
  }
  if (kind.startsWith('outreach.')) {
    try {
      result = await runOutreach(env, kind, payload);
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
  if (kind === 'content.save_draft' || kind === 'content.approve_draft' || kind === 'content.generate_drafts') {
    const tenant = tenantOf(env);
    if (payload.tenant && payload.tenant !== tenant) return json({ error: 'Wrong tenant' }, 403);
    try {
      if (kind === 'content.generate_drafts') {
        const out = await fillFromEnv(env);
        result = out.failed
          ? `Filled ${out.inserted} slots for ${out.day}. ${out.failed} failed — no connected product facts. Nothing posted.`
          : `Filled ${out.inserted} drafts for ${out.day}. Nothing posted.`;
      } else if (kind === 'content.save_draft') {
        const saved = await saveDraft(env.DB, tenant, payload);
        if (!saved) return json({ error: 'Draft not found' }, 404);
        result = 'Edit saved · not published';
      } else {
        const saved = await approveDraft(env.DB, tenant, payload.id);
        if (!saved) return json({ error: 'Draft not found' }, 404);
        result = 'Approved · not published';
      }
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
    const overrides = await listDealStages(env.DB);
    const extra = { habits: await listHabits(env.DB), checklist: await listChecklist(env.DB, ymd(now)) };
    const tenant = tenantOf(env);
    try {
      extra.drafts = await listDrafts(env.DB, tenant, vancouverDay(now));
    } catch (err) {
      extra.drafts = [];
      extra.draftsError = err.message || 'Drafts unavailable';
    }
    extra.platforms = configuredPlatforms(env);
    extra.unavailable = unavailablePlatforms(env);
    const merged = mergeSnapshot(base, await listSnapshots(env.DB), now, overrides, await listIdeas(env.DB), await listPosts(env.DB), await listVideoProjects(env.DB), extra);
    if (merged.pages.outreach) {
      applyOutreachStatus(merged.pages.outreach, await latestAction(env.DB, 'outreach.refresh'), merged.sources?.instantly);
    }
    if (merged.pages.video) {
      const jobs = await listVideoJobs(env.DB);
      if (jobs.length) overlayVideo(merged.pages.video, { queue: jobs.map(videoQueueItem) });
      const beat = merged.sources?.video_gpu1;
      if (!beat || beat.stale) merged.pages.video.editing.meta = 'GPU1 disconnected';
    }
    return json(merged);
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
    if (source === 'post') {
      const items = Array.isArray(data) ? data : Array.isArray(data.posts) ? data.posts : [data];
      if (env.DB) {
        for (const item of items) {
          const row = normalizePost(item, 'agent', collectedAt);
          if (row.platform && (row.first_line || row.url)) await upsertPost(env.DB, row);
        }
      }
      return json({ ok: true });
    }
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
    };
    const status = result.stage === 'waiting-for-review' ? 'waiting' : 'claimed';
    await reportAction(env.DB, row.id, status, JSON.stringify(result));
    return json({ ok: true, id: row.id, status });
  }

  const resume = rest.match(/^\/actions\/([^/]+)\/resume$/);
  if (resume && method === 'POST') {
    const denied = await needSession(request, env);
    if (denied) return denied;
    const cc = needCc(request);
    if (cc) return cc;
    const row = env.DB ? await actionById(env.DB, resume[1]) : null;
    if (!row || row.target !== 'gpu1') return json({ error: 'Not found' }, 404);
    const body = await request.json().catch(() => ({}));
    const keepers = Array.isArray(body.keepers) ? body.keepers : [];
    if (!keepersOk(keepers)) return json({ error: 'Keepers required' }, 400);
    const payload = JSON.parse(row.payload || '{}');
    payload.keepers = keepers;
    if (Array.isArray(body.expectedLines)) payload.expectedLines = body.expectedLines.filter((line) => typeof line === 'string' && line.trim());
    const prev = row.result ? JSON.parse(row.result) : {};
    prev.stage = 'resume';
    await requeueAction(env.DB, row.id, JSON.stringify(payload), JSON.stringify(prev));
    return json({ ok: true, id: row.id, status: 'queued' });
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
  if (up && method === 'PUT') {
    const id = up[1];
    const exp = Number(url.searchParams.get('exp') || 0);
    const sig = url.searchParams.get('sig') || '';
    const filename = safeName(url.searchParams.get('filename'));
    const title = url.searchParams.get('title') || filename;
    if (!env.SESSION_SECRET || exp < Date.now() / 1000) return json({ error: 'Expired' }, 403);
    const want = await hmacHex(env.SESSION_SECRET, `${id}.${exp}.${filename}`);
    if (!timingSafeEqualString(sig, want)) return json({ error: 'Unauthorized' }, 403);
    const key = uploadKey(id, filename);
    const idem = `upload-${id}`;
    if (env.DB) {
      const existing = await actionByIdem(env.DB, idem);
      if (existing) return json({ ok: true, id: existing.id, status: existing.status, host: 'gpu1' });
    }
    const buf = await request.arrayBuffer();
    if (env.UPLOADS) await env.UPLOADS.put(key, buf);
    const now = new Date().toISOString();
    const actionId = crypto.randomUUID();
    if (env.DB) {
      await insertAction(env.DB, {
        id: actionId, kind: 'video.start_edit', target: 'gpu1',
        payload: JSON.stringify({ id, title, filename, key }),
        status: 'queued', result: null, idem_key: idem, created_at: now, finished_at: null,
      });
    }
    return json({ ok: true, id: actionId, status: 'queued', host: 'gpu1' });
  }
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
  if (output && method === 'GET') {
    const denied = await needSession(request, env);
    if (denied) return denied;
    const row = env.DB ? await actionByIdem(env.DB, `upload-${output[1]}`) : null;
    const result = row && row.result ? JSON.parse(row.result) : null;
    if (!row || !result || !result.validated || !result.outputKey) return json({ error: 'Not ready' }, 404);
    const obj = env.UPLOADS ? await env.UPLOADS.get(result.outputKey) : null;
    if (!obj) return json({ error: 'Not found' }, 404);
    return new Response(obj.body, { headers: { 'Content-Type': 'video/mp4' } });
  }
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

  if (rest === '/actions' && method === 'POST') return postAction(request, env, ctx);
  const one = rest.match(/^\/actions\/([^/]+)$/);
  if (one && method === 'GET') {
    if (!env.DB) return json({ id: one[1], status: 'done', result: 'Done' });
    const row = await actionById(env.DB, one[1]);
    if (!row) return json({ error: 'Not found' }, 404);
    return json({ id: row.id, status: row.status, result: row.result });
  }
  if (rest === '/checklist' && method === 'POST' && env.DB) {
    const b = await request.json().catch(() => ({}));
    if (b.done === false) await deleteChecklist(env.DB, b.day, b.item);
    else if (b.how === 'auto') return json({ ok: true, ignored: true });
    else await upsertChecklist(env.DB, b.day, b.item, b.done_at || new Date().toISOString(), 'manual');
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
  const idea = rest.match(/^\/ideas\/([^/]+)$/);
  if (idea && method === 'POST' && env.DB) {
    const b = await request.json().catch(() => ({}));
    await upsertIdea(env.DB, { id: idea[1], ...b });
    return json({ ok: true });
  }
  if (rest === '/uploads' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const id = crypto.randomUUID();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const filename = safeName(b.filename);
    const title = String(b.title || filename.replace(/\.[^.]+$/, '') || 'Recording');
    const sig = await hmacHex(env.SESSION_SECRET, `${id}.${exp}.${filename}`);
    const origin = new URL(request.url).origin;
    const putUrl = `${origin}/dashboard/api/uploads/${id}?exp=${exp}&sig=${sig}&filename=${encodeURIComponent(filename)}&title=${encodeURIComponent(title)}`;
    return json({ id, putUrl });
  }
  if (rest === '/video-projects' && method === 'PUT' && env.DB) {
    const list = await request.json().catch(() => []);
    if (!Array.isArray(list)) return json({ error: 'Bad projects' }, 400);
    await replaceVideoProjects(env.DB, list, new Date().toISOString());
    return json({ ok: true, n: list.length });
  }
  if (rest === '/posts' && method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const row = normalizePost(b, 'manual');
    if (!row.platform || !row.first_line) return json({ error: 'Need a platform and the first line' }, 400);
    if (env.DB) await upsertPost(env.DB, row);
    return json({ ok: true, id: row.id });
  }
  return json({ error: 'Not found' }, 404);
}
