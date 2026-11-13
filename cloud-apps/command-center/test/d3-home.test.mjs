// Dashboard 3 Home page (public/d3/js/home.js): the default page at /dash/, built from Jacqueline's handover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderHome, homeGoals, scheduleOf, homeClick, homeChange, homeSubmit, editorOf, editorSummary, goalSummary, newGoal, clockOf, BUDGET } from '../public/d3/js/home.js';
import { dayItems, occursOn, zoned, goalState } from '../public/d3/js/sched.js';
import { homeData } from '../src/home.js';
import { sqliteD1 } from './sqlited1.mjs';

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
// A Vancouver wall-clock time as the ISO instant Google sends, whatever offset this Node's time-zone data gives November.
const VAN_NOON = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', hourCycle: 'h23' }).format(new Date('2026-11-10T12:00:00Z')));
const V = (ymd, hm) => new Date(Date.parse(`${ymd}T${hm}:00Z`) + (12 - VAN_NOON) * 3600000).toISOString();
// GET /dashboard/api/home as the Worker answers it from the migration's seed, with the standing rules starting a week
// earlier so the sample's week (Nov 2 to 8) has them, a workout logged on Monday and a date night on Thursday.
const HOME = async (more = () => {}) => {
  const db = sqliteD1();
  db.sqlite.exec("INSERT INTO habits (day, kind, done, note) VALUES ('2026-11-02', 'workout', 1, ''), ('2026-11-05', 'date_night', 1, '')");
  await more(db);
  const home = await homeData({ DB: db }, NOW);
  for (const t of home.tasks) if (t.rep !== 'none') t.from = '2026-10-26';
  return home;
};
const rowsOf = (cats, key, per) => cats.find((c) => c.key === key)[per];
const rowOf = (cats, key, per, k) => rowsOf(cats, key, per).find((r) => r.k === k);

test('Home is the default page and is called Goals in the menu; Personal sits between Hyper and Money', () => {
  const app = read('../public/d3/js/app.js');
  assert.match(app, /return PAGES\[k\] \? k : 'home';/);
  assert.match(app, /const PAGES = \{ home: 'Goals', team: 'Team', factory: 'Factory', track: 'Track', blockers: 'Blockers', review: 'Review', scripts: 'Scripts', hyper: 'Hyper', personal: 'Personal', money: 'Money', bluesky: 'Bluesky', system: 'System' \};/);
  const index = read('../public/d3/index.html');
  const nav = [...index.matchAll(/<a href="#([a-z]+)" data-nav="([a-z]+)">/g)].map((m) => { assert.equal(m[1], m[2]); return m[1]; });
  assert.deepEqual(nav, ['home', 'team', 'factory', 'track', 'blockers', 'review', 'scripts', 'hyper', 'personal', 'money', 'bluesky', 'system']);
  assert.match(index, /data-nav="home">.*<\/svg>Goals<\/a>/);
});

test('Shell: no hash and #goals both draw Home (the Goals page); See more starts closed', async () => {
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
  assert.equal(home.title, 'Goals · Jon Mac');
  assert.match(home.html, /data-hmmore aria-expanded="false">See more/);
  assert.match(home.html, /class="psmnav"/);
  const goals = await open('#goals', 2);
  assert.match(goals.html, /<div class="hm"/);
});

test('Home: widgets, Schedule, then Progress as four category cards; no retired agent names, no mockup sample numbers', () => {
  const html = renderHome(SAMPLE(), d3Sample(), {}, NOW);
  const at = (s) => { const i = html.indexOf(s); assert.notEqual(i, -1, s); return i; };
  assert.ok(at('class="hmwid"') < at('aria-label="Schedule"') && at('aria-label="Schedule"') < at('<h2>Progress</h2>'));
  assert.ok(at('aria-label="PnL"') < at('aria-label="Sponsors"') && at('aria-label="Sponsors"') < at('aria-label="Factory"') && at('aria-label="Factory"') < at('aria-label="Personal"')); // Jon's order, 2026-11-12
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
  // without the saved tasks the page says so and offers nothing that would save
  assert.match(html, /Your saved tasks could not be loaded/);
  assert.match(html, /data-hmadd disabled/);
  assert.doesNotMatch(html + week, /<form|type="time"|data-hmtick/);
});

