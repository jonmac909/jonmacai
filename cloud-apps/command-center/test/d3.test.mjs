// Dashboard 3 (docs/dashboard-3.md): /dash serving, GET /dashboard/api/d3, the Goals, Team and Blockers mapping and the shell's sign-in handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { limitLabel, heygenLine } from '../src/d3.js';
import worker from '../src/worker.js';
import { signSession, COOKIE } from '../src/auth.js';
import { renderGoals, objectivesOf, pipelineOf } from '../public/d3/js/goals.js';
import { statHtml, railCounts } from '../public/d3/js/rail.js';
import { renderTeam } from '../public/d3/js/team.js';
import { blockerRows, renderBlockers } from '../public/d3/js/blockers.js';
import { reviewItems, renderReview, reviewClick, OTHER_PICK } from '../public/d3/js/review.js';
import { dealStages, renderMoney } from '../public/d3/js/money.js';
import { renderSources } from '../public/d3/js/sources.js';

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
  ins(db, 'bot_proofs', { id: 'p1', task_id: 't3', kind: 'render', link: '/dashboard/review/1', status: 'failed', created_by: 'qc', created_at: '2026-11-05T10:00:00Z' });
  ins(db, 'bot_proofs', { id: 'p2', task_id: 't3', kind: 'render', link: '/dashboard/review/2', status: 'passed', created_by: 'qc', created_at: '2026-11-06T10:00:00Z' });
  ins(db, 'bot_proofs', { id: 'p3', task_id: 't2', kind: 'render', link: '/dashboard/review/3', status: 'passed', created_by: 'qc', created_at: '2026-11-07T10:00:00Z' });
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
  // Jon, 2026-11-11: no "Today's videos" panel on top of Goals; the numbers stay in the key results.
  const page = renderGoals(SAMPLE(), body, {});
  assert.ok(!page.includes("Today's videos"));
  assert.doesNotMatch(page, /\d+ of \d+ passed today|approved, not uploaded, oldest/);
  assert.match(page, /QC-passed today/);
  assert.match(page, /Approved, not uploaded/);
});

