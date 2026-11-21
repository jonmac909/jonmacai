// Dashboard 3 Home (Jon, 2026-11-17): tick boxes on calendar meetings, and the sidebar's saved order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { homeData, homeWrite } from '../src/home.js';
import { signSession, COOKIE } from '../src/auth.js';
import { scheduleOf, renderHome, homeChange } from '../public/d3/js/home.js';
import { orderOf, moveTo, applyOrder, currentOrder, navDrag } from '../public/d3/js/navorder.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const NOW = Date.parse('2026-11-12T18:00:00.000Z'); // Thursday Nov 12, 2026 in Vancouver
const SECRET = 'test-session-secret-32-bytes-ok!';
const setup = () => {
  const env = { DB: sqliteD1(), SESSION_SECRET: SECRET };
  const w = (rest, body) => homeWrite(env, 'POST', rest, body, new URLSearchParams(), NOW);
  return { env, w, read: () => homeData(env, NOW) };
};
const count = async (db, t) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n;
const SAMPLE = () => JSON.parse(readFileSync(new URL('./fixtures/d2-sample.json', import.meta.url), 'utf8')); // Sunday Nov 8, 2026
const SUN = Date.parse('2026-11-08T21:05:00.000Z');
// A Vancouver wall-clock time as the ISO instant Google sends, whatever offset this Node's time-zone data gives November.
const VAN_NOON = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', hourCycle: 'h23' }).format(new Date('2026-11-10T12:00:00Z')));
const V = (ymd, hm) => new Date(Date.parse(`${ymd}T${hm}:00Z`) + (12 - VAN_NOON) * 3600000).toISOString();

// ---------- 1. meeting tick boxes ----------

test('a meeting tick saves, survives a reload, unticks, and does not tick the same meeting on another day', async () => {
  const { env, w, read } = setup();
  assert.deepEqual((await read()).meetDone, []);
  assert.deepEqual(await w('/meetings/tick', { id: 'evt_abc', day: '2026-11-12', done: true }), { status: 200, body: { ok: true } });
  assert.deepEqual((await read()).meetDone, [{ id: 'evt_abc', day: '2026-11-12' }]); // a fresh read = a reload
  await w('/meetings/tick', { id: 'evt_abc', day: '2026-11-12', done: true }); // ticking again changes nothing
  assert.equal(await count(env.DB, 'home_meeting_ticks'), 1);
  // the same event id on another day, and another event on the same day, are separate
  assert.equal((await read()).meetDone.some((m) => m.day === '2026-11-13' || m.id === 'evt_other'), false);
  await w('/meetings/tick', { id: 'evt_abc', day: '2026-11-13', done: true });
  await w('/meetings/tick', { id: 'evt_other', day: '2026-11-12', done: true });
  assert.deepEqual((await read()).meetDone.map((m) => `${m.id}|${m.day}`).sort(), ['evt_abc|2026-11-12', 'evt_abc|2026-11-13', 'evt_other|2026-11-12']);
  // untick one day only
  assert.equal((await w('/meetings/tick', { id: 'evt_abc', day: '2026-11-12', done: false })).status, 200);
  assert.deepEqual((await read()).meetDone.map((m) => `${m.id}|${m.day}`).sort(), ['evt_abc|2026-11-13', 'evt_other|2026-11-12']);
  // tick again after an untick
  await w('/meetings/tick', { id: 'evt_abc', day: '2026-11-12', done: true });
  assert.equal((await read()).meetDone.length, 3);
});

