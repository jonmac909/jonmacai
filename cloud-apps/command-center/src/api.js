import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import {
  SESSION_DAYS, timingSafeEqualString, signSession, readSession,
  sessionCookieHeader, checkLockout, recordLoginFailure, clientIp,
} from './auth.js';
import {
  loginStore, insertAction, actionByIdem, actionById, claimQueued, claimedVideo, completeAction,
  reportAction, upsertHabit, upsertSnapshot, listSnapshots, getSnapshot, getSponsorDeals, putSponsorDeals, upsertDealStage, listDealStages, listIdeas, upsertIdea, listHabits,
} from './db.js';
import { mergeSnapshot } from './snapshot.js';
import { listFunnel } from './webinar.js';
import { boardStageFor, dealThreadIds, draftThreadIds } from './sponsors.js';
import { runMoneyMove } from './money.js';
import { exchangeGoogleCode, gClientId, googleAuthUrl, pullCalendar, runLife } from './life.js';
import { homeData, homeWrite } from './home.js';
import { personalData, personalWrite } from './personal.js';
import { REVIEW_SOURCE, draftId, isIsolated, parseReview, plannerDestination, reviewMutate, upsertReview } from './review.js';
import { botOf, handleV1, todayData } from './bots.js';
import { pipelineOf } from '../public/d3/js/goals.js';
import { freshen, youtubeAnalyticsCheck, youtubeCallback, youtubeConnect, youtubeStatus } from './youtube.js';
import { channelData } from './channels.js';
import { trackData } from './track.js';
import { monthWindow } from './today.js';
import { buildD2, d2Data } from './d2.js';
import { funnelsData } from './funnels.js';
import { buildD3, d3Data, factoryData } from './d3.js';
import { buildPending, pendingData } from './pending.js';
import { hyperEntry, hyperTicketOk } from './hyper.js';

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
  if (kind === 'sponsor.add_deal' || kind === 'sponsor.set_amount') return 'worker'; // kept on the Worker, never queued to the Mac
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

// The dashboard's pages, in nav order. Today, Todo, Projects, Calendar, Content and Webinar have no fixture
// numbers at all (the fixture's old "content" mockup is never served); Feed and Journal load their own rows
// from /v1 (activity, journal).
export const PAGES = ['today', 'weekly', 'monthly', 'todo', 'projects', 'feed', 'calendar', 'content', 'track', 'factory', 'sponsors', 'viral', 'webinar', 'money', 'life', 'journal'];
const LIVE_ONLY = ['calendar', 'content', 'track'];

function filterSnapshot(pages) {
  const want = pages ? pages.split(',').map((s) => s.trim()).filter((id) => PAGES.includes(id)) : PAGES;
  const out = {};
  for (const id of want) out[id] = (!LIVE_ONLY.includes(id) && snapshot.pages[id]) || {};
  return JSON.parse(JSON.stringify({ pages: out, nav: liveNav(snapshot.nav), sources: snapshot.sources }));
}

// The bot-table and calendar rows the live pages need, shared by /snapshot and /d2.
async function snapshotExtra(env, base, now) {
  const extra = { habits: await listHabits(env.DB), funnel: await listFunnel(env.CLONE_DB), deals: await getSponsorDeals(env.DB) };
  if (base.pages.today || base.pages.projects || base.pages.todo) extra.today = await todayData(env.DB, now, monthWindow(now).key);
  if (base.pages.calendar || base.pages.content) extra.channels = await channelData(env.DB, now);
  return extra;
}
const D2_PAGES = 'today,projects,sponsors,viral,money,calendar,content';

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
      { title: 'Today', items: [
        { id: 'today', label: 'Today', icon: 'home' },
        { id: 'weekly', label: 'Weekly', icon: 'cal' },
        { id: 'monthly', label: 'Monthly', icon: 'chart' },
        { id: 'todo', label: 'Todo', icon: 'check' },
        { id: 'projects', label: 'Projects', icon: 'board' },
        { id: 'feed', label: 'Feed', icon: 'chat' },
        // Review is a link to the video review pages (src/videoreview.js), not a snapshot page.
        { id: 'review', label: 'Review', icon: 'film', href: '/dashboard/review' },
      ] },
      { title: 'YouTube', items: [{ id: 'calendar', label: 'Calendar', icon: 'cal' }, { id: 'content', label: 'Content', icon: 'trend' }, { id: 'track', label: 'Track', icon: 'chart' }, { id: 'factory', label: 'Factory', icon: 'board' }] },
      { title: 'Business', items: [
        { id: 'sponsors', label: 'Sponsors', icon: 'mail' },
        { id: 'viral', label: 'Viral View', icon: 'chart' },
        { id: 'webinar', label: 'Webinar', icon: 'clock' },
        { id: 'money', label: 'Money', icon: 'wallet' },
      ] },
      { title: 'Life', items: [{ id: 'life', label: 'Life', icon: 'heart' }, { id: 'journal', label: 'Journal', icon: 'pen' }] },
    ],
  };
}

