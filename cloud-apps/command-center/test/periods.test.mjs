import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { weekStart, monthKey } from '../src/periods.js';
import { row, group, weekly, mountWeekly, mountMonthly, monthly, weekBlock, carryCard, reportBlocks } from '../public/js/pages/periods.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const BOTS = ['ana', 'moneyclaw', 'developer', 'sponsors'];
const TOK = Object.fromEntries(BOTS.map((b) => [b, `ccb_${b.padEnd(43, 'x')}`]));

async function setup() {
  const db = sqliteD1();
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
async function call(env, method, path, { bot, body, jon } = {}) {
  const h = new Headers();
  if (bot) h.set('Authorization', `Bearer ${TOK[bot]}`);
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}

const THIS_WEEK = weekStart(Date.now());
const SNAP = { weekStart: THIS_WEEK, weekEnd: '2099-01-01', groups: [{ title: 'Home Guide Press', rows: [{ label: 'Peter Collins', target: 3, done: 2, note: '1 scheduled this week' }] }, { title: 'Sponsor videos', empty: 'None open.', rows: [] }] };

test('week and month keys use the Vancouver calendar, Monday first', () => {
  const noon = (d) => Date.parse(`${d}T20:00:00Z`); // 1 pm Vancouver, clear of any midnight edge
  assert.equal(weekStart(noon('2026-11-05')), '2026-11-02', 'Thursday -> that Monday');
  assert.equal(weekStart(noon('2026-11-02')), '2026-11-02', 'Monday -> itself');
  assert.equal(weekStart(noon('2026-11-08')), '2026-11-02', 'Sunday -> the Monday before');
  assert.equal(weekStart(noon('2026-11-09')), '2026-11-09');
  assert.equal(monthKey(noon('2026-11-30')), '2026-11');
  assert.equal(monthKey(noon('2026-12-01')), '2026-12');
});

test('periods: only the script writers post, one row is overwritten, the 60 s snapshot never carries it', async () => {
  const { db, env } = await setup();
  assert.equal((await call(env, 'GET', '/v1/periods', { jon: true })).body.weekly, null);
  assert.equal((await call(env, 'PUT', '/v1/periods', { bot: 'sponsors', body: SNAP })).status, 403);
  assert.equal((await call(env, 'PUT', '/v1/periods', { jon: true, body: SNAP })).status, 403, 'Jon reads and ticks, a script writes');
  assert.equal((await call(env, 'PUT', '/v1/periods', { bot: 'moneyclaw', body: { ...SNAP, weekStart: 'monday' } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/periods', { bot: 'moneyclaw', body: { ...SNAP, groups: 'x' } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/periods', { bot: 'moneyclaw', body: { ...SNAP, groups: [null] } })).status, 400, 'a null group would break the page');
  assert.equal((await call(env, 'PUT', '/v1/periods', { bot: 'moneyclaw', body: { ...SNAP, groups: [{ title: 't', rows: [{ label: 'x', target: 'a', done: 1 }] }] } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/periods', { bot: 'moneyclaw', body: SNAP })).status, 200);
  assert.equal((await call(env, 'PUT', '/v1/periods', { bot: 'moneyclaw', body: { ...SNAP, groups: [] } })).status, 200);
  const got = (await call(env, 'GET', '/v1/periods', { jon: true })).body;
  assert.deepEqual(got.weekly.groups, []);
  assert.equal(got.week, THIS_WEEK);
  assert.ok(Date.parse(got.asOf));
  assert.deepEqual(got.weekHabits.map((h) => h.key), ['recording', 'webinar', 'expenses']);
  assert.deepEqual(got.monthHabits.map((h) => h.key), ['networth', 'close', 'budget', 'gst']);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE source = 'periods'").first()).n, 1);
  const snap = await call(env, 'GET', '/snapshot', { jon: true });
  assert.equal(snap.body.sources.periods, undefined);
  const ids = snap.body.nav.groups.flatMap((g) => g.items.map((i) => i.id));
  assert.deepEqual(ids.slice(0, 3), ['today', 'weekly', 'monthly']);
  assert.equal((await call(env, 'GET', '/v1/periods')).status, 401);
});

test('periods: only Jon ticks a habit, it saves, unticks, and is scoped to this week and month', async () => {
  const { db, env } = await setup();
  const tick = (body, who = { jon: true }) => call(env, 'POST', '/v1/periods/tick', { ...who, body });
  assert.equal((await tick({ scope: 'week', key: 'recording', done: true }, { bot: 'ana' })).status, 403, 'a bot cannot tick for Jon');
  assert.equal((await tick({ scope: 'week', key: 'nope', done: true })).status, 400);
  assert.equal((await tick({ scope: 'year', key: 'recording', done: true })).status, 400);
  assert.equal((await tick({ scope: 'week', key: 'recording', done: 'yes' })).status, 400);
  assert.equal((await tick({ scope: 'week', key: 'recording', done: true })).status, 200);
  assert.equal((await tick({ scope: 'month', key: 'close', done: true })).status, 200);
  let got = (await call(env, 'GET', '/v1/periods', { jon: true })).body;
  assert.deepEqual(got.weekHabits.filter((h) => h.done).map((h) => h.key), ['recording']);
  assert.deepEqual(got.monthHabits.filter((h) => h.done).map((h) => h.key), ['close']);
  // ticks from an old week never leak into this week
  await db.prepare("INSERT INTO habits (day, kind, done, note) VALUES ('2020-01-06', 'wk:webinar', 1, '')").run();
  await db.prepare("INSERT INTO habits (day, kind, done, note) VALUES (?, 'wk:expenses', 1, '')").bind('2020-01-06').run();
  got = (await call(env, 'GET', '/v1/periods', { jon: true })).body;
  assert.deepEqual(got.weekHabits.filter((h) => h.done).map((h) => h.key), ['recording']);
  assert.equal((await tick({ scope: 'week', key: 'recording', done: false })).status, 200);
  got = (await call(env, 'GET', '/v1/periods', { jon: true })).body;
  assert.equal(got.weekHabits.filter((h) => h.done).length, 0);
});

test('weekly page: rows show target, done and due; an empty group says why', () => {
  assert.match(row({ label: 'Peter Collins', target: 3, done: 2, note: '1 scheduled this week' }), /2 of 3[\s\S]*aria-valuenow="67"[\s\S]*1 scheduled this week/);
  assert.match(row({ label: 'Topview video 3', target: 1, done: 0, due: '2026-11-12', note: 'In production' }), /In production · Due Thu, Nov 12/);
  assert.match(row({ label: 'x', target: 0, done: 0 }), /none due/);
  assert.match(group({ title: 'Sponsor videos', rows: [], empty: 'None open.' }), /Sponsor videos[\s\S]*None open\./);
  assert.match(group({ title: '<b>x</b>', rows: [] }), /&lt;b&gt;x&lt;\/b&gt;/, 'titles are escaped');
  assert.match(weekly(), /pdgroups/);
});

function fakeEl() {
  const boxes = { '.fystatus': { innerHTML: '' }, '.pdweek': { textContent: '' }, '.pdgroups': { innerHTML: '' }, '.pdcarry': { innerHTML: '' }, '.pdreport': { innerHTML: '' }, '.pdhab': { innerHTML: '' } };
  let alive = true; let onChange = null;
  return { boxes, stop: () => { alive = false; }, change: (e) => onChange(e), get isConnected() { return alive; }, addEventListener: (_t, fn) => { onChange = fn; }, querySelector: (s) => boxes[s] };
}
const PERIODS = (over = {}) => ({ ok: true, week: THIS_WEEK, month: '2026-11', weekly: SNAP, asOf: new Date().toISOString(), weekHabits: [{ key: 'recording', label: 'Monday recording', done: true }], monthHabits: [], ...over });

test('weekly page: first load paints the groups and habits, a stale or last-week row says so', async () => {
  const el = fakeEl();
  let body = PERIODS();
  globalThis.fetch = async () => ({ ok: true, json: async () => body });
  mountWeekly(el);
  await new Promise((r) => setTimeout(r, 50));
  assert.match(el.boxes['.pdgroups'].innerHTML, /Peter Collins[\s\S]*2 of 3[\s\S]*None open\./);
  assert.match(el.boxes['.pdhab'].innerHTML, /Monday recording/);
  assert.match(el.boxes['.pdhab'].innerHTML, /checked/);
  assert.match(el.boxes['.fystatus'].innerHTML, /Live/);
  body = PERIODS({ asOf: new Date(Date.now() - 20 * 60000).toISOString() });
  mountWeekly(el); await new Promise((r) => setTimeout(r, 50));
  assert.match(el.boxes['.fystatus'].innerHTML, /Stale/);
  body = PERIODS({ weekly: { ...SNAP, weekStart: '2020-01-06' } });
  mountWeekly(el); await new Promise((r) => setTimeout(r, 50));
  assert.match(el.boxes['.fystatus'].innerHTML, /last week/);
  assert.match(el.boxes['.pdgroups'].innerHTML, /No counts for this week yet/);
  el.stop();
});

test('weekly page: a tick posts at once; if the save fails the box goes back and says so', async () => {
  const el = fakeEl();
  const said = []; let ok = true; const posts = [];
  globalThis.fetch = async (url, opt) => {
    if (opt?.method === 'POST') { posts.push(JSON.parse(opt.body)); return { ok }; }
    return { ok: true, json: async () => PERIODS() };
  };
  mountWeekly(el, { say: (m) => said.push(m) });
  await new Promise((r) => setTimeout(r, 50));
  const box = { checked: true, disabled: false, dataset: { hscope: 'week', hkey: 'webinar' } };
  await el.change({ target: { closest: () => box } });
  assert.deepEqual(posts[0], { scope: 'week', key: 'webinar', done: true });
  assert.equal(box.checked, true);
  assert.equal(said.at(-1), 'Ticked');
  ok = false;
  await el.change({ target: { closest: () => box } });
  assert.equal(box.checked, false, 'a failed save puts the box back');
  assert.equal(said.at(-1), 'Could not save that tick');
  el.stop();
});

// ---- Week-by-week report and carry-over (Monthly and Weekly) ----
const REPORT = {
  weeks: [
    { weekStart: THIS_WEEK, weekEnd: THIS_WEEK, current: true, planned: 3, done: 1, rows: [{ project: 'coding', label: 'Coding', planned: 3, done: 1 }] },
    { weekStart: '2026-10-26', weekEnd: '2026-11-01', current: false, planned: 0, done: 0, rows: [] },
  ],
  carry: [
    { title: 'Fix <b>upload</b>', project: 'coding', label: 'Coding', owner: 'historient', stage: 'In production', slipped: 3 },
    { title: 'Sponsor script', project: 'sponsors', label: 'Sponsors', owner: 'sponsors', stage: 'Not started', slipped: 1 },
  ],
  carryTotal: 5,
};

test('weekBlock shows planned vs done per project and says when nothing was planned', () => {
  const html = weekBlock(REPORT.weeks[0]);
  assert.match(html, /1 of 3 done/);
  assert.match(html, /\(this week\)/);
  assert.match(html, /Coding/);
  assert.match(weekBlock(REPORT.weeks[1]), /Nothing was planned/);
  assert.doesNotMatch(weekBlock(REPORT.weeks[1]), /this week/);
});

test('carryCard shows weeks slipped, red from 2 weeks, escapes titles and says when the list is cut', () => {
  const html = carryCard(REPORT);
  assert.match(html, /3 weeks slipped/);
  assert.match(html, /1 week slipped/);
  assert.match(html, /pill crit">3 weeks slipped/);
  assert.match(html, /pill risk">1 week slipped/);
  assert.doesNotMatch(html, /<b>upload<\/b>/);
  assert.match(html, /5, showing 2/);
  assert.match(carryCard({ carry: [], carryTotal: 0 }), /Nothing carried over/);
});

test('reportBlocks says so when the report is missing or failed on GPU1', () => {
  assert.match(reportBlocks(null), /not been posted yet/);
  assert.match(reportBlocks({ reportError: 'boom' }), /failed on GPU1/);
  assert.match(reportBlocks({ weekStart: '2020-01-06', report: REPORT }, THIS_WEEK), /from an earlier week/);
  const html = reportBlocks({ weekStart: THIS_WEEK, report: REPORT }, THIS_WEEK);
  assert.match(html, /Carried over into this week/);
  assert.equal((html.match(/class="cardhead"/g) || []).length, 3); // carry card + 2 weeks
});

test('PUT /v1/periods keeps the report and GET returns it; a malformed report is refused', async () => {
  const { env } = await setup();
  const base = { weekStart: THIS_WEEK, groups: [] };
  assert.equal((await call(env, 'PUT', '/v1/periods', { bot: 'moneyclaw', body: { ...base, report: REPORT } })).status, 200);
  const got = await call(env, 'GET', '/v1/periods', { jon: true });
  assert.equal(got.body.weekly.report.carry.length, 2);
  assert.equal(got.body.weekly.report.weeks[0].rows[0].label, 'Coding');
  for (const bad of [{ weeks: 'x', carry: [] }, { weeks: [], carry: 'x' }, { weeks: [{ weekStart: 'monday', rows: [] }], carry: [] }, { weeks: [], carry: new Array(201).fill({}) }, 'text',
    { weeks: [], carry: [null] }, { weeks: [], carry: [{ title: 'x' }] }, { weeks: [{ weekStart: THIS_WEEK, rows: [null] }], carry: [] },
    { weeks: [{ weekStart: '9999-99-99', rows: [] }], carry: [] }]) {
    assert.equal((await call(env, 'PUT', '/v1/periods', { bot: 'moneyclaw', body: { ...base, report: bad } })).status, 400);
  }
  assert.equal((await call(env, 'PUT', '/v1/periods', { bot: 'moneyclaw', body: base })).status, 200); // no report is still fine
});

test('weekly page shows what carried over; monthly page paints the week-by-week report and habits', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => PERIODS({ weekly: { ...SNAP, report: REPORT }, monthHabits: [{ key: 'close', label: 'Month close', done: false }] }) });
  const w = fakeEl();
  mountWeekly(w); await new Promise((r) => setTimeout(r, 50));
  assert.match(w.boxes['.pdcarry'].innerHTML, /3 weeks slipped/);
  w.stop();
  assert.match(monthly(null, null), /Week by week[\s\S]*pdreport[\s\S]*Your habits this month/);
  const m = fakeEl();
  mountMonthly(m); await new Promise((r) => setTimeout(r, 50));
  assert.match(m.boxes['.pdreport'].innerHTML, /Carried over into this week[\s\S]*1 of 3 done/);
  assert.match(m.boxes['.pdhab'].innerHTML, /Month close/);
  m.stop();
});