test('a meeting tick refuses a missing id, a bad day and a non-boolean, and writes nothing', async () => {
  const { env, w } = setup();
  for (const body of [{}, { id: '', day: '2026-11-12', done: true }, { id: 'x', day: '12/11', done: true }, { id: 'x', day: '2026-13-40', done: true }, { id: 'x', day: '2026-11-12', done: 'yes' }, { id: 'x'.repeat(401), day: '2026-11-12', done: true }, { id: 5, day: '2026-11-12', done: true }]) {
    assert.equal((await w('/meetings/tick', body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(await count(env.DB, 'home_meeting_ticks'), 0);
});

test('ticking a meeting touches no task, goal or other row (the table is new and additive)', async () => {
  const { env, w } = setup();
  const tables = ['home_tasks', 'home_task_days', 'home_goals', 'home_goal_logs', 'habits'];
  const before = await Promise.all(tables.map((t) => count(env.DB, t)));
  await w('/meetings/tick', { id: 'e1', day: '2026-11-12', done: true });
  await w('/meetings/tick', { id: 'e1', day: '2026-11-12', done: false });
  assert.deepEqual(await Promise.all(tables.map((t) => count(env.DB, t))), before);
});

test('Google events keep their id in /home; one without an id still reads fine', async () => {
  const { env, read } = setup();
  await env.DB.prepare("INSERT INTO snapshots (source, data, collected_at, received_at) VALUES ('calendar', ?, 'x', 'x')").bind(JSON.stringify({ connected: true, events: [
    { id: 'g1_20261113', title: 'Dentist', start: '2026-11-13T17:30:00Z', end: '2026-11-13T18:15:00Z' }, { title: 'Call', start: '2026-11-13T19:00:00Z', end: '2026-11-13T19:30:00Z' },
  ] })).run();
  const ev = (await read()).calendar.events;
  assert.equal(ev[0].id, 'g1_20261113');
  assert.equal('id' in ev[1], false);
});

test('the schedule marks a ticked meeting done on its own day only, from Google or from the feed', async () => {
  const { read } = setup();
  const home = await read();
  home.calendar = { connected: true, canConnect: true, events: [
    { id: 'a1', title: 'Dentist', start: V('2026-11-10', '09:30'), end: V('2026-11-10', '10:15') },
    { id: 'a1', title: 'Dentist', start: V('2026-11-09', '09:30'), end: V('2026-11-09', '10:15') }, // the same id on another day
    { id: 'b2', title: 'Call NY', start: V('2026-11-10', '11:00'), end: V('2026-11-10', '12:00') },
  ] };
  home.meetDone = [{ id: 'a1', day: '2026-11-10' }];
  const sch = scheduleOf(SAMPLE(), null, undefined, home, { h: 14 });
  const meets = (ymd) => sch.days.find((d) => d.ymd === ymd).items.filter((x) => x.meet).map((x) => [x.w, x.mid, x.done]);
  assert.deepEqual(meets('2026-11-10'), [['Dentist', 'a1', true], ['Call NY', 'b2', false]]);
  assert.deepEqual(meets('2026-11-09'), [['Dentist', 'a1', false]]);
  // Ana's feed has no ids: the time and title stand in, and a tick still sticks to that day
  home.calendar = { connected: false, canConnect: false, events: [] };
  const feed = scheduleOf(SAMPLE(), null, undefined, home, { h: 14 }).days.find((d) => d.today).items.find((x) => x.meet);
  assert.equal(feed.done, false);
  home.meetDone = [{ id: feed.mid, day: feed.on }];
  assert.equal(scheduleOf(SAMPLE(), null, undefined, home, { h: 14 }).days.find((d) => d.today).items.find((x) => x.meet).done, true);
});

test('the list shows a tick box left of the time on a meeting, struck through when ticked, with the Meeting tag and no pencil; the calendar shows it done too', async () => {
  const { read } = setup();
  const home = await read();
  home.calendar = { connected: true, canConnect: true, events: [{ id: 'a1', title: 'Dentist', start: V('2026-11-08', '15:00'), end: V('2026-11-08', '15:30') }] };
  const open = renderHome(SAMPLE(), null, {}, SUN, home);
  assert.match(open, /<div class="hmrow meet"(?: data-hmnow)?><input type="checkbox" data-hmmeet="m\|2026-11-08\|0" aria-label="Dentist: not done"><span class="hmtm">3:00–3:30<\/span><i class="hmcd"[^>]*><\/i><span class="hmwhat">Dentist<\/span><span class="hmtag">Meeting<\/span><\/div>/);
  assert.doesNotMatch(open, /Edit Dentist/);
  home.meetDone = [{ id: 'a1', day: '2026-11-08' }];
  const done = renderHome(SAMPLE(), null, {}, SUN, home);
  assert.match(done, /<div class="hmrow done meet"(?: data-hmnow)?><input type="checkbox" data-hmmeet="m\|2026-11-08\|0" checked aria-label="Dentist: done">/);
  assert.match(renderHome(SAMPLE(), null, { hmView: 'cal' }, SUN, home), /class="hmev sm m done"[^>]*title="3:00–3:30 Dentist"/);
  assert.match(renderHome(SAMPLE(), null, { hmView: 'cal' }, SUN, { ...home, meetDone: [] }), /class="hmev sm m"[^>]*title="3:00–3:30 Dentist"/);
});

test('clicking a meeting tick shows at once, posts id + day + done, then reloads', async () => {
  const { read } = setup();
  const home = await read();
  home.calendar = { connected: true, canConnect: true, events: [{ id: 'a1', title: 'Dentist', start: V('2026-11-08', '15:00'), end: V('2026-11-08', '15:30') }] };
  const ui = {};
  renderHome(SAMPLE(), null, ui, SUN, home);
  const S = { ui, home };
  const sent = [];
  let drew = 0;
  let reloaded = 0;
  const api = async (...a) => { sent.push(a); return { ok: true }; };
  const t = (checked) => ({ target: { closest: () => null, dataset: { hmmeet: 'm|2026-11-08|0' }, checked } });
  assert.equal(homeChange(t(true), S, () => { drew++; }, api, async () => { reloaded++; }), true);
  assert.deepEqual(sent.pop(), ['POST', '/home/meetings/tick', { id: 'a1', day: '2026-11-08', done: true }]);
  assert.deepEqual(home.meetDone, [{ id: 'a1', day: '2026-11-08' }]);
  homeChange(t(false), S, () => { drew++; }, api, async () => { reloaded++; });
  assert.deepEqual(sent.pop(), ['POST', '/home/meetings/tick', { id: 'a1', day: '2026-11-08', done: false }]);
  assert.deepEqual(home.meetDone, []);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([drew, reloaded], [2, 2]);
  // a failed save says so
  homeChange(t(true), S, () => {}, async () => ({ ok: false, error: 'answered 500' }), async () => {});
  await new Promise((r) => setImmediate(r));
  assert.match(S.error, /Could not save the tick \(answered 500\)/);
});

// ---------- 2. sidebar order ----------

const NAV = ['home', 'factory', 'track', 'review', 'hyper', 'personal', 'money', 'bluesky', 'cards', 'eos'];

test('nav order: save, read back, new and removed pages, reset', async () => {
  const { env, w, read } = setup();
  assert.equal((await read()).navOrder, null); // none saved: the built-in order
  const mine = ['money', 'home', 'cards', 'factory'];
  assert.deepEqual(await w('/nav-order', { order: mine }), { status: 200, body: { ok: true, order: mine } });
  assert.deepEqual((await read()).navOrder, mine);
  // what the menu shows: his order, then the pages he never placed in their built-in places
  assert.deepEqual(orderOf(NAV, mine), ['money', 'home', 'cards', 'factory', 'track', 'review', 'hyper', 'personal', 'bluesky', 'eos']);
  // a page removed since (unknown id) is dropped; a page added later goes last; repeats count once
  assert.deepEqual(orderOf([...NAV, 'newpage'], ['gone', 'cards', 'cards', 'home']), ['cards', 'home', 'factory', 'track', 'review', 'hyper', 'personal', 'money', 'bluesky', 'eos', 'newpage']);
  assert.deepEqual(orderOf(NAV, null), NAV);
  assert.deepEqual(orderOf(NAV, 'junk'), NAV);
  // a second save replaces the first (one row)
  await w('/nav-order', { order: NAV.slice().reverse() });
  assert.deepEqual((await read()).navOrder, NAV.slice().reverse());
  assert.equal(await count(env.DB, 'dash_settings'), 1);
  // reset
  assert.deepEqual(await w('/nav-order', { reset: true }), { status: 200, body: { ok: true, order: null } });
  assert.equal((await read()).navOrder, null);
  assert.equal(await count(env.DB, 'dash_settings'), 0);
});

test('nav order: bad input is refused and changes nothing; a damaged saved row reads as the built-in order', async () => {
  const { env, w, read } = setup();
  await w('/nav-order', { order: ['home', 'cards'] });
  for (const body of [{}, { order: 'home' }, { order: [] }, { order: [1, 2] }, { order: ['home', 'home'] }, { order: ['<b>', 'Home Page'] }, { order: null }]) {
    assert.equal((await w('/nav-order', body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual((await read()).navOrder, ['home', 'cards']);
  await env.DB.prepare("UPDATE dash_settings SET value = 'not json' WHERE key = 'nav_order'").run();
  assert.equal((await read()).navOrder, null);
  await env.DB.prepare("UPDATE dash_settings SET value = '{\"a\":1}' WHERE key = 'nav_order'").run();
  assert.equal((await read()).navOrder, null);
});

test('moveTo moves one item and leaves the list alone for a no-op or a bad index', () => {
  assert.deepEqual(moveTo(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveTo(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveTo(['a', 'b'], 1, 1), ['a', 'b']);
  assert.deepEqual(moveTo(['a', 'b'], 5, 0), ['a', 'b']);
});

// A tiny stand-in for the menu: enough DOM for applyOrder and navDrag. Each link is 40 px tall, stacked in list order.
function fakeNav(idList) {
  const listeners = {};
  const kids = [];
  const cl = () => ({ s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } });
  const nav = {
    dataset: {}, classList: cl(), kids, resetBtn: { hidden: true },
    ownerDocument: { getElementById: (id) => (id === 'navReset' ? nav.resetBtn : null) },
    querySelectorAll(sel) { return sel === 'a[data-nav]' ? kids.slice() : sel === '.navdrag' ? kids.filter((k) => k.classList.contains('navdrag')) : []; },
    appendChild(el) { const i = kids.indexOf(el); if (i >= 0) kids.splice(i, 1); kids.push(el); },
    insertBefore(el, ref) { const i = kids.indexOf(el); if (i >= 0) kids.splice(i, 1); const j = ref ? kids.indexOf(ref) : kids.length; kids.splice(j < 0 ? kids.length : j, 0, el); },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    fire(t, e) { for (const f of listeners[t] || []) f(e); },
  };
  for (const id of idList) {
    const el = { dataset: { nav: id }, badge: id === 'review' ? 'Review count 3' : null, classList: cl(), draggable: true, setPointerCapture() {}, getBoundingClientRect: () => { const i = kids.indexOf(el); return { top: i * 40, bottom: i * 40 + 40, height: 40 }; } };
    kids.push(el);
  }
  return nav;
}
const idsOf = (nav) => nav.kids.map((k) => k.dataset.nav);

test('the menu is rearranged to the saved order, a badge moves with its link, the Reset link shows only when the order differs', () => {
  const nav = fakeNav(NAV);
  assert.deepEqual(applyOrder(nav, ['money', 'review', 'home']), ['money', 'review', 'home', 'factory', 'track', 'hyper', 'personal', 'bluesky', 'cards', 'eos']);
  assert.deepEqual(idsOf(nav), ['money', 'review', 'home', 'factory', 'track', 'hyper', 'personal', 'bluesky', 'cards', 'eos']);
  assert.equal(nav.kids.find((k) => k.dataset.nav === 'review').badge, 'Review count 3'); // same element, so its badge went with it
  assert.equal(nav.resetBtn.hidden, false);
  applyOrder(nav, null);
  assert.deepEqual(idsOf(nav), NAV);
  assert.equal(nav.resetBtn.hidden, true);
  applyOrder(nav, ['nope', 'cards']); // an unknown page is ignored
  assert.deepEqual(idsOf(nav), ['cards', ...NAV.filter((x) => x !== 'cards')]);
  assert.deepEqual(currentOrder(nav), idsOf(nav));
});

test('dragging a menu item with the mouse reorders it, saves once, and the click after the drag does not open the page; a plain click does not save', () => {
  const nav = fakeNav(NAV);
  const saved = [];
  navDrag(nav, (o) => saved.push(o));
  const P = (y) => ({ pointerType: 'mouse', pointerId: 1, button: 0, clientX: 10, clientY: y, target: { closest: () => nav.kids.find((k) => k.dataset.nav === 'track') }, preventDefault() {} });
  // a plain click: press and release, no move
  nav.fire('pointerdown', P(100));
  nav.fire('pointerup', P(100));
  assert.deepEqual(saved, []);
  // drag Track (row 2, y 80-120) up above Goals (row 0, y 0-40)
  nav.fire('pointerdown', P(100));
  nav.fire('pointermove', P(50)); // past the grab distance, in Factory's lower half... then
  nav.fire('pointermove', P(45));
  nav.fire('pointermove', P(5)); // over Goals' top half: Track moves above Goals
  assert.equal(nav.classList.contains('navdragging'), true);
  nav.fire('pointerup', P(5));
  const want = idsOf(nav);
  assert.equal(want[0], 'track');
  assert.deepEqual(want.slice().sort(), NAV.slice().sort()); // nothing lost or doubled
  assert.deepEqual(saved, [want]);
  assert.equal(nav.classList.contains('navdragging'), false);
  // the click that follows the drop is swallowed
  let stopped = false;
  nav.fire('click', { preventDefault() {}, stopImmediatePropagation() { stopped = true; } });
  assert.equal(stopped, true);
});

test('a finger drags only after a hold; moving first is a scroll; a cancelled drag puts the order back; a held drag saves', async () => {
  const nav = fakeNav(NAV);
  const saved = [];
  navDrag(nav, (o) => saved.push(o));
  const P = (y) => ({ pointerType: 'touch', pointerId: 1, button: 0, clientX: 10, clientY: y, target: { closest: () => nav.kids[2] }, preventDefault() {} });
  const wait = () => new Promise((r) => setTimeout(r, 520));
  nav.fire('pointerdown', P(100));
  nav.fire('pointermove', P(130)); // wandered: scrolling, so no drag
  await wait();
  nav.fire('pointermove', P(5));
  nav.fire('pointerup', P(5));
  assert.deepEqual([idsOf(nav), saved], [NAV, []]);
  // a hold, then a drag; the browser cancels the touch: the order goes back and nothing is saved
  nav.fire('pointerdown', P(100));
  await wait();
  assert.equal(nav.classList.contains('navdragging'), true);
  nav.fire('pointermove', P(50));
  assert.notDeepEqual(idsOf(nav), NAV);
  nav.fire('pointercancel', P(50));
  assert.deepEqual([idsOf(nav), saved], [NAV, []]);
  // a hold, a drag and a drop saves
  nav.fire('pointerdown', P(100));
  await wait();
  nav.fire('pointermove', P(50));
  nav.fire('pointerup', P(50));
  assert.equal(saved.length, 1);
  assert.notDeepEqual(saved[0], NAV);
});

test('index.html keeps the links in the built-in order and has the Reset link; app.js wires the saved order', () => {
  const index = readFileSync(new URL('../public/d3/index.html', import.meta.url), 'utf8');
  const MENU = [...NAV.slice(0, 7), 'budget', 'expenses', 'pnl', ...NAV.slice(7)]; // Budget, Expenses and P&L after Money (2026-11-21)
  assert.deepEqual([...index.matchAll(/<a href="#([a-z]+)" data-nav="([a-z]+)">/g)].map((m) => m[1]), MENU);
  assert.match(index, /<\/nav>\n<button type="button" class="navreset" id="navReset" hidden>Reset menu order<\/button>/);
  const app = readFileSync(new URL('../public/d3/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /navDrag\(navEl, saveNavOrder/);
  assert.match(app, /'\/home\/nav-order'/);
});

// ---------- 3. signed out: refused, nothing changes ----------

async function go(env, path, { method = 'POST', body, jon = false, cc = true } = {}) {
  const h = new Headers({ 'Content-Type': 'application/json' });
  if (jon) h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`);
  if (cc) h.set('X-CC', '1');
  return worker.fetch(new Request(`https://jonmac.ai${path}`, { method, headers: h, body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }), env, { waitUntil() {} });
}

test('signed out, the meeting tick and the nav order are refused and nothing is stored; signed in they save', async () => {
  const env = { DB: sqliteD1(), SESSION_SECRET: SECRET };
  const tick = { id: 'e1', day: '2026-11-12', done: true };
  const order = { order: ['cards', 'home'] };
  for (const [path, body] of [['/dashboard/api/home/meetings/tick', tick], ['/dashboard/api/home/nav-order', order], ['/dashboard/api/home/nav-order', { reset: true }]]) {
    const r = await go(env, path, { body });
    assert.ok([401, 302].includes(r.status), `${path} signed out gave ${r.status}`);
    const r2 = await go(env, path, { body, cc: false });
    assert.ok([401, 302].includes(r2.status), `${path} signed out, no X-CC gave ${r2.status}`);
  }
  assert.equal(await count(env.DB, 'home_meeting_ticks'), 0);
  assert.equal(await count(env.DB, 'dash_settings'), 0);
  // signed in but without X-CC is refused too
  assert.equal((await go(env, '/dashboard/api/home/nav-order', { body: order, jon: true, cc: false })).status, 403);
  assert.equal(await count(env.DB, 'dash_settings'), 0);
  // signed in: both save, and /home reads them back
  assert.equal((await go(env, '/dashboard/api/home/meetings/tick', { body: tick, jon: true })).status, 200);
  assert.equal((await go(env, '/dashboard/api/home/nav-order', { body: order, jon: true })).status, 200);
  const home = (await (await go(env, '/dashboard/api/home', { method: 'GET', jon: true })).json()).home;
  assert.deepEqual([home.meetDone, home.navOrder], [[{ id: 'e1', day: '2026-11-12' }], ['cards', 'home']]);
  // signed out, GET /home does not hand the order out
  assert.equal([401, 302].includes((await go(env, '/dashboard/api/home', { method: 'GET' })).status), true);
});
