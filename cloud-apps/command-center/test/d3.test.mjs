// Dashboard 3 (docs/dashboard-3.md): /dash serving, GET /dashboard/api/d3, the Goals page mapping and the shell's sign-in handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import worker from '../src/worker.js';
import { signSession, COOKIE } from '../src/auth.js';
import { renderGoals, objectivesOf } from '../public/d3/js/goals.js';
import { statHtml, railCounts } from '../public/d3/js/rail.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TUESDAY = Date.parse('2026-11-10T19:00:00Z'); // Tuesday Nov 10, 11:00 AM in Kelowna
const cookieAt = async (ms) => `${COOKIE}=${await signSession(SECRET, Math.floor(ms / 1000) + 3600)}`;
const assets = { fetch: async (r) => new Response(`asset:${new URL(r.url).pathname}`) };
const SAMPLE = () => JSON.parse(readFileSync(new URL('./fixtures/d2-sample.json', import.meta.url), 'utf8'));

async function withNow(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try { return await fn(); } finally { Date.now = real; }
}
const ins = (db, table, row) => {
  const keys = Object.keys(row);
  db.sqlite.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
};

test('/dash: 308 to /dash/, login or app by session, only its own files, and /dashboard and /dashboard-2 unchanged', async () => {
  const env = { SESSION_SECRET: SECRET, ASSETS: assets };
  const go = async (path, cookie) => {
    const res = await worker.fetch(new Request(`https://jonmac.ai${path}`, cookie ? { headers: { Cookie: cookie } } : {}), env, {});
    return res;
  };
  const text = async (path, cookie) => { const r = await go(path, cookie); return r.status === 404 ? 404 : r.text(); };
  const bare = await go('/dash');
  assert.equal(bare.status, 308);
  assert.equal(bare.headers.get('Location'), 'https://jonmac.ai/dash/');
  assert.equal(await text('/dash/'), 'asset:/d3/login.html');
  assert.equal(await text('/dash/index.html'), 'asset:/d3/login.html');
  const cookie = await cookieAt(Date.now());
  const index = await go('/dash/', cookie);
  assert.equal(await index.text(), 'asset:/d3/index.html');
  assert.equal(index.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(await text('/dash/index.html', cookie), 'asset:/d3/index.html');
  assert.equal(await text('/dash/login.html'), 'asset:/d3/login.html');
  assert.equal(await text('/dash/css/d3.css'), 'asset:/d3/css/d3.css');
  assert.equal(await text('/dash/js/app.js'), 'asset:/d3/js/app.js');
  assert.equal(await text('/dash/js/goals.js'), 'asset:/d3/js/goals.js');
  for (const p of ['/dash/x', '/dash/js/app.mjs', '/dash/d3/index.html', '/dashx', '/dash-3',
    '/dashboard/d3/index.html', '/dashboard/d3/', '/dashboard/d3', '/dashboard/D3/js/app.js', '/dashboard/d3%2Findex.html']) {
    assert.equal(await text(p, cookie), 404, p);
  }
  assert.equal((await go('/dashboard')).headers.get('Location'), 'https://jonmac.ai/dashboard/');
  assert.equal(await text('/dashboard/'), 'asset:/login.html');
  assert.equal((await go('/dashboard-2')).headers.get('Location'), 'https://jonmac.ai/dashboard-2/');
  assert.equal(await text('/dashboard-2/', cookie), 'asset:/d2/index.html');
  assert.equal(await text('/dashboard-2/js/app.js'), 'asset:/d2/js/app.js');
});

test('GET /dashboard/api/d3: 401 without a session; read-only answer with No feed parts when nothing reports', async () => {
  const env = { SESSION_SECRET: SECRET };
  assert.equal((await handleApi(new Request('https://jonmac.ai/dashboard/api/d3'), env)).status, 401);
  const res = await withNow(TUESDAY, async () => handleApi(new Request('https://jonmac.ai/dashboard/api/d3', { headers: { Cookie: await cookieAt(TUESDAY) } }), env));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Cache-Control') || '', /no-store/);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.asOf, new Date(TUESDAY).toISOString());
  const { rail, review, openCards, goals } = body.d3;
  for (const k of ['dispatcher', 'bots', 'tokens', 'youtube']) assert.equal(rail[k].state, 'none', k);
  assert.equal(rail.dispatcher.text, 'No feed');
  assert.equal(review, null);
  assert.equal(openCards, null);
  assert.equal(goals.qcFirstTry.actual, null);
  assert.equal(goals.workouts.actual, null);
  assert.equal(goals.charges.display, 'No data');
  // The rail shows each missing line as "<name> · No feed" with a grey dot; counts stay hidden.
  const html = statHtml(body);
  assert.match(html, /Dispatcher · No feed/);
  assert.doesNotMatch(html, /dot [gyr]/);
  assert.deepEqual(railCounts(null, body), { blockers: null, review: null });
});

test('GET /dashboard/api/d3: values from D1 (review queue, tokens, open cards, workouts, QC first try)', async () => {
  const db = sqliteD1();
  const t = (id, project, status, at = '2026-11-09T16:00:00Z') => ins(db, 'bot_tasks', { id, title: `Card ${id}`, owner: 'elle', project, status, created_by: 'ana', updated_by: 'ana', created_at: at, updated_at: at });
  t('t1', 'jon-mac', 'review', '2026-11-09T19:00:00Z');
  t('t2', 'jon-mac', 'doing');
  t('t3', 'home-guide-press', 'todo');
  t('t4', 'home-guide-press', 'done');
  ins(db, 'bot_approvals', { id: 'a1', action: 'publish_draft', title: 'Post it', requested_by: 'elle', status: 'pending', created_at: '2026-11-10T12:00:00Z', updated_at: '2026-11-10T12:00:00Z' });
  ins(db, 'bot_feed_entries', { id: 'f1', name: 'claude_usage', bot: 'ana', data: JSON.stringify({ weekPct: 100, resetsAt: '2026-11-13T00:00:00Z' }), created_at: '2026-11-10T18:00:00Z' });
  ins(db, 'habits', { day: '2026-11-09', kind: 'workout', done: 1 });
  ins(db, 'habits', { day: '2026-11-10', kind: 'workout', done: 1 });
  ins(db, 'bot_proofs', { id: 'p1', task_id: 't3', kind: 'render', link: 'https://x/1', status: 'failed', created_by: 'qc', created_at: '2026-11-05T10:00:00Z' });
  ins(db, 'bot_proofs', { id: 'p2', task_id: 't3', kind: 'render', link: 'https://x/2', status: 'passed', created_by: 'qc', created_at: '2026-11-06T10:00:00Z' });
  ins(db, 'bot_proofs', { id: 'p3', task_id: 't2', kind: 'render', link: 'https://x/3', status: 'passed', created_by: 'qc', created_at: '2026-11-07T10:00:00Z' });
  const env = { DB: db, SESSION_SECRET: SECRET };
  const body = await withNow(TUESDAY, async () => (await handleApi(new Request('https://jonmac.ai/dashboard/api/d3', { headers: { Cookie: await cookieAt(TUESDAY) } }), env)).json());
  const d3 = body.d3;
  assert.equal(d3.review.count, 2);
  assert.equal(d3.review.cards, 1);
  assert.equal(d3.review.approvals, 1);
  assert.deepEqual(d3.openCards, { 'jon-mac': 2, 'home-guide-press': 1 });
  assert.equal(d3.rail.tokens.pct, 100);
  assert.equal(d3.rail.tokens.text, 'Token limit hit');
  assert.equal(d3.goals.tokenWeeks.actual, 1);
  assert.equal(d3.goals.workouts.actual, 2);
  assert.equal(d3.goals.workouts.loggedToday, true);
  assert.equal(d3.goals.qcFirstTry.actual, 50);
  assert.equal(d3.rail.youtube.text, 'YouTube not connected');
  // No such table in D1: that part goes null / No feed, the rest still answers.
  db.sqlite.exec('DROP TABLE habits');
  const again = await withNow(TUESDAY, async () => (await handleApi(new Request('https://jonmac.ai/dashboard/api/d3', { headers: { Cookie: await cookieAt(TUESDAY) } }), env)).json());
  assert.equal(again.d3.goals.workouts.actual, null);
  assert.equal(again.d3.review.count, 2);
});

const d3Sample = () => ({ ok: true, d3: {
  rail: { dispatcher: { state: 'none', text: 'No feed' }, bots: { state: 'none', text: 'No feed' }, tokens: { state: 'y', text: 'Tokens 80% used', pct: 80 }, youtube: { state: 'g', text: 'YouTube login ok' } },
  review: { count: 3, oldestLabel: '5 hr' }, openCards: { 'jon-mac': 8, jonmacai: 1 },
  goals: {
    tokenWeeks: { actual: 1, target: 0, display: '1', pace: null, status: { text: 'Behind', cls: 'risk' }, hitDays: ['2026-11-03'], note: 'x', days: [] },
    qcFirstTry: { actual: 40, target: null, display: '40%', passed: 2, total: 5, status: { text: 'No target', cls: 'idle' }, note: '', days: [] },
    workouts: { actual: 1, target: 3, display: '1 of 3', pace: 0.5, status: { text: 'On pace', cls: 'ok' }, loggedToday: true, days: [{ ymd: '2026-11-02', actual: 1 }] },
    dateNights: { actual: 0, target: 4, display: '0 of 4', pace: 1, status: { text: 'Behind', cls: 'risk' }, loggedToday: false, perDay: {} },
    charges: { actual: 0, target: 0, display: 'No data', status: { text: 'No data', cls: 'idle' }, note: '' },
  },
} });

test('Goals: sections in the design order, targets from the data, no design sample text', () => {
  const d2 = SAMPLE();
  const html = renderGoals(d2, d3Sample(), {});
  const order = ['<h1>Goals</h1>', 'Key results', 'Sponsor Revenue', 'Blockers', 'To review', 'Tokens', '<h2>Content Factory</h2>', '<h2>Operations</h2>', '<h2>Personal</h2>', 'Videos Scheduled'];
  let at = -1;
  for (const s of order) { const i = html.indexOf(s, at + 1); assert.ok(i > at, `${s} after the one before`); at = i; }
  const hgp = d2.d2.goals.find((g) => g.key === 'hgp').week[0];
  assert.match(html, new RegExp(`of ${hgp.target} · ${hgp.rows.length} channels, ${hgp.rows[0].target} each`));
  assert.match(html, /\$3,100/);
  assert.match(html, /of \$10,000/);
  assert.match(html, /behind pace|ahead of pace/);
  assert.match(html, /8 open cards/);
  assert.match(html, /Tuesday|Sunday/);
  for (const s of ['Arcads', 'Topview', 'Forecast', 'forecast', 'of 48', '16 channels', 'Atoms', '$1,500', 'Peter Collins']) assert.ok(!html.includes(s), s);
  // A target changed in the data shows on the page; nothing is hard-coded.
  hgp.target = 35;
  for (const r of hgp.rows) r.target = 9;
  const changed = renderGoals(d2, d3Sample(), {});
  assert.match(changed, /of 35 · 4 channels, 9 each/);
  const jm = d2.d2.goals.find((g) => g.key === 'jonmac').week[0];
  jm.target = 5;
  const b1 = objectivesOf(d2, d3Sample()).find((o) => o.title === 'Content Factory').krs[0];
  assert.equal(b1.v2, ' / 5');
});

test('Goals: missing sources read No feed / No data with a grey dot; text is escaped; trends only from real points', () => {
  const d2 = SAMPLE();
  const none = renderGoals(d2, null, {});
  assert.match(none, /Approved, not published<\/span><span class="krv nf">No feed/);
  assert.match(none, /Workouts<\/span><span class="krv nf">No feed/);
  assert.match(none, /<b class="num sp nf">No feed<\/b>/); // tiles that need /d3
  assert.match(none, /Open cards: No feed/);
  const objs = objectivesOf(d2, null);
  for (const k of objs.flatMap((o) => o.krs).filter((k) => k.nf)) assert.equal(k.tone, 'n', k.text);
  // Nothing at all: no numbers, no crash.
  const empty = renderGoals({ d2: { goals: [], period: {} } }, null, {});
  assert.doesNotMatch(empty, /\$\d/);
  // Escaping.
  d2.d2.goals.find((g) => g.key === 'hgp').week[0].rows[0].label = '<img src=x onerror=alert(1)>';
  const esc = renderGoals(d2, d3Sample(), { hgpOpen: true });
  assert.ok(!esc.includes('<img src=x'));
  assert.match(esc, /&lt;img src=x/);
  // Trends: a week count plots its days; a number with no series says so.
  const open = renderGoals(d2, d3Sample(), { openKr: 'b3' });
  assert.match(open, /<polyline class="act [a-z]*" points="20,125 /);
  assert.match(renderGoals(d2, d3Sample(), { openKr: 'c2' }), /No trend data yet\./);
  // + Log: on Workouts and Date nights only; disabled once logged today.
  const page = renderGoals(d2, d3Sample(), {});
  assert.match(page, /data-log="workout" disabled>Logged today/);
  assert.match(page, /data-log="date_night">\+ Log/);
  assert.equal((page.match(/data-log=/g) || []).length, 2);
});

test('Shell: signed out opens /dash/ once, then shows a sign-in link instead of reloading', async () => {
  const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const session = store();
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  const realInterval = globalThis.setInterval;
  const open = async (n) => {
    const nodes = new Map();
    const node = () => ({ innerHTML: '', textContent: '', hidden: false, dataset: {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, addEventListener() {} });
    const location = { hash: '', replaced: [], replace(u) { this.replaced.push(u); } };
    Object.assign(globalThis, {
      document: { documentElement: node(), title: '', visibilityState: 'visible', querySelectorAll: () => [], getElementById: (k) => nodes.get(k) || nodes.set(k, node()).get(k), addEventListener() {} },
      window: { addEventListener() {} }, location, localStorage: store(), sessionStorage: session,
      fetch: async () => new Response('{"error":"Sign in"}', { status: 401 }),
    });
    globalThis.setInterval = () => 0;
    try {
      await import(`../public/d3/js/app.js?tab=${n}`);
      await settle();
    } finally { globalThis.setInterval = realInterval; }
    return { location, main: nodes.get('main') };
  };
  const first = await open(1);
  assert.deepEqual(first.location.replaced, ['/dash/']);
  const second = await open(2);
  assert.deepEqual(second.location.replaced, []);
  assert.match(second.main.innerHTML, /signed out/);
});
