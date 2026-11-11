// Dashboard 3 (docs/dashboard-3.md): /dash serving, GET /dashboard/api/d3, the Goals, Team and Blockers mapping and the shell's sign-in handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import worker from '../src/worker.js';
import { signSession, COOKIE } from '../src/auth.js';
import { renderGoals, objectivesOf } from '../public/d3/js/goals.js';
import { statHtml, railCounts } from '../public/d3/js/rail.js';
import { renderTeam } from '../public/d3/js/team.js';
import { blockerRows, renderBlockers } from '../public/d3/js/blockers.js';

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
  assert.match(html, /Late: No feed/);
  assert.equal((html.match(/<span class="nf" style="font-size: 12px">No feed<\/span>/g) || []).length, 8); // each stage of the video board
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
  assert.match(ap, /<a class="btn pri" href="#review">Open in Review<\/a>/);
  assert.doesNotMatch(renderBlockers(d2, d3, { openBl: 't:stuck' }), /Open in Review/);
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
