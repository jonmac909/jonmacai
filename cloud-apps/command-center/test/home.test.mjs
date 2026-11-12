// Dashboard 3 Home's saved schedule and goals (src/home.js) against a real SQLite loaded with the migrations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeData, homeWrite } from '../src/home.js';
import { sqliteD1 } from './sqlited1.mjs';

const NOW = Date.parse('2026-11-12T18:00:00.000Z'); // Thursday Nov 12, 2026 in Vancouver
const Q = (s = '') => new URLSearchParams(s);
const setup = () => {
  const env = { DB: sqliteD1() };
  const w = (method, rest, body = {}, query = '') => homeWrite(env, method, rest, body, Q(query), NOW);
  const read = () => homeData(env, NOW);
  return { env, w, read };
};
const TASK = { title: ' Call the bank ', cat: 'pnl', day: '2026-11-13', start: 600, end: 630, rep: 'none', days: [], miss: 'next', rem: '10', text: true, note: 'ask about fees' };

test('GET /home: the seeded standing rules and Book trip, today, and a calendar that is not connected', async () => {
  const { env, read } = setup();
  const home = await read();
  assert.equal(home.today, '2026-11-12');
  assert.equal(home.tz, 'America/Vancouver');
  assert.deepEqual(home.tasks.map((t) => t.id).sort(), ['r-date', 'r-dinner', 'r-emails', 'r-garbage', 'r-lunch', 'r-lunch-wo', 'r-meals', 'r-review', 'r-workout']);
  assert.deepEqual(home.tasks.find((t) => t.id === 'r-workout'), { id: 'r-workout', title: 'Workout', cat: 'personal', start: 660, end: 720, rep: 'weekly', days: [0, 2, 4], day: null, from: '2026-11-09', miss: 'retry', retry: 900, rem: 'none', text: false, note: '', kind: 'workout' });
  assert.deepEqual(home.goals.map((g) => [g.id, g.type, g.steps.length]), [['g-trip', 'checklist', 3]]);
  assert.deepEqual(home.calendar, { connected: false, canConnect: false, at: null, events: [] });
  // connected: timed events only (an all-day one has a bare date), and the connect link needs all three secrets
  await env.DB.prepare("INSERT INTO snapshots (source, data, collected_at, received_at) VALUES ('calendar', ?, 'x', 'x')").bind(JSON.stringify({ connected: true, events: [
    { title: 'Dentist', start: '2026-11-13T17:30:00Z', end: '2026-11-13T18:15:00Z' }, { title: 'Holiday', start: '2026-11-11', end: '2026-11-12' }, { start: '2026-11-14T17:00:00Z' },
  ] })).run();
  const cal = (await homeData({ ...env, GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', SESSION_SECRET: 'c' }, NOW)).calendar;
  assert.deepEqual([cal.connected, cal.canConnect, cal.at], [true, true, 'x']);
  assert.deepEqual(cal.events, [{ title: 'Dentist', start: '2026-11-13T17:30:00Z', end: '2026-11-13T18:15:00Z' }, { title: 'Busy', start: '2026-11-14T17:00:00Z', end: '2026-11-14T17:00:00Z' }]);
});

test('Tasks: add, change every time, change or remove just one day, delete', async () => {
  const { w, read } = setup();
  // a new one-off
  const made = await w('POST', '/tasks', TASK);
  assert.equal(made.status, 200);
  const id = made.body.task.id;
  assert.deepEqual(made.body.task, { id, title: 'Call the bank', cat: 'pnl', start: 600, end: 630, rep: 'none', days: [], day: '2026-11-13', from: '2026-11-13', miss: 'next', retry: null, rem: '10', text: true, note: 'ask about fees', kind: '' });
  // what is refused
  for (const [patch, error] of [
    [{ title: '  ' }, 'Give it a name (up to 120 characters)'], [{ cat: 'x' }, 'Pick a category'], [{ end: 600 }, 'End time has to be after the start time'],
    [{ start: 9.5 }, 'End time has to be after the start time'], [{ rep: 'weekly' }, 'Pick at least one day of the week'], [{ day: '2026-13-40' }, 'Pick a day'],
    [{ miss: 'retry' }, 'The retry time has to be later than the start time'], [{ miss: 'retry', retry: 590 }, 'The retry time has to be later than the start time'],
    [{ rem: '5' }, 'Unknown reminder'], [{ rep: 'yearly' }, 'Unknown repeat'], [{ note: 'x'.repeat(1001) }, 'The note is too long (1000 characters at most)'],
  ]) assert.deepEqual(await w('POST', '/tasks', { ...TASK, ...patch }), { status: 400, body: { ok: false, error } }, JSON.stringify(patch));
  assert.equal((await read()).tasks.length, 10);
  // every time: a one-off made weekly starts today, and missing fields keep their value
  const wk = await w('PATCH', `/tasks/${id}`, { rep: 'weekly', days: [4, 1, 1], start: 615, end: 660 });
  assert.deepEqual([wk.body.task.rep, wk.body.task.days, wk.body.task.from, wk.body.task.start, wk.body.task.title, wk.body.task.rem], ['weekly', [1, 4], '2026-11-12', 615, 'Call the bank', '10']);
  assert.equal((await w('PATCH', `/tasks/${id}`, { end: 100 })).body.error, 'End time has to be after the start time');
  // just this one: the series keeps its time and days; that day moves, and a name change still applies to the task
  const once = await w('PATCH', '/tasks/r-date', { title: 'Date night', day: '2026-11-14', start: 1080, end: 1200, rep: 'daily', scope: 'once', occ: '2026-11-12' });
  assert.deepEqual([once.body.task.title, once.body.task.start, once.body.task.end, once.body.task.rep, once.body.task.days, once.body.task.from], ['Date night', 960, 1140, 'weekly', [3], '2026-11-09']);
  assert.deepEqual((await read()).days, [{ id: 'r-date', day: '2026-11-12', done: false, doneOn: null, skip: false, moveDay: '2026-11-14', start: 1080, end: 1200 }]);
  // the same day at another time is not a move
  await w('PATCH', '/tasks/r-date', { day: '2026-11-12', start: 1020, end: 1140, scope: 'once', occ: '2026-11-12' });
  assert.deepEqual((await read()).days[0], { id: 'r-date', day: '2026-11-12', done: false, doneOn: null, skip: false, moveDay: null, start: 1020, end: 1140 });
  assert.equal((await w('PATCH', '/tasks/r-date', { day: '2026-11-12', start: 1020, end: 1000, scope: 'once', occ: '2026-11-12' })).body.error, 'End time has to be after the start time');
  assert.equal((await w('PATCH', '/tasks/r-date', { day: '2026-11-12', start: 1020, end: 1140, scope: 'once' })).body.error, 'Pick a day');
  // remove one day only, then the whole task; the seeded rule stays in the table so it is never re-added
  assert.equal((await w('DELETE', '/tasks/r-garbage', {}, 'scope=once&occ=2026-11-17')).status, 200);
  assert.equal((await w('DELETE', '/tasks/r-garbage', {}, 'scope=once&occ=soon')).body.error, 'Needs the day to remove');
  let home = await read();
  assert.equal(home.tasks.some((t) => t.id === 'r-garbage'), true);
  assert.equal(home.days.find((d) => d.id === 'r-garbage').skip, true);
  assert.equal((await w('DELETE', '/tasks/r-garbage')).status, 200);
  home = await read();
  assert.equal(home.tasks.some((t) => t.id === 'r-garbage'), false);
  assert.deepEqual(await w('PATCH', '/tasks/r-garbage', { title: 'x' }), { status: 404, body: { ok: false, error: 'That task is gone' } });
  assert.equal((await w('GET', '/tasks/r-dinner')).status, 404);
  assert.equal((await w('POST', '/nothing')).status, 404);
});

test('Ticks: one day at a time; a workout or date night tick is also the habit log', async () => {
  const { env, w, read } = setup();
  const habits = async () => (await env.DB.prepare("SELECT day, kind, done FROM habits ORDER BY day, kind").all()).results.map((h) => `${h.day} ${h.kind} ${h.done}`);
  assert.equal((await w('POST', '/tasks/r-dinner/day', { day: '2026-11-13', done: true })).status, 200);
  assert.deepEqual((await read()).days, [{ id: 'r-dinner', day: '2026-11-13', done: true, doneOn: '2026-11-13', skip: false, moveDay: null, start: null, end: null }]);
  assert.deepEqual(await habits(), []); // dinner is not a habit
  await w('POST', '/tasks/r-dinner/day', { day: '2026-11-13', done: false });
  assert.deepEqual([(await read()).days[0].done, (await read()).days[0].doneOn], [false, null]);
  assert.equal((await w('POST', '/tasks/r-dinner/day', { day: '2026-11-13' })).body.error, 'Needs the day and done');
  assert.equal((await w('POST', '/tasks/r-dinner/day', { day: 'x', done: true })).status, 400);
  // Wednesday's workout ticked on Thursday (carried over): logged on the day it was done
  await w('POST', '/tasks/r-workout/day', { day: '2026-11-11', on: '2026-11-12', done: true });
  assert.deepEqual(await habits(), ['2026-11-12 workout 1']);
  let home = await read();
  assert.deepEqual(home.habits, [{ day: '2026-11-12', kind: 'workout' }]);
  assert.equal(home.days.find((d) => d.id === 'r-workout').doneOn, '2026-11-12');
  // unticked: the log goes too
  await w('POST', '/tasks/r-workout/day', { day: '2026-11-11', on: '2026-11-12', done: false });
  home = await read();
  assert.deepEqual([home.habits, home.days.find((d) => d.id === 'r-workout').done], [[], false]);
  await w('POST', '/tasks/r-date/day', { day: '2026-11-12', done: true });
  assert.deepEqual((await read()).habits, [{ day: '2026-11-12', kind: 'date_night' }]);
  // a tick keeps a "just this one" move
  await w('PATCH', '/tasks/r-review', { day: '2026-11-14', start: 600, end: 660, scope: 'once', occ: '2026-11-13' });
  await w('POST', '/tasks/r-review/day', { day: '2026-11-13', on: '2026-11-14', done: true });
  assert.deepEqual((await read()).days.find((d) => d.id === 'r-review'), { id: 'r-review', day: '2026-11-13', done: true, doneOn: '2026-11-14', skip: false, moveDay: '2026-11-14', start: 600, end: 660 });
});

test('Goals: add by type, log, and delete', async () => {
  const { w, read } = setup();
  const G = { name: ' Podcast ', cat: 'factory', sub: 'Uploads', per: 'week', type: 'count', target: 3, days: [], track: 'log' };
  for (const [patch, error] of [
    [{ name: '' }, 'Give the goal a name (up to 80 characters)'], [{ cat: 'x' }, 'Pick a category'], [{ per: 'year' }, 'Pick how often'], [{ type: 'x' }, 'Pick a type'],
    [{ target: 0 }, 'Add a target above 0'], [{ type: 'percent', target: 120 }, 'A rate goes up to 100%'], [{ type: 'checklist', steps: [' '] }, 'Add at least one step'], [{ type: 'habit' }, 'Pick at least one day'],
  ]) assert.deepEqual(await w('POST', '/goals', { ...G, ...patch }), { status: 400, body: { ok: false, error } }, JSON.stringify(patch));
  const id = async (g) => (await w('POST', '/goals', { ...G, ...g })).body.id;
  const count = await id({});
  const spend = await id({ name: 'Trip budget', type: 'spend', per: 'month', target: 2000 });
  const once = await id({ name: 'Renew passport', type: 'once', due: '2026-11-20', target: 5 });
  const list = await id({ name: 'Taxes', type: 'checklist', steps: ['Gather slips', ' File '] });
  const habit = await id({ name: 'Stretch', type: 'habit', days: [0, 2], time: 420 });
  let home = await read();
  const got = (x) => home.goals.find((g) => g.id === x);
  assert.deepEqual(got(count), { id: count, name: 'Podcast', cat: 'factory', sub: 'Uploads', per: 'week', type: 'count', target: 3, due: null, steps: [], time: null, days: [], track: 'log' });
  assert.deepEqual([got(once).due, got(once).target, got(list).steps, got(habit).days, got(habit).time], ['2026-11-20', null, ['Gather slips', 'File'], [0, 2], 420]);
  // a count adds to today's number and never goes below 0; a typed number replaces today's
  const log = (x, body) => w('POST', `/goals/${x}/log`, body);
  await log(count, { add: 1 });
  await log(count, { add: 1 });
  await log(count, { add: -5 });
  await log(count, { add: 2 });
  await log(spend, { value: 900 });
  await log(spend, { value: 950.5 });
  await log(once, { done: true });
  await log(list, { step: 1, done: true });
  await log(habit, { done: true });
  await log('g-trip', { step: 0, done: true });
  await log('g-trip', { step: 0, done: false });
  home = await read();
  const logs = (x) => home.logs.filter((l) => l.id === x).map((l) => [l.day, l.step, l.value]);
  assert.deepEqual(logs(count), [['2026-11-12', -1, 2]]);
  assert.deepEqual(logs(spend), [['2026-11-12', -1, 950.5]]);
  assert.deepEqual(logs(once), [['0000-00-00', -1, 1]]);
  assert.deepEqual(logs(list), [['0000-00-00', 1, 1]]);
  assert.deepEqual(logs(habit), [['2026-11-12', -1, 1]]);
  assert.deepEqual(logs('g-trip'), [['0000-00-00', 0, 0]]);
  for (const [x, body, error] of [[count, { add: 0 }, 'Needs a whole number to add'], [count, { add: 1.5 }, 'Needs a whole number to add'], [spend, { value: '' }, 'Needs a number, 0 or more'],
    [spend, { value: -1 }, 'Needs a number, 0 or more'], [once, {}, 'Needs done'], [list, { step: 2, done: true }, 'Needs the step and done']]) assert.equal((await log(x, body)).body.error, error);
  // deleted: gone from the page with its logs, and no longer writable
  assert.equal((await w('DELETE', `/goals/${count}`)).status, 200);
  home = await read();
  assert.deepEqual([home.goals.some((g) => g.id === count), home.logs.some((l) => l.id === count)], [false, false]);
  assert.deepEqual(await log(count, { add: 1 }), { status: 404, body: { ok: false, error: 'That goal is gone' } });
  assert.equal((await w('PATCH', `/goals/${spend}`)).status, 404);
});
