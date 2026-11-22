// OpenBot reminders on Home (card t_b57896651c1c478a): a planted OpenBot routine database -> bots/reminders_feed.py -> the
// `reminders` feed on the real API -> GET /home -> the calendar and list data and html. A weekly and a one-off reminder show,
// a routine removed from OpenBot disappears on the next sync.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { homeData, remindersOf } from '../src/home.js';
import { renderHome, scheduleOf } from '../public/d3/js/home.js';
import { reminderItems, upcomingReminders } from '../public/d3/js/sched.js';
import { sqliteD1 } from './sqlited1.mjs';

const SAMPLE = () => JSON.parse(readFileSync(new URL('./fixtures/d2-sample.json', import.meta.url), 'utf8')); // Sunday Nov 8, 2026
const SCRIPT = new URL('../bots/reminders_feed.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const NOW_ISO = '2026-11-08T21:05:00.000Z'; // Sunday Nov 8, 14:05 in Vancouver
const NOW = Date.parse(NOW_ISO);
const TOKEN = `ccb_${'d'.repeat(43)}`;
const PY = ['python', 'py'].find((c) => spawnSync(c, ['-I', '-c', 'import sqlite3'], { stdio: 'ignore' }).status === 0);

// OpenBot's own tables, with the columns the script reads.
function openbot(routines) {
  const path = join(mkdtempSync(join(tmpdir(), 'openbot-')), 'openbot.db');
  const db = new DatabaseSync(path);
  db.exec('create table projection_agent_routines (routine_id text primary key, agent_id text, name text, instruction text, active integer, timezone text);'
    + 'create table projection_routine_triggers (trigger_id text primary key, routine_id text unique, schedule_json text, next_run_at text);');
  for (const [id, name, active, tz, sched, next] of routines) {
    db.prepare('insert into projection_agent_routines values (?, ?, ?, ?, ?, ?)').run(id, 'ana', name, 'x', active, tz);
    db.prepare('insert into projection_routine_triggers values (?, ?, ?, ?)').run(`t-${id}`, id, JSON.stringify(sched), next);
  }
  return { path, db };
}
const WEEKLY = ['w1', 'Reminder: Sunday meals', 1, 'America/Vancouver', { kind: 'weekly', weekday: 0, time: '09:00' }, '2026-11-15T16:00:00.000Z'];
const ONE_OFF = ['o1', 'Reminder: Dentist forms', 1, 'America/Vancouver', { kind: 'once', date: '2026-11-10', time: '08:30' }, '2026-11-10T15:30:00.000Z'];
const TELUS = ['o2', 'Reminder: Telus bill', 1, 'America/Vancouver', { kind: 'once', date: '2027-02-22', time: '09:00' }, '2027-02-22T16:00:00.000Z'];
const NOT_ONE = ['x1', 'Daily brief page 09:00', 1, 'UTC', { kind: 'daily', time: '16:00' }, '2026-11-09T16:00:00.000Z'];

// The script's feed body for a database, as it would send it.
function feedBody(path) {
  const r = spawnSync(PY, ['-I', SCRIPT, '--print', '--db', path, '--now', NOW_ISO], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

async function dashboard() {
  const db = sqliteD1();
  await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at, revoked_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(TOKEN), 'developer', '2026-10-29T00:00:00.000Z', null).run();
  const env = { DB: db };
  const put = (body) => handleApi(new Request('https://jonmac.ai/dashboard/api/v1/feeds/reminders', { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env)
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  let n = 0;
  // each post lands a second later, so "newest wins" has an order to go by
  const post = async (body) => { const r = await put(body); assert.equal(r.status, 201, JSON.stringify(r.body)); await db.prepare('UPDATE bot_feed_entries SET created_at = ? WHERE id = ?').bind(new Date(NOW + (++n) * 1000).toISOString(), r.body.feed.id).run(); };
  return { env, db, put, post };
}

const pageOf = (home, view) => renderHome(SAMPLE(), { ok: true, asOf: NOW_ISO, d3: { openCards: {}, goals: {} } }, { hmView: view }, NOW, home);
const dayOf = (home, ymd) => scheduleOf(SAMPLE(), null, undefined, home, { h: 14 + 5 / 60 }).days.find((d) => d.ymd === ymd);

test('a weekly and a one-off reminder show in the calendar and the list; a removed routine disappears', { skip: PY ? false : 'python is not on the PATH' }, async () => {
  const { path, db } = openbot([WEEKLY, ONE_OFF, TELUS, NOT_ONE]);
  const { env, post } = await dashboard();

  // 1. nothing posted yet: Home still builds, with no reminders
  const before = await homeData(env, NOW);
  assert.equal(before.reminders, null);
  assert.doesNotMatch(pageOf(before, 'list'), /Sunday meals/);

  // 2. sync: the script reads OpenBot's tables, the feed takes it, Home reads it
  const body = feedBody(path);
  assert.deepEqual(body.reminders.map((r) => r.title), ['Dentist forms', 'Sunday meals', 'Telus bill']); // soonest first; the daily brief is not a reminder
  await post(body);
  const home = await homeData(env, NOW);
  assert.deepEqual(home.reminders.items.map((r) => [r.title, r.repeat, r.next]), [['Dentist forms', 'Once', '2026-11-10T08:30'], ['Sunday meals', 'Every Sunday', '2026-11-15T09:00'], ['Telus bill', 'Once', '2027-02-22T09:00']]);

  // 3. the calendar data: the weekly one on every Sunday of the week it is in, the one-off on its own day, each marked as a reminder
  const sunday = dayOf(home, '2026-11-08').items.find((x) => x.rem);
  assert.deepEqual([sunday.w, sunday.s, sunday.e, sunday.tag, sunday.c], ['Sunday meals', 9, 9.25, 'Reminder', 'reminder']);
  const tuesday = dayOf(home, '2026-11-10').items.find((x) => x.rem);
  assert.deepEqual([tuesday.w, tuesday.s, tuesday.tag], ['Dentist forms', 8.5, 'Reminder']);
  assert.equal(dayOf(home, '2026-11-09').items.filter((x) => x.rem).length, 0, 'no reminder on a day it does not fall on');
  assert.equal(reminderItems(home, '2026-11-15')[0].w, 'Sunday meals', 'next week too');

  // 4. the calendar view and the list view both draw them, marked
  const cal = pageOf(home, 'cal');
  assert.match(cal, /class="hmev[^"]* rem"[^>]*title="9:00–9:15 Sunday meals"/);
  assert.match(cal, /class="hmev[^"]* rem"[^>]*title="8:30–8:45 Dentist forms"/);
  assert.doesNotMatch(cal, /data-hmit="rm\|/, 'a reminder is not an editable task');
  const list = pageOf(home, 'list');
  assert.match(list, /<div class="hmrow rem"[^>]*>(?:(?!<\/div>).)*Sunday meals(?:(?!<\/div>).)*<span class="hmtag rem">Reminder<\/span>/s);
  assert.doesNotMatch(list, /data-hmtick="rm\|/);
  // a reminder far off (the Telus bill, Feb 22 2027) shows under "Reminders coming up", with the next of the others
  assert.match(list, /Reminders coming up/);
  assert.match(list, /Mon 22 Feb<\/span>[^]*?Telus bill/);
  assert.deepEqual(upcomingReminders(home, '2026-11-08T14:05').map((r) => r.title), ['Dentist forms', 'Sunday meals', 'Telus bill']);

  // 5. the weekly reminder is removed from OpenBot: gone from the calendar and the list after the next sync
  db.prepare("delete from projection_agent_routines where routine_id = 'w1'").run();
  db.prepare("delete from projection_routine_triggers where routine_id = 'w1'").run();
  await post(feedBody(path));
  const after = await homeData(env, NOW);
  assert.deepEqual(after.reminders.items.map((r) => r.title), ['Dentist forms', 'Telus bill']);
  assert.equal(dayOf(after, '2026-11-08').items.filter((x) => x.rem).length, 0);
  for (const view of ['cal', 'list']) assert.doesNotMatch(pageOf(after, view), /Sunday meals/);
  assert.match(pageOf(after, 'cal'), /Dentist forms/);

  // 6. every reminder removed (or paused): an empty list, so nothing is left on Home
  db.prepare('update projection_agent_routines set active = 0').run();
  await post(feedBody(path));
  const none = await homeData(env, NOW);
  assert.deepEqual(none.reminders.items, []);
  for (const view of ['cal', 'list']) assert.doesNotMatch(pageOf(none, view), /Dentist forms|Telus bill|Reminders coming up/);
});

test('the reminders feed takes only the whole shape and only developer or ana', async () => {
  const { put } = await dashboard();
  const good = { at: NOW_ISO, reminders: [{ id: 'a', title: 'Sunday meals', repeat: 'Every Sunday', next: '2026-11-15T09:00', times: ['2026-11-15T09:00'] }] };
  assert.equal((await put(good)).status, 201);
  for (const [patch, why] of [
    [{ reminders: 'x' }, 'a list'], [{ at: undefined }, 'a time'], [{ reminders: [{ ...good.reminders[0], times: ['tomorrow'] }] }, 'times look like 2026-11-22T09:00'],
    [{ reminders: [{ ...good.reminders[0], title: '' }] }, 'a title'], [{ reminders: [good.reminders[0], good.reminders[0]] }, 'twice'],
  ]) assert.equal((await put({ ...good, ...patch })).status, 400, why);
});

test('a damaged or missing reminders entry reads as none, never as an error', () => {
  assert.equal(remindersOf(undefined), null);
  assert.equal(remindersOf('{nope'), null);
  assert.equal(remindersOf('{"at":"x"}'), null);
  assert.deepEqual(remindersOf('{"at":"x","reminders":[{"id":"a","title":"A","times":[]},{"id":3}]}').items.map((r) => r.id), ['a']);
  assert.deepEqual(reminderItems({}, '2026-11-08'), []);
  assert.deepEqual(upcomingReminders(null, '2026-11-08T00:00'), []);
});