test('Goals scoreboard: clock from the first stage, own channels waiting, ad / live / old cards skipped', async () => {
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
  const order = ['<h1>Goals</h1>', 'Key results', 'Sponsor Revenue', 'Pipeline revenue', '<h2>Content Factory</h2>', '<h2>Personal</h2>', 'Videos Scheduled'];
  let at = -1;
  for (const s of order) { const i = html.indexOf(s, at + 1); assert.ok(i > at, `${s} after the one before`); at = i; }
  // Operations card removed (Jon, 2026-11-11): no card and no Key results rows for it; 13 rows left.
  for (const s of ['Operations', 'Weeks token limit hit', 'Dashboard 3 pages built', 'Cost per video measured', 'typed &quot;continue&quot;']) assert.ok(!html.includes(s), s);
  assert.equal((html.match(/class="krb"/g) || []).length, 13);
  assert.match(html, /of 13 /);
  const hgp = d2.d2.goals.find((g) => g.key === 'hgp').week[0];
  assert.match(html, new RegExp(`of ${hgp.target} · ${hgp.rows.length} channels, ${hgp.rows[0].target} each`));
  assert.match(html, /\$3,100/);
  assert.match(html, /of \$10,000/);
  assert.match(html, /behind pace|ahead of pace/);
  assert.match(html, /8 open cards/);
  assert.match(html, /Tuesday|Sunday/);
  for (const s of ['Topview', 'Forecast', 'forecast', 'of 48', '16 channels', 'Atoms', '$1,500', 'Peter Collins']) assert.ok(!html.includes(s), s);
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

test('Goals: cards in a row are the same size; a long deal list scrolls inside Pipeline revenue (Jon, 2026-11-11)', () => {
  // Plant a long Pipeline list: 33 leads and 17 deals in production.
  const d2 = SAMPLE();
  const cols = d2.d2.pipeline.boards.find((b) => b.goal === 'sponsors').sponsors.board.columns;
  const lead = cols.find((c) => c.title === 'Leads');
  const prod = cols.find((c) => c.title === 'Video Production');
  for (let i = 1; i <= 33; i++) lead.cards.push({ id: `qc-lead-${i}`, name: `QC long list lead ${i} with a long sponsor name`, amt: null });
  for (let i = 1; i <= 17; i++) prod.cards.push({ id: `qc-prod-${i}`, name: `QC production deal ${i}`, amt: null });
  const html = renderGoals(d2, d3Sample(), {});
  // Top row and objectives sit in their own equal-column grids, in order.
  const top = html.indexOf('<div class="gtop">');
  const objs = html.indexOf('<div class="gobjs">');
  assert.ok(top >= 0 && objs > top, '.gtop then .gobjs wrappers');
  const topRow = html.slice(top, objs);
  for (const s of ['aria-label="Key results"', 'aria-label="Sponsor Revenue"', 'aria-label="Pipeline revenue"']) assert.ok(topRow.includes(s), `${s} in .gtop`);
  assert.match(topRow, /<section class="card gpipe"/);
  for (const s of ['<h2>Content Factory</h2>', '<h2>Personal</h2>']) assert.ok(html.indexOf(s) > objs, `${s} in .gobjs`);
  // No card sizes itself: no inline flex sizing or max-height on any card section.
  for (const [tag] of html.matchAll(/<section class="card[^>]*>/g)) assert.doesNotMatch(tag, /flex:|max-height|min-width/, tag);
  assert.doesNotMatch(html, /max-height/);
  // Every deal row (planted ones included) sits inside a .plist, which scrolls.
  const deals = (html.match(/data-deal="/g) || []).length;
  assert.ok((html.match(/data-deal="qc-/g) || []).length === 50, 'all 50 planted deals rendered');
  const inLists = [...html.matchAll(/<div class="plist">([^\n]*)/g)].reduce((n, m) => n + (m[1].match(/data-deal="/g) || []).length, 0);
  assert.equal(inLists, deals, 'every deal row inside a .plist');
  // d3.css: equal 1fr grid columns that stretch, Pipeline sized by its row, lists scroll, titles on one line.
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]).join(';');
  for (const sel of ['.d3 .gtop', '.d3 .gobjs']) {
    const r = rule(sel);
    assert.match(r, /display:grid/, sel);
    assert.match(r, /align-items:stretch/, sel);
    const cols = [...r.matchAll(/grid-template-columns:([^;}]+)/g)].map((m) => m[1]);
    assert.ok(cols.length && cols.every((c) => /^repeat\(auto-fit,minmax\([^;]+,1fr\)\)$/.test(c.trim())), `${sel} equal 1fr columns: ${cols}`);
  }
  assert.match(rule('.d3 .gpipe'), /contain:size/);
  assert.match(rule('.d3 .plist'), /overflow:auto/);
  for (const sel of ['.d3 .gtop h2', '.d3 .gobjs h2']) assert.match(rule(sel), /white-space:nowrap/, sel);
});

test('Goals: every row shows its age, stale rows are grey, sponsor rows explain their counts', () => {
  const d2 = SAMPLE();
  const sp = d2.d2.goals.find((g) => g.key === 'sponsors');
  const hgp = d2.d2.goals.find((g) => g.key === 'hgp').week[0];
  const coll = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  coll.source = { label: 'Bank deposits through Nov 9', ageLabel: '2 hr ago', stale: false };
  hgp.source = { label: 'Calendar', ageLabel: '29 hr ago', stale: true };
  sp.week[1].behind = ['a', 'b'];
  sp.week[2].facts = [{ label: 'No live video found', value: 20 }];
  const krs = objectivesOf(d2, d3Sample()).flatMap((o) => o.krs);
  const by = (id) => krs.find((k) => k.id === id);
  assert.equal(by('a1').hint, 'this month, through Nov 9 · 2 hr ago');
  assert.notEqual(by('a1').tone, 'n');
  assert.equal(by('b3').hint, 'this week · 29 hr ago, stale');
  assert.equal(by('b3').tone, 'n'); // stale = grey, whatever the status
  assert.match(by('a2').hint, /counted from first video card per sponsor/);
  assert.match(by('a3').hint, /2 more due/);
  assert.match(by('a4').hint, /20 more not counted \(no live video found\)/);
  assert.match(renderGoals(d2, d3Sample(), {}), /29 hr ago, stale/);
});

test('Goals: missing sources read No feed / No data with a grey dot; text is escaped; trends only from real points', () => {
  const d2 = SAMPLE();
  const none = renderGoals(d2, null, {});
  assert.match(none, /Approved, not uploaded<\/span><span class="krv nf">No feed/);
  assert.ok(!none.includes("Today's videos"));
  assert.match(none, /Workouts<\/span><span class="krv nf">No feed/);
  assert.match(none, /Pipeline revenue<\/h2>[\s\S]*To close/); // the deal card needs only /d2
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
  assert.match(renderGoals(d2, d3Sample(), { openKr: 'b4' }), /No trend data yet\./);
  // + Log: on Workouts and Date nights only; disabled once logged today.
  const page = renderGoals(d2, d3Sample(), {});
  assert.match(page, /data-log="workout" disabled>Logged today/);
  assert.match(page, /data-log="date_night">\+ Log/);
  assert.equal((page.match(/data-log=/g) || []).length, 2);
  // Armed (first click): the button reads "Confirm log?"; a logged habit never shows it.
  const armed = renderGoals(d2, d3Sample(), { confirmLog: 'date_night' });
  assert.match(armed, /class="btn sm primary" data-log="date_night">Confirm log\?/);
  assert.doesNotMatch(renderGoals(d2, d3Sample(), { confirmLog: 'workout' }), /Confirm log\?/);
});

test('Shell: "+ Log" first click shows Confirm log? (kept on reload), a fast double-tap and the 4 s revert do not post, a later second click posts once', async () => {
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  const nodes = new Map();
  let onClick = null;
  const node = () => ({ innerHTML: '', textContent: '', hidden: false, dataset: {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, querySelector: () => null, addEventListener(t, f) { if (t === 'click') onClick = f; } });
  const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const posts = [];
  const d2 = SAMPLE();
  const realInterval = globalThis.setInterval; const realTimeout = globalThis.setTimeout; const realNow = Date.now;
  let now = 1_000_000; const timers = [];
  Object.assign(globalThis, {
    document: { documentElement: node(), title: '', visibilityState: 'visible', querySelectorAll: () => [], getElementById: (k) => nodes.get(k) || nodes.set(k, node()).get(k), addEventListener() {} },
    window: { addEventListener() {} }, location: { hash: '#goals', replace() {} }, localStorage: store(), sessionStorage: store(),
    fetch: async (url, o = {}) => {
      if (o.method === 'POST') { posts.push(JSON.parse(o.body)); return new Response('{}'); }
      return new Response(JSON.stringify(String(url).endsWith('/d2') ? d2 : d3Sample()));
    },
  });
  let tick = null;
  globalThis.setInterval = (f) => { tick = f; return 0; };
  const el = { disabled: false, dataset: { log: 'date_night' } };
  const click = async () => { await onClick({ target: { closest: (s) => (s === '[data-log]' ? el : null) } }); await settle(); };
  const main = () => nodes.get('main').innerHTML;
  try {
    await import('../public/d3/js/app.js?tab=log');
    await settle();
    assert.match(main(), /data-log="date_night">\+ Log/);
    globalThis.setTimeout = (f) => { timers.push(f); return timers.length; };
    Date.now = () => now;
    await click();
    assert.equal(posts.length, 0);
    assert.match(main(), /data-log="date_night">Confirm log\?/);
    tick(); await settle(); // the 60 s reload redraws: still armed
    assert.match(main(), /data-log="date_night">Confirm log\?/);
    now += 100; await click(); // double-tap inside 400 ms: no post, still armed
    assert.equal(posts.length, 0);
    assert.match(main(), /Confirm log\?/);
    timers.at(-1)(); // the 4 s revert
    assert.match(main(), /data-log="date_night">\+ Log/);
    await click(); now += 1000; await click(); // arm again, confirm 1 s later
    assert.equal(posts.length, 1);
    assert.equal(posts[0].kind, 'date_night');
    assert.doesNotMatch(main(), /Confirm log\?/);
  } finally { globalThis.setInterval = realInterval; globalThis.setTimeout = realTimeout; Date.now = realNow; }
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
  assert.ok(!('cost' in T)); // no cost source: the field is gone, not shown as No feed
  for (const b of T.bots) assert.equal(b.runsToday, null); // no live feed: Runs today unknown
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

test('Blockers: same-title rows get the owner (and card id when owners match); every card row links to its card', async () => {
  const db = teamDb();
  const t = (id, owner) => ins(db, 'bot_tasks', { id, title: 'Same title', owner, status: 'waiting_on_jon', created_by: 'ana', updated_by: owner, created_at: H(6), updated_at: H(6) });
  t('t_aaaaaaaaaaaaaaaa', 'developer'); t('t_bbbbbbbbbbbbbbbb', 'developer'); t('t_cccccccccccccccc', 'sponsors');
  const B = (await d3Of(db)).d3.blockers;
  const same = B.filter((b) => b.title.startsWith('Same title')).map((b) => b.title).sort();
  assert.equal(new Set(same).size, 3);
  assert.ok(same.some((s) => /^Same title \(Lucy[^)]*, t_aaaaaaaaaaaaaaaa\)$/.test(s)), same.join(' | '));
  assert.ok(same.some((s) => /^Same title \([^,)]+\)$/.test(s)), same.join(' | ')); // the sponsors card: owner only
  const by = Object.fromEntries(B.map((b) => [b.id, b]));
  assert.equal(by['t:t_aaaaaaaaaaaaaaaa'].card, 't_aaaaaaaaaaaaaaaa');
  assert.equal(by['a:a1'].card, null); // approval with no card
  const html = renderBlockers(null, { d3: { blockers: B, rail: {} } }, { openBl: 't:t_aaaaaaaaaaaaaaaa' });
  assert.match(html, /href="\/dashboard\/\?card=t_aaaaaaaaaaaaaaaa"/);
  const team = renderTeam(null, { d3: { team: { bots: [{ slug: 'developer', names: ['Lucy'], role: 'Dev', tone: 'g', card: { id: 't_aaaaaaaaaaaaaaaa', title: 'X', stage: 'Doing' }, counts: {} }], fails: [{ card: 't_bbbbbbbbbbbbbbbb', title: 'Y', who: 'Lucy', kind: 'run', age: '1 hr' }], waiting: { count: 0 }, names: 1, line: null } } }, { openBot: 'developer' });
  assert.match(team, /href="\/dashboard\/\?card=t_aaaaaaaaaaaaaaaa"/);
  assert.match(team, /href="\/dashboard\/\?card=t_bbbbbbbbbbbbbbbb"/);
});

test('Team page: design sections in order, live rows, No feed where nothing reports, no design sample text', async () => {
  const d2 = SAMPLE();
  const d3 = await d3Of(teamDb());
  const html = renderTeam(d2, d3, {});
  const order = ['<h1>Team</h1>', 'Working', 'Waiting on you', 'Failed', 'Tokens', '<h2>Bots</h2>', 'Working on', 'Lucy', '<h2>Video board</h2>', "Limits: Jon's stage budgets."];
  let at = -1;
  for (const s of order) { const i = html.indexOf(s, at + 1); assert.ok(i > at, `${s} after the one before`); at = i; }
  assert.equal((html.match(/class="brow"/g) || []).length, TEAM.bots.length);
  assert.match(html, /Card d1/);
  assert.match(html, /Runs and tokens: No feed/);
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

test('Team cards by bot: every open card (past 400) by owner and status, Others for Jon and retired bots, chips, All view, kanban', async () => {
  const db = teamDb();
  const STATUSES = ['todo', 'doing', 'qc', 'waiting_on_jon', 'review'];
  const owners = ['developer', 'sponsors', 'qc', 'jon', 'moneyclaw'];
  for (let i = 0; i < 450; i++) {
    ins(db, 'bot_tasks', { id: `n${i}`, title: `Bulk ${i}`, owner: owners[i % 5], status: STATUSES[i % 7 % 5], project: i % 2 ? 'coding' : null, stage: i % 3 ? null : 'edit', created_by: 'ana', updated_by: 'ana', created_at: H(i / 10), updated_at: H(i / 10) });
  }
  const T = (await d3Of(db)).d3.team;
  const count = (sql, ...a) => db.sqlite.prepare(sql).get(...a).n;
  const open = count("SELECT COUNT(*) n FROM bot_tasks WHERE status IN ('todo','doing','waiting_on_jon','qc','review')");
  assert.ok(open > 450);
  assert.equal(T.openTotal, open);
  assert.equal(T.cut, false);
  // Counts per bot and column equal D1 (what dash.py tasks --owner --status reads).
  for (const b of T.bots) for (const s of STATUSES) {
    assert.equal(b.cards[s].length, count('SELECT COUNT(*) n FROM bot_tasks WHERE owner = ? AND status = ?', b.slug, s), `${b.slug} ${s}`);
  }
  const listed = [...T.bots, T.others].flatMap((b) => STATUSES.flatMap((s) => b.cards[s].map((c) => c.id)));
  assert.equal(new Set(listed).size, open); // every open card once
  assert.equal(listed.length, open);
  // Others: Jon's and retired bots' cards, without their owner slug.
  const roster = TEAM.bots.map((b) => b.slug);
  assert.equal(STATUSES.reduce((n, s) => n + T.others.cards[s].length, 0), count(`SELECT COUNT(*) n FROM bot_tasks WHERE status IN ('todo','doing','waiting_on_jon','qc','review') AND owner NOT IN (${roster.map(() => '?').join(',')})`, ...roster));
  assert.ok(!JSON.stringify(T).includes('moneyclaw'));
  // Newest change first, with project label, stage and age.
  const dev = T.bots.find((b) => b.slug === 'developer').cards.doing;
  assert.deepEqual(dev.map((c) => c.id), db.sqlite.prepare("SELECT id FROM bot_tasks WHERE owner = 'developer' AND status = 'doing' ORDER BY updated_at DESC").all().map((r) => r.id));
  assert.equal(dev[0].id, 'd1');
  const n0 = T.bots.find((b) => b.slug === 'developer').cards.todo.find((c) => c.id === 'n0');
  assert.deepEqual([n0.project, n0.stage], ['Unsorted', 'Edit']);
  // Render: chips (greyed when empty), All view counts, kanban with card links.
  const d3 = { d3: { team: T } };
  const all = renderTeam(SAMPLE(), d3, {});
  assert.match(all, /<h2>Cards by bot<\/h2>/);
  assert.match(all, /data-tm="all" aria-pressed="true"/);
  assert.match(all, /class="btn tm" data-tm="developer"/);
  assert.match(all, /class="btn tm off" data-tm="ana"/);
  assert.match(all, /data-tm="others"/);
  const devTodo = T.bots.find((b) => b.slug === 'developer').cards.todo.length;
  assert.match(all, new RegExp(`data-tmcol="developer\\|todo"[^>]*>${devTodo}</button>`));
  assert.doesNotMatch(all, /class="tmkan"/);
  const kan = renderTeam(SAMPLE(), d3, { teamBot: 'developer', teamCol: 'review' });
  assert.match(kan, /class="tmkan"/);
  for (const w of ['To do', 'Doing', 'QC', 'Needs you', 'Review']) assert.match(kan, new RegExp(`<b>${w}</b>`));
  assert.match(kan, /class="stage tmon" data-tmk="review"/);
  assert.match(kan, /href="\/dashboard\/\?card=d1#projects"/);
  T.bots.find((b) => b.slug === 'developer').cards.doing[0].title = '<img src=x onerror=alert(1)>';
  const esc1 = renderTeam(SAMPLE(), d3, { teamBot: 'developer' });
  assert.ok(esc1.includes('&lt;img src=x onerror=alert(1)&gt;') && !esc1.includes('<img src=x'));
  assert.equal((kan.match(/class="vcard tmcard"/g) || []).length, STATUSES.reduce((n, s) => n + T.bots.find((b) => b.slug === 'developer').cards[s].length, 0));
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
  assert.doesNotMatch(html, /HeyGen today|Sponsor inbox/); // no source in this feed: row left out, never No feed
  for (const s of ['Atoms', '$5,500', 'Arcads', 'Dale Whitaker', '[', 'Rosa']) assert.ok(!html.includes(s), s);
  // A filter shows only its kind; an open row shows Blocks and Ana (No feed); only review items link to Review.
  const you = renderBlockers(d2, d3, { blFilter: 'you' });
  assert.equal((you.match(/class="blrow/g) || []).length, rows.filter((b) => b.you).length);
  const ap = renderBlockers(d2, d3, { openBl: 'a:a1' });
  assert.match(ap, /Blocks<\/span><span>Florence · Approval to publish draft<\/span>/);
  assert.doesNotMatch(ap, /Ana<\/span><span class="nf">/); // no source for what Ana did: row left out
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
  assert.match(html, new RegExp(`· ${n} roles( · <span class="upd">Updated [^<]+</span>)?</span>`));
  assert.match(html, new RegExp(`of ${n} roles</span>`));
});

test('d3.css: narrow screens stack the Team and Blockers rows, desktop rules unchanged', () => {
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  assert.match(css, /\.d3 \.brow\{display:grid;grid-template-columns:206px minmax\(0,1fr\) 116px 60px 60px 56px 84px;/);
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
  t('v1', 'edit', 'doing', H(9)); // past the 1 h 10 m limit
  t('v2', 'edit', 'doing', H(1));
  t('v3', 'script', 'qc', H(30), { updated_at: H(1) }); // Script QC, timed from the move to QC
  t('v4', 'sponsor review', 'doing', H(2)); // sponsor-video stage: its own column after the design ones, no limit
  t('v5', 'pack', 'done', H(1)); // closed: not on the board
  for (const i of [1, 2, 3, 4]) t(`p${i}`, 'pack', 'doing', H(i));
  const d3 = await d3Of(db);
  const L = d3.d3.team.line;
  const by = Object.fromEntries(L.stages.map((s) => [s.key, s]));
  assert.deepEqual(L.stages.map((s) => s.key), ['brief', 'script', 'script qc', 'a-roll', 'pack', 'edit', 'render qc', 'publish', 'sponsor review']);
  assert.deepEqual([by.edit.n, by.edit.oldest, by.edit.cards.map((c) => [c.id, c.tone])], [2, '9 hr', [['v1', 'r'], ['v2', 'g']]]);
  assert.deepEqual([by['script qc'].n, by['script qc'].cards[0].age, by['script qc'].cards[0].tone], [1, '1 hr', 'r']); // past the 20 m Script QC limit
  assert.equal(by.script.n, 0);
  assert.deepEqual([by.pack.n, by.pack.cards.map((c) => c.id), by.pack.more], [4, ['p4', 'p3', 'p2'], 1]);
  assert.equal(L.late, 5); // v1, v3, p2-p4 (pack 1 h 15 m)
  assert.deepEqual([by['sponsor review'].name, by['sponsor review'].limit, by['sponsor review'].cards[0].tone], ['Sponsor review', '', 'g']);
  assert.equal(L.total, 8);
  const editor = d3.d3.team.bots.find((b) => b.slug === 'video-editor');
  assert.match(editor.card.stage, /^(Edit|Pack|Script|Sponsor review) · /);
  const html = renderTeam(SAMPLE(), d3, {});
  assert.match(html, /<span class="pill bad sp">5 late<\/span>/);
  assert.match(html, /grid-template-columns: repeat\(9, minmax\(0, 1fr\)\)/);
  assert.match(html, /data-stage="edit">[\s\S]*?limit 1 h 10 m · oldest 9 hr[\s\S]*?Video v1[\s\S]*?dot r/);
  assert.match(html, /data-stage="pack">[\s\S]*?\+1 more/);
  assert.doesNotMatch(html, /Video v5/);
});

// ---- Dispatcher live feed (dash_live_feed.py -> dispatch_live) ----
const M = (m) => new Date(TUESDAY - m * 60000).toISOString();
const liveRow = (db, ageMin, d) => ins(db, 'bot_feed_entries', { id: `l${ageMin}`, name: 'dispatch_live', bot: 'developer', created_at: M(ageMin), data: JSON.stringify({ at: M(ageMin), ...d }) });
const usage22h = (db) => ins(db, 'bot_feed_entries', { id: 'u1', name: 'claude_usage', bot: 'ana', data: JSON.stringify({ weekPct: 100, resetsAt: '2026-11-13T00:00:00Z' }), created_at: H(22) });

test('Live feed fresh: dispatcher, bots, tokens, team runs and fails', async () => {
  const db = teamDb();
  usage22h(db);
  liveRow(db, 1, {
    beat: M(1), week: { pct: 42, resets: '2026-11-13T00:00:00Z', at: M(1) },
    running: [{ slot: 1, bot: 'developer', card: 'd1', since: M(15) }, { slot: 2, bot: 'developer', card: 'd2', since: M(5) }],
    tokens: { developer: 1200, sponsors: 300 }, runs: { developer: { ok: 3, failed: 1 } },
    fails: [{ at: H(2), bot: 'developer', card: 'd2', why: 'exit 1', kind: 'run' }],
    heygen: { accepted: 3, refused: 1, failed: 0, last: M(3) },
  });
  const body = await d3Of(db);
  const { d3 } = body;
  assert.deepEqual([d3.rail.dispatcher.state, d3.rail.dispatcher.text], ['g', 'Dispatcher running']);
  assert.deepEqual([d3.rail.bots.state, d3.rail.bots.text], ['g', '2 runs going']);
  assert.deepEqual([d3.rail.tokens.state, d3.rail.tokens.pct, d3.rail.tokens.text], ['g', 42, 'Tokens 42% used']); // feed newer than the 22 h reading
  const dev = d3.team.bots.find((b) => b.slug === 'developer');
  assert.match(dev.running, /^2 · /);
  assert.deepEqual([dev.tokens, dev.failedRunsToday, dev.runsToday], [1200, 1, 4]); // 3 ok + 1 failed
  assert.deepEqual([d3.rail.heygen.state, d3.rail.heygen.text], ['y', '3 accepted · 1 refused']);
  assert.equal(heygenLine({ d: { heygen: { accepted: 2, failed: 1 } } }).state, 'r');
  assert.equal(heygenLine({ d: {} }).text, 'No feed');
  const staleH = heygenLine({ at: '2026-01-01T00:00:00Z', d: { heygen: { accepted: 2 } } }, Date.parse('2026-01-01T03:00:00Z'));
  assert.deepEqual([staleH.state, staleH.stale], ['none', true]);  assert.deepEqual([d3.team.running, d3.team.tokens], [2, 1500]);
  assert.deepEqual(d3.team.fails.map((f) => [f.card, f.title, f.kind]), [['d2', 'Card d2', 'run'], ['stuck', 'Card stuck', 'qc']]); // c4: runs + QC fails today
  // Pages: Team fails list and pill, Blockers Dispatcher card.
  const th = renderTeam(SAMPLE(), body, {});
  assert.match(th, /<span class="pill sp">Runs live · 1 min ago<\/span>/);
  assert.match(th, /data-bot="developer">[\s\S]*?aria-label="Runs today"><span class="sub">4<\/span>/);
  assert.doesNotMatch(th, /Cost/);
  assert.match(th, /<h2>Failed today \(2\)<\/h2>[\s\S]*?Card d2[\s\S]*?run failed · exit 1/);
  assert.equal(d3.team.failedToday, d3.team.fails.length); // tile = list
  assert.ok(d3.team.fails.some((f) => f.kind === 'run')); // c5: failed runs exist, yet the Dispatcher pill reads Running
  assert.match(renderBlockers(SAMPLE(), body, {}), /<h2 style="font-size: 15px">Dispatcher<\/h2><span class="pill ok sp">Running<\/span>/);
  const bh = renderBlockers(SAMPLE(), body, {});
  assert.match(bh, /Heartbeat<\/span><b>Dispatcher running/);
  assert.match(bh, /Bots<\/span><b>2 runs going/);
  assert.match(bh, /dot r"><\/span><span class="ell">Failed runs today<\/span><b>1</);
  assert.doesNotMatch(bh, /Watchdog|GPU2 job/);
  assert.match(bh, /HeyGen today<\/span><b>3 accepted · 1 refused/);
});

test('Live feed stale: Failed tile = Failed list (posted failed runs + QC fails), Stuck stays off', async () => {
  const db = teamDb();
  liveRow(db, 30, { beat: M(30), running: [], tokens: {}, runs: { developer: { ok: 1, failed: 5 } },
    fails: [{ at: M(40), bot: 'developer', card: 'd1', why: 'old feed', kind: 'run' }, { at: M(40), bot: 'developer', card: 'd1', why: 'x', kind: 'stuck' }] });
  ins(db, 'bot_runs', { id: 'rf1', bot: 'developer', started_at: H(1), status: 'failed', task_id: 'd2', error: 'exit 1', created_at: H(1) });
  ins(db, 'bot_runs', { id: 'rf2', bot: 'moneyclaw', started_at: H(1), status: 'failed', created_at: H(1) }); // retired bot: not counted
  ins(db, 'bot_runs', { id: 'rf3', bot: 'developer', started_at: H(30), status: 'failed', created_at: H(30) }); // yesterday
  const body = await d3Of(db);
  const T = body.d3.team;
  assert.equal(T.running, null); // stale feed
  assert.deepEqual(T.fails.map((f) => [f.card, f.title, f.kind, f.why || '']), [['d2', 'Card d2', 'run', 'exit 1'], ['stuck', 'Card stuck', 'qc', '']]);
  assert.equal(T.failedToday, T.fails.length);
  assert.equal(T.stuck, null);
  const th = renderTeam(SAMPLE(), body, {});
  assert.match(th, /<b>Failed<\/b>[\s\S]*?font-size: 30px">2<\/b>/);
  assert.match(th, /<h2>Failed today \(2\)<\/h2>[\s\S]*?Card d2[\s\S]*?run failed · exit 1/);
  assert.doesNotMatch(th, /Stuck today/);
});

test('Goals token weeks: stale Ana check -> No data with reason; dispatcher reading at the limit counts', async () => {
  const oldAna = (db) => ins(db, 'bot_feed_entries', { id: 'u0', name: 'claude_usage', bot: 'ana', data: JSON.stringify({ weekPct: 60, resetsAt: '2026-10-31T00:00:00Z' }), created_at: '2026-10-29T18:00:00Z' });
  const db1 = teamDb();
  oldAna(db1);
  liveRow(db1, 1, { beat: M(1), week: { pct: 78, resets: 'Nov 14', at: M(1) }, running: [], tokens: {}, runs: {}, fails: [] });
  const tw1 = (await d3Of(db1)).d3.goals.tokenWeeks;
  assert.deepEqual([tw1.display, tw1.actual, tw1.source.label, tw1.source.stale], ['No data', null, "Ana's Claude usage check", true]);
  assert.match(tw1.note, /Ana's usage check last posted Oct 29\); past weeks can't be counted/);
  const db2 = teamDb();
  oldAna(db2);
  liveRow(db2, 30, { beat: M(30), week: { pct: 100, resets: 'Nov 14', at: M(30) }, running: [], tokens: {}, runs: {}, fails: [] });
  const tw2 = (await d3Of(db2)).d3.goals.tokenWeeks;
  assert.deepEqual([tw2.display, tw2.actual, tw2.hitDays, tw2.source.label, tw2.source.stale], ['1', 1, ['2026-11-10'], 'Dispatcher weekly limit check', false]);
  assert.match(tw2.note, /weeks of 2026-11-10\. Earlier weeks can't be counted/);
});

test('Live feed stale: dispatcher red, bots and tokens grey, team falls back to posted runs', async () => {
  const db = teamDb();
  usage22h(db);
  liveRow(db, 12, { beat: M(12), week: { pct: 100, at: H(7) }, running: [{ slot: 1, bot: 'developer', card: 'd1', since: M(20) }], tokens: { developer: 9 }, runs: {}, fails: [] });
  const body = await d3Of(db);
  const { d3 } = body;
  assert.equal(d3.rail.dispatcher.state, 'r');
  assert.match(d3.rail.dispatcher.text, /^Dispatcher stopped/);
  assert.deepEqual([d3.rail.bots.state, d3.rail.bots.stale], ['none', true]);
  assert.deepEqual([d3.rail.tokens.state, d3.rail.tokens.pct, d3.rail.tokens.stale], ['none', 100, true]); // 7 h old: grey, pct kept
  assert.equal(d3.team.running, null);
  assert.deepEqual(d3.team.fails.map((f) => [f.card, f.kind]), [['stuck', 'qc']]); // no posted failed runs: QC fails only
  assert.equal(d3.team.failedToday, d3.team.fails.length);
  assert.equal(d3.team.bots.find((b) => b.slug === 'developer').tokens, null);
  assert.equal(blockerRows(SAMPLE(), body).some((b) => b.id === 'tokens'), false); // an old 100% is not a blocker
  assert.match(renderBlockers(SAMPLE(), body, {}), /dot "><\/span><span class="ell">Weekly tokens<\/span><b>100%, 7 hr old</);
});

test('limitLabel: stage budgets in hours and minutes', () => {
  assert.deepEqual([0.25, 0.33, 1.17, 1.25, 2, null].map(limitLabel), ['15 m', '20 m', '1 h 10 m', '1 h 15 m', '2 h', '']);
});

test('Video board: videos only; coding cards in build or deploy are left off, with no Build or Deploy column', async () => {
  const db = teamDb();
  const t = (id, stage, owner) => ins(db, 'bot_tasks', { id, title: `Card ${id}`, owner, project: owner === 'developer' ? 'coding' : 'home-guide-press', status: 'doing', stage, stage_since: H(20), created_by: 'ana', updated_by: 'ana', created_at: H(50), updated_at: H(0.5) });
  t('c1', 'build', 'developer'); // past every limit: would count as late if it were on the board
  t('c2', 'deploy', 'developer');
  t('v1', 'edit', 'video-editor');
  const L = (await d3Of(db)).d3.team.line;
  assert.deepEqual(L.stages.map((s) => s.key), ['brief', 'script', 'script qc', 'a-roll', 'pack', 'edit', 'render qc', 'publish']);
  assert.deepEqual([L.total, L.late], [1, 1]);
  const html = renderTeam(SAMPLE(), (await d3Of(db)), {});
  const board = html.slice(html.indexOf('<h2>Video board</h2>'));
  assert.match(board, /Card v1/);
  assert.doesNotMatch(board, /Card c1|Card c2|data-stage="build"|data-stage="deploy"|>Build<|>Deploy</);
  assert.match(board, /grid-template-columns: repeat\(8, minmax\(0, 1fr\)\)/);
});

// ---- Card 3: Review and Money pages ----
function reviewDb() {
  const db = teamDb();
  ins(db, 'bot_tasks', { id: 'vid', title: 'Tiny house tour - Rosa', owner: 'video-editor', project: 'home-guide-press', status: 'review', note: 'Final cut <b>v2</b>', due: '2026-11-12', created_by: 'ana', updated_by: 'qc', created_at: H(8), updated_at: H(8) });
  ins(db, 'bot_proofs', { id: 'pv', task_id: 'vid', kind: 'render', link: '/dashboard/review/abc', status: 'passed', created_by: 'qc', created_at: H(8) });
  ins(db, 'bot_tasks', { id: 'loc', title: 'Local only', owner: 'developer', status: 'review', created_by: 'ana', updated_by: 'qc', created_at: H(2), updated_at: H(2) });
  ins(db, 'bot_proofs', { id: 'pl', task_id: 'loc', kind: 'file', link: 'D:\\work\\out.txt', status: 'passed', created_by: 'qc', created_at: H(2) });
  // A developer's card whose proof is a YouTube link is a video, never a one-click dev card.
  ins(db, 'bot_tasks', { id: 'dvy', title: 'Promo cut', owner: 'developer', status: 'review', created_by: 'ana', updated_by: 'qc', created_at: H(1), updated_at: H(1) });
  ins(db, 'bot_proofs', { id: 'py', task_id: 'dvy', kind: 'link', link: 'https://youtu.be/abc', status: 'passed', created_by: 'qc', created_at: H(1) });
  ins(db, 'bot_questions', { id: 'q4', asked_by: 'sponsors', question: 'Which rate?', options: JSON.stringify(['$2,500', 'Other (type your own)']), status: 'open', created_at: H(6), updated_at: H(6) });
  return db;
}

test('GET /dashboard/api/d3: Review queue from D1, videos first, dev cards last, oldest first in each, each item with its existing write, no local links', async () => {
  const d3 = (await d3Of(reviewDb())).d3;
  const q = d3.queue;
  assert.deepEqual(q.map((x) => x.group), ['video', 'video', 'video', 'other', 'other', 'other', 'other', 'dev']);
  for (const g of ['video', 'other', 'dev']) {
    const at = q.filter((x) => x.group === g).map((x) => Date.parse(x.at));
    assert.deepEqual(at, [...at].sort((a, b) => a - b), g);
  }
  assert.deepEqual(q.map((x) => x.id), ['t:vid', 't:rev', 't:dvy', 'q:q2', 'q:q4', 'q:q1', 'a:a1', 't:loc']);
  // The video count on top = the Review cards with a video proof (render, review page or video link); dev = the developer's other Review cards.
  assert.deepEqual([d3.review.videos, d3.review.dev], [3, 1]);
  assert.deepEqual([q[2].type, q[2].kind], ['video', 'Video']);
  assert.ok(!q.some((x) => x.id === 'q:q3')); // bot health stays with Ana
  const by = Object.fromEntries(q.map((x) => [x.id, x]));
  assert.deepEqual(by['t:vid'].act, { type: 'card', url: '/dashboard/api/v1/tasks/vid' });
  assert.equal(by['t:vid'].type, 'video');
  assert.equal(by['t:vid'].link, '/dashboard/review/abc');
  assert.equal(by['t:vid'].linkLabel, 'Open the review page');
  assert.equal(by['t:rev'].type, 'video'); // its proof is a render
  assert.equal(by['t:rev'].link, 'https://x/p5');
  assert.deepEqual([by['t:loc'].type, by['t:loc'].kind], ['card', 'Dev card']);
  assert.equal(by['t:loc'].link, ''); // local path dropped
  assert.equal(by['a:a1'].act.url, '/dashboard/api/v1/approvals/a1/decide');
  assert.equal(by['q:q4'].act.url, '/dashboard/api/v1/questions/q4/answer');
  assert.deepEqual(by['q:q4'].act.options, ['$2,500', 'Other (type your own)']);
});

test('Review queue: a local-path proof never hides the card web links or turns it into an empty video', async () => {
  const db = teamDb();
  ins(db, 'bot_tasks', { id: 'lp', title: 'Render with local newest', owner: 'video-editor', status: 'review', created_by: 'ana', updated_by: 'qc', created_at: H(3), updated_at: H(3) });
  ins(db, 'bot_proofs', { id: 'lp1', task_id: 'lp', kind: 'url', link: 'https://homeguidepress.com/page', status: 'passed', created_by: 'qc', created_at: H(3) });
  ins(db, 'bot_proofs', { id: 'lp2', task_id: 'lp', kind: 'render', link: 'D:\work\shot.jpg', status: 'passed', created_by: 'qc', created_at: H(2) });
  ins(db, 'bot_tasks', { id: 'lq', title: 'Local render only', owner: 'video-editor', status: 'review', created_by: 'ana', updated_by: 'qc', created_at: H(3), updated_at: H(3) });
  ins(db, 'bot_proofs', { id: 'lq1', task_id: 'lq', kind: 'render', link: 'D:\work\clip.mp4', status: 'passed', created_by: 'qc', created_at: H(2) });
  ins(db, 'bot_proofs', { id: 'lp3', task_id: 'lp', kind: 'file', link: '/dashboard/f/abc.png', status: 'passed', created_by: 'qc', created_at: H(4) });
  // A video with several web proofs keeps its review page as the main link, the rest listed.
  ins(db, 'bot_tasks', { id: 'lv', title: 'Video many proofs', owner: 'video-editor', status: 'review', created_by: 'ana', updated_by: 'qc', created_at: H(3), updated_at: H(3) });
  ins(db, 'bot_proofs', { id: 'lv1', task_id: 'lv', kind: 'render', link: 'https://jonmac.ai/dashboard/review/vid-1', status: 'passed', created_by: 'qc', created_at: H(3) });
  ins(db, 'bot_proofs', { id: 'lv2', task_id: 'lv', kind: 'url', link: 'https://example.com/newer', status: 'passed', created_by: 'qc', created_at: H(1) });
  const by = Object.fromEntries((await d3Of(db)).d3.queue.map((x) => [x.id, x]));
  assert.deepEqual([by['t:lp'].type, by['t:lp'].link], ['card', 'https://homeguidepress.com/page']);
  assert.ok(by['t:lp'].links.some((l) => l.href === '/dashboard/f/abc.png'), 'extra /dashboard/f/ proof listed');
  assert.deepEqual([by['t:lv'].type, by['t:lv'].link], ['video', 'https://jonmac.ai/dashboard/review/vid-1']);
  assert.deepEqual(by['t:lv'].links.map((l) => l.href), ['https://example.com/newer']);
  assert.equal(by['t:lq'].type, 'card'); // no web link: not a video with an empty player
  assert.equal(by['t:lq'].link, '');
});

test('Review page: videos first, then sponsor drafts, dev cards last with one-click Done, buttons per type, Undo disabled, text escaped, no design sample text', async () => {
  const d2 = SAMPLE();
  const d3 = await d3Of(reviewDb());
  const items = reviewItems(d2, d3);
  assert.deepEqual(items.map((x) => x.id), ['t:vid', 't:rev', 't:dvy', 'd:c-poppy', 'q:q2', 'q:q4', 'q:q1', 'a:a1', 't:loc']);
  assert.equal(items[3].type, 'email');
  assert.equal(items.length, 1 + d3.d3.queue.length);
  const html = renderReview(d2, d3, {});
  assert.match(html, /3 videos for you · One at a time/);
  assert.match(html, /Videos for you \(3\)[\s\S]*Emails, approvals, questions and cards \(5\)[\s\S]*Dev cards \(1\)/);
  // The dev row's pick button shrinks, so a long title can't push Done out; Done is off while a write is running.
  assert.match(html, /class="qrow" style="flex: 1; min-width: 0"[^>]*data-rvq="t:loc"/);
  assert.match(renderReview(d2, d3, { busy: true }), /data-rv="done" data-id="t:loc"[^>]* disabled[^>]*>Done<\/button>/);
  // A closed item kept for this visit stays in its group, so previous / next follow the list.
  const kept = renderReview(d2, { d3: { ...d3.d3, queue: d3.d3.queue.filter((x) => x.id !== 't:vid') } }, { rvSel: 't:vid', rvDone: { 't:vid': 'Approved' }, rvKept: { 't:vid': d3.d3.queue[0] } });
  assert.match(kept, /Videos for you \(3\)/);
  assert.match(kept, /<span class="mut">3 of 9<\/span>/);
  // Only the dev card gets a Done on its row; videos and other cards don't.
  assert.match(html, /data-rv="done" data-id="t:loc"[^>]*>Done<\/button>/);
  assert.equal((html.match(/data-rv="done"/g) || []).length, 1);
  assert.match(renderReview(d2, d3, { rvSel: 't:loc' }), /data-rv="done" data-id="t:loc"[^>]*>Done<\/button><button[^>]*data-rv="open-back" data-id="t:loc"/);
  assert.doesNotMatch(renderReview(d2, d3, { rvSel: 't:rev' }), /data-rv="done" data-id="t:rev"/);
  assert.doesNotMatch(renderReview(d2, d3, { rvDone: { 't:loc': 'Done' } }), /data-rv="done"/);
  assert.match(html, /<h1>Review<\/h1>/);
  assert.match(html, new RegExp(`${items.length} left`));
  assert.match(html, /aria-current="true" data-rvq="t:vid"/); // the oldest video opens first
  const pick = (id, ui = {}) => renderReview(d2, d3, { rvSel: id, ...ui });
  const mail = pick('d:c-poppy');
  assert.match(mail, /Reply to Poppy/);
  assert.match(mail, /data-rv="send"/);
  assert.match(mail, /data-rv="edit"/);
  assert.match(mail, /ann@poppy\.ai/);
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
  // A Decision: its options as buttons in the bot's order, then "Other (type your own)", then one Submit.
  // "Other" opens the typed box; its words are never sent as the answer.
  const q4 = pick('q:q4');
  assert.match(q4, /data-rv="pick" data-id="q:q4" aria-pressed="false" data-opt="\$2,500"[^>]*>\$2,500<\/button><button[^>]*data-rv="other" data-id="q:q4" aria-pressed="false"[^>]*>Other \(type your own\)<\/button><\/div><button[^>]*data-rv="answer" data-id="q:q4"[^>]*>Submit<\/button>/);
  assert.doesNotMatch(q4, /data-opt="Other/);
  assert.doesNotMatch(q4, /class="rvtext"/);
  assert.match(pick('q:q4', { rvPick: { id: 'q:q4', v: '$2,500' } }), /aria-pressed="true" data-opt="\$2,500"/);
  assert.doesNotMatch(pick('q:q4', { rvPick: { id: 'q:q2', v: '$2,500' } }), /aria-pressed="true"/); // a pick made on another item
  assert.match(pick('q:q4', { rvPick: { id: 'q:q4', v: OTHER_PICK }, rvText: 'Mine' }), /data-rv="other"[^>]*aria-pressed="true"[\s\S]*<textarea class="rvtext"[^>]*>Mine<\/textarea><button[^>]*data-rv="answer"[^>]*>Submit/);
  // An old question with no options: the typed box and Submit.
  assert.match(pick('q:q2'), /<textarea class="rvtext"[^>]*placeholder="Type your answer"[\s\S]*data-rv="answer"[^>]*>Submit/);
  assert.doesNotMatch(pick('q:q2'), /data-rv="other"/);
  // The answer row sits right under the question, not pushed to the bottom of a panel as tall as the queue.
  assert.match(q4, /class="card rvdetail"/);
  assert.doesNotMatch(q4, /margin-top: auto/);
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
    for (const [sel, rv, ui0] of [['t:rev', 'approve'], ['t:rev', 'back', { rvBack: 't:rev' }], ['a:a1', 'yes'], ['a:a1', 'no'], ['q:q4', 'answer', { rvPick: { id: 'q:q4', v: '$2,500' } }], ['q:q2', 'answer'], ['d:c-poppy', 'send']]) {
      await run(sel, 'rv', { rv }, ui0 || {});
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
    // Picking an option or Other only marks it; Submit sends the pick, or the typed text after Other.
    ui = await run('q:q4', 'rv', { rv: 'pick', opt: '$2,500' });
    assert.deepEqual(ui.rvPick, { id: 'q:q4', v: '$2,500' });
    assert.equal(calls.length, 0);
    ui = await run('q:q4', 'rv', { rv: 'answer' });
    assert.match(ui.rvErr, /Pick an answer/);
    typed = 'typed without Other';
    await run('q:q4', 'rv', { rv: 'answer' });
    typed = '';
    await run('q:q4', 'rv', { rv: 'answer' }, { rvPick: { id: 'q:q2', v: '$2,500' } }); // a pick made on another item
    await run('q:q4', 'rv', { rv: 'answer' }, { rvPick: { id: 'q:q4', v: 'Not an option' } });
    assert.equal(calls.length, 0);
    ui = await run('q:q4', 'rv', { rv: 'answer' }, { rvPick: { id: 'q:q4', v: '$2,500' } });
    assert.deepEqual(calls.pop(), ['/dashboard/api/v1/questions/q4/answer', 'POST', { answer: '$2,500' }]);
    assert.equal(ui.rvDone['q:q4'], '$2,500');
    assert.equal(ui.rvPick, null);
    assert.notEqual(ui.rvSel, 'q:q4'); // moved on to the next item
    await run('d:c-poppy', 'rv', { rv: 'send' }, { rvEdit: 'd:c-poppy', rvDraft: { body: 'Edited' } });
    const [url, method, body] = calls.pop();
    assert.deepEqual([url, method, body.kind, body.payload.body, body.payload.to], ['/dashboard/api/actions', 'POST', 'sponsor.send_draft', 'Edited', 'ann@poppy.ai']);
    assert.ok(body.idemKey);
    typed = 'My own answer';
    ui = await run('q:q4', 'rv', { rv: 'other' });
    assert.deepEqual(ui.rvPick, { id: 'q:q4', v: OTHER_PICK });
    await run('q:q4', 'rv', { rv: 'answer' }, { rvPick: ui.rvPick });
    assert.deepEqual(calls.pop(), ['/dashboard/api/v1/questions/q4/answer', 'POST', { answer: 'My own answer' }]);
    await run('q:q2', 'rv', { rv: 'answer' }); // no options: the box alone
    assert.deepEqual(calls.pop(), ['/dashboard/api/v1/questions/q2/answer', 'POST', { answer: 'My own answer' }]);
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
    // A dev card closes in one click: no confirm (yes = false still sends), and the open item stays open.
    globalThis.fetch = async (url, o) => { calls.push([url, o.method, JSON.parse(o.body)]); return new Response('{"ok":true}', { status: 200 }); };
    yes = false;
    calls.length = 0;
    ui = await run('t:vid', 'rv', { rv: 'done', id: 't:loc' });
    assert.deepEqual(calls.pop(), ['/dashboard/api/v1/tasks/loc', 'PATCH', { status: 'done' }]);
    assert.deepEqual([ui.rvDone['t:loc'], ui.rvSel], ['Done', 't:vid']);
    // Done in the open dev card's detail moves on to the next item still waiting.
    ui = await run('t:loc', 'rv', { rv: 'done' }, { rvDone: { 't:vid': 'Approved' } });
    assert.deepEqual(calls.pop(), ['/dashboard/api/v1/tasks/loc', 'PATCH', { status: 'done' }]);
    assert.deepEqual([ui.rvDone['t:loc'], ui.rvSel], ['Done', 't:rev']);
    // Busy: nothing sent.
    await run('t:loc', 'rv', { rv: 'done' }, { busy: true });
    assert.equal(calls.length, 0);
    // Done on anything but a dev card sends nothing.
    for (const sel of ['t:rev', 't:vid', 'a:a1', 'q:q4', 'd:c-poppy']) await run(sel, 'rv', { rv: 'done' });
    assert.equal(calls.length, 0);
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

test('Goals: Pipeline revenue replaces Blockers, To review and Tokens; totals are the sum of the deal rows', () => {
  const d2 = SAMPLE();
  const html = renderGoals(d2, d3Sample(), {});
  for (const s of ['>Blockers<', '>To review<', '>Tokens<', 'href="#blockers"', 'href="#review"']) assert.ok(!html.includes(s), s);
  const p = pipelineOf(d2);
  // Fixture: Poppy negotiating $2,500; Invideo owes $2,100 (its money-owed row wins over the $4,200 deal); Arcads in
  // production with no amount; Creatify paid and Topview archived are left out.
  assert.deepEqual(p.close.map((r) => [r.id, r.name, r.amt]), [['c-poppy', 'Poppy', 2500]]);
  assert.deepEqual(p.collect.map((r) => [r.id, r.name, r.amt]), [['c-invideo', 'Invideo', 2100], ['c-arcads', 'Arcads', null]]);
  for (const k of ['close', 'collect']) assert.equal(p.totals[k], p[k].reduce((n, r) => n + (r.amt || 0), 0), k);
  const card = html.slice(html.indexOf('aria-label="Pipeline revenue"'));
  assert.match(card, /To close<\/span><b class="num sp" style="font-size: 26px">\$2,500</);
  assert.match(card, /To collect<\/span><b class="num sp" style="font-size: 26px">\$2,100</);
  assert.match(card, /2 deals · 1 no amount/);
  for (const id of ['c-poppy', 'c-invideo', 'c-arcads']) assert.match(card, new RegExp(`href="#money" data-deal="${id}"`));
  assert.ok(!/Creatify|Topview|\$4,200/.test(card.slice(0, card.indexOf('</section>'))));
  // Every row opens its deal on Money: the same key marks the card there and outlines it.
  const money = renderMoney(d2, d3Sample(), { dealSel: 'c-arcads' });
  assert.match(money, /id="deal-c-arcads" style="gap: 4px; outline: 2px solid #2563eb/);
  assert.match(money, /id="deal-c-poppy" style="gap: 4px">/);
  // Old boards with no card ids: rows key by name, a deal on the owed list is not counted twice.
  const old = SAMPLE();
  const cols = old.d2.pipeline.boards.find((b) => b.goal === 'sponsors').sponsors.board.columns;
  for (const c of cols) for (const k of c.cards || []) delete k.id;
  old.d2.pipeline.boards.find((b) => b.goal === 'sponsors').sponsors.collect.rows[0].payload = {};
  const q = pipelineOf(old);
  assert.deepEqual(q.collect.map((r) => [r.id, r.amt]), [['n:invideo', 2100], ['n:arcads', null]]);
  assert.match(renderMoney(old, null, { dealSel: 'n:invideo' }), /id="deal-n:invideo" style="gap: 4px; outline/);
  // No Sponsors board: the card says No feed, no numbers made up.
  const bare = renderGoals({ d2: { goals: [], period: {} } }, null, {});
  assert.match(bare, /Pipeline revenue<\/h2>[\s\S]*No feed: the Sponsors board could not be read/);
  assert.doesNotMatch(bare, /NaN|undefined/);
  // Names are escaped.
  cols.find((c) => c.title === 'Negotiations').cards[0].name = '<img src=x onerror=alert(1)>';
  assert.ok(!renderGoals(old, null, {}).includes('<img src=x'));
});

test('Pipeline revenue: a repeat sponsor\'s second deal is its own row; an owed row with no live card has no dead link', () => {
  const d2 = SAMPLE();
  const sp = d2.d2.pipeline.boards.find((b) => b.goal === 'sponsors').sponsors;
  sp.board.columns.find((c) => c.title === 'Leads').cards.push({ id: 'c-invideo-2', name: 'Invideo', amt: 3000 });
  sp.collect.rows.push({ sponsor: 'Gone Co', owedUsd: 900, payload: { id: 'c-archived' } });
  const p = pipelineOf(d2);
  assert.deepEqual(p.close.map((r) => [r.id, r.amt]), [['c-invideo-2', 3000], ['c-poppy', 2500]]);
  assert.equal(p.totals.close, 5500);
  assert.deepEqual(p.collect.map((r) => [r.id, r.name, r.amt]), [['c-invideo', 'Invideo', 2100], [null, 'Gone Co', 900], ['c-arcads', 'Arcads', null]]);
  assert.equal(p.totals.collect, 3000);
  const card = renderGoals(d2, null, {});
  assert.match(card, /<div class="hd" style="[^"]*"><span class="ell"[^>]*>Gone Co</);
  assert.doesNotMatch(card, /data-deal="(null|undefined|)"/);
  // An owed row with no id listed before the id row cannot take the id row's card; no card is counted twice.
  sp.collect.rows.unshift({ sponsor: 'Invideo', owedUsd: 500, payload: {} });
  const q = pipelineOf(d2);
  assert.equal(q.collect.find((r) => r.amt === 2100).id, 'c-invideo');
  const ids = [...q.close, ...q.collect].map((r) => r.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
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
  assert.match(html, /<img class="av pic" src="img\/bots\/lucy\.webp" alt="" title="Lucy"[^>]* width="32" height="32"/);
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

// Card 4: Bluesky and System. All text is from the approved designs (no live numbers), so the tests check the
// layout, the clicks' state, escaping and that the data files still match the designs.
import { renderBluesky, TAB_IDS } from '../public/d3/js/bluesky.js';
import { renderSystem, SY_TABS, PROJ } from '../public/d3/js/system.js';
import { ROLES, OBJ } from '../public/d3/js/system-data.js';
import { values } from '../public/d3/js/bluesky-data.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { L, P } from '../public/d3/js/system-data.js';

const DESIGN_DIR = 'D:/AgentTeam/briefs/dashboard3';
const heads = (html) => [...html.matchAll(/<h2[^>]*>([^<]*)</g)].map((m) => m[1]);

test('Bluesky page: every tab draws its design headings, unknown tab falls back to Vision, data escaped', () => {
  const want = { vision: ['Vision', 'Values', 'Strategic business plans'], quarters: ['Next quarter: Q1 2027 (Jan to Mar)'], depts: ['Bluesky per department'], y2026: ['2026 in one line', 'Highlights', 'By department'], call: ['Your call'] };
  assert.deepEqual(TAB_IDS, ['vision', 'okrs', 'quarters', 'depts', 'y2026', 'call']);
  for (const t of TAB_IDS) {
    const html = renderBluesky(SAMPLE(), { bsTab: t });
    assert.match(html, /<h1>Bluesky 2027<\/h1>/);
    assert.match(html, new RegExp(`data-bstab="${t}" aria-pressed="true"`));
    for (const h of want[t] || []) assert.ok(heads(html).includes(h), `${t}: ${h}`);
    assert.ok(heads(html).length, `${t} has sections`);
    assert.doesNotMatch(html, /NaN|undefined|\[object Object\]/);
  }
  assert.equal(renderBluesky(null, { bsTab: 'nope' }), renderBluesky(null, {}));
  const keep = values[0].t;
  values[0].t = '<img src=x onerror=alert(1)>';
  try { assert.match(renderBluesky(null, { bsTab: 'vision' }), /&lt;img src=x/); } finally { values[0].t = keep; }
});

test('System page: tabs, tiles (16 projects, 9 roles), project and kind picks with fallbacks, data escaped', () => {
  assert.deepEqual(SY_TABS.map((t) => t[0]), ['map', 'moves', 'team', 'goals']);
  const want = { map: ['The map'], moves: ['How work moves'], team: ['The team: nine roles', 'Your day'], goals: [...OBJ.map((o) => o.o), 'How goals run'] };
  for (const [t] of SY_TABS) {
    const html = renderSystem(SAMPLE(), { syTab: t });
    assert.match(html, /<h1>System<\/h1>/);
    for (const h of want[t]) assert.ok(heads(html).includes(h), `${t}: ${h}`);
    assert.doesNotMatch(html, /NaN|undefined|\[object Object\]/);
  }
  assert.equal(PROJ.length, 16);
  assert.equal(ROLES.length, 9);
  const map = renderSystem(null, {});
  assert.match(map, /<b>Projects<\/b><b class="num sp"[^>]*>16</);
  assert.match(map, /<b>Roles<\/b><b class="num sp"[^>]*>9</);
  // Default pick is the first project, Sponsors, on its cards.
  assert.match(map, /<h2 style="font-size: 22px">Sponsors<\/h2>/);
  assert.match(map, /class="sproj" aria-pressed="true" data-sysel="sponsors"/);
  // A kind the project has none of falls back to its first kind with parts; an unknown project falls back to the first.
  const sp = PROJ.find((p) => p.id === 'sponsors');
  const none = ['card', 'sop', 'routine', 'script', 'event'].find((c) => !sp.byCat[c]);
  if (none) assert.match(renderSystem(null, { sySel: 'sponsors', syCat: none }), /aria-pressed="true" data-sysel="sponsors" data-sycat="card"/);
  assert.equal(renderSystem(null, { sySel: 'nope' }), renderSystem(null, { sySel: 'sponsors' }));
  const hgp = renderSystem(null, { sySel: 'hgp', syCat: 'script' });
  assert.match(hgp, new RegExp(`<h2 style="font-size: 22px">${PROJ.find((p) => p.id === 'hgp').name}</h2>`));
  assert.match(hgp, /class="schip +sel"[^>]*data-sysel="hgp" data-sycat="script"/);
  const keep = PROJ[0].name;
  PROJ[0].name = '<script>x</script>';
  try { const h = renderSystem(null, {}); assert.doesNotMatch(h, /<script>x/); assert.match(h, /&lt;script&gt;x/); } finally { PROJ[0].name = keep; }
  // Every part a project names exists (a typo is skipped at load, so catch it here).
  for (const p of P) for (const id of p.parts) assert.ok(L[id], `${p.id}: no part ${id}`);
});

const lf = (s) => s.replace(/\r\n/g, '\n'); // core.autocrlf checkouts have \r\n

test('Bluesky and System text files are still the approved designs, unchanged', { skip: !existsSync(DESIGN_DIR) && 'design files not on this machine' }, () => {
  const out = mkdtempSync(join(tmpdir(), 'd3text-'));
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/d3-text-from-design.mjs', import.meta.url)), DESIGN_DIR, out]);
    for (const f of ['bluesky-data.js', 'system-data.js']) {
      assert.equal(lf(readFileSync(join(out, f), 'utf8')), lf(readFileSync(new URL(`../public/d3/js/${f}`, import.meta.url), 'utf8')), f);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('design text compare ignores CRLF line endings but still catches a real change', () => {
  const text = lf(readFileSync(new URL('../public/d3/js/system-data.js', import.meta.url), 'utf8'));
  const crlf = text.replace(/\n/g, '\r\n');
  assert.notEqual(crlf, text);
  assert.equal(lf(crlf), lf(text));
  assert.notEqual(lf(crlf.replace(/[A-Za-z]/, '#')), lf(text));
});

test('d3.css: Bluesky and System rules from the designs, narrow rules below the 1024 layout', () => {
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  for (const sel of ['.srow', '.flow', '.smap', '.schip']) assert.ok(css.includes(sel), sel);
  const media = [...css.matchAll(/@media \(max-width:(\d+)px\)\{([\s\S]*?)\n\}/g)].map((m) => [Number(m[1]), m[2]]);
  assert.ok(media.every(([w]) => w < 1024));
  assert.match(media.map(([, b]) => b).join('\n'), /srow/);
  // The map stacks for every width below the 1024 layout (the rail sits beside it from 808px).
  assert.ok(media.some(([w, b]) => w >= 983 && /\.d3 \.smap,\.d3 \.sbranch\{flex-direction:column/.test(b)), 'map stacks below 1024');
});

test('Key results: named rows (name, actual / target, bar, status) worst first, no coloured tiles', async () => {
  const { keyRows, KR_OPEN } = await import('../public/d3/js/goals.js');
  const d2 = SAMPLE();
  const html = renderGoals(d2, d3Sample(), {});
  const card = html.slice(html.indexOf('aria-label="Key results"'), html.indexOf('aria-label="Sponsor Revenue"'));
  assert.doesNotMatch(card, /class="sq/);
  const objs = objectivesOf(d2, d3Sample());
  const all = objs.flatMap((o) => o.krs);
  const rows = keyRows(objs);
  assert.equal(rows.length, all.length);
  const e = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Every result shows once, with its name, its status word and a bar only when it has a target.
  for (const k of all) {
    const m = card.match(new RegExp(`<div class="ksr"[^>]*data-kr-row="${k.id}"[^>]*>([\\s\\S]*?)</div>`));
    assert.ok(m, k.id);
    assert.ok(m[1].includes(e(k.text)), k.id);
    // One line: no grey objective subtitle or stacked block inside a row; order is dot, name, bar, value, status.
    assert.doesNotMatch(m[1], /class="mut ell"|class="[^"]*\bstack\b/, k.id);
    assert.match(m[1], /^<span class="ksn"><span class="dot[^"]*"><\/span><span class="ell">[^<]*<\/span>(<span class="ksh">[^<]*<\/span>)?<\/span><span class="bar[^"]*"[^>]*>(<i [^>]*><\/i>)?<\/span><span class="ksv[^"]*">[\s\S]*<\/span><span class="kss [rygn]">[^<]*<\/span>$/, k.id);
    if (k.hasBar) assert.match(m[1], /class="bar"[^>]*><i class="[rygn]" style="width: [\d.]+%"/, k.id);
    else assert.match(m[1], /class="bar nb"[^>]*><\/span>/, k.id);
    assert.match(m[1], /class="kss [rygn]">(Off track|At risk|On track|No data|No feed)</);
    // Same numbers as the row in the sections below, escaped exactly as rendered.
    if (!k.nf) assert.ok(m[1].includes(e(k.v1)) && (!k.v2 || m[1].includes(`<span class="dim">${e(k.v2)}</span>`)), k.id);
  }
  // Rendered order is the worst-first order: the worst KR_OPEN rows open, the rest inside one collapsed <details>.
  const ids = (s) => [...s.matchAll(/data-kr-row="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(ids(card), rows.map((k) => k.id));
  assert.equal(KR_OPEN, 9);
  assert.ok(rows.length > KR_OPEN, 'sample has more results than the open list, so the toggle is tested');
  const det = card.includes('<details') ? card.slice(card.indexOf('<details'), card.indexOf('</details>')) : '';
  assert.match(det, new RegExp(`^<details class="ksm"><summary class="mut">\\+${rows.length - KR_OPEN} more</summary>`), 'collapsed, says how many');
  assert.deepEqual(ids(det), rows.slice(KR_OPEN).map((k) => k.id));
  assert.deepEqual(ids(card.replace(det, '')), rows.slice(0, KR_OPEN).map((k) => k.id));
  // Planted fault: a name with quotes and markup is escaped in the hover title and in the row.
  const bad = SAMPLE();
  bad.d2.goals.find((g) => g.key === 'jonmac').title = '"><img onerror=x>';
  const badCard = renderGoals(bad, d3Sample(), {});
  assert.doesNotMatch(badCard, /<img onerror/);
  assert.match(badCard, /<div class="ksr" title="&quot;&gt;&lt;img onerror=x&gt; · Content Factory" data-kr-row="b1">/);
  // Worst first: status order, then lowest share of target first.
  const rank = { r: 0, y: 1, g: 2, n: 3 };
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    assert.ok(rank[a.tone] <= rank[b.tone], `${a.id} before ${b.id}`);
    if (a.tone === b.tone && a.hasBar && b.hasBar) assert.ok(a.pct <= b.pct, `${a.id} ${a.pct} before ${b.id} ${b.pct}`);
  }
  // Planted fault: an off-track row placed last in its objective still comes out on top.
  const planted = [{ title: 'X', krs: [{ id: 'z1', text: 'Fine', tone: 'g', hasBar: true, pct: 90 }, { id: 'z2', text: 'Bad', tone: 'r', hasBar: true, pct: 10 }, { id: 'z3', text: 'Worse', tone: 'r', hasBar: true, pct: 5 }] }];
  assert.deepEqual(keyRows(planted).map((k) => k.id), ['z3', 'z2', 'z1']);
});

// ---- Sponsor email draft: the Gmail thread above it (t_d5b72a1d03024731) ----
const MAIL = { id: 'c-viktor', threadId: '1a100fca30a15755', payload: { id: 'c-viktor', to: 'v@x.com', subject: 'Re: Campaign', body: 'Thanks, my rate is $2,000.' } };
const threadItem = (over = {}) => ({ id: 'd:c-viktor', type: 'email', kind: 'Sponsor email', name: 'Viktor', head: 'Reply to Viktor', sub: '', facts: [], body: MAIL.payload.body, threadId: MAIL.threadId, act: { type: 'email', payload: MAIL.payload }, ...over });
const THREAD3 = { at: '2026-11-11T20:00:00Z', threads: { [MAIL.threadId]: { subject: 'Campaign', messages: [
  { id: 'm1', from: 'Viktor <v@x.com>', date: '2026-10-01T17:00:00Z', body: 'FIRST message body', quoted: false },
  { id: 'm2', from: 'Jon <partners@x.com>', date: '2026-10-02T17:00:00Z', body: 'SECOND message body', quoted: true },
  { id: 'm3', from: 'Viktor <v@x.com>', date: '2026-10-03T17:00:00Z', body: 'THIRD message body', quoted: false },
] } } };
const renderThread = (ui, item = threadItem()) => renderReview({ pages: {} }, { d3: { queue: [item] } }, { rvSel: item.id, ...ui });
const openStates = (html) => (html.match(/<details class="rvmsg"[^>]*>/g) || []).map((d) => d.includes(' open'));

test('Review: a 3-message thread renders all 3 oldest first above the draft, older folded, Vancouver dates', () => {
  const html = renderThread({ rvThreads: THREAD3 });
  const at = (s) => html.indexOf(s);
  assert.ok(at('FIRST message body') > -1 && at('FIRST message body') < at('SECOND message body') && at('SECOND message body') < at('THIRD message body'));
  assert.ok(at('THIRD message body') < at('Your reply (draft, not sent)'));
  assert.ok(at('Your reply (draft, not sent)') < at('my rate is $2,000'));
  assert.match(html, /3 messages, oldest first/);
  assert.deepEqual(openStates(html), [false, true, true]); // newest two open
  assert.match(html, /\(earlier quoted text hidden\)/);
  assert.match(html, /Oct 1, 2026/);
  assert.match(html, /10:00 AM/); // 17:00Z is 10:00 in Kelowna (PDT)
  // Jon's click choice (ui.rvOpen) wins over the default.
  const toggled = renderThread({ rvThreads: THREAD3, rvOpen: { [`${MAIL.threadId}:m1`]: true, [`${MAIL.threadId}:m3`]: false } });
  assert.deepEqual(openStates(toggled), [true, true, false]);
});

test('Review: thread states (loading, error, no thread id, thread missing), escaping, and edit mode keeps the thread', () => {
  assert.match(renderThread({}), /Loading the thread/);
  assert.match(renderThread({ rvThreads: { error: 'offline' } }), /Could not load the thread \(offline\)/);
  assert.match(renderThread({ rvThreads: THREAD3 }, threadItem({ threadId: '' })), /No thread found/);
  assert.match(renderThread({ rvThreads: { threads: {} } }), /No thread found/);
  assert.match(renderThread({ rvThreads: { threads: { [MAIL.threadId]: { error: 'Google 500' } } } }), /Could not load the thread/);
  // A new message arriving keeps the others' fold state (keys are message ids).
  const grown = { threads: { [MAIL.threadId]: { messages: [...THREAD3.threads[MAIL.threadId].messages, { id: 'm4', from: 'V', date: '2026-10-04T17:00:00Z', body: 'FOURTH', quoted: false }] } } };
  assert.deepEqual(openStates(renderThread({ rvThreads: grown, rvOpen: { [`${MAIL.threadId}:m1`]: true } })), [true, false, false, true].map((x, i) => (i === 2 ? true : x)).slice(0, 4));
  const evil = { threads: { [MAIL.threadId]: { messages: [{ from: '<img src=x>', date: 'bad', body: '<script>alert(1)</script>', quoted: false }] } } };
  const h = renderThread({ rvThreads: evil });
  assert.doesNotMatch(h, /<script>alert|<img src=x>/);
  assert.match(h, /1 message, oldest/);
  const edit = renderThread({ rvThreads: THREAD3, rvEdit: 'd:c-viktor', rvDraft: {} });
  assert.match(edit, /THIRD message body[\s\S]*Your reply \(draft, not sent\)[\s\S]*<textarea class="rvin" name="body"/);
});

test('CSS: the thread scroll box is dropped on narrow screens', () => {
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  assert.match(css, /\.rvthread\{max-height:55vh;overflow-y:auto\}/);
  assert.match(css, /@media \(max-width:600px\)\{\.d3 \.rvthread\{max-height:none/);
});

test('Review: clicking a message summary toggles it in ui.rvOpen and redraws', async () => {
  const S = { ui: { rvThreads: THREAD3 }, d2: { pages: {} }, d3: { d3: { queue: [threadItem()] } } };
  let renders = 0; let prevented = false;
  const summary = { dataset: { rvmsg: `${MAIL.threadId}:m1` }, parentElement: { open: false } };
  const e = { preventDefault() { prevented = true; }, target: { closest: (sel) => (sel === '[data-rvmsg]' ? summary : null) } };
  assert.equal(await reviewClick(e, S, () => { renders++; }, async () => {}), true);
  assert.deepEqual([prevented, renders, S.ui.rvOpen], [true, 1, { [`${MAIL.threadId}:m1`]: true }]);
});

const draftCard = (id, threadId, over = {}) => ({ id, threadId, stage: 'needs-reply', draftReply: { status: 'needs-review', body: 'Hello', to: 'a@b.c' }, ...over });
const post = (env, tok, source, data) => handleApi(new Request('https://jonmac.ai/dashboard/api/ingest', { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ source, collectedAt: '2026-11-11T20:00:00Z', data }) }), env);

test('API: GET /dashboard/api/sponsor-threads needs a session and returns the stored threads; the page poll leaves them out', async () => {
  const db = sqliteD1();
  const env = { DB: db, SESSION_SECRET: SECRET, MACHINE_TOKEN_GPU1: 'gpu1-tok' };
  const url = 'https://jonmac.ai/dashboard/api/sponsor-threads';
  assert.equal((await handleApi(new Request(url), env)).status, 401);
  const cookie = { headers: { Cookie: await cookieAt(Date.now()) } };
  assert.deepEqual(await (await handleApi(new Request(url, cookie), env)).json(), { ok: true, at: null, threads: {} });
  assert.equal((await post(env, 'gpu1-tok', 'sponsor_threads', THREAD3)).status, 200);
  const got = await (await handleApi(new Request(url, cookie), env)).json();
  assert.equal(got.at, '2026-11-11T20:00:00Z');
  assert.equal(got.threads[MAIL.threadId].messages.length, 3);
  const { listSnapshots } = await import('../src/db.js');
  assert.ok(!(await listSnapshots(db)).some((r) => r.source === 'sponsor_threads'));
});

test('API: /sponsor-threads/wanted is gpu1 only and lists draft threads (no archived, no draftless, no bad ids, no repeats)', async () => {
  const db = sqliteD1();
  const env = { DB: db, SESSION_SECRET: SECRET, MACHINE_TOKEN_GPU1: 'gpu1-tok', MACHINE_TOKEN_MAC: 'mac-tok' };
  const cards = [draftCard('a', '1a100fca30a15755'), draftCard('b', '1a100fca30a15755'), draftCard('c', '2b200fca30a15755', { stage: 'archived' }),
    draftCard('d', '3c300fca30a15755', { draftReply: { status: 'sent', body: 'x' } }), draftCard('e', 'zz;drop'), draftCard('f', '4d400fca30a15755')];
  await post(env, 'mac-tok', 'sponsors', { cards });
  const ask = (tok) => handleApi(new Request('https://jonmac.ai/dashboard/api/sponsor-threads/wanted', { headers: tok ? { Authorization: `Bearer ${tok}` } : {} }), env);
  assert.equal((await ask(null)).status, 401);
  assert.equal((await ask('mac-tok')).status, 401);
  assert.equal((await ask('nope')).status, 401);
  assert.deepEqual(await (await ask('gpu1-tok')).json(), { ok: true, threads: ['1a100fca30a15755', '4d400fca30a15755'] });
});

test('API: ingest of sponsor_threads is refused from mac and gpu2, allowed from gpu1', async () => {
  const env = { DB: sqliteD1(), SESSION_SECRET: SECRET, MACHINE_TOKEN_GPU1: 'gpu1-tok', MACHINE_TOKEN_MAC: 'mac-tok', MACHINE_TOKEN_GPU2: 'gpu2-tok' };
  const codes = [];
  for (const tok of ['mac-tok', 'gpu2-tok', 'gpu1-tok']) codes.push((await post(env, tok, 'sponsor_threads', THREAD3)).status);
  assert.deepEqual(codes, [401, 401, 200]);
});

test('System page Sources: real feeds and snapshots only, stale first, live feed stale after 10 minutes', async () => {
  const db = teamDb();
  ins(db, 'bot_feed_entries', { id: 'sa', name: 'claude_usage', bot: 'ana', data: '{}', created_at: H(30) });
  ins(db, 'bot_feed_entries', { id: 'sb', name: 'dispatch_live', bot: 'developer', data: '{}', created_at: M(20) });
  ins(db, 'bot_feed_entries', { id: 'sc', name: 'ebook_sales', bot: 'accounting', data: '{}', created_at: H(1) });
  const body = await d3Of(db);
  const S = body.d3.sources;
  assert.deepEqual(S.map((s) => [s.name, s.stale]), [['claude_usage', true], ['dispatch_live', true], ['ebook_sales', false]]);
  assert.equal(S[2].ageLabel, 'updated 1 hr ago');
  assert.ok(!S.some((s) => s.name === 'morning_summary')); // nothing posted: no row, no invented one
  const html = renderSources(SAMPLE(), body);
  assert.match(html, /2 stale/);
  assert.match(html, /data-source="ebook_sales"/);
  assert.match(renderSources(SAMPLE(), { d3: { sources: null } }), /No feed/);
  assert.match(renderSources(SAMPLE(), { d3: { sources: [] } }), /Nothing has reported yet/);
});
