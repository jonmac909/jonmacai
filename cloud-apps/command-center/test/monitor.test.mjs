import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { readFileSync } from 'node:fs';
import { GpuMonitor, shapeSample, withTimes, machineView, scrub, kelownaTime, STALE_MS, MAX_PUSH_BYTES } from '../src/monitor.js';
import { signSession, COOKIE } from '../src/auth.js';

const SECRET = 's'.repeat(40);
const SESSION_SECRET = 'x'.repeat(32);
const ASSETS = { fetch: async (r) => new Response(`asset:${new URL(r.url).pathname}`, { status: 200, headers: { 'Content-Type': 'text/html' } }) };

function makeEnv() {
  const store = new Map();
  const storage = { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } };
  const instance = new GpuMonitor({ storage });
  const GPU_MONITOR = { idFromName: (n) => n, get: () => instance };
  return { env: { ASSETS, GPU_MONITOR, MONITOR_PUSH_SECRET: SECRET, SESSION_SECRET }, instance, store };
}
const call = (env, path, init = {}) => worker.fetch(new Request('https://jonmac.ai' + path, init), env, {});
const cookie = async () => `${COOKIE}=${await signSession(SESSION_SECRET, Date.now() + 3600e3)}`;
const pushInit = (body, auth = `Bearer ${SECRET}`) => ({ method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const sample = { gpu: { name: 'RTX 5090', util: 42, vram_used: 5e9, vram_total: 32e9 }, host: { cpu: 10 }, jobs: 'Z-Image warmup', sampled_at: Date.now() / 1000 };

test('push needs the exact bearer secret', async () => {
  const { env } = makeEnv();
  for (const auth of ['', 'Bearer wrong', `Bearer ${SECRET}x`, SECRET]) {
    assert.equal((await call(env, '/monitor/api/push', pushInit({ gpu1: sample }, auth))).status, 401, auth);
  }
  const short = makeEnv();
  short.env.MONITOR_PUSH_SECRET = 'short';
  assert.equal((await call(short.env, '/monitor/api/push', pushInit({ gpu1: sample }, 'Bearer short'))).status, 401);
});

test('push rejects unknown machines, bad JSON and oversize bodies', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, '/monitor/api/push', pushInit({ gpu3: sample }))).status, 400);
  assert.equal((await call(env, '/monitor/api/push', pushInit({}))).status, 400);
  assert.equal((await call(env, '/monitor/api/push', pushInit('{nope'))).status, 400);
  assert.equal((await call(env, '/monitor/api/push', pushInit('x'.repeat(MAX_PUSH_BYTES + 1)))).status, 413);
});

test('shapeSample keeps only known fields', () => {
  const s = shapeSample({ gpu: { name: 'A', util: 5, evil: 'x', vram_used: '5' }, host: { cpu: 1, pid: 99 }, extra: 'C:\\secret', processes: [{ name: 'p', pid: 4, vram: 1 }] });
  assert.equal(s.extra, undefined);
  assert.equal(s.gpu.evil, undefined);
  assert.equal(s.gpu.vram_used, null);
  assert.equal(s.host.pid, undefined);
  assert.deepEqual(s.processes, [{ name: 'p', type: '', vram: 1 }]);
});

test('data needs a session; signed-in page sees a live machine after a push', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, '/monitor/api/data')).status, 401);
  assert.equal((await call(env, '/monitor/api/push', pushInit({ gpu1: sample }))).status, 200);
  const res = await call(env, '/monitor/api/data', { headers: { Cookie: await cookie() } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const d = await res.json();
  assert.equal(d.machines.gpu1.online, true);
  assert.equal(d.machines.gpu1.sample.gpu.util, 42);
  assert.equal(d.machines.gpu1.state, 'live');
  assert.equal(d.machines.gpu2.online, false);
  assert.equal(d.machines.gpu2.state, 'waiting');
  assert.equal(d.machines.gpu2.offline_since_text, null);
});

