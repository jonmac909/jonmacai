// Dashboard 3 (docs/dashboard-3.md): /dash serving, GET /dashboard/api/d3, the Goals, Team and Blockers mapping and the shell's sign-in handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import worker from '../src/worker.js';
import { signSession, COOKIE } from '../src/auth.js';
import { renderGoals, objectivesOf, scoreboardHtml } from '../public/d3/js/goals.js';
import { statHtml, railCounts } from '../public/d3/js/rail.js';
import { renderTeam } from '../public/d3/js/team.js';
import { blockerRows, renderBlockers } from '../public/d3/js/blockers.js';
import { reviewItems, renderReview, reviewClick } from '../public/d3/js/review.js';
import { dealStages, renderMoney } from '../public/d3/js/money.js';

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

test('Goals scoreboard: today\'s QC-passed videos, stage clocks, and approved videos not uploaded', async () => {
  const db = sqliteD1();
  const card = (id, title, project, extra = {}) => ins(db, 'bot_tasks', { id, title, owner: 'elle', project, status: 'doing', created_by: 'ana', updated_by: 'ana', created_at: '2026-11-10T15:00:00Z', updated_at: '2026-11-10T15:00:00Z', ...extra });
  const pass = (id, task, link, at = '2026-11-10T17:00:00Z') => ins(db, 'bot_proofs', { id, task_id: task, kind: 'render', link, status: 'passed', created_by: 'qc', created_at: at, checked_at: at });
  const ev = (id, task, at, kind, detail) => db.sqlite.prepare('INSERT INTO bot_task_events (id, task_id, at, "by", kind, detail) VALUES (?, ?, ?, ?, ?, ?)').run(id, task, at, 'jon', kind, detail);
  // Elle's Rosa video passed today: counts, even though Olivia doesn't own it.
  card('e1', "Smart thermostat mistakes - Rosa's House Hacks", 'home-guide-press');
  pass('p1', 'e1', 'https://jonmac.ai/review/rosa-3-v3');
  pass('p1b', 'e1', 'https://jonmac.ai/review/rosa-3-v4', '2026-11-10T18:00:00Z'); // one card counts once
  // An a-roll pass doesn't count; the card is in pack, on time.
  card('a1', 'Kitchen tips - Naomi Takeda Japan', 'home-guide-press', { stage: 'pack', stage_since: '2026-11-10T18:00:00Z', created_at: '2026-11-10T17:00:00Z' });
  pass('p2', 'a1', 'https://jonmac.ai/review/aroll/naomi-1-v1');
  // A parked channel doesn't count.
  card('d1', 'Dog training - Dale Whitaker Pitbulls', 'home-guide-press');
  pass('p3', 'd1', 'https://jonmac.ai/review/dale-1-v1');
  // Jon Mac passed yesterday (not today); its edit stage is over budget, so it's late.
  card('j1', 'AI agents explained - Jon Mac', 'jon-mac', { stage: 'edit', stage_since: '2026-11-10T16:00:00Z', created_at: '2026-11-10T16:00:00Z' });
  pass('p4', 'j1', 'https://jonmac.ai/review/jonmac-1-v1', '2026-11-09T20:00:00Z');
  // Rosa passed v1 yesterday and v2 today: a new version of an older video doesn't count again.
  card('r2', "Fridge coils - Rosa's House Hacks", 'home-guide-press');
  pass('p5', 'r2', 'https://jonmac.ai/review/rosa-4-v1', '2026-11-09T20:00:00Z');
  pass('p6', 'r2', 'https://jonmac.ai/review/rosa-4-v2');
  // Approved and waiting; approved then sent back; approved and already published.
  card('n1', 'Litter box myths - Nora Fairweather Cats', 'home-guide-press');
  ev('v1', 'n1', '2026-11-08T19:00:00Z', 'review', 'approved v2 on the review page');
  card('g1', 'Pasta water - Giovanni Moretti', 'home-guide-press');
  ev('v2', 'g1', '2026-11-08T19:00:00Z', 'review', 'approved v1 on the review page');
  ev('v3', 'g1', '2026-11-09T19:00:00Z', 'review', 'changes asked on v1');
  card('s1', 'Sushi at home - Naomi Takeda Japan', 'home-guide-press');
  ev('v4', 's1', '2026-11-08T19:00:00Z', 'status', 'status review → qc (approved by Jon)');
  ins(db, 'yt_calendar', { id: 'c1', channel: 'naomi-takeda-japan', title: 'Sushi at home', day: '2026-11-10', status: 'published', created_by: 'x', updated_by: 'x', created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z' });
  const env = { DB: db, SESSION_SECRET: SECRET };
  const body = await withNow(TUESDAY, async () => (await handleApi(new Request('https://jonmac.ai/dashboard/api/d3', { headers: { Cookie: await cookieAt(TUESDAY) } }), env)).json());
  const sb = body.d3.goals.scoreboard;
  assert.equal(sb.actual, 1);
  assert.equal(sb.target, 6);
  assert.deepEqual(sb.rows.map((r) => [r.id, r.state]), [['e1', 'passed'], ['j1', 'late'], ['a1', 'on']]);
  assert.equal(sb.late, 1);
  const pack = sb.rows.find((r) => r.id === 'a1');
  assert.deepEqual([pack.stageMin, pack.budgetMin, pack.clockMin], [60, 75, 120]);
  const aw = body.d3.goals.approvedWaiting;
  assert.deepEqual(aw.items.map((x) => x.id), ['n1']);
  assert.equal(aw.actual, 1);
  assert.ok(aw.oldestLabel);
  const html = scoreboardHtml(body);
  assert.match(html, /1 of 6 passed today/);
  assert.match(html, /1 late/);
  assert.match(html, /1 approved, not uploaded, oldest [^:]+: Litter box myths - Nora Fairweather Cats/);
  assert.match(html, /pack 60 of 75 min/);
  assert.match(html, /2:00 of 3:00/);
  // The Goals page puts it right after the header.
  const page = renderGoals(SAMPLE(), body, {});
  assert.ok(page.indexOf("Today's videos") < page.indexOf('Key results'));
});

test('Goals scoreboard: clock from the first stage, own channels waiting, ad / live / old cards skipped, long list capped, no feed', async () => {
  const db = sqliteD1();
  const card = (id, title, project, extra = {}) => ins(db, 'bot_tasks', { id, title, owner: 'elle', project, status: 'doing', created_by: 'ana', updated_by: 'ana', created_at: '2026-11-10T15:00:00Z', updated_at: '2026-11-10T15:00:00Z', ...extra });
  const ev = (id, task, at, kind, detail) => db.sqlite.prepare('INSERT INTO bot_task_events (id, task_id, at, "by", kind, detail) VALUES (?, ?, ?, ?, ?, ?)').run(id, task, at, 'jon', kind, detail);
  // Made two days ahead, brief started an hour ago: the clock reads 1:00, not late.
  card('k1', 'Rice cooker hacks - Naomi Takeda Japan', 'home-guide-press', { stage: 'brief', stage_since: '2026-11-10T18:50:00Z', created_at: '2026-11-08T15:00:00Z' });
  ev('s1', 'k1', '2026-11-10T18:00:00Z', 'stage', 'stage none → brief');
  // Approved and waiting on the Jon Mac and @JonMacAI channels count now.
  card('j1', 'Claude tips - Jon Mac', 'jon-mac');
  ev('a1', 'j1', '2026-11-09T19:00:00Z', 'review', 'approved v1 on the review page');
  card('j2', 'Agents in 10 minutes - JonMacAI', 'jonmacai');
  ev('a2', 'j2', '2026-11-09T18:00:00Z', 'review', 'approved v1 on the review page');
  // Not waiting: an ebook ad, a card with a live proof link, a card done more than 14 days ago.
  card('x1', 'Ebook ad - Rosa\'s House Hacks', 'home-guide-press');
  ev('a3', 'x1', '2026-11-09T19:00:00Z', 'review', 'approved v1 on the review page');
  card('x2', 'Gutter cleaning - Rosa\'s House Hacks', 'home-guide-press');
  ev('a4', 'x2', '2026-11-09T19:00:00Z', 'review', 'approved v1 on the review page');
  ins(db, 'bot_proofs', { id: 'pl', task_id: 'x2', kind: 'live', link: 'https://youtu.be/abc', status: 'passed', created_by: 'elle', created_at: '2026-11-09T20:00:00Z' });
  card('x3', 'Old one - Giovanni Moretti', 'home-guide-press', { status: 'done', updated_at: '2026-10-20T00:00:00Z' });
  ev('a5', 'x3', '2026-10-19T19:00:00Z', 'review', 'approved v1 on the review page');
  const env = { DB: db, SESSION_SECRET: SECRET };
  const body = await withNow(TUESDAY, async () => (await handleApi(new Request('https://jonmac.ai/dashboard/api/d3', { headers: { Cookie: await cookieAt(TUESDAY) } }), env)).json());
  const k1 = body.d3.goals.scoreboard.rows.find((r) => r.id === 'k1');
  assert.deepEqual([k1.clockMin, k1.state], [60, 'on']);
  assert.deepEqual(body.d3.goals.approvedWaiting.items.map((x) => x.id), ['j2', 'j1']);
  // Seven waiting: the red line names five and counts the rest.
  const items = Array.from({ length: 7 }, (_, i) => ({ id: `w${i}`, title: `Video ${i} - Jon Mac`, waitMin: 60 }));
  const many = { d3: { goals: { scoreboard: body.d3.goals.scoreboard, approvedWaiting: { actual: 7, oldestLabel: '1 hr', items } } } };
  const html = scoreboardHtml(many);
  assert.match(html, /Video 4 - Jon Mac and 2 more/);
  assert.ok(!html.includes('Video 5'));
  // No scoreboard source: the section says No feed instead of breaking the page.
  assert.match(scoreboardHtml({ d3: { goals: {} } }), /No feed/);
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
  assert.match(none, /Approved, not uploaded<\/span><span class="krv nf">No feed/);
  assert.match(none, /Today's videos<\/h2><\/div><p class="mut">No feed/);
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

// ---- Card 2: Team and Blockers ----
const TEAM = JSON.parse(readFileSync(new URL('../src/d3-team.json', import.meta.url), 'utf8'));
const BOTS_FILE = 'D:\\AgentTeam\\rules\\BOTS.md';
test('Team roster (src/d3-team.json) is the same as BOTS.md, with no retired bot', { skip: !existsSync(BOTS_FILE) && 'not on GPU1' }, () => {
  const want = new Map();
  const roles = new Map();
  for (const line of readFileSync(BOTS_FILE, 'utf8').split(/\r?\n/)) {
    const c = line.split('|').map((x) => x.trim());
    const slug = c[2]?.match(/^areas\/([a-z0-9-]+)\.md$/)?.[1];
    if (!slug) continue;
    want.set(slug, [...(want.get(slug) || []), c[4]]);
    roles.set(slug, c[1]);
  }
  const have = new Map(TEAM.bots.map((b) => [b.slug, b.names]));
  assert.deepEqual([...have.keys()].sort(), [...want.keys()].sort());
  for (const [slug, names] of want) assert.deepEqual([...have.get(slug)].sort(), [...names].sort(), slug);
  for (const b of TEAM.bots) if (roles.get(b.slug) !== b.names[0]) assert.equal(b.role, roles.get(b.slug), b.slug);
});

test('Team roster never lists a retired bot', () => {
  const names = TEAM.bots.flatMap((b) => b.names);
  for (const gone of ['Mila', 'Ivy', 'Zendaya']) assert.ok(!names.includes(gone), gone);
  for (const slug of ['moneyclaw', 'inbox', 'historient', 'yt-strategy']) assert.ok(!TEAM.bots.some((b) => b.slug === slug), slug);
});

const H = (h) => new Date(TUESDAY - h * 3600000).toISOString();
function teamDb() {
  const db = sqliteD1();
  const t = (id, owner, status, at, extra = {}) => ins(db, 'bot_tasks', { id, title: `Card ${id}`, owner, status, created_by: 'ana', updated_by: owner, created_at: at, updated_at: at, ...extra });
  t('w1', 'home-guide-press', 'waiting_on_jon', H(28), { note: 'What happened:\n- Thumbnail done\nYour move: Approve the thumbnail\nNext: upload' });
  t('d1', 'developer', 'doing', H(0.5), { note: 'Building the Team page.', due: '2026-11-10' });
  t('d2', 'developer', 'todo', H(5));
  t('late', 'sponsors', 'doing', H(3));
  t('stuck', 'video-editor', 'doing', H(1));
  t('rev', 'qc', 'review', H(1));
  t('old', 'qc', 'done', H(40));
  t('mc', 'moneyclaw', 'doing', H(1)); // a retired bot's card: not on Team
  t('jon1', 'jon', 'doing', H(10)); // Jon's own card: never late
  const proof = (id, task, status, at) => ins(db, 'bot_proofs', { id, task_id: task, kind: 'render', link: `https://x/${id}`, status, created_by: 'qc', created_at: at, checked_at: at });
  proof('p1', 'stuck', 'failed', H(30)); proof('p2', 'stuck', 'failed', H(2));
  proof('p3', 'rev', 'failed', H(30)); proof('p4', 'rev', 'failed', H(20)); proof('p5', 'rev', 'passed', H(1));
  proof('p6', 'old', 'failed', H(45)); proof('p7', 'old', 'failed', H(44));
  ins(db, 'bot_task_events', { id: 'e1', task_id: 'rev', at: H(1), by: 'qc', kind: 'status', detail: 'status qc → review (QC passed)' });
  ins(db, 'bot_questions', { id: 'q1', asked_by: 'home-guide-press', question: 'Which thumbnail?', task_id: 'w1', status: 'open', created_at: H(5), updated_at: H(5) }); // same card as w1: shown once
  ins(db, 'bot_questions', { id: 'q2', asked_by: 'sponsors', question: 'Which company invoices sponsors?', status: 'open', created_at: H(50), updated_at: H(50) });
  ins(db, 'bot_questions', { id: 'q3', asked_by: 'ana', question: 'Bot health', status: 'open', idem_key: 'team-guard:x', created_at: H(5), updated_at: H(5) });
  ins(db, 'bot_approvals', { id: 'a1', action: 'publish_draft', title: 'Munch reply', requested_by: 'sponsors', status: 'pending', created_at: H(4), updated_at: H(4) });
  ins(db, 'bot_runs', { id: 'r1', bot: 'sponsors', started_at: H(0.3), status: 'running', created_at: H(0.3) });
  return db;
}
const d3Of = async (db) => withNow(TUESDAY, async () => (await handleApi(new Request('https://jonmac.ai/dashboard/api/d3', { headers: { Cookie: await cookieAt(TUESDAY) } }), { DB: db, SESSION_SECRET: SECRET })).json());

test('GET /dashboard/api/d3: Team rows from the roster and D1 cards, proofs and runs', async () => {
  const body = await d3Of(teamDb());
  const T = body.d3.team;
  assert.deepEqual(T.bots.map((b) => b.slug), TEAM.bots.map((b) => b.slug));
  assert.ok(!JSON.stringify(T).includes('moneyclaw'));
  const by = Object.fromEntries(T.bots.map((b) => [b.slug, b]));
  assert.equal(by.developer.card.id, 'd1');
  assert.equal(by.developer.card.stage, 'Doing');
  assert.equal(by.developer.card.due, 'today');
  assert.equal(by.developer.tone, 'g');
  assert.deepEqual(by.developer.counts, { doing: 1, todo: 1 });
  assert.equal(by['home-guide-press'].tone, 'y');
  assert.equal(by['home-guide-press'].card.stage, 'Waiting on you');
  assert.deepEqual(by.qc.finishedToday, ['Card rev']);
  assert.equal(by['video-editor'].failedToday, 1); // p2 failed today
  assert.equal(by['video-editor'].tone, 'r');
  assert.equal(by.sponsors.running, '18 m');
  assert.equal(by.developer.running, null); // posts no runs: No feed
  for (const b of T.bots) assert.equal(b.tokens, null); // nothing posts tokens
  assert.equal(T.working, 3); // developer, sponsors, video-editor have a card in Doing
  assert.deepEqual(T.waiting, { count: 1, oldest: '28 hr' });
  assert.equal(T.failedToday, 1);
  assert.equal(T.cost, null);
  assert.equal(T.names, TEAM.bots.reduce((n, b) => n + b.names.length, 0));
});

test('GET /dashboard/api/d3: Blockers from D1, with Stuck = 2+ failed proofs on an open card not in Review', async () => {
  const B = (await d3Of(teamDb())).d3.blockers;
  const by = Object.fromEntries(B.map((b) => [b.id, b]));
  assert.deepEqual(Object.keys(by).sort(), ['a:a1', 'q:q2', 't:late', 't:stuck', 't:w1']);
  assert.equal(by['t:w1'].kind, 'p');
  assert.equal(by['t:w1'].you, true);
  assert.equal(by['t:w1'].blocks, 'Approve the thumbnail');
  assert.equal(by['t:w1'].owner, 'Elle');
  assert.equal(by['t:w1'].age, '28 hr');
  assert.equal(by['q:q2'].review, true);
  assert.equal(by['a:a1'].review, true);
  assert.equal(by['t:stuck'].kind, 'f');
  assert.equal(by['t:stuck'].you, false);
  assert.equal(by['t:stuck'].fails, 2);
  assert.equal(by['t:stuck'].owner, 'Olivia, Emma, Indy');
  assert.equal(by['t:late'].kind, 's');
  assert.match(by['t:late'].blocks, /no card update for 3 hr/);
  // No cards table: no blockers at all, so the rail count hides instead of saying 0.
  const db = teamDb();
  db.sqlite.exec('DROP TABLE bot_tasks');
  const none = await d3Of(db);
  assert.equal(none.d3.blockers, null);
  assert.equal(none.d3.team, null);
  assert.equal(railCounts(null, none).blockers, null);
});

test('Team page: design sections in order, live rows, No feed where nothing reports, no design sample text', async () => {
  const d2 = SAMPLE();
  const d3 = await d3Of(teamDb());
  const html = renderTeam(d2, d3, {});
  const order = ['<h1>Team</h1>', 'Working', 'Waiting on you', 'Failed', 'Cost', '<h2>Bots</h2>', 'Working on', 'Lucy', '<h2>Video board</h2>', 'Limits are proposed, not agreed.'];
  let at = -1;
  for (const s of order) { const i = html.indexOf(s, at + 1); assert.ok(i > at, `${s} after the one before`); at = i; }
  assert.equal((html.match(/class="brow"/g) || []).length, TEAM.bots.length);
  assert.match(html, /Card d1/);
  assert.match(html, /Runs, tokens and cost: No feed/);
  assert.match(html, /<span class="pill sp">0 late<\/span>/); // no staged card in teamDb: an empty board, not No feed
  assert.equal((html.match(/<span class="mut" style="font-size: 12px">None<\/span>/g) || []).length, 8); // each stage of the video board
  for (const s of ['Dale Whitaker', '$746', '$4,194', '90K', 'Peter Collins', 'Mila', 'Ivy', 'Sample activity', 'batches at', 'Munch']) assert.ok(!html.includes(s), s);
  assert.doesNotMatch(html, /Finished today/); // rows closed
  const open = renderTeam(d2, d3, { openBot: 'qc' });
  assert.match(open, /aria-expanded="true" data-bot="qc"/);
  assert.match(open, /Finished today<\/span><div class="hd" style="gap: 8px"><span class="dot g"><\/span><span>Card rev<\/span>/);
  assert.match(open, /Work so far/);
  assert.match(renderTeam(d2, d3, { openBot: 'developer' }), /Building the Team page\.[\s\S]*Open cards: 1 doing, 1 to do/);
  // No /d3 answer: tiles and rows say No feed, nothing made up.
  const none = renderTeam(d2, null, {});
  assert.match(none, /No feed: the dashboard cards could not be read/);
  assert.match(none, /Late: No feed/);
  assert.equal((none.match(/<span class="nf" style="font-size: 12px">No feed<\/span>/g) || []).length, 8);
  assert.equal((none.match(/<b class="num sp nf">No feed<\/b>/g) || []).length, 4);
});

test('Blockers page: filters, rows open to what they block, review items link to Review, rail count = rows', async () => {
  const d2 = SAMPLE();
  const d3 = await d3Of(teamDb());
  d3.d3.rail.youtube = { state: 'r', text: 'YouTube login out (1 of 3)', out: 1, connected: 3 };
  d3.d3.rail.tokens = { state: 'r', text: 'Token limit hit', pct: 100, source: { ageLabel: 'updated 5 min ago', stale: false } };
  const missed = (d2.d2.checks || []).filter((c) => c.today?.ok === false).length;
  const rows = blockerRows(d2, d3);
  assert.equal(rows.length, 5 + 2 + missed);
  assert.equal(railCounts(d2, d3).blockers, rows.length);
  assert.ok(rows.findIndex((b) => !b.you) > rows.findLastIndex((b) => b.you)); // Jon's rows first
  const html = renderBlockers(d2, d3, {});
  const order = ['<h1>Blockers</h1>', 'Open', 'Need you', 'Ana on it', 'Oldest', '<h2>Open blockers</h2>', 'System health', 'Daily jobs', 'Dispatcher', 'Logins and limits', 'Feed age'];
  let at = -1;
  for (const s of order) { const i = html.indexOf(s, at + 1); assert.ok(i > at, `${s} after the one before`); at = i; }
  assert.match(html, /data-blf="all">All \d+</);
  assert.match(html, /data-blf="a">Access 2</);
  assert.match(html, /Weekly tokens<\/span><b>100%/);
  assert.match(html, /HeyGen today<\/span><b class="nf">No feed/);
  for (const s of ['Atoms', '$5,500', 'Arcads', 'Dale Whitaker', '[', 'Rosa']) assert.ok(!html.includes(s), s);
  // A filter shows only its kind; an open row shows Blocks and Ana (No feed); only review items link to Review.
  const you = renderBlockers(d2, d3, { blFilter: 'you' });
  assert.equal((you.match(/class="blrow/g) || []).length, rows.filter((b) => b.you).length);
  const ap = renderBlockers(d2, d3, { openBl: 'a:a1' });
  assert.match(ap, /Blocks<\/span><span>Florence · Approval to publish draft<\/span>/);
  assert.match(ap, /Ana<\/span><span class="nf">No feed<\/span>/);
  assert.match(ap, /<a class="btn pri" href="#review" data-rvgo="a:a1">Open in Review<\/a>/);
  assert.doesNotMatch(renderBlockers(d2, d3, { openBl: 't:stuck' }).split('<h2>Open blockers</h2>')[1], /Open in Review/); // Needs you above has its own
  // No cards: no rows, tiles say No feed.
  assert.match(renderBlockers(d2, null, {}), /No feed: the dashboard cards could not be read/);
});

// ---- Card 2 review fixes ----
test('Owners not on the roster (retired bots) read "Former bot", never a slug or a retired name', async () => {
  const { ownerName } = await import('../src/d3.js');
  assert.equal(ownerName('moneyclaw'), 'Former bot');
  assert.equal(ownerName('ivy'), 'Former bot');
  assert.equal(ownerName('developer'), 'Lucy');
  assert.equal(ownerName('jon'), 'Jon');
  const db = teamDb();
  ins(db, 'bot_questions', { id: 'q9', asked_by: 'moneyclaw', question: 'Old MoneyClaw question', status: 'open', created_at: H(6), updated_at: H(6) });
  const B = (await d3Of(db)).d3.blockers;
  assert.equal(B.find((b) => b.id === 'q:q9').owner, 'Former bot');
  for (const s of ['moneyclaw', 'Mila', 'Ivy']) assert.ok(!JSON.stringify(B).includes(s), s);
});

test('Page header escapes its sub line; Team header and Working tile read the same role count', async () => {
  const { headerOnly } = await import('../public/d3/js/goals.js');
  assert.match(headerOnly(null, 'X', '<img src=x>'), /&lt;img src=x&gt;/);
  assert.doesNotMatch(headerOnly(null, 'X', '<img src=x>'), /<img/);
  const html = renderTeam(SAMPLE(), await d3Of(teamDb()), {});
  const n = TEAM.bots.length;
  assert.match(html, new RegExp(`· ${n} roles</span>`));
  assert.match(html, new RegExp(`of ${n} roles</span>`));
});

test('d3.css: narrow screens stack the Team and Blockers rows, desktop rules unchanged', () => {
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  assert.match(css, /\.d3 \.brow\{display:grid;grid-template-columns:170px minmax\(0,1fr\) 116px 60px 60px 56px 84px;/);
  assert.match(css, /\.d3 \.blrow\{display:grid;grid-template-columns:minmax\(0,1fr\) 160px 90px 104px;/);
  const media = [...css.matchAll(/@media \(max-width:(\d+)px\)\{([\s\S]*?)\n\}/g)].map((m) => [Number(m[1]), m[2]]);
  const narrow = media.filter(([w]) => w < 1024).map(([, body]) => body).join('\n');
  assert.ok(media.length && media.every(([w]) => w < 1024), 'no narrow rule reaches the 1024 layout');
  assert.match(narrow, /\.d3 \.brow\{grid-template-columns:[^}]*\}/);
  assert.match(narrow, /\.d3 \.brow>:nth-child\(n\+4\)\{display:none\}/);
  assert.match(narrow, /\.d3 \.blrow\{grid-template-columns:minmax\(0,1fr\) auto\}/);
});

test('Video board: open cards with a stage, by stage, with count, oldest age, late past the limit, QC columns', async () => {
  const db = teamDb();
  const t = (id, stage, status, since, extra = {}) => ins(db, 'bot_tasks', { id, title: `Video ${id}`, owner: 'video-editor', status, stage, stage_since: since, created_by: 'ana', updated_by: 'ana', created_at: H(50), updated_at: H(0.5), ...extra });
  t('v1', 'edit', 'doing', H(9)); // past the 8 h limit
  t('v2', 'edit', 'doing', H(1));
  t('v3', 'script', 'qc', H(30), { updated_at: H(1) }); // Script QC, timed from the move to QC
  t('v4', 'sponsor review', 'doing', H(2)); // not a design column: its own column after them, no limit
  t('v5', 'pack', 'done', H(1)); // closed: not on the board
  for (const i of [1, 2, 3, 4]) t(`p${i}`, 'pack', 'doing', H(i));
  const d3 = await d3Of(db);
  const L = d3.d3.team.line;
  const by = Object.fromEntries(L.stages.map((s) => [s.key, s]));
  assert.deepEqual(L.stages.map((s) => s.key), ['brief', 'script', 'script qc', 'a-roll', 'pack', 'edit', 'render qc', 'publish', 'sponsor review']);
  assert.deepEqual([by.edit.n, by.edit.oldest, by.edit.cards.map((c) => [c.id, c.tone])], [2, '9 hr', [['v1', 'r'], ['v2', 'g']]]);
  assert.deepEqual([by['script qc'].n, by['script qc'].cards[0].age, by['script qc'].cards[0].tone], [1, '1 hr', 'g']);
  assert.equal(by.script.n, 0);
  assert.deepEqual([by.pack.n, by.pack.cards.map((c) => c.id), by.pack.more], [4, ['p4', 'p3', 'p2'], 1]);
  assert.deepEqual([by['sponsor review'].name, by['sponsor review'].limit, by['sponsor review'].cards[0].tone], ['Sponsor review', '', 'g']);
  assert.equal(L.late, 1);
  assert.equal(L.total, 8);
  const editor = d3.d3.team.bots.find((b) => b.slug === 'video-editor');
  assert.match(editor.card.stage, /^(Edit|Pack|Script|Sponsor review) · /);
  const html = renderTeam(SAMPLE(), d3, {});
  assert.match(html, /<span class="pill bad sp">1 late<\/span>/);
  assert.match(html, /grid-template-columns: repeat\(9, minmax\(0, 1fr\)\)/);
  assert.match(html, /data-stage="edit">[\s\S]*?limit 8 h · oldest 9 hr[\s\S]*?Video v1[\s\S]*?dot r/);
  assert.match(html, /data-stage="pack">[\s\S]*?\+1 more/);
  assert.match(html, /data-stage="sponsor review">[\s\S]*?no limit · oldest 2 hr/);
  assert.doesNotMatch(html, /Video v5/);
});

// ---- Card 3: Review and Money pages ----
function reviewDb() {
  const db = teamDb();
  ins(db, 'bot_tasks', { id: 'vid', title: 'Tiny house tour - Rosa', owner: 'video-editor', project: 'home-guide-press', status: 'review', note: 'Final cut <b>v2</b>', due: '2026-11-12', created_by: 'ana', updated_by: 'qc', created_at: H(8), updated_at: H(8) });
  ins(db, 'bot_proofs', { id: 'pv', task_id: 'vid', kind: 'render', link: '/dashboard/review/abc', status: 'passed', created_by: 'qc', created_at: H(8) });
  ins(db, 'bot_tasks', { id: 'loc', title: 'Local only', owner: 'developer', status: 'review', created_by: 'ana', updated_by: 'qc', created_at: H(2), updated_at: H(2) });
  ins(db, 'bot_proofs', { id: 'pl', task_id: 'loc', kind: 'file', link: 'D:\\work\\out.mp4', status: 'passed', created_by: 'qc', created_at: H(2) });
  ins(db, 'bot_questions', { id: 'q4', asked_by: 'sponsors', question: 'Which rate?', options: JSON.stringify(['$2,500', 'Other (type your own)']), status: 'open', created_at: H(6), updated_at: H(6) });
  return db;
}

test('GET /dashboard/api/d3: Review queue from D1, oldest first, each item with its existing write, no local links', async () => {
  const q = (await d3Of(reviewDb())).d3.queue;
  const at = q.map((x) => Date.parse(x.at));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  assert.equal(q[0].id, 'q:q2');
  assert.ok(!q.some((x) => x.id === 'q:q3')); // bot health stays with Ana
  const by = Object.fromEntries(q.map((x) => [x.id, x]));
  assert.deepEqual(by['t:vid'].act, { type: 'card', url: '/dashboard/api/v1/tasks/vid' });
  assert.equal(by['t:vid'].type, 'video');
  assert.equal(by['t:vid'].link, '/dashboard/review/abc');
  assert.equal(by['t:vid'].linkLabel, 'Open the review page');
  assert.equal(by['t:rev'].type, 'card');
  assert.equal(by['t:rev'].link, 'https://x/p5');
  assert.equal(by['t:loc'].link, ''); // local path dropped
  assert.equal(by['a:a1'].act.url, '/dashboard/api/v1/approvals/a1/decide');
  assert.equal(by['q:q4'].act.url, '/dashboard/api/v1/questions/q4/answer');
  assert.deepEqual(by['q:q4'].act.options, ['$2,500', 'Other (type your own)']);
});

test('Review page: sponsor drafts first, buttons per type, Undo disabled, text escaped, no design sample text', async () => {
  const d2 = SAMPLE();
  const d3 = await d3Of(reviewDb());
  const items = reviewItems(d2, d3);
  assert.equal(items[0].id, 'd:c-poppy');
  assert.equal(items[0].type, 'email');
  assert.equal(items.length, 1 + d3.d3.queue.length);
  const html = renderReview(d2, d3, {});
  assert.match(html, /<h1>Review<\/h1>/);
  assert.match(html, new RegExp(`${items.length} left`));
  assert.match(html, /Reply to Poppy/);
  assert.match(html, /data-rv="send"/);
  assert.match(html, /data-rv="edit"/);
  assert.match(html, /ann@poppy\.ai/);
  const pick = (id, ui = {}) => renderReview(d2, d3, { rvSel: id, ...ui });
  // A video with a review page is approved there (that locks the version): only the link, no Approve here.
  const vid = pick('t:vid');
  assert.match(vid, /<a class="btn pri lg" href="\/dashboard\/review\/abc"[^>]*>Approve or send back on the review page<\/a>/);
  assert.doesNotMatch(vid, /data-rv="approve"/);
  assert.match(vid, /Final cut &lt;b&gt;v2&lt;\/b&gt;|Final cut v2/);
  assert.doesNotMatch(vid, /<b>v2<\/b>/);
  assert.doesNotMatch(pick('t:loc'), /out\.mp4/);
  // Every action button carries the id of the item it was drawn for.
  assert.match(pick('t:rev'), /data-rv="approve" data-id="t:rev"[^>]*>Approve<\/button><button[^>]*data-rv="open-back" data-id="t:rev"/);
  assert.match(pick('t:rev', { rvBack: 't:rev' }), /class="rvtext"[\s\S]*data-rv="back" data-id="t:rev"[\s\S]*data-rv="cancel"/);
  assert.match(pick('a:a1'), /data-rv="yes" data-id="a:a1"[^>]*>Approve<\/button><button[^>]*data-rv="no"[^>]*>Reject/);
  // "Other (type your own)" is the typed box, never a button that sends those words.
  const q4 = pick('q:q4');
  assert.match(q4, /data-rv="opt" data-id="q:q4" data-opt="\$2,500"/);
  assert.doesNotMatch(q4, /data-opt="Other/);
  assert.match(q4, /placeholder="Or type your own answer"[\s\S]*data-rv="answer" data-id="q:q4"/);
  assert.match(pick('q:q2'), /placeholder="Type your answer"[\s\S]*data-rv="answer"/);
  // Only the "Other (type ...)" option is the box; a real option starting with "Other" stays a button.
  const q4item = d3.d3.queue.find((x) => x.id === 'q:q4');
  q4item.act.options = ['Other channel first', 'Other (type your own)'];
  assert.match(pick('q:q4'), /data-opt="Other channel first"/);
  assert.doesNotMatch(pick('q:q4'), /data-opt="Other \(type/);
  assert.match(pick('q:q2', { rvDone: { 'q:q2': 'Answered' } }), /Answered<\/span><button type="button" class="btn lg" disabled title="Nothing to undo with yet">Undo/);
  for (const s of ['Atoms', '$5,500', 'Arcads', 'Dale Whitaker', 'Undo the last']) assert.ok(!html.includes(s), s);
  assert.match(renderReview(null, null, {}), /No feed: the review queue could not be read/);
  assert.match(renderReview(null, { d3: { queue: [] } }, {}), /Nothing waiting for you/);
});

test('Review clicks: each button calls only its write, after a confirm where it changes something', async () => {
  const d2 = SAMPLE();
  const d3 = await d3Of(reviewDb());
  const real = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
  const calls = [];
  let yes = true;
  let typed = '';
  globalThis.fetch = async (url, o) => { calls.push([url, o.method, JSON.parse(o.body)]); return new Response('{"ok":true}', { status: 200 }); };
  globalThis.window = { confirm: () => yes };
  globalThis.document = { querySelector: () => ({ value: typed }) };
  const el = (attrs) => ({ dataset: attrs, disabled: false });
  const ev = (key, attrs) => ({ target: { closest: (sel) => (sel === `[data-${key}]` ? el(attrs) : null) } });
  let reloads = 0;
  const run = async (sel, key, attrs, ui = {}) => {
    const S = { d2, d3, ui: { rvSel: sel, ...ui } };
    await reviewClick(ev(key, key === 'rv' ? { id: sel, ...attrs } : attrs), S, () => {}, async () => { reloads += 1; });
    return S.ui;
  };
  try {
    let ui = await run('t:rev', 'rv', { rv: 'approve' });
    assert.deepEqual(calls.pop(), ['/dashboard/api/v1/tasks/rev', 'PATCH', { status: 'done' }]);
    assert.equal(ui.rvDone['t:rev'], 'Approved');
    // A video with a review page, a button of the wrong type, or an item gone since it was drawn: nothing sent.
    await run('t:vid', 'rv', { rv: 'approve' });
    await run('a:a1', 'rv', { rv: 'approve' });
    await run('q:q4', 'rv', { rv: 'yes' });
    reloads = 0;
    ui = await run('t:rev', 'rv', { rv: 'approve', id: 'q:gone' });
    assert.match(ui.rvErr, /This item changed/);
    assert.equal(reloads, 1);
    assert.equal(calls.length, 0);
    // Every write confirms first: No sends nothing.
    yes = false;
    typed = 'Fix it';
    for (const [sel, rv, extra] of [['t:rev', 'approve'], ['t:rev', 'back', { rvBack: 't:rev' }], ['a:a1', 'yes'], ['a:a1', 'no'], ['q:q4', 'opt', { opt: '$2,500' }], ['q:q2', 'answer'], ['d:c-poppy', 'send']]) {
      await run(sel, 'rv', { rv, ...(extra?.opt ? { opt: extra.opt } : {}) }, extra?.rvBack ? { rvBack: extra.rvBack } : {});
    }
    assert.equal(calls.length, 0);
    yes = true;
    typed = '';
    ui = await run('t:rev', 'rv', { rv: 'back' }, { rvBack: 't:rev' });
    assert.equal(calls.length, 0);
    assert.match(ui.rvErr, /Type what should change/);
    typed = '  Fix the intro  ';
    await run('t:rev', 'rv', { rv: 'back' }, { rvBack: 't:rev' });
    assert.deepEqual(calls.pop(), ['/dashboard/api/v1/tasks/rev', 'PATCH', { status: 'doing', comment: 'Fix the intro' }]);
    await run('a:a1', 'rv', { rv: 'no' });
    assert.deepEqual(calls.pop(), ['/dashboard/api/v1/approvals/a1/decide', 'POST', { decision: 'reject' }]);
    await run('a:a1', 'rv', { rv: 'yes' });
    assert.deepEqual(calls.pop(), ['/dashboard/api/v1/approvals/a1/decide', 'POST', { decision: 'approve' }]);
    ui = await run('q:q4', 'rv', { rv: 'opt', opt: '$2,500' });
    assert.deepEqual(calls.pop(), ['/dashboard/api/v1/questions/q4/answer', 'POST', { answer: '$2,500' }]);
    assert.equal(ui.rvDone['q:q4'], '$2,500');
    await run('d:c-poppy', 'rv', { rv: 'send' }, { rvEdit: 'd:c-poppy', rvDraft: { body: 'Edited' } });
    const [url, method, body] = calls.pop();
    assert.deepEqual([url, method, body.kind, body.payload.body, body.payload.to], ['/dashboard/api/actions', 'POST', 'sponsor.send_draft', 'Edited', 'ann@poppy.ai']);
    assert.ok(body.idemKey);
    typed = 'My own answer';
    await run('q:q4', 'rv', { rv: 'answer' });
    assert.deepEqual(calls.pop(), ['/dashboard/api/v1/questions/q4/answer', 'POST', { answer: 'My own answer' }]);
    // Done items, busy state and a failed write: nothing sent twice, the error shown.
    await run('t:rev', 'rv', { rv: 'approve' }, { rvDone: { 't:rev': 'Approved' } });
    await run('t:rev', 'rv', { rv: 'approve' }, { busy: true });
    assert.equal(calls.length, 0);
    globalThis.fetch = async (url, o) => { calls.push(JSON.parse(o.body)); return new Response('{"error":"not allowed"}', { status: 403 }); };
    ui = await run('t:rev', 'rv', { rv: 'approve' });
    assert.equal(ui.rvErr, 'Could not save: not allowed');
    assert.ok(!ui.rvDone?.['t:rev']);
    // A failed email send keeps its key, so the retry can't send twice.
    const S = { d2, d3, ui: { rvSel: 'd:c-poppy' } };
    await reviewClick(ev('rv', { rv: 'send', id: 'd:c-poppy' }), S, () => {}, async () => {});
    await reviewClick(ev('rv', { rv: 'send', id: 'd:c-poppy' }), S, () => {}, async () => {});
    const [k1, k2] = calls.splice(-2).map((x) => x.idemKey);
    assert.ok(k1 && k1 === k2);
    // An edited (or new) draft for the same sponsor gets a new key, so it is really sent.
    Object.assign(S.ui, { rvEdit: 'd:c-poppy', rvDraft: { body: 'New text' } });
    await reviewClick(ev('rv', { rv: 'send', id: 'd:c-poppy' }), S, () => {}, async () => {});
    assert.notEqual(calls.pop().idemKey, k1);
    // Picking and paging change only the selection.
    ui = await run('t:vid', 'rvnav', { rvnav: '1' });
    assert.notEqual(ui.rvSel, 't:vid');
  } finally {
    Object.assign(globalThis, real);
  }
});

test('Money page: design sections, six deal stages from the Sponsors board, No feed where nothing reports, no design numbers', async () => {
  const d2 = SAMPLE();
  const d3 = await d3Of(reviewDb());
  const st = dealStages(d2);
  assert.deepEqual(st.map((s) => s.name), ['Lead', 'Negotiating', 'Agreed', 'In production', 'Invoiced', 'Paid']);
  assert.deepEqual(st.map((s) => s.deals.length), [0, 1, 0, 2, 0, 1]); // Archived column left out
  assert.equal(st[1].deals[0].note, 'your send');
  const html = renderMoney(d2, d3);
  const order = ['<h1>Money</h1>', 'Collected', 'Agreed, not invoiced', 'Viral View', 'Team cost', 'Sponsor Revenue', 'Income and profit', 'Sponsor deals', 'Team cost'];
  let at = -1;
  for (const s of order) { const i = html.indexOf(s, at + 1); assert.ok(i > at, `${s} after the one before`); at = i; }
  assert.match(html, /\$3,100/);
  assert.match(html, /of \$10,000/);
  assert.match(html, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(html, /1 needs your send/);
  assert.match(html, /Forecast<\/span><span class="krv nf">No feed/);
  assert.match(html, /YouTube ads<\/span><b class="nf">No feed/);
  assert.match(html, /Profit this month<\/span><span class="num nf"[^>]*>No data/);
  for (const n of d3.d3.team.bots.map((b) => b.names[0]).slice(0, 3)) assert.match(html, new RegExp(`>${n}</span><span class="bar"`));
  for (const s of ['$4,194', '$1,859', '$1,711', '$3,211', '$5,500', '$7,000', 'Atoms']) assert.ok(!html.includes(s), s);
  // Deposit days from d2's sponsors cashDays (real d2 output in the sample) draw the collected line and count.
  assert.deepEqual(d2.d2.goals.find((g) => g.key === 'sponsors').cashDays, { '2026-11-01': 1000, '2026-11-03': 2100 });
  assert.match(html, /<polyline class="act" points="/);
  assert.match(html, /Deposit days<\/span><span class="krv">2</);
  d2.d2.goals.find((g) => g.key === 'sponsors').cashDays = null;
  const noDays = renderMoney(d2, d3);
  assert.doesNotMatch(noDays, /class="act"/);
  assert.match(noDays, /Deposit days<\/span><span class="krv nf">No feed/);
  // The rail's Review count is the Review page's queue, drafts included.
  assert.equal(railCounts(d2, d3).review, reviewItems(d2, d3).length);
  // Nothing readable: every part says so, the page still draws.
  const none = renderMoney(null, null);
  assert.match(none, /No feed: the Sponsors board could not be read/);
  assert.match(none, /No feed: the team roster could not be read/);
  assert.doesNotMatch(none, /NaN|undefined/);
});

test('Team page: each bot shows its profile picture from /dash/img/bots, rows with several bots stack them, others keep the letter', async () => {
  const { avatars, BOT_PICS } = await import('../public/d3/js/team.js');
  // Every roster name has a small picture file, and every picture in the list exists.
  for (const n of TEAM.bots.flatMap((b) => b.names)) assert.ok(BOT_PICS.has(n.toLowerCase()), `picture for ${n}`);
  for (const k of BOT_PICS) {
    const f = new URL(`../public/d3/img/bots/${k}.webp`, import.meta.url);
    assert.ok(existsSync(f), `${k}.webp`);
    assert.ok(readFileSync(f).length < 10000, `${k}.webp is small`);
  }
  const html = renderTeam(SAMPLE(), await d3Of(teamDb()), {});
  assert.match(html, /<img class="av pic" src="img\/bots\/lucy\.webp" alt="Lucy"[^>]* width="32" height="32"/);
  assert.match(html, /<span class="avs"><img [^>]*olivia\.webp[^>]*><img [^>]*emma\.webp[^>]*><img [^>]*indy\.webp[^>]*><\/span>/);
  assert.doesNotMatch(html, /<span class="av"[^>]*>[A-Z]<\/span>/); // every roster bot has a picture now
  // A bot with no picture keeps its letter circle, also inside a stack; nothing from a name reaches the src.
  assert.equal(avatars(['Zed']), '<span class="av" style="width: 32px; height: 32px; font-size: 13px">Z</span>');
  assert.match(avatars(['Ana', 'Zed']), /^<span class="avs"><img [^>]*ana\.webp[^>]*><span class="av"[^>]*>Z<\/span><\/span>$/);
  assert.doesNotMatch(avatars(['../x']), /<img/);
  // Served behind /dash like the css and js, and nothing else under img/.
  const env = { SESSION_SECRET: SECRET, ASSETS: assets };
  const get = async (p) => { const r = await worker.fetch(new Request(`https://jonmac.ai${p}`), env, {}); return r.status === 404 ? 404 : r.text(); };
  assert.equal(await get('/dash/img/bots/ana.webp'), 'asset:/d3/img/bots/ana.webp');
  for (const p of ['/dash/img/bots/ana.png', '/dash/img/ana.webp', '/dash/img/bots/../js/app.js', '/dash/img/bots/a-b.webp', '/dash/img/bots/Ana.webp']) assert.equal(await get(p), 404, p);
});