test('Schedule: the standing rules are saved tasks, seeded by the migration, by weekday', async () => {
  const home = await HOME();
  const names = (ymd) => dayItems(home, ymd, '2026-11-01', 0).map((x) => `${clockOf(x.s)} ${x.w}`);
  assert.deepEqual(names('2026-11-09'), ['8:00 Groceries · Meals 1–4', '9:00 Sponsor emails', '11:00 Workout', '12:00 Cook lunch', '5:00 Dinner']); // Monday
  assert.deepEqual(names('2026-11-10'), ['8:00 Garbage out', '9:00 Sponsor emails', '11:30 Cook lunch', '5:00 Dinner']); // Tuesday
  assert.deepEqual(names('2026-11-12'), ['8:00 Groceries · Meals 5–7', '9:00 Sponsor emails', '11:30 Cook lunch', '4:00 Date night · happy hour']); // Thursday: date night covers dinner
  assert.deepEqual(names('2026-11-13'), ['9:00 Sponsor emails', '11:00 Workout', '12:00 Cook lunch', '3:30 Friday review', '5:00 Dinner']);
  assert.deepEqual(names('2026-11-14'), ['11:30 Cook lunch', '5:00 Dinner']); // Saturday: nothing from work
  assert.deepEqual(names('2026-11-15'), ['10:30 Plan meals for the week', '11:30 Cook lunch', '5:00 Dinner']);
  // the seed itself starts on Monday Nov 9, so nothing before it reads as missed
  const seeded = await homeData({ DB: sqliteD1() }, NOW);
  assert.equal(seeded.tasks.length, 11); // 0028_personal.sql adds the two grocery days
  assert.equal(seeded.tasks.every((t) => t.from === '2026-11-09' && !occursOn(t, '2026-11-06')), true);
});

test('Schedule: done, missed, retry, carried over Late, moved just this once, removed for a day', async () => {
  const home = await HOME();
  const at = (ymd, today, h = 0) => dayItems(home, ymd, today, h);
  const one = (list, id, f = () => true) => list.find((x) => x.id === id && f(x));
  // the habit log marks a workout or date night done
  assert.equal(one(at('2026-11-02', '2026-11-08'), 'r-workout').done, true);
  assert.equal(one(at('2026-11-05', '2026-11-08'), 'r-date').done, true);
  // a missed workout: its 11am slot and its 3pm retry both read Missed on that day
  const wed = at('2026-11-04', '2026-11-08').filter((x) => x.id === 'r-workout');
  assert.deepEqual(wed.map((x) => [x.s, x.w, x.missed, !!x.ghost]), [[11, 'Workout', true, true], [15, 'Workout · retry', true, false]]);
  // today before 12: just the slot; after it: the slot fades and the retry is live
  assert.deepEqual(at('2026-11-06', '2026-11-06', 10).filter((x) => x.id === 'r-workout').map((x) => [x.s, !!x.missed]), [[11, false]]);
  assert.deepEqual(at('2026-11-06', '2026-11-06', 13).filter((x) => x.id === 'r-workout').map((x) => [x.s, x.w, !!x.missed]), [[11, 'Workout', true], [15, 'Workout · retry', false]]);
  // the next day (Thursday has no workout of its own) it is carried over, marked Late; a day to come is neither
  const thu = one(at('2026-11-05', '2026-11-05'), 'r-workout');
  assert.deepEqual([thu.w, thu.late, thu.tag, thu.day, thu.on, thu.s], ['Workout · from Wed', true, 'Late', '2026-11-04', '2026-11-05', 11]);
  assert.equal(one(at('2026-11-06', '2026-11-05'), 'r-workout').missed, undefined);
  // never next to the task's own slot (Friday), and never across Monday (weekly goals reset)
  assert.equal(at('2026-11-06', '2026-11-06').filter((x) => x.id === 'r-workout').length, 1);
  assert.equal(at('2026-11-09', '2026-11-09').some((x) => x.late), false); // Friday's missed review is not on Monday
  assert.equal(one(at('2026-11-10', '2026-11-10'), 'r-workout').w, 'Workout · from Mon');
  // sponsor emails and the home routines are skipped, not carried
  assert.equal(at('2026-11-07', '2026-11-07').some((x) => (x.id === 'r-emails' || x.id === 'r-dinner') && x.late), false);
  // Friday review carries to Saturday; ticked there, it stays on Saturday as done and Friday reads Missed
  assert.equal(one(at('2026-11-07', '2026-11-07'), 'r-review').late, true);
  home.days.push({ id: 'r-review', day: '2026-11-06', done: true, doneOn: '2026-11-07', skip: false, moveDay: null, start: null, end: null });
  assert.deepEqual([one(at('2026-11-07', '2026-11-08'), 'r-review').done, one(at('2026-11-06', '2026-11-08'), 'r-review').tag], [true, 'Missed']);
  assert.equal(at('2026-11-08', '2026-11-08').some((x) => x.id === 'r-review'), false);
  // "just this one": date night moved from Thursday to Saturday 6pm; the usual slot stays, faded, and next week is untouched
  home.habits = home.habits.filter((h) => h.kind !== 'date_night');
  home.days.push({ id: 'r-date', day: '2026-11-05', done: false, doneOn: null, skip: false, moveDay: '2026-11-07', start: 1080, end: 1200 });
  assert.deepEqual([one(at('2026-11-05', '2026-11-05'), 'r-date').tag, one(at('2026-11-05', '2026-11-05'), 'r-date').ghost], ['Moved', true]);
  const sat = one(at('2026-11-07', '2026-11-05'), 'r-date');
  assert.deepEqual([sat.w, sat.s, sat.e, sat.day], ['Date night · happy hour · make-up', 18, 20, '2026-11-05']);
  assert.equal(one(at('2026-11-12', '2026-11-05'), 'r-date').s, 16);
  // removed for one day only
  home.days.push({ id: 'r-garbage', day: '2026-11-03', done: false, doneOn: null, skip: true, moveDay: null, start: null, end: null });
  assert.equal(at('2026-11-03', '2026-11-03').some((x) => x.id === 'r-garbage'), false);
  assert.equal(at('2026-11-10', '2026-11-03').some((x) => x.id === 'r-garbage'), true);
  // one-off tasks, and monthly ones
  const t = { id: 'x', title: 'Call the bank', cat: 'pnl', start: 600, end: 630, rep: 'none', days: [], day: '2026-11-04', from: '2026-11-04', miss: 'next', retry: null, kind: '' };
  assert.deepEqual([occursOn(t, '2026-11-04'), occursOn(t, '2026-11-05')], [true, false]);
  assert.equal(dayItems({ tasks: [t], days: [], habits: [] }, '2026-11-09', '2026-11-09', 0)[0].w, 'Call the bank · from Wed'); // a one-off carries across the week
  assert.deepEqual([occursOn({ ...t, rep: 'monthly' }, '2026-12-04'), occursOn({ ...t, rep: 'monthly' }, '2026-12-05')], [true, false]);
});