test('planted stale sample: machine shows offline since its last sample, in Kelowna time (UTC-7)', async () => {
  const { env, instance } = makeEnv();
  await call(env, '/monitor/api/push', pushInit({ gpu1: sample, gpu2: sample }));
  const last = Date.UTC(2026, 10, 15, 19, 5, 9); // 12:05:09 p.m. Nov 15 in Kelowna (UTC-7; US Pacific would say 11:05)
  instance.latest.gpu2.received_at = last;
  instance.latest.gpu1.received_at = Date.now() - (STALE_MS + 5000);
  const d = await (await call(env, '/monitor/api/data', { headers: { Cookie: await cookie() } })).json();
  assert.equal(d.machines.gpu1.online, false);
  assert.equal(d.machines.gpu2.online, false);
  assert.equal(d.machines.gpu2.offline_since, new Date(last).toISOString());
  assert.equal(d.machines.gpu2.offline_since_text, 'Nov 15, 12:05:09 p.m.');
  const fresh = machineView({ received_at: 1000, sample: {} }, 1000 + STALE_MS);
  assert.equal(fresh.online, true);
});

test('last-seen survives an evicted Durable Object (storage fallback)', async () => {
  const { env, store } = makeEnv();
  await call(env, '/monitor/api/push', pushInit({ gpu1: sample }));
  assert.ok(store.get('gpu1'));
  const again = new GpuMonitor({ storage: { get: async (k) => store.get(k), put: async () => {} } });
  const d = await (await again.fetch(new Request('https://monitor/data'))).json();
  assert.ok(d.machines.gpu1.last_seen);
});

test('page: signed out gets the sign-in page, signed in gets the monitor, no other files', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, '/monitor')).status, 308);
  assert.equal(await (await call(env, '/monitor/')).text(), 'asset:/login.html');
  const page = await call(env, '/monitor/', { headers: { Cookie: await cookie() } });
  assert.equal(await page.text(), 'asset:/monitor/index.html');
  assert.equal(page.headers.get('cache-control'), 'private, no-store');
  assert.equal(await (await call(env, '/monitor/css/tokens.css')).text(), 'asset:/css/tokens.css');
  for (const p of ['/monitor/index.js', '/monitor/../worker.js', '/monitor/api/other']) assert.equal((await call(env, p)).status, 404, p);
  assert.equal((await call(env, '/dashboard/monitor/index.html')).status, 404);
});

test('planted secrets: jobs and names lose paths, links, addresses, tokens and pids', () => {
  const dirty = String.raw`clip C:\Users\jon\x.mp4 and D:/HGP-work/a b /home/jon/run.sh https://x.io/a?k=1 100.64.1.2:8188 pid 4242 Bearer abcd token=xyz ${'Q'.repeat(40)} \\gpu2\share`;
  const out = scrub(dirty, 400);
  for (const bad of ['Users', 'HGP-work', '/home', 'x.io', '100.64', '4242', 'abcd', 'xyz', 'QQQQ', 'share']) assert.ok(!out.includes(bad), `${bad} in ${out}`);
  assert.equal(scrub('Z-Image 3/5 · Omni GPU1/GPU2'), 'Z-Image 3/5 · Omni GPU1/GPU2');
  const s = shapeSample({ jobs: dirty, queued: dirty, loaded: dirty, gpu: { name: String.raw`E:\x` }, processes: [{ name: '/usr/bin/python3' }], services: [{ name: 'svc http://a', state: 'pid=7' }] });
  for (const v of [s.jobs, s.queued, s.loaded, s.gpu.name, s.processes[0].name, s.services[0].name, s.services[0].state]) {
    assert.ok(!/Users|home|x\.io|4242|:\/\/|\d+\.\d+\.\d+\.\d+|=7/.test(v), v);
  }
});

test('planted frozen agent: a fresh push of an old sample shows offline since the sample time', async () => {
  const { env } = makeEnv();
  const old = Date.now() - 60e3;
  await call(env, '/monitor/api/push', pushInit({ gpu1: sample, gpu2: { ...sample, sampled_at: old / 1000 } }));
  const d = await (await call(env, '/monitor/api/data', { headers: { Cookie: await cookie() } })).json();
  assert.equal(d.machines.gpu1.online, true);
  assert.equal(d.machines.gpu2.online, false);
  assert.equal(d.machines.gpu2.offline_since, new Date(old).toISOString());
});

test('last seen comes from memory, not the throttled stored copy', async () => {
  const { env, instance, store } = makeEnv();
  await call(env, '/monitor/api/push', pushInit({ gpu1: { ...sample, sampled_at: Date.now() / 1000 + 5 } })); // clock ahead: arrival time wins
  store.set('gpu1', { ...store.get('gpu1'), received_at: Date.now() - 25e3 }); // stored copy lags up to 30 s
  const d = await (await call(env, '/monitor/api/data', { headers: { Cookie: await cookie() } })).json();
  assert.equal(d.machines.gpu1.online, true);
  assert.equal(d.machines.gpu1.last_seen, new Date(instance.latest.gpu1.received_at).toISOString());
});

