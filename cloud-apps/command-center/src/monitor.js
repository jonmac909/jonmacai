// Live GPU Monitor web page (jonmac.ai/monitor). GPU1's pusher (D:\gpu-monitor\monitor_push.py) posts the latest
// sample of GPU1 and GPU2 every ~3 s; the GpuMonitor Durable Object keeps only the latest one per machine.
// The page polls /monitor/api/data with a dashboard session. A machine whose last sample is older than
// STALE_MS shows "offline since <last seen>". The worker alone decides live/offline (its own clock) and formats
// every time in Kelowna time (pacific(): UTC-7 all year from Nov 2026); the page only displays what it gets.
import { readSession, timingSafeEqualString } from './auth.js';
import { pacific } from './channels.js';

export const MONITOR = '/monitor';
export const STALE_MS = 30 * 1000; // pusher sends every ~3 s; a push can take up to 8 s plus GPU2's 1.5 s read
export const MAX_PUSH_BYTES = 64 * 1024;
export const MACHINES = ['gpu1', 'gpu2'];
// Memory holds the live sample and exact last-seen; storage is only read on a cold start (deploy or eviction).
// Persisting every 10 s keeps a cold-start copy well inside STALE_MS, so a restart never flashes a live machine offline.
const PERSIST_MS = 10 * 1000;
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...NO_STORE } });
const text = (body, status) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...NO_STORE } });