async function postAction(request, env, parsed = null) {
  let body = parsed || {};
  if (!parsed) try { body = await request.json(); } catch { body = {}; }
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
  if ((kind === 'sponsor.add_deal' || kind === 'sponsor.set_amount') && env.DB) {
    const tid = String(payload.threadId || '');
    const dealId = String(payload.id || (tid ? `gmail-thread-${tid}` : ''));
    const bad = (m) => json({ id, status: 'failed', result: m }, 400);
    if (!/^gmail-thread-[0-9a-f]{6,32}$/i.test(dealId)) return bad('bad id');
    if (tid && !/^[0-9a-f]{6,32}$/i.test(tid)) return bad('bad threadId');
    if (payload.amount != null && payload.amount !== '' && !(Number.isFinite(Number(payload.amount)) && Number(payload.amount) >= 0 && Number(payload.amount) <= 1000000)) return bad('bad amount');
    if (kind === 'sponsor.set_amount' && (payload.amount == null || payload.amount === '')) return bad('amount required');
    for (const k of ['brand', 'sponsor', 'contact', 'next', 'blocker', 'status', 'subject']) if (payload[k] != null && String(payload[k]).length > 200) return bad(`${k} too long`);
    if (kind === 'sponsor.add_deal' && payload.stage != null && !KNOWN_STAGES.has(String(payload.stage))) return bad('unknown stage');
    const deals = await getSponsorDeals(env.DB);
    if (!deals[dealId] && Object.keys(deals).length >= 500) return bad('too many deals');
    const prev = deals[dealId] || {};
    if (kind === 'sponsor.add_deal') {
      const stage = asBoardStage(payload.stage || 'new-lead');
      deals[dealId] = {
        ...prev, id: dealId, sponsor: String(payload.brand || payload.sponsor || prev.sponsor || dealId), contact: String(payload.contact || prev.contact || ''),
        stage, ...(Number(payload.amount) > 0 ? { amountSet: Number(payload.amount) } : {}), next: String(payload.next ?? prev.next ?? ''),
        blocker: String(payload.blocker ?? prev.blocker ?? ''), status: String(payload.status ?? prev.status ?? ''), subject: String(payload.subject ?? prev.subject ?? ''),
        threadId: tid || prev.threadId || dealId.replace(/^gmail-thread-/, ''), added: prev.added || now, updatedAt: now,
      };
      await upsertDealStage(env.DB, dealId, stage, now);
    } else {
      deals[dealId] = { ...prev, id: dealId, amountSet: Number(payload.amount) || 0, ...(payload.brand ? { brand: String(payload.brand) } : {}), updatedAt: now };
    }
    await putSponsorDeals(env.DB, deals, now);
    result = kind === 'sponsor.add_deal' ? `Added ${deals[dealId].sponsor}` : 'Amount set';
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

// The /d2 pages and d2 view, shared by /d2 and the bots' GET /v1/sponsors.
async function d2Build(env, now) {
  const base = filterSnapshot(D2_PAGES);
  const rows = env.DB ? await listSnapshots(env.DB) : [];
  const extra = env.DB ? await snapshotExtra(env, base, now) : {};
  const out = mergeSnapshot(base, rows, now, env.DB ? await listDealStages(env.DB) : {}, extra);
  return { out, d2: buildD2(out, rows, extra, await d2Data(env, now), now) };
}

// Bots with a v1 token (2026-11-11): the sponsor plan loader posts the same actions Jon's board does (same handler and
// checks as /actions, these kinds only), and a bot reads the Sponsors page plus the Goals pipeline totals Jon sees.
const SPONSOR_BOTS = ['developer', 'ana'];
const SPONSOR_BOT_FIELDS = {
  'sponsor.move_stage': ['id', 'stage'],
  'sponsor.add_deal': ['id', 'threadId', 'brand', 'sponsor', 'contact', 'stage', 'amount', 'next', 'blocker', 'status', 'subject'],
  'sponsor.set_amount': ['id', 'amount', 'brand'],
};
const SPONSOR_BOT_KINDS = Object.keys(SPONSOR_BOT_FIELDS);
async function sponsorsForBot(request, env, rest) {
  const bot = await botOf(request, env.DB);
  if (!bot) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (!SPONSOR_BOTS.includes(bot)) return json({ ok: false, error: `Only ${SPONSOR_BOTS.join(', ')} can use this` }, 403);
  if (rest === '/v1/sponsors/actions' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !SPONSOR_BOT_KINDS.includes(body.kind)) return json({ ok: false, error: `kind must be one of: ${SPONSOR_BOT_KINDS.join(', ')}` }, 400);
    const p = body.payload && typeof body.payload === 'object' ? body.payload : {};
    // Only this kind's own fields reach postAction (no msg, isolated or other extras).
    const payload = Object.fromEntries(SPONSOR_BOT_FIELDS[body.kind].filter((k) => p[k] != null).map((k) => [k, p[k]]));
    if (body.kind === 'sponsor.move_stage' && (!/^gmail-thread-[0-9a-f]{6,32}$/i.test(String(payload.id || '')) || !KNOWN_STAGES.has(String(payload.stage || '')))) {
      return json({ ok: false, error: 'move_stage needs a gmail-thread-<hex> id and a known stage' }, 400);
    }
    // Bot keys live in their own namespace: no reading Jon's actions by key, and the row records the bot.
    const idemKey = `bot:${bot}:${body.idemKey != null ? String(body.idemKey).slice(0, 400) : crypto.randomUUID()}`;
    return postAction(request, env, { kind: body.kind, payload, idemKey });
  }
  if (rest === '/v1/sponsors' && request.method === 'GET') {
    const now = Date.now();
    const { out, d2 } = await d2Build(env, now);
    // d2's sponsors view is the whole cleaned page; its .board holds Jon's stage columns.
    const view = (d2.pipeline?.boards || []).find((b) => b.goal === 'sponsors')?.sponsors || null;
    return json({ ok: true, asOf: new Date(now).toISOString(), sponsors: out.pages.sponsors || null, board: view?.board || null, hidden: view?.hidden || null, value: view?.value || null, pipeline: pipelineOf({ d2 }) });
  }
  return json({ ok: false, error: 'Not found' }, 404);
}

const KNOWN_STAGES = new Set(['drafts', 'new-lead', 'negotiating', 'contract-brief', 'invoice-sent', 'deposit-paid', 'script-approval', 'production', 'video-approval', 'publishing', 'balance-invoice', 'paid', 'done', 'archived']);
function asBoardStage(stage) {
  const s = String(stage || '');
  return KNOWN_STAGES.has(s) ? s : boardStageFor(s);
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

  if (rest === '/v1/sponsors' || rest === '/v1/sponsors/actions') return sponsorsForBot(request, env, rest);
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
    if (!ok) return Response.redirect(`${url.origin}/dashboard/#life?cal=err`, 302);
    await pullCalendar(env).catch((err) => console.error('calendar', err)); // so Home shows the week at once, not after the next cron
    return Response.redirect(`${url.origin}/dash/`, 302);
  }
  // Google's redirect back carries no session (the cookie is SameSite=Strict); the one-use state stands in (src/youtube.js).
  if (rest === '/youtube/callback' && method === 'GET') return youtubeCallback(request, env);
  // For Jon and for Lucy's checks with a bot token.
  if (rest === '/youtube/status' && method === 'GET') {
    const ok = request.headers.get('Authorization') ? await botOf(request, env.DB) : await readSession(request, env);
    return ok ? youtubeStatus(env) : json({ error: 'Sign in' }, 401);
  }
  if (rest === '/youtube/analytics-check' && method === 'GET') {
    return (await botOf(request, env.DB)) ? youtubeAnalyticsCheck(env, new URL(request.url).searchParams.get('channel')) : json({ error: 'Bot token only' }, 401);
  }
  // Dashboard 3 Hyper page (src/hyper.js): Jon's session gets a 60-second ticket for the app at hyper.jonmac.ai;
  // that host's Worker asks /hyper/check (no session: the ticket is the proof) before it lets a browser in.
  if (rest === '/hyper/ticket' && method === 'GET') {
    const denied = await needSession(request, env);
    return denied || json(await hyperEntry(env));
  }
  if (rest === '/hyper/check' && method === 'GET') {
    const ok = await hyperTicketOk(env, url.searchParams.get('t'));
    return json({ ok }, ok ? 200 : 401);
  }
  // The deploy's version alone, so a page that doesn't refresh its data still notices a deploy (app.js).
  if (rest === '/build' && method === 'GET') {
    const denied = await needSession(request, env);
    return denied || json({ build: env.CF_VERSION_METADATA?.id ?? null });
  }
  if (rest === '/snapshot' && method === 'GET') {
    const denied = await needSession(request, env);
    if (denied) return denied;
    const base = filterSnapshot(url.searchParams.get('pages'));
    if (!env.DB) return json(base);
    const now = Date.now();
    const extra = await snapshotExtra(env, base, now);
    // Only when Track is opened (?pages=track), never on the snapshot every page load and 60 s poll fetch.
    // Track syncs from the YouTube APIs first on every open or refresh (15 s floor); the cron syncs hourly too (src/youtube.js).
    if ((url.searchParams.get('pages') || '').split(',').some((p) => p.trim() === 'track')) {
      await freshen(env, ctx, undefined, now);
      extra.track = await trackData(env.DB, url.origin, now, env.HGP_DB);
    }
    const build = env.CF_VERSION_METADATA?.id ?? null; // this deploy; an open page reloads when it changes (app.js)
    return json({ ...mergeSnapshot(base, await listSnapshots(env.DB), now, await listDealStages(env.DB), extra), build });
  }
  // Dashboard 2 (docs/dashboard-2.md): the same pages /snapshot builds, plus the `d2` view. Read only.
  // /d2/ana: what Dashboard 2 keeps off Jon's pages (stale feeds, items past his 3), for Ana's hourly check with her bot token.
  if ((rest === '/d2' || rest === '/d2/ana') && method === 'GET') {
    const ana = rest === '/d2/ana';
    const ok = ana && request.headers.get('Authorization') ? await botOf(request, env.DB) : await readSession(request, env);
    if (!ok) return json({ error: 'Sign in' }, 401);
    const now = Date.now();
    const { out, d2 } = await d2Build(env, now);
    if (ana) return json({ ok: true, asOf: new Date(now).toISOString(), stale: d2.stale, toAna: d2.today.toAna });
    let pending = null; // the Pending page: Jon's ask cards, view only; a failure here never takes down the rest of /d2
    try { pending = buildPending(await pendingData(env.DB), now); } catch (err) { console.error('pending', err); }
    return json({ ok: true, build: env.CF_VERSION_METADATA?.id ?? null, asOf: new Date(now).toISOString(), pages: out.pages, d2, pending });
  }
  // Dashboard 2 Funnels: every Home Guide Press book page and Buy link, checked live on each open (src/funnels.js). Read only.
  if (rest === '/d2/funnels' && method === 'GET') {
    const denied = await needSession(request, env);
    if (denied) return denied;
    return json({ ok: true, funnels: await funnelsData(env) });
  }
  // Dashboard 3 (docs/dashboard-3.md): the rail's status lines and the Goals numbers /d2 doesn't carry. Read only.
  if (rest === '/d3' && method === 'GET') {
    const denied = await needSession(request, env);
    if (denied) return denied;
    const now = Date.now();
    return json({ ok: true, build: env.CF_VERSION_METADATA?.id ?? null, asOf: new Date(now).toISOString(), d3: buildD3(await d3Data(env, now)) });
  }
  // Dashboard 3 Factory page: only the video program's newest board, read every 3 s while that page is open.
  if (rest === '/d3/factory' && method === 'GET') {
    const denied = await needSession(request, env);
    if (denied) return denied;
    const now = Date.now();
    // A board that can't be read is a 503, not "nothing posted": the page then keeps what it shows.
    try { return json({ ok: true, asOf: new Date(now).toISOString(), factory: await factoryData(env, now) }); } catch (err) { console.error('d3 factory', err); return json({ ok: false, error: 'Could not read the board' }, 503); }
  }
  // Review page: the Gmail thread above each sponsor draft (bots/sponsor_threads.py on GPU1 reads partners@, read only).
  if (rest === '/sponsor-threads' && method === 'GET') {
    const denied = await needSession(request, env);
    if (denied) return denied;
    const row = env.DB ? await getSnapshot(env.DB, 'sponsor_threads') : null;
    const data = row ? JSON.parse(row.data || '{}') : {};
    return json({ ok: true, at: row?.collected_at || null, threads: data.threads || {} });
  }
  // GPU1 asks which threads to read: the Gmail thread of every sponsor card with a draft waiting for Jon.
  if (rest === '/sponsor-threads/wanted' && method === 'GET') {
    if (machineOf(request, env) !== 'gpu1') return json({ error: 'Unauthorized' }, 401);
    const row = env.DB ? await getSnapshot(env.DB, 'sponsors') : null;
    const data = row ? JSON.parse(row.data || '{}') : {};
    // ...and every deal on the Money page, for its deal view (same stage overrides as the board).
    const deals = dealThreadIds(data, Date.now(), env.DB ? await listDealStages(env.DB) : {}, await getSponsorDeals(env.DB));
    return json({ ok: true, threads: [...new Set([...draftThreadIds(data.cards || []), ...deals])] });
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
      || source === 'sponsor_deals' // hand-added deals: written only by the Worker's sponsor.add_deal / set_amount
      || source === 'periods' // written only through PUT /v1/periods (writer check + validation)
      || (source === 'sponsor_threads' && who !== 'gpu1') // partners@ threads, read on GPU1 only
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
    if (!gClientId(env) || !env.SESSION_SECRET) return json({ error: 'Google Calendar is not connected yet' }, 501);
    return Response.redirect(await googleAuthUrl(env, url.origin), 302);
  }
  if (rest === '/youtube/connect' && method === 'GET') return youtubeConnect(request, env);

  if (rest === '/actions' && method === 'POST') return postAction(request, env);
  const one = rest.match(/^\/actions\/([^/]+)$/);
  if (one && method === 'GET') {
    if (!env.DB) return json({ id: one[1], status: 'done', result: 'Done' });
    const row = await actionById(env.DB, one[1]);
    if (!row) return json({ error: 'Not found' }, 404);
    return json({ id: row.id, status: row.status, result: row.result });
  }
  // Dashboard 3 Home: Jon's saved schedule tasks, his own goals and his Google Calendar week (src/home.js).
  if (rest === '/home' && method === 'GET') {
    if (!env.DB) return json({ ok: true, home: null });
    return json({ ok: true, home: await homeData(env) });
  }
  if (rest.startsWith('/home/') && env.DB) {
    const b = method === 'GET' ? {} : await request.json().catch(() => ({}));
    const out = await homeWrite(env, method, rest.slice(5), b && typeof b === 'object' ? b : {}, url.searchParams);
    return json(out.body, out.status);
  }
  // The Personal page: meals, grocery prices, trips, rules, expense tags and recipe photos (src/personal.js).
  if (rest === '/personal' && method === 'GET') {
    if (!env.DB) return json({ ok: true, personal: null });
    return json({ ok: true, personal: await personalData(env) });
  }
  if (rest.startsWith('/personal/') && env.DB) {
    const out = await personalWrite(env, method, rest.slice(9), request);
    return json(out.body, out.status);
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