test('monitor page file is never served as a plain static asset', async () => {
  const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(cfg, /"run_worker_first":\s*true/);
  assert.doesNotMatch(cfg, /"run_worker_first":\s*(false|\[)/);
  const { env } = makeEnv();
  assert.equal(await (await call(env, '/monitor/index.html')).text(), 'asset:/login.html');
  for (const p of ['/monitor//index.html', '/monitor%2Findex.html', '/MONITOR/index.html', '/dashboard/monitor%2Findex.html', '/dashboard//monitor/index.html', '/dashboard/MONITOR/index.html', '/dashboard/%6Donitor/index.html']) {
    const res = await call(env, p);
    assert.notEqual(await res.text(), 'asset:/monitor/index.html', p);
  }
});

test('Kelowna time: Updated stamp and offline stamp agree for a Nov 16 2026 sample, both UTC-7', async () => {
  const at = Date.UTC(2026, 10, 16, 16, 46, 58); // 9:46:58 a.m. in Kelowna
  assert.deepEqual(kelownaTime(at), { date: 'Nov 16', clock: '9:46:58 a.m.', text: 'Nov 16, 9:46:58 a.m.' });
  assert.equal(kelownaTime(Date.UTC(2026, 10, 17, 6, 59, 1)).text, 'Nov 16, 11:59:01 p.m.', 'the Kelowna day, not UTC');
  assert.equal(kelownaTime(Date.UTC(2026, 10, 16, 7, 0, 0)).text, 'Nov 16, 12:00:00 a.m.');
  const instance = new GpuMonitor({ storage: { get: async () => undefined, put: async () => {} } });
  instance.latest.gpu1 = { received_at: at, sample: {} };
  const realNow = Date.now;
  Date.now = () => at + 40e3; // 9:47:38, gpu1 silent for 40 s
  try {
    const d = await (await instance.fetch(new Request('https://monitor/data'))).json();
    assert.equal(d.updated_text, 'Updated 9:47:38 a.m. (Kelowna)');
    assert.equal(d.machines.gpu1.offline_since_text, 'Nov 16, 9:46:58 a.m.');
    assert.equal(d.updated_text.match(/(\d+):\d\d:\d\d [ap]\.m\./)[1], d.machines.gpu1.offline_since_text.match(/(\d+):\d\d:\d\d [ap]\.m\./)[1], 'same hour');
  } finally { Date.now = realNow; }
});

test('planted cold start: a live machine never flashes offline after the Durable Object restarts', async () => {
  const { env, store } = makeEnv();
  const realNow = Date.now;
  let t = Date.UTC(2026, 10, 16, 16, 47, 0);
  Date.now = () => t;
  try {
    for (let i = 0; i < 20; i++) { // pushes every 3 s for a minute; only some are persisted
      await call(env, '/monitor/api/push', pushInit({ gpu1: { ...sample, sampled_at: t / 1000 } }));
      t += 3000;
    }
    const lag = t - 3000 - store.get('gpu1').received_at;
    assert.ok(lag < STALE_MS / 2, `stored copy lags ${lag} ms`);
    const restarted = new GpuMonitor({ storage: { get: async (k) => store.get(k), put: async () => {} } }); // deploy or eviction
    const d = await (await restarted.fetch(new Request('https://monitor/data'))).json();
    assert.equal(d.machines.gpu1.online, true, 'first read after a restart');
    assert.equal(d.machines.gpu1.offline_since_text, null);
  } finally { Date.now = realNow; }
  assert.ok(STALE_MS >= 30e3, 'threshold covers a slow push (8 s timeout) plus the 3 s interval');
});

test('page never judges live/offline or formats a time itself', () => {
  const page = readFileSync(new URL('../public/monitor/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /Intl\.|new Date|Date\.now|toLocale|stale_after|age_s|last_seen/);
  assert.match(page, /d\.updated_text/);
  assert.match(page, /m\.state === 'live'/);
  assert.match(page, /<span id="updated">Loading\.\.\.<\/span>/, 'no machine panel before the first data');
  assert.match(page, /<main id="panels"><\/main>/);
  assert.match(page, /\|\| \{ state: 'waiting' \}/, 'a machine missing from the data is waiting, not offline');
  assert.match(page, /catch \(e\) \{\s*panels\.classList\.add\('stale'\)/, 'a failed poll dims the old panels');
  assert.doesNotMatch(page, /no data yet|never seen/);
});

test('planted empty storage: a machine that never sent data is waiting, with no Offline text', async () => {
  const { env } = makeEnv();
  const d = await (await call(env, '/monitor/api/data', { headers: { Cookie: await cookie() } })).json();
  for (const m of ['gpu1', 'gpu2']) {
    assert.equal(d.machines[m].state, 'waiting', m);
    assert.equal(d.machines[m].offline_since_text, null, m);
    assert.doesNotMatch(JSON.stringify(d.machines[m]), /offline since|never seen/i, m);
  }
});

test('planted failed save: the next push retries the save instead of waiting PERSIST_MS', async () => {
  let fail = true;
  const store = new Map();
  const instance = new GpuMonitor({ storage: { get: async (k) => store.get(k), put: async (k, v) => { if (fail) throw new Error('storage down'); store.set(k, v); } } });
  const push = () => instance.fetch(new Request('https://monitor/push', { method: 'POST', body: JSON.stringify({ gpu1: sample }) }));
  await assert.rejects(push());
  fail = false;
  await push();
  assert.ok(store.get('gpu1'), 'saved on the very next push');
});

test('Kelowna time ignores the runtime tzdata from Nov 2026 (a runtime still on PST would say 8 a.m.)', () => {
  const real = Intl.DateTimeFormat.prototype.formatToParts;
  Intl.DateTimeFormat.prototype.formatToParts = () => { throw new Error('zone rules used'); }; // planted: no tzdata at all
  try {
    assert.equal(kelownaTime(Date.UTC(2026, 11, 20, 16, 0, 5)).text, 'Dec 20, 9:00:05 a.m.');
    assert.equal(kelownaTime(Date.UTC(2027, 0, 1, 6, 59, 59)).text, 'Dec 31, 11:59:59 p.m.');
  } finally { Intl.DateTimeFormat.prototype.formatToParts = real; }
});

test('status: bearer-only summary of live/offline per machine, no samples (for the pusher watchdog)', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, '/monitor/api/status')).status, 401);
  assert.equal((await call(env, '/monitor/api/status', { headers: { Cookie: await cookie() } })).status, 401);
  assert.equal((await call(env, '/monitor/api/status', { method: 'POST', headers: { Authorization: `Bearer ${SECRET}` } })).status, 405);
  await call(env, '/monitor/api/push', pushInit({ gpu1: sample }));
  const res = await call(env, '/monitor/api/status', { headers: { Authorization: `Bearer ${SECRET}` } });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.machines.gpu1.state, 'live');
  assert.equal(d.machines.gpu2.state, 'waiting');
  assert.ok(d.machines.gpu1.age_s <= 2);
  assert.equal(d.machines.gpu1.sample, undefined);
  assert.ok(!JSON.stringify(d).includes('RTX'));
});

