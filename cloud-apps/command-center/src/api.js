import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import {
  SESSION_DAYS, timingSafeEqualString, signSession, readSession,
  sessionCookieHeader, checkLockout, recordLoginFailure, clientIp, hmacHex,
} from './auth.js';
import {
  loginStore, insertAction, actionByIdem, actionById, claimQueued, completeAction,
  upsertChecklist, deleteChecklist, upsertHabit, upsertSnapshot, listSnapshots, upsertDealStage, listDealStages, listIdeas, upsertIdea, ideaById,
  listVideoProjects, replaceVideoProjects,
  upsertPost, listPosts, listChecklist, listHabits,
} from './db.js';
import { mergeSnapshot } from './snapshot.js';
import { boardStageFor, mapColumn } from './sponsors.js';
import { normalizePost } from './content.js';
import { runMoneyMove } from './money.js';
import { runOutreach } from './outreach.js';
import { exchangeGoogleCode, googleAuthUrl, runLife, ymd } from './life.js';
import { revalidateSources } from './revalidate.js';
import { persistQueueDrafts, listDrafts, upsertDraft } from './drafts.js';
import { fillFromEnv } from './daily-drafts.js';

const PREFIX = '/dashboard/api';
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });


function safeName(name) {
  return String(name || 'video.mp4').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'video.mp4';
}

function uploadKey(id, filename) {
  return `uploads/${id}/${filename}`;
}
function targetFor(kind, payload = {}) {
  if (kind === 'ping') return payload.machine === 'mac' || payload.machine === 'gpu2' ? payload.machine : null;
  if (kind === 'mastermind.park' || kind === 'content.save_draft' || kind === 'content.discard_draft' || kind === 'content.generate_drafts') return 'worker';
  if (kind === 'agent.restart') return payload.machine === 'mac' ? 'mac' : 'gpu2';
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
  const draftId = String(payload.uid || payload.id || '');
  const sendKind = kind === 'support.send' || kind === 'sponsor.send_draft' || kind === 'support.decide_refund';
  const allIds = (payload.ids || []).map(String).sort().join(',');
  let idem = String(body.idemKey || crypto.randomUUID());
  if (sendKind && draftId) idem = `send:${kind}:${draftId}`;
  else if (kind === 'support.send_all_safe' && allIds) idem = `send:${kind}:${allIds}`;
  if (env.DB) {
    const existing = await actionByIdem(env.DB, idem);
    if (existing) return json({ id: existing.id, status: existing.status, result: existing.result });
  }
  const target = targetFor(kind, payload);
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
    const existingIdea = await ideaById(env.DB, payload.id);
    if (existingIdea && ['sent', 'building', 'built'].includes(existingIdea.status)) {
      return json({ id: existingIdea.id, status: 'done', result: 'Already in Planner' });
    }
    await upsertIdea(env.DB, { id: payload.id, title: payload.title, body: payload.body, area: payload.area, verdict: payload.verdict || 'implement', status: 'sent' });
  }
  if ((kind === 'content.save_draft' || kind === 'content.discard_draft') && env.DB) {
    await upsertDraft(env.DB, {
      id: payload.id || crypto.randomUUID(),
      day: payload.day || ymd(Date.now()),
      platform: payload.platform || 'X',
      slot: payload.slot || 1,
      body: payload.body || '',
      subject: payload.subject || '',
      first_line: payload.first_line || String(payload.body || '').slice(0, 80),
      status: kind === 'content.discard_draft' ? 'discarded' : 'draft',
    });
    result = kind === 'content.discard_draft' ? 'Draft discarded' : 'Draft saved';
    status = 'done';
  }
  if (kind === 'content.generate_drafts' && env.DB) {
    const out = await fillFromEnv(env);
    result = `Filled ${out.inserted} drafts for ${out.day}`;
    status = 'done';
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
  if (rest === '/google/callback' && method === 'GET') {
    const ok = await exchangeGoogleCode(env, url.origin, url.searchParams.get('code'), url.searchParams.get('state'));
    return Response.redirect(`${url.origin}/dashboard/#life${ok ? '' : '?cal=err'}`, 302);
  }
  if (rest === '/snapshot' && method === 'GET') {
    const denied = await needSession(request, env);
    if (denied) return denied;
    const base = filterSnapshot(url.searchParams.get('pages'));
    if (!env.DB) return json(base);
    if (env.VIRALVIEW_SUMMARY_SECRET || env.MONEYCLAW_DASHBOARD_TOKEN || env.INSTANTLY_API_KEY || env.YT2_REVALIDATE === '1' || env.CRON_SECRET) {
      await revalidateSources(env);
    }
    const now = Date.now();
    const overrides = await listDealStages(env.DB);
    const extra = { habits: await listHabits(env.DB), checklist: await listChecklist(env.DB, ymd(now)), drafts: await listDrafts(env.DB, ymd(now)) };
    return json(mergeSnapshot(base, await listSnapshots(env.DB), now, overrides, await listIdeas(env.DB), await listPosts(env.DB), await listVideoProjects(env.DB), extra));
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
    if (source === 'content_queue' && env.DB) await persistQueueDrafts(env.DB, data, collectedAt);
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
    const buf = await request.arrayBuffer();
    if (env.UPLOADS) await env.UPLOADS.put(key, buf);
    const now = new Date().toISOString();
    const actionId = crypto.randomUUID();
    // ponytail: no studio POST exists; stay disconnected even if LOOP_STUDIO_URL/GPU1_VIDEO_URL is set
    return json({
      ok: true, stored: true, id: actionId, created_at: now,
      result: 'Uploaded · Loop Studio / GPU1 is not connected',
      editor: 'disconnected',
    });
  }
  if (up && method === 'GET') {
    const who = machineOf(request, env);
    if (!who) return json({ error: 'Unauthorized' }, 401);
    const key = url.searchParams.get('key') || uploadKey(up[1], safeName(url.searchParams.get('filename')));
    const obj = env.UPLOADS ? await env.UPLOADS.get(key) : null;
    if (!obj) return json({ error: 'Not found' }, 404);
    return new Response(obj.body, { headers: { 'Content-Type': 'application/octet-stream' } });
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
  if (rest === '/checklist' && method === 'POST' && env.DB) {
    const b = await request.json().catch(() => ({}));
    if (b.done === false) await deleteChecklist(env.DB, b.day, b.item);
    else await upsertChecklist(env.DB, b.day, b.item, b.done_at || new Date().toISOString(), b.how || 'manual');
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