// Shape a pushed sample to known fields only: numbers stay numbers, strings are capped, nothing else is kept.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : '');
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
// Second line of defence after the pusher's own scrub: no path, link, address, token or process id is kept.
const SCRUB = [
  [/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[link]'],
  [/\b[A-Za-z]:[\\/][^\s,;)\]]*/g, '[path]'],
  [/\\\\[^\s,;)\]]+/g, '[path]'],
  [/(?<![\w.])~?\/(?:[\w.~-]+\/)+[\w.~-]*/g, '[path]'],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[addr]'],
  [/\bBearer\s+\S+/gi, 'Bearer [hidden]'],
  [/\b(token|secret|password|passwd|api[_-]?key|access[_-]?key|auth)\s*[:=]\s*\S+/gi, '$1=[hidden]'],
  [/\b[A-Za-z0-9_-]{32,}\b/g, '[hidden]'],
  [/\bpids?\s*[:=#]?\s*\d+/gi, 'pid'],
];
export function scrub(v, n = 120) {
  let t = str(v, 4 * n);
  for (const [re, to] of SCRUB) t = t.replace(re, to);
  return t.trim().slice(0, n);
}
// Per machine the running tasks, split into GPU and CPU: friendly name, CPU %, GPU memory, start time (seconds).
const task = (t) => ({ name: scrub(obj(t).name, 80), cpu: num(obj(t).cpu), vram: num(obj(t).vram), started: num(obj(t).started) });
export function shapeSample(s) {
  s = obj(s);
  const g = obj(s.gpu);
  const h = obj(s.host);
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, num(o[k])]));
  return {
    gpu: {
      name: scrub(g.name, 80), driver: str(g.driver, 40),
      ...pick(g, ['util', 'mem_util', 'vram_used', 'vram_total', 'temp', 'power_w', 'power_limit_w', 'fan', 'core_mhz', 'mem_mhz', 'encoder', 'decoder']),
    },
    host: pick(h, ['cpu', 'ram_used', 'ram_total', 'ram_pct']),
    disks: arr(s.disks, 12).map((d) => ({ label: str(obj(d).label, 12), free: num(obj(d).free), total: num(obj(d).total) })),
    tasks: { gpu: arr(obj(s.tasks).gpu, 10).map(task).filter((t) => t.name), cpu: arr(obj(s.tasks).cpu, 10).map(task).filter((t) => t.name) },
    processes: arr(s.processes, 10).map((p) => ({ name: scrub(obj(p).name, 60), type: scrub(obj(p).type, 12), vram: num(obj(p).vram) })),
    services: arr(s.services, 12).map((v) => ({ name: scrub(obj(v).name, 40), state: scrub(obj(v).state, 20) })),
    jobs: scrub(s.jobs, 400),
    queued: scrub(s.queued, 400),
    loaded: scrub(s.loaded, 200),
    sampled_at: num(s.sampled_at),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// A moment as Kelowna text, e.g. { date: 'Nov 16', clock: '9:46:58 a.m.' }. Day and minute come from pacific();
// seconds are the same in every whole-hour zone.
export function kelownaTime(ms) {
  const { day, time } = pacific(ms);
  const [, mo, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':');
  const sec = String(new Date(ms).getUTCSeconds()).padStart(2, '0');
  const clock = `${Number(h) % 12 || 12}:${mi}:${sec} ${Number(h) < 12 ? 'a.m.' : 'p.m.'}`;
  return { date: `${MONTHS[mo - 1]} ${d}`, clock, text: `${MONTHS[mo - 1]} ${d}, ${clock}` };
}

// Last time the machine was really seen: when its sample arrived, or when the sample was taken if that is older
// (a frozen GPU2 agent keeps handing the pusher the same old sample). sampled_at is in seconds.
export function lastSeen(entry) {
  const sampled = num(entry.sample?.sampled_at);
  return sampled ? Math.min(entry.received_at, sampled * 1000) : entry.received_at;
}

// Tasks get their Kelowna start time and how long they have run (the page never does time maths).
export function withTimes(sample, now) {
  if (!sample || !sample.tasks) return sample;
  const add = (t) => {
    if (!num(t.started)) return t;
    const mins = Math.max(0, Math.floor((now - t.started * 1000) / 60000));
    return { ...t, started_text: kelownaTime(t.started * 1000).clock, running_text: mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min` };
  };
  return { ...sample, tasks: { gpu: sample.tasks.gpu.map(add), cpu: sample.tasks.cpu.map(add) } };
}

// What the page gets: per machine the latest sample, or offline with the time it was last seen.
export function machineView(entry, now) {
  // 'waiting': no sample has ever arrived, so the page shows a neutral "Waiting for data", never Offline.
  if (!entry || !num(entry.received_at)) return { state: 'waiting', online: false, offline_since: null, offline_since_text: null, sample: null };
  const seen = lastSeen(entry);
  const online = now - seen <= STALE_MS;
  return {
    state: online ? 'live' : 'offline',
    online,
    last_seen: new Date(seen).toISOString(),
    age_s: Math.max(0, Math.round((now - seen) / 1000)),
    offline_since: online ? null : new Date(seen).toISOString(),
    offline_since_text: online ? null : kelownaTime(seen).text,
    sample: withTimes(entry.sample, now) || null,
  };
}

export class GpuMonitor {
  constructor(ctx) {
    this.ctx = ctx;
    this.latest = {}; // machine -> {received_at, sample}
    this.persistedAt = {};
  }

  async entry(m) {
    if (!this.latest[m]) {
      const saved = await this.ctx.storage.get(m);
      if (saved) this.latest[m] = saved;
    }
    return this.latest[m];
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    if (url.pathname === '/push' && request.method === 'POST') {
      const body = await request.json();
      for (const m of MACHINES) {
        if (!body[m]) continue;
        this.latest[m] = { received_at: now, sample: body[m] };
        if (!this.persistedAt[m] || now - this.persistedAt[m] >= PERSIST_MS) {
          await this.ctx.storage.put(m, this.latest[m]);
          this.persistedAt[m] = now; // only after the save worked, so a failed put is retried on the next push
        }
      }
      return json({ ok: true });
    }
    if (url.pathname === '/data' && request.method === 'GET') {
      const machines = {};
      for (const m of MACHINES) machines[m] = machineView(await this.entry(m), now);
      return json({ now: new Date(now).toISOString(), updated_text: `Updated ${kelownaTime(now).clock} (Kelowna)`, stale_after_s: STALE_MS / 1000, machines });
    }
    return text('Not found', 404);
  }
}

function stub(env) {
  return env.GPU_MONITOR.get(env.GPU_MONITOR.idFromName('monitor'));
}

async function push(request, env) {
  const secret = env.MONITOR_PUSH_SECRET || '';
  const auth = request.headers.get('Authorization') || '';
  if (secret.length < 32 || !timingSafeEqualString(auth, `Bearer ${secret}`)) return text('Unauthorized', 401);
  if (request.method !== 'POST') return text('Method not allowed', 405);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_PUSH_BYTES) return text('Too large', 413);
  const raw = await request.text();
  if (raw.length > MAX_PUSH_BYTES) return text('Too large', 413);
  let body;
  try { body = JSON.parse(raw); } catch { return text('Bad JSON', 400); }
  body = obj(body);
  const keys = Object.keys(body);
  if (!keys.length || keys.some((k) => !MACHINES.includes(k))) return text('Unknown machine', 400);
  const clean = Object.fromEntries(keys.map((k) => [k, shapeSample(body[k])]));
  if (!env.GPU_MONITOR) return text('Monitor is not set up', 503);
  return stub(env).fetch(new Request('https://monitor/push', { method: 'POST', body: JSON.stringify(clean) }));
}

async function data(request, env) {
  if (!(await readSession(request, env))) return text('Sign in', 401);
  if (request.method !== 'GET') return text('Method not allowed', 405);
  if (!env.GPU_MONITOR) return text('Monitor is not set up', 503);
  return stub(env).fetch(new Request('https://monitor/data'));
}

// Read-only summary for the pusher's own watchdog and for checks without a browser: per machine only live/offline,
// last seen and age (no samples). Same bearer secret as the push, so it is never open to the public.
async function status(request, env) {
  const secret = env.MONITOR_PUSH_SECRET || '';
  const auth = request.headers.get('Authorization') || '';
  if (secret.length < 32 || !timingSafeEqualString(auth, `Bearer ${secret}`)) return text('Unauthorized', 401);
  if (request.method !== 'GET') return text('Method not allowed', 405);
  if (!env.GPU_MONITOR) return text('Monitor is not set up', 503);
  const res = await stub(env).fetch(new Request('https://monitor/data'));
  const full = await res.json();
  const machines = Object.fromEntries(Object.entries(full.machines || {}).map(([m, v]) => [m, {
    state: v.state, online: v.online, last_seen: v.last_seen || null, age_s: v.age_s ?? null,
  }]));
  return json({ now: full.now, stale_after_s: full.stale_after_s, machines });
}

// Everything under /monitor. `asset(request, env, path)` is the worker's static-file helper.
export async function handleMonitor(request, env, asset) {
  const url = new URL(request.url);
  const path = url.pathname.slice(MONITOR.length);
  if (path === '') {
    url.pathname = `${MONITOR}/`;
    return new Response(null, { status: 308, headers: { Location: url.toString(), ...NO_STORE } });
  }
  if (path === '/api/push') return push(request, env);
  if (path === '/api/data') return data(request, env);
  if (path === '/api/status') return status(request, env);
  if (request.method !== 'GET' && request.method !== 'HEAD') return text('Not found', 404);
  if (path === '/' || path === '/index.html') {
    const page = (await readSession(request, env)) ? '/monitor/index.html' : '/login.html';
    const res = await asset(request, env, page);
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(res.body, { status: res.status, headers });
  }
  // The sign-in page's stylesheets (relative links), and nothing else.
  if (path === '/css/tokens.css' || path === '/css/components.css') return asset(request, env, path);
  return text('Not found', 404);
}