test('tasks are kept as GPU and CPU lists, scrubbed, capped and given Kelowna start times', () => {
  const s = shapeSample({ tasks: {
    gpu: [{ name: 'Hyperframes render naomi-japan-12', cpu: 3.2, vram: 4e9, started: 1000, pid: 7 }, { name: '' }],
    cpu: [{ name: 'ffmpeg scan C:\\secret\\x token=abc123 Bearer zzz', cpu: 'x', started: 'no' }, ...Array(20).fill({ name: 'n' })],
  } });
  assert.deepEqual(s.tasks.gpu, [{ name: 'Hyperframes render naomi-japan-12', cpu: 3.2, vram: 4e9, started: 1000 }]);
  assert.equal(s.tasks.cpu.length, 10);
  assert.ok(!/secret|abc123|zzz/.test(s.tasks.cpu[0].name), s.tasks.cpu[0].name);
  assert.equal(s.tasks.cpu[0].cpu, null);
  assert.deepEqual(shapeSample({}).tasks, { gpu: [], cpu: [] });
  const t = withTimes(s, 1000 * 1000 + 75 * 60000).tasks.gpu[0];
  assert.equal(t.running_text, '1 h 15 min');
  assert.match(t.started_text, /^\d+:\d\d:\d\d (a|p)\.m\.$/);
  assert.equal(withTimes({ gpu: {} }, 1).tasks, undefined); // an older stored sample has no tasks: left alone
});
