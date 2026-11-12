// Dashboard 3 Home page (public/d3/js/home.js): the default page at /dash/, built from Jacqueline's handover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderHome, homeGoals, scheduleOf, routineOf, homeClick, clockOf, BUDGET } from '../public/d3/js/home.js';

const SAMPLE = () => JSON.parse(readFileSync(new URL('./fixtures/d2-sample.json', import.meta.url), 'utf8')); // Sunday Nov 8, 2026
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const d3Sample = () => ({ ok: true, asOf: '2026-11-08T21:05:00.000Z', d3: {
  openCards: { 'jon-mac': 8, jonmacai: 1 },
  goals: {
    qcFirstTry: { actual: 40, target: null, display: '40%', passed: 2, total: 5, status: { text: 'No target', cls: 'idle' }, note: '' },
    workouts: { actual: 1, target: 3, display: '1 of 3', pace: 3, status: { text: 'Behind', cls: 'risk' }, loggedToday: false,
      days: [{ ymd: '2026-11-02', actual: 1 }, { ymd: '2026-11-03', actual: 0 }, { ymd: '2026-11-04', actual: 0 }, { ymd: '2026-11-05', actual: 0 }, { ymd: '2026-11-06', actual: 0 }, { ymd: '2026-11-07', actual: 0 }, { ymd: '2026-11-08', actual: 0 }] },
    dateNights: { actual: 1, target: 4, display: '1 of 4', pace: 1, status: { text: 'On pace', cls: 'ok' }, loggedToday: false, perDay: { '2026-11-05': 1 } },
    charges: { actual: 2, target: 5, display: '2 of 5', open: 3, status: { text: 'Behind', cls: 'risk' }, note: '3 MoneyClaw charge questions still open for you.' },
    scoreboard: { actual: 1, target: 6, display: '1 of 6', pace: null, status: { text: 'Behind', cls: 'crit' }, note: '' },
    approvedWaiting: { actual: 2, target: 0, display: '2', oldestLabel: '3 days', items: [{ id: 'a', title: 'JM video A' }, { id: 'b', title: 'JM video B' }], status: { text: 'Behind', cls: 'crit' }, note: '' },
  },
} });
const NOW = Date.parse('2026-11-08T21:05:00.000Z');
const rowsOf = (cats, key, per) => cats.find((c) => c.key === key)[per];
const rowOf = (cats, key, per, k) => rowsOf(cats, key, per).find((r) => r.k === k);

test('Home is the default page: /dash/ with no hash opens it, and every earlier page stays in the menu', () => {
  const app = read('../public/d3/js/app.js');
  assert.match(app, /return PAGES\[k\] \? k : 'home';/);
  assert.match(app, /const PAGES = \{ home: 'Home', goals: 'Goals', team: 'Team', factory: 'Factory', track: 'Track', blockers: 'Blockers', review: 'Review', scripts: 'Scripts', hyper: 'Hyper', money: 'Money', bluesky: 'Bluesky', system: 'System' \};/);
  const index = read('../public/d3/index.html');
  const nav = [...index.matchAll(/<a href="#([a-z]+)" data-nav="([a-z]+)">/g)].map((m) => { assert.equal(m[1], m[2]); return m[1]; });
  assert.deepEqual(nav, ['home', 'goals', 'team', 'factory', 'track', 'blockers', 'review', 'scripts', 'hyper', 'money', 'bluesky', 'system']);
});