test('Schedule: the week, meetings from the feed or from Google Calendar, the email count, ticks and pencils', async () => {
  const home = await HOME();
  const sch = scheduleOf(SAMPLE(), d3Sample(), undefined, home, { h: 14 });
  assert.deepEqual(sch.days.map((d) => d.ymd), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
  assert.deepEqual(sch.days.filter((d) => d.week).length, 7);
  assert.deepEqual(sch.days.filter((d) => d.phone).map((d) => d.ymd), ['2026-11-08', '2026-11-09', '2026-11-10']); // a phone shows today and the next two
  const today = sch.days.find((d) => d.today);
  // not connected: today's meetings from Ana's feed, none on other days
  assert.equal(sch.cal, 'none');
  assert.deepEqual(today.items.filter((x) => x.meet).map((x) => [x.s, x.e, x.w]), [[15, 15.5, 'Call with Poppy']]);
  assert.equal(sch.days.filter((d) => !d.today).some((d) => d.items.some((x) => x.meet)), false);
  // connected: the week's timed events in Vancouver time; an event named like a task is that task, not a second row
  home.calendar = { connected: true, canConnect: true, events: [
    { title: 'Dentist', start: V('2026-11-10', '09:30'), end: V('2026-11-10', '10:15') },
    { title: 'Call NY', start: V('2026-11-09', '10:00'), end: V('2026-11-09', '11:00') },
    { title: 'workout', start: V('2026-11-09', '11:00'), end: V('2026-11-09', '12:00') },
  ] };
  const g = scheduleOf(SAMPLE(), d3Sample(), undefined, home, { h: 14 });
  assert.equal(g.cal, 'google');
  const meets = (ymd) => g.days.find((d) => d.ymd === ymd).items.filter((x) => x.meet).map((x) => [x.s, x.e, x.w]);
  assert.deepEqual(meets('2026-11-10'), [[9.5, 10.25, 'Dentist']]);
  assert.deepEqual(meets('2026-11-09'), [[10, 11, 'Call NY']]);
  assert.deepEqual(meets('2026-11-08'), []); // the feed is not mixed in
  assert.deepEqual(zoned(V('2026-11-09', '23:30'), V('2026-11-10', '01:00')), { ymd: '2026-11-09', s: 23.5, e: 24 });
  // a weekday shows how many sponsor emails wait
  const d2 = SAMPLE();
  d2.d2.period.today = { ...d2.d2.period.today, ymd: '2026-11-06', weekday: 4 };
  assert.match(scheduleOf(d2, null, undefined, home).days.find((d) => d.today).items.find((x) => x.key === 'emails').w, /^Sponsor emails · \d+ waiting$/);
  // the list: a live tick box, the time and name open the pop-up, a pencil on every task, none on a meeting
  home.calendar = { connected: false, canConnect: false, events: [] };
  const ui = {};
  const list = renderHome(SAMPLE(), d3Sample(), ui, NOW, home);
  assert.match(list, /<input type="checkbox" data-hmtick="r-dinner\|2026-11-08\|2026-11-08\|" aria-label="Dinner: not done">/);
  assert.doesNotMatch(list, /type="checkbox"[^>]*disabled/);
  assert.match(list, /<button type="button" class="hmwhat hmlink" data-hmit="r-dinner\|2026-11-08\|2026-11-08\|">Dinner<\/button>/);
  assert.match(list, /class="hmedb" data-hmit="r-dinner\|2026-11-08\|2026-11-08\|" aria-label="Edit Dinner"/);
  assert.match(list, /Workout · from Fri<\/button><span class="hmtag late">Late<\/span>/);
  assert.match(list, /<span class="hmnb" aria-hidden="true"><\/span><span class="hmtm">3:00–3:30<\/span>.*Call with Poppy<\/span><span class="hmtag">Meeting<\/span><\/div>/);
  assert.equal(ui.hmItems['r-dinner|2026-11-08|2026-11-08|'].w, 'Dinner');
  assert.match(list, /until Google Calendar is connected/);
  assert.match(renderHome(SAMPLE(), d3Sample(), {}, NOW, { ...home, calendar: { connected: false, canConnect: true, events: [] } }), /<a href="\/dashboard\/api\/google\/start">connect Google Calendar<\/a>/);
  const cal = renderHome(SAMPLE(), d3Sample(), { hmView: 'cal' }, NOW, home);
  assert.match(cal, /class="hmday today hmwk hmph"><div class="hmdh"><small>Sun<\/small><b>8<\/b><\/div><div class="hmcol" data-ymd="2026-11-08">/);
  assert.match(cal, /class="hmnow" style="top: \d+px"/);
  assert.match(cal, /class="hmev sm m" style="[^"]*" title="3:00–3:30 Call with Poppy"/); // a meeting cannot be dragged or opened
  assert.match(cal, /class="hmev" data-hmit="r-dinner\|2026-11-08\|2026-11-08\|" role="button" tabindex="0"/);
  assert.match(cal, /Drag a block to move it/);
});

test('Task pop-up: its fields, the summary line, and what Save, Delete and a tick send', async () => {
  const home = await HOME();
  const d2 = SAMPLE();
  const P = d2.d2.period.today;
  const ui = { now: NOW };
  renderHome(d2, d3Sample(), ui, NOW, home);
  const S = { d2, d3: d3Sample(), home, ui, error: '' };
  const sent = [];
  const api = async (...a) => { sent.push(a); return { ok: true }; };
  let draws = 0;
  const render = () => { draws += 1; };
  const reload = async () => { draws += 1; };
  const el = (sel, dataset = {}) => ({ closest: (s) => (s === sel ? { dataset } : null), matches: () => false, dataset: {} });
  // clicking a task opens it with that occurrence's day and time; a repeating one defaults to "Just this one"
  assert.equal(homeClick({ target: el('[data-hmit]', { hmit: 'r-workout|2026-11-06|2026-11-08|' }) }, ui, render, S, api, reload), true);
  assert.deepEqual([ui.hmEd.id, ui.hmEd.occ, ui.hmEd.day, ui.hmEd.start, ui.hmEd.end, ui.hmEd.scope, ui.hmEd.rep, ui.hmEd.miss, ui.hmEd.retry],
    ['r-workout', '2026-11-06', '2026-11-08', '11:00', '12:00', 'once', 'weekly', 'retry', '15:00']);
  assert.equal(editorSummary(ui.hmEd), 'Sun 8 · 11:00–12:00  ·  Weekly on Mon, Wed, Fri  ·  If missed → retry, then next day  ·  No reminder');
  const pop = renderHome(d2, d3Sample(), ui, NOW, home);
  assert.match(pop, /<div class="hmhost" data-hmhost><form class="hmed" data-hmform="task"/);
  assert.match(pop, /name="scope" value="once" checked> Just this one \(usual time stays\)/);
  assert.match(pop, /<select name="rep" aria-label="Repeats" disabled>/); // how it repeats changes only with "Every time"
  assert.match(pop, /<span class="hmgpill">Workouts · 1 \/ 3 this week<\/span>/);
  assert.match(pop, /Retry at<\/span><input type="time" name="retry" step="900" value="15:00"/);
  assert.match(pop, /data-hmdel>Delete<\/button>/);
  // Save, "just this one": the series keeps its time; the one day moves
  const form = (kind) => ({ dataset: { hmform: kind }, elements: [], querySelector: () => null });
  const submit = (kind) => homeSubmit({ target: { closest: () => form(kind) }, preventDefault() {} }, S, render, api, reload);
  Object.assign(ui.hmEd, { day: '2026-11-07', start: '10:00', end: '11:00' });
  await submit('task');
  assert.deepEqual(sent.pop(), ['PATCH', '/home/tasks/r-workout', { title: 'Workout', cat: 'personal', day: '2026-11-07', start: 600, end: 660, rep: 'weekly', days: [0, 2, 4], miss: 'retry', retry: 900, rem: 'none', text: false, note: '', scope: 'once', occ: '2026-11-06' }]);
  assert.equal(ui.hmEd, null);
  // "Every time" sends no scope; a bad time is refused before anything is sent
  homeClick({ target: el('[data-hmit]', { hmit: 'r-dinner|2026-11-08|2026-11-08|' }) }, ui, render, S, api, reload);
  Object.assign(ui.hmEd, { scope: 'all', end: '16:00' });
  await submit('task');
  assert.equal(sent.length, 0);
  assert.equal(ui.hmEd.err, 'End time has to be after the start time');
  ui.hmEd.end = '18:30';
  await submit('task');
  assert.deepEqual([sent[0][0], sent[0][2].scope, sent[0][2].end], ['PATCH', undefined, 1110]);
  sent.length = 0;
  // + Add task: a new one-off today
  homeClick({ target: el('[data-hmadd]') }, ui, render, S, api, reload);
  assert.deepEqual([ui.hmEd.id, ui.hmEd.day, ui.hmEd.rep, ui.hmEd.cat], [null, P.ymd, 'none', 'personal']);
  assert.doesNotMatch(renderHome(d2, d3Sample(), ui, NOW, home), /data-hmdel|name="scope"/);
  await submit('task');
  assert.equal(ui.hmEd.err, 'Give it a name');
  ui.hmEd.title = ' Call the bank ';
  await submit('task');
  assert.deepEqual([sent[0][0], sent[0][1], sent[0][2].title, sent[0][2].rep], ['POST', '/home/tasks', 'Call the bank', 'none']);
  sent.length = 0;
  // Delete asks once more, then removes just this day of a repeating task
  homeClick({ target: el('[data-hmit]', { hmit: 'r-dinner|2026-11-08|2026-11-08|' }) }, ui, render, S, api, reload);
  const del = { closest: (s) => (s === '[data-hmdel]' ? {} : s === '[data-hmform]' ? form('task') : null), matches: () => false, dataset: {} };
  homeClick({ target: del }, ui, render, S, api, reload);
  assert.deepEqual([ui.hmEd.arm, sent.length], [true, 0]);
  assert.match(renderHome(d2, d3Sample(), ui, NOW, home), /Remove just this one\?/);
  homeClick({ target: del }, ui, render, S, api, reload);
  assert.deepEqual(sent.pop(), ['DELETE', '/home/tasks/r-dinner?scope=once&occ=2026-11-08', undefined].slice(0, 2));
  await new Promise((r) => setImmediate(r));
  assert.equal(ui.hmEd, null);
  // ✕ or a click outside closes without sending
  ui.hmEd = editorOf(ui.hmItems['r-dinner|2026-11-08|2026-11-08|'], home, P, { h: 14 });
  homeClick({ target: { closest: () => null, matches: (s) => s === '[data-hmhost]', dataset: {} } }, ui, render, S, api, reload);
  assert.deepEqual([ui.hmEd, sent.length], [null, 0]);
  // a tick shows at once and posts the occurrence's own day and the day it was ticked on; a workout tick is a habit log
  const tick = { closest: () => null, dataset: { hmtick: 'r-workout|2026-11-06|2026-11-08|' }, checked: true };
  assert.equal(homeChange({ target: tick }, S, render, api, reload), true);
  assert.deepEqual(sent.pop(), ['POST', '/home/tasks/r-workout/day', { day: '2026-11-06', on: '2026-11-08', done: true }]);
  assert.deepEqual(home.days.find((d) => d.id === 'r-workout'), { id: 'r-workout', day: '2026-11-06', skip: false, moveDay: null, start: null, end: null, done: true, doneOn: '2026-11-08' });
  assert.equal(home.habits.some((h) => h.kind === 'workout' && h.day === '2026-11-08'), true);
  assert.equal(dayItems(home, '2026-11-08', '2026-11-08', 14).find((x) => x.id === 'r-workout').done, true);
  assert.ok(draws > 5);
});

test('Add goal: the form by type, its summary, what it sends, and the goal as a Progress row with its own controls', async () => {
  const home = await HOME(async (db) => {
    db.sqlite.exec(`INSERT INTO home_goals (id, name, cat, sub, per, type, target, due, steps, time_min, days, track, created_at) VALUES
      ('g1', 'Podcast <b>', 'factory', 'Uploads', 'week', 'count', 3, NULL, '[]', NULL, '', 'log', 'x'),
      ('g2', 'Trip budget', 'personal', 'Trips', 'month', 'spend', 2000, NULL, '[]', NULL, '', 'log', 'x'),
      ('g3', 'Stretch', 'personal', 'Health', 'week', 'habit', NULL, NULL, '[]', 420, '0246', 'log', 'x'),
      ('g4', 'Ad income', 'pnl', '', 'month', 'money', 1000, NULL, '[]', NULL, '', 'auto', 'x');
      INSERT INTO home_goal_logs (goal_id, day, step, value, at) VALUES ('g1', '2026-11-03', -1, 1, 'x'), ('g1', '2026-11-08', -1, 1, 'x'), ('g1', '2026-10-30', -1, 5, 'x'),
      ('g2', '2026-11-04', -1, 900, 'x'), ('g-trip', '0000-00-00', 1, 1, 'x'), ('g3', '2026-11-02', -1, 1, 'x')`);
  });
  const d2 = SAMPLE();
  const cats = homeGoals(d2, d3Sample(), undefined, { h: 14 }, home);
  const g1 = rowOf(cats, 'factory', 'week', 'g:g1');
  assert.deepEqual([g1.n, g1.v, g1.st, g1.pct, g1.info], ['Podcast <b>', '2 / 3', 'risk', 67, 'Uploads · You log it']); // last week's 5 are not counted
  const g2 = rowOf(cats, 'personal', 'month', 'g:g2');
  assert.deepEqual([g2.v, g2.st], ['$900 / max $2,000', 'risk']); // $900 by day 8 of 30 is on pace for more than $2,000
  assert.deepEqual([rowOf(cats, 'personal', 'week', 'g:g3').v, rowOf(cats, 'personal', 'week', 'g:g3').info], ['1 / 4', 'Health · Mon, Wed, Fri, Sun at 7:00 · You log it']);
  const trip = rowOf(cats, 'personal', 'week', 'g:g-trip');
  assert.deepEqual([trip.n, trip.v, trip.word, trip.st], ['Book trip', '1 / 3', 'In progress', 'none']);
  assert.deepEqual([rowOf(cats, 'pnl', 'month', 'g:g4').v, rowOf(cats, 'pnl', 'month', 'g:g4').st], ['No feed', 'none']);
  // more shapes, straight from goalState
  const P = { ymd: '2026-11-08', weekday: 6, weekT: 1, monthT: 8 / 30, daysInMonth: 30 };
  const gs = (g, logs) => goalState({ id: 'a', per: 'today', track: 'log', days: [], steps: [], ...g }, logs.map((l) => ({ id: 'a', step: -1, ...l })), P);
  assert.deepEqual([gs({ type: 'pile' }, []).v, gs({ type: 'pile' }, [{ day: '2026-11-08', value: 4 }]).v, gs({ type: 'pile' }, [{ day: '2026-11-08', value: 0 }]).st], ['No data', '4 open', 'on']);
  assert.deepEqual([gs({ type: 'percent', target: 80, per: 'week' }, [{ day: '2026-11-05', value: 70 }]).v, gs({ type: 'percent', target: 80, per: 'week' }, [{ day: '2026-11-05', value: 70 }]).st], ['70% / 80%', 'risk']);
  assert.deepEqual([gs({ type: 'once', due: '2026-11-01' }, []).word, gs({ type: 'once' }, [{ day: '0000-00-00', value: 1 }]).v], ['Late', 'Done']);
  assert.deepEqual([gs({ type: 'count', target: 2 }, [{ day: '2026-11-08', value: 2 }]).st, gs({ type: 'count', target: 2 }, [{ day: '2026-11-07', value: 2 }]).v], ['on', '0 / 2']); // a daily goal resets every day
  // the row opened: text escaped, its own controls
  const html = renderHome(d2, d3Sample(), { hmPer: 'week', hmOpen: 'factory.g:g1' }, NOW, home);
  assert.match(html, /<span class="hmpn">Podcast &lt;b&gt;<\/span><span class="hmpv">2 \/ 3<\/span>/);
  assert.match(html, /data-hmglog="g1\|add\|1">\+ Log<\/button><button type="button" class="btn sm" data-hmglog="g1\|add\|-1">Undo 1<\/button><button type="button" class="btn sm hmdel sp" data-hmgdel="g1">Delete goal<\/button>/);
  assert.match(renderHome(d2, d3Sample(), { hmPer: 'week', hmOpen: 'personal.g:g-trip' }, NOW, home), /data-hmgstep="g-trip\|0"> Book flights<\/label><label class="hmck"><input type="checkbox" data-hmgstep="g-trip\|1" checked> Book hotel/);
  assert.match(renderHome(d2, d3Sample(), { hmPer: 'month', hmOpen: 'personal.g:g2' }, NOW, home), /<input type="number" min="0" step="any" class="hmgnum" data-hmgval="g2"/);
  // + Add goal: on the Progress bar and pinned in every card
  assert.equal((html.match(/data-hmgadd="/g) || []).length, 5);
  assert.match(html, /class="hmaddc" data-hmgadd="pnl">\+ Add goal<\/button>/);
  // the form shows only the fields its type needs
  const ui = { now: NOW, hmGoal: newGoal('personal', 'week', d2.d2.period.today) };
  const f = (more) => { Object.assign(ui.hmGoal, more); return renderHome(d2, d3Sample(), ui, NOW, home); };
  assert.match(f({}), /data-hmform="goal"[\s\S]*<label>Target<\/label>[\s\S]*<label>On days<\/label>/);
  assert.doesNotMatch(f({}), /<label>By<\/label>|<label>Steps<\/label>|<label>At<\/label>/);
  assert.match(f({ type: 'spend' }), /<label>Max \$<\/label>/);
  assert.match(f({ type: 'checklist' }), /<label>By<\/label>[\s\S]*<label>Steps<\/label>/);
  assert.doesNotMatch(f({ type: 'checklist' }), /<label>Target<\/label>/);
  assert.match(f({ type: 'habit', per: 'month' }), /<label>At<\/label>[\s\S]*<label>On days<\/label>/);
  assert.equal(goalSummary({ ...ui.hmGoal, name: 'Trip fund', sub: 'Trips', per: 'month', type: 'spend', target: '2000', days: [] }), 'Trip fund · Personal › Trips · monthly · stay under $2,000');
  // Add goal: refused without a target, then sent; the page turns to that goal's period
  const S = { d2, d3: d3Sample(), home, ui, error: '' };
  const sent = [];
  const api = async (...a) => { sent.push(a); return { ok: true }; };
  const submit = () => homeSubmit({ target: { closest: () => ({ dataset: { hmform: 'goal' }, elements: [], querySelector: () => null }) }, preventDefault() {} }, S, () => {}, api, async () => {});
  Object.assign(ui.hmGoal, { name: 'Podcast', type: 'count', per: 'month', target: '', days: [] });
  await submit();
  assert.deepEqual([ui.hmGoal.err, sent.length], ['Add a target above 0', 0]);
  ui.hmGoal.target = '4';
  await submit();
  assert.deepEqual([sent[0][0], sent[0][1], sent[0][2].name, sent[0][2].target, sent[0][2].per], ['POST', '/home/goals', 'Podcast', 4, 'month']);
  assert.deepEqual([ui.hmGoal, ui.hmPer], [null, 'month']);
  // + Log, a typed number and the two-step delete
  const el = (sel, dataset) => ({ closest: (s) => (s === sel ? { dataset, parentElement: { querySelector: () => ({ value: '250' }) } } : null), matches: () => false, dataset: {} });
  sent.length = 0;
  homeClick({ target: el('[data-hmglog]', { hmglog: 'g1|add|1' }) }, ui, () => {}, S, api, async () => {});
  homeClick({ target: el('[data-hmgset]', { hmgset: 'g2' }) }, ui, () => {}, S, api, async () => {});
  homeClick({ target: el('[data-hmgdel]', { hmgdel: 'g1' }) }, ui, () => {}, S, api, async () => {});
  assert.equal(ui.hmGDel, 'g1');
  homeClick({ target: el('[data-hmgdel]', { hmgdel: 'g1' }) }, ui, () => {}, S, api, async () => {});
  assert.deepEqual(sent, [['POST', '/home/goals/g1/log', { add: 1 }], ['POST', '/home/goals/g2/log', { value: 250 }], ['DELETE', '/home/goals/g1', undefined]]);
});

test('Progress: numbers and status from the feeds; a goal with no source reads No feed with a grey dot', () => {
  const cats = homeGoals(SAMPLE(), d3Sample());
  assert.deepEqual(cats.map((c) => c.title), ['PnL', 'Sponsors', 'Factory', 'Personal']);
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
  for (const per of ['today', 'week', 'month']) assert.deepEqual(rowsOf(cats, 'pnl', per).map((r) => r.k).slice(0, 4), ['revenue', 'bmonth', 'pmonth', 'profit'], per);
  for (const [cat, per, k] of [['personal', 'month', 'trips'], ['personal', 'month', 'groups']]) {
    const r = rowOf(cats, cat, per, k);
    assert.deepEqual([r.v, r.st, r.word, r.pct], ['No feed', 'none', 'No feed', null], k);
  }
  assert.equal(rowOf(cats, 'personal', 'month', 'networth'), undefined); // removed (handover: no net worth)
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
  const click = (sel, dataset) => homeClick({ target: { closest: (s) => (s === sel ? { dataset } : null), matches: () => false } }, ui, () => { draws += 1; });
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
  assert.equal(click('[data-hmit]', { hmit: 'x' }), false); // what saves needs the shell's state
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
  assert.match(home, /\.d3 \.card\.hmpc\{padding:16px 20px 0;height:400px;/); // room for PnL's month rows and Sponsors' money rows (2026-11-12)
  const phone = home.slice(home.indexOf('@media (max-width:600px)'));
  assert.doesNotMatch(phone, /hmwid\{[^}]*grid-template-columns|hmsecs\{[^}]*grid-template-columns/);
  assert.match(phone, /\.d3 \.hmday\.hmwk\{display:none\}\n\s*\.d3 \.hmday\.hmph\{display:block/); // three days on a phone
});

test('PnL shows revenue, expenses and profit this month; Sponsors shows money owed and deals to close (Jon, 2026-11-12)', () => {
  const d2 = SAMPLE();
  const exp = d2.d2.summary.sections.find((s) => s.key === 'expenses');
  exp.split.business = { basis: 'stages', monthFrom: null, yesterday: 10, week: 300, month: 1400 };
  const sp = d2.d2.goals.find((g) => g.key === 'sponsors');
  sp.month = [{ ...[].concat(sp.month)[0], actual: 3100, source: { ...[].concat(sp.month)[0].source, stale: false } }];
  const fx = { usdcad: 1.4, day: '2026-11-12' };
  const cats = homeGoals(d2, d3Sample(), undefined, undefined, { goals: [], logs: [], fx });
  const pr = rowOf(cats, 'pnl', 'month', 'profit');
  assert.equal(pr.v, '$2,100'); // 3,100 USD - 1,400 CAD / 1.4
  assert.deepEqual([pr.st, pr.word], ['on', 'Profit']);
  assert.match(pr.info, /1 USD = 1\.4000 CAD/);
  assert.equal(rowOf(cats, 'pnl', 'today', 'revenue').n, 'Revenue this month');
  assert.equal(rowOf(cats, 'pnl', 'today', 'bmonth').n, 'Business expenses');
  exp.split.business.month = 7000;
  assert.equal(rowOf(homeGoals(d2, d3Sample(), undefined, undefined, { goals: [], logs: [], fx }), 'pnl', 'month', 'profit').v, '−$1,900');
  assert.equal(rowOf(homeGoals(d2, d3Sample()), 'pnl', 'month', 'profit').v, 'No data', 'no rate, no sum across currencies');
  for (const per of ['today', 'week', 'month']) {
    const owed = rowOf(cats, 'sponsors', per, 'owed');
    const close = rowOf(cats, 'sponsors', per, 'close');
    assert.match(owed.v, /^\$[\d,]+$|^Not priced$/, per);
    assert.match(close.v, /^\$[\d,]+$/, per); // to close holds priced deals only (Jon, 2026-11-13)
  }
  // deals with no amount on the board: Money owed reads "Not priced", never $0; Deals to close drops them
  const sb = d2.d2.pipeline.boards.find((b) => b.goal === 'sponsors').sponsors;
  for (const c of sb.board.columns) for (const k of c.cards || []) k.amt = 0;
  sb.collect = { rows: [] };
  const np = homeGoals(d2, d3Sample());
  const close = rowOf(np, 'sponsors', 'month', 'close');
  assert.deepEqual([close.v, close.info], ['$0', 'None open']);
  const owed = rowOf(np, 'sponsors', 'month', 'owed');
  if (owed.info !== 'Nothing owed') { assert.equal(owed.v, 'Not priced'); assert.match(owed.info, /no amounts on the Sponsors board/); }
});