test('Shell: no hash draws Home, #goals still draws Goals', async () => {
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const realInterval = globalThis.setInterval;
  const open = async (hash, n) => {
    const nodes = new Map();
    const node = () => ({ innerHTML: '', textContent: '', hidden: false, dataset: {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, addEventListener() {} });
    Object.assign(globalThis, {
      document: { documentElement: node(), title: '', visibilityState: 'visible', querySelectorAll: () => [], getElementById: (k) => nodes.get(k) || nodes.set(k, node()).get(k), addEventListener() {} },
      window: { addEventListener() {} }, location: { hash, replace() {} }, localStorage: store(), sessionStorage: store(),
      fetch: async (url) => new Response(JSON.stringify(String(url).endsWith('/d2') ? SAMPLE() : d3Sample())),
    });
    globalThis.setInterval = () => 0;
    try { await import(`../public/d3/js/app.js?home=${n}`); await settle(); } finally { globalThis.setInterval = realInterval; }
    return { html: nodes.get('main').innerHTML, title: globalThis.document.title };
  };
  const home = await open('', 1);
  assert.match(home.html, /<div class="hm"/);
  assert.match(home.html, /aria-label="Schedule"/);
  assert.equal(home.title, 'Home · Jon Mac');
  const goals = await open('#goals', 2);
  assert.doesNotMatch(goals.html, /<div class="hm"/);
  assert.match(goals.html, /Key results/);
});

test('Home: widgets, Schedule, then Progress as four category cards; no retired agent names, no mockup sample numbers', () => {
  const html = renderHome(SAMPLE(), d3Sample(), {}, NOW);
  const at = (s) => { const i = html.indexOf(s); assert.notEqual(i, -1, s); return i; };
  assert.ok(at('class="hmwid"') < at('aria-label="Schedule"') && at('aria-label="Schedule"') < at('<h2>Progress</h2>'));
  assert.ok(at('aria-label="Sponsors"') < at('aria-label="Factory"') && at('aria-label="Factory"') < at('aria-label="Personal"') && at('aria-label="Personal"') < at('aria-label="PNL"'));
  assert.match(html, /<small>Today<\/small><b><span class="hmlg">Sunday<\/span><span class="hmsm">Sun<\/span><\/b><span>8 Nov<\/span>/);
  assert.match(html, /<b class="hmclock">\d{1,2}:05 PM<\/b>/);
  assert.match(html, /Day 7 <i>of 7<\/i><\/b><div class="hmwbar"><u style="width: 100%">/);
  assert.match(html, /Day 8 <i>of 30<\/i><\/b><div class="hmwbar"><u style="width: 27%">/);
  // the two switches are independent, each with its own pressed button
  assert.match(html, /data-hmview="list" aria-pressed="true">List<\/button><button type="button" data-hmview="cal" aria-pressed="false">/);
  assert.match(html, /data-hmper="today" aria-pressed="true"/);
  const week = renderHome(SAMPLE(), d3Sample(), { hmPer: 'week', hmView: 'list' }, NOW);
  assert.match(week, /data-hmview="list" aria-pressed="true"/);
  assert.match(week, /data-hmper="week" aria-pressed="true"/);
  for (const bad of ['Florence', 'Elle', 'Arcads', 'peony', 'Omnirogue', '$7,006', '$9,172', 'jonCatColours']) assert.equal(html.includes(bad) || week.includes(bad), false, bad);
  // nothing that needs saving is offered: no task editor, no add-goal form
  assert.doesNotMatch(html + week, /Add goal<|<form|type="time"/);
});

test('Schedule: the handover\'s standing rules by weekday', () => {
  const names = (ymd) => routineOf(ymd).map((x) => `${clockOf(x.s)} ${x.w}`);
  assert.deepEqual(names('2026-11-09'), ['9:00 Sponsor emails', '11:00 Workout', '12:00 Cook lunch', '5:00 Dinner']); // Monday
  assert.deepEqual(names('2026-11-10'), ['8:00 Garbage out', '9:00 Sponsor emails', '11:30 Cook lunch', '5:00 Dinner']); // Tuesday
  assert.deepEqual(names('2026-11-12'), ['9:00 Sponsor emails', '11:30 Cook lunch', '4:00 Date night · happy hour']); // Thursday: date night covers dinner
  assert.deepEqual(names('2026-11-13'), ['9:00 Sponsor emails', '11:00 Workout', '12:00 Cook lunch', '3:30 Friday review', '5:00 Dinner']);
  assert.deepEqual(names('2026-11-14'), ['11:30 Cook lunch', '5:00 Dinner']); // Saturday: nothing from work
  assert.deepEqual(names('2026-11-15'), ['10:30 Plan meals for the week', '11:30 Cook lunch', '5:00 Dinner']);
});

test('Schedule: done and missed come from the habit log, meetings from the calendar feed, the email count from the board', () => {
  const sch = scheduleOf(SAMPLE(), d3Sample());
  assert.deepEqual(sch.days.map((d) => d.ymd), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
  assert.deepEqual(sch.days.filter((d) => d.week).length, 7);
  assert.deepEqual(sch.days.filter((d) => d.phone).map((d) => d.ymd), ['2026-11-08', '2026-11-09', '2026-11-10']); // a phone shows today and the next two
  const item = (ymd, key) => sch.days.find((d) => d.ymd === ymd).items.find((x) => x.key === key);
  assert.equal(item('2026-11-02', 'workout').done, true);
  assert.equal(item('2026-11-04', 'workout').missed, true);
  assert.equal(item('2026-11-09', 'workout').missed, undefined); // a day to come is neither
  assert.equal(item('2026-11-05', 'date').done, true);
  const today = sch.days.find((d) => d.today);
  assert.deepEqual(today.items.filter((x) => x.meet).map((x) => [x.s, x.e, x.w]), [[15, 15.5, 'Call with Poppy']]);
  assert.equal(sch.days.filter((d) => !d.today).some((d) => d.items.some((x) => x.meet)), false); // the feed holds today only
  // with no habit log nothing is marked done or missed
  const bare = scheduleOf(SAMPLE(), null);
  assert.equal(bare.days.some((d) => d.items.some((x) => x.done || x.missed)), false);
  // a weekday shows how many sponsor emails wait
  const d2 = SAMPLE();
  d2.d2.period.today = { ...d2.d2.period.today, ymd: '2026-11-06', weekday: 4 };
  assert.match(scheduleOf(d2, null).days.find((d) => d.today).items.find((x) => x.key === 'emails').w, /^Sponsor emails · \d+ waiting$/);
  const cal = renderHome(SAMPLE(), d3Sample(), { hmView: 'cal' }, NOW);
  assert.match(cal, /class="hmday today hmwk hmph"><div class="hmdh"><small>Sun<\/small><b>8<\/b>/);
  assert.match(cal, /class="hmnow" style="top: \d+px"/);
  assert.match(cal, /class="hmev sm m"[^>]*title="3:00–3:30 Call with Poppy"/);
});

test('Progress: numbers and status from the feeds; a goal with no source reads No feed with a grey dot', () => {
  const cats = homeGoals(SAMPLE(), d3Sample());
  assert.deepEqual(cats.map((c) => c.title), ['Sponsors', 'Factory', 'Personal', 'PNL']);
  const d2 = SAMPLE().d2;
  const sp = d2.goals.find((g) => g.key === 'sponsors');
  assert.equal(rowOf(cats, 'sponsors', 'week', 'deals').v, `${sp.week[0].actual} / ${sp.week[0].target}`);
  assert.equal(rowOf(cats, 'sponsors', 'week', 'deals').st, 'off');
  assert.match(rowOf(cats, 'sponsors', 'week', 'deals').info, /Should be ~1\.9 by today/);
  assert.equal(rowOf(cats, 'sponsors', 'month', 'collected').v, '$3,100 / $10,000');
  assert.equal(rowOf(cats, 'sponsors', 'month', 'collected').word, 'Stale'); // a stale number is grey, whatever it says
  assert.equal(rowOf(cats, 'sponsors', 'month', 'collected').st, 'none');
  assert.equal(rowOf(cats, 'factory', 'today', 'approved').v, '2 · target 0');
  assert.equal(rowOf(cats, 'factory', 'today', 'approved').info, 'Oldest 3 days');
  assert.equal(rowOf(cats, 'factory', 'today', 'qc').v, '1 / 6');
  assert.equal(rowOf(cats, 'factory', 'week', 'hgp').v, '4 / 28');
  assert.equal(rowOf(cats, 'factory', 'week', 'hgp').det.items.length, 4); // one line per channel
  assert.equal(rowOf(cats, 'factory', 'month', 'qc1').v, '40%');
  assert.equal(rowOf(cats, 'factory', 'month', 'qc1').word, 'No target');
  assert.equal(rowOf(cats, 'personal', 'today', 'charges').v, '3 open');
  assert.equal(rowOf(cats, 'personal', 'today', 'charges').st, 'risk');
  assert.equal(rowOf(cats, 'personal', 'week', 'workouts').v, '1 / 3');
  assert.deepEqual(rowOf(cats, 'personal', 'week', 'workouts').det.items, ['Mon · done', 'Wed · missed', 'Fri · missed']);
  assert.equal(rowOf(cats, 'personal', 'week', 'datewk').v, '1 / 1'); // Thursday Nov 5 is inside this week
  assert.deepEqual(rowsOf(cats, 'pnl', 'today'), []);
  for (const [cat, per, k] of [['personal', 'week', 'trip'], ['personal', 'month', 'trips'], ['personal', 'month', 'groups'], ['personal', 'month', 'networth']]) {
    const r = rowOf(cats, cat, per, k);
    assert.deepEqual([r.v, r.st, r.word, r.pct], ['No feed', 'none', 'No feed', null], k);
  }
  assert.equal(rowOf(cats, 'pnl', 'month', 'profit').v, 'No data'); // never a USD income minus CAD spending sum
  // nothing reporting at all: every row is grey, none invents a number
  const empty = homeGoals({ d2: { goals: [], period: {} } }, null);
  for (const c of empty) for (const per of ['today', 'week', 'month']) for (const r of c[per]) assert.equal(r.st, 'none', `${c.key}.${r.k}`);
  const html = renderHome({ d2: { goals: [], period: {} } }, null, { hmPer: 'month' }, NOW);
  assert.doesNotMatch(html, /\$\d/);
  assert.doesNotMatch(html, /class="dot (r|y|hmon)"/);
});

test('Progress: workout and date-night rows show only on their days; spending is judged against the handover budgets', () => {
  const d2 = SAMPLE();
  assert.deepEqual(rowsOf(homeGoals(d2, d3Sample()), 'personal', 'today').map((r) => r.k), ['charges']); // Sunday
  d2.d2.period.today = { ...d2.d2.period.today, ymd: '2026-11-06', weekday: 4 };
  const fri = homeGoals(d2, d3Sample(), undefined, { h: 10 });
  assert.deepEqual(rowsOf(fri, 'personal', 'today').map((r) => r.k), ['workout', 'charges']);
  assert.deepEqual([rowOf(fri, 'personal', 'today', 'workout').v, rowOf(fri, 'personal', 'today', 'workout').st], ['0 / 1', 'on']);
  assert.equal(rowOf(homeGoals(d2, d3Sample(), undefined, { h: 13 }), 'personal', 'today', 'workout').st, 'risk'); // past its hour, not logged
  assert.deepEqual(rowOf(fri, 'personal', 'today', 'workout').det.log, { kind: 'workout', done: false });
  d2.d2.period.today = { ...d2.d2.period.today, ymd: '2026-11-05', weekday: 3 };
  assert.deepEqual(rowsOf(homeGoals(d2, d3Sample(), undefined, { h: 10 }), 'personal', 'today').map((r) => r.k), ['date', 'charges']);
  // spending
  const exp = d2.d2.summary.sections.find((s) => s.key === 'expenses');
  exp.split.personal = { basis: 'stages', monthFrom: null, yesterday: 220.71, week: 1219.14, month: 7005.83 };
  exp.split.business = { basis: 'lists', from: '2026-10-01', partial: false, yesterday: 8.93, week: 1354.48, month: 9171.69 };
  const cats = homeGoals(d2, d3Sample());
  const ps = rowOf(cats, 'personal', 'month', 'pspend');
  assert.equal(ps.v, `$7,006 / ${BUDGET.personal[2]}`);
  assert.equal(ps.st, 'off'); // under the max so far, but on pace for far more than it
  assert.match(ps.info, /this month so far · on pace for ~\$[\d,]+ · RBC CAD · budget from the handover/);
  assert.match(ps.det.items.join('|'), /To stay under \$10,000: about \$\d+ a day/);
  assert.deepEqual([rowOf(cats, 'pnl', 'week', 'bweek').v, rowOf(cats, 'pnl', 'week', 'bweek').st], ['$1,354 / $700–1,150', 'off']);
  const bm = rowOf(cats, 'pnl', 'month', 'bmonth');
  assert.deepEqual([bm.v, bm.st, bm.pace], ['$9,172 / $3–5k', 'off', null]); // a last-30-days figure gets no pace mark
  assert.match(bm.info, /^last 30 days/);
  exp.stale = true;
  assert.equal(rowOf(homeGoals(d2, d3Sample()), 'pnl', 'month', 'bmonth').word, 'Stale');
  exp.split = null;
  assert.equal(rowOf(homeGoals(d2, d3Sample()), 'pnl', 'month', 'bmonth').v, 'No feed');
});

test('Progress rows: status shows on the dot only, a row opens to its detail and page link, text is escaped', () => {
  const d2 = SAMPLE();
  const board = d2.d2.pipeline.boards.find((b) => b.goal === 'sponsors').sponsors.board;
  const card = board.columns.flatMap((c) => c.cards || []).find((k) => k.draft);
  assert.ok(card, 'the sample has a sponsor draft');
  card.name = '<img src=x onerror=alert(1)>';
  const ui = { hmPer: 'today', hmOpen: 'sponsors.emails' };
  const html = renderHome(d2, d3Sample(), ui, NOW);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /data-hmrow="sponsors\.emails" aria-expanded="true"><i class="dot y"><\/i><span class="hmpn">Emails waiting on you<\/span>/);
  assert.match(html, /<div class="hmdet">.*<a href="#money">Open Money ›<\/a>/s);
  assert.match(html, /<span class="hmsw">At risk<\/span>/);
  assert.doesNotMatch(html, /hmsw (r|y|bad|warn)/);
  // on track is a grey dot, never green
  assert.doesNotMatch(renderHome(SAMPLE(), d3Sample(), { hmPer: 'week' }, NOW), /class="dot g"/);
  // "+ Log" is the Goals page's own button, so the shell's confirm-then-post handles it
  const log = renderHome(SAMPLE(), d3Sample(), { hmPer: 'week', hmOpen: 'personal.workouts' }, NOW);
  assert.match(log, /<button type="button" class="btn sm" data-log="workout">\+ Log<\/button>/);
  assert.match(renderHome(SAMPLE(), d3Sample(), { hmPer: 'week', hmOpen: 'personal.workouts', confirmLog: 'workout' }, NOW), /class="btn sm primary" data-log="workout">Confirm log\?/);
});

test('Home clicks: the two switches, See more and a row each change only their own state', () => {
  const ui = { hmView: 'list', hmPer: 'today', hmOpen: null, hmMore: false };
  let draws = 0;
  const click = (sel, dataset) => homeClick({ target: { closest: (s) => (s === sel ? { dataset } : null) } }, ui, () => { draws += 1; });
  assert.equal(click('[data-hmview]', { hmview: 'cal' }), true);
  assert.deepEqual([ui.hmView, ui.hmPer], ['cal', 'today']);
  assert.equal(click('button[data-hmper]', { hmper: 'month' }), true);
  assert.deepEqual([ui.hmView, ui.hmPer], ['cal', 'month']);
  assert.equal(click('[data-hmmore]', {}), true);
  assert.equal(ui.hmMore, true);
  assert.equal(click('[data-hmrow]', { hmrow: 'pnl.profit' }), true);
  assert.equal(ui.hmOpen, 'pnl.profit');
  assert.equal(click('[data-hmrow]', { hmrow: 'pnl.profit' }), true);
  assert.equal(ui.hmOpen, null);
  assert.equal(draws, 5);
  assert.equal(click('[data-log]', { log: 'workout' }), false); // left for the shell
  assert.equal(draws, 5);
});

test('d3.css: Home uses the dashboard tokens (light and dark follow the theme) and keeps its layout on a phone', () => {
  const css = read('../public/d3/css/d3.css');
  const home = css.slice(css.indexOf('/* Home page (home.js'));
  assert.ok(home.length > 1000);
  // the only fixed colour is white text on the blue date circle; the category colours are set by home.js
  assert.deepEqual([...new Set(home.match(/#[0-9a-f]{3,8}\b/gi))], ['#ffffff']);
  assert.match(renderHome(SAMPLE(), null, { hmCols: { pnl: '#112233', factory: 'red"><b>' } }, NOW), /<div class="hm" style="--c-factory: #039be5; --c-sponsors: #33b679; --c-personal: #e67c73; --c-pnl: #112233">/);
  assert.match(home, /\.d3 \.hmwid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/); // four widgets in one row, phones too
  assert.match(home, /\.d3 \.hmsecs\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/); // always 2 x 2
  assert.match(home, /\.d3 \.hmbox\{position:relative;height:280px;/);
  assert.match(home, /\.d3 \.card\.hmpc\{padding:16px 20px 0;height:280px;/);
  const phone = home.slice(home.indexOf('@media (max-width:600px)'));
  assert.doesNotMatch(phone, /hmwid\{[^}]*grid-template-columns|hmsecs\{[^}]*grid-template-columns/);
  assert.match(phone, /\.d3 \.hmday\.hmwk\{display:none\}\n\s*\.d3 \.hmday\.hmph\{display:block/); // three days on a phone
});
