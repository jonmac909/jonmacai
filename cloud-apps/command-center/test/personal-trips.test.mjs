// Trips (Personal › Trips › a trip): edit a stop, see the stops on a calendar, and put the stops in Jon's own order
// (card t_0f52cc6c34fe4393). The order is the saved list's order: the server keeps it, nothing re-sorts it by date.
import test from 'node:test';
import assert from 'node:assert/strict';
import { personalData, personalWrite } from '../src/personal.js';
import { renderPersonal, moveStop, editStop } from '../public/d3/js/personal.js';
import { sqliteD1 } from './sqlited1.mjs';

const items = () => [{ k: 'Flight', cost: '', ok: false }, { k: 'Hotel', cost: '', ok: false }, { k: 'Car', cost: '', ok: false }];
const TRIPS = () => [{ name: 'Portugal', bud: 5000, stops: [
  { place: 'Lisbon', from: '2026-12-01', to: '2026-12-04', items: items() },
  { place: 'Sintra', from: '2026-12-04', to: '2026-12-05', items: items() },
  { place: 'Porto', from: '2026-12-06', to: '2026-12-09', items: items() },
] }];
const put = (env, key, body) => personalWrite(env, 'PUT', `/${key}`, { json: async () => body, headers: new Map() });
const places = (P) => P.store.trips[0].stops.map((s) => s.place);
const page = (P, ui = {}) => renderPersonal({ personal: P, home: null }, ['trips', '0'], ui, Date.parse('2026-11-14T18:00:00Z'));

test('Trips: a reordered stop list is saved and read back in that order, not by date', async () => {
  const env = { DB: sqliteD1() };
  const T = TRIPS();
  assert.equal(await put(env, 'trips', T).then((r) => r.status), 200);
  assert.deepEqual(places(await personalData(env)), ['Lisbon', 'Sintra', 'Porto']);
  // Porto (the latest dates) to the top, Lisbon (the earliest) to the bottom
  assert.equal(moveStop(T, 0, 2, 0), true);
  assert.equal(moveStop(T, 0, 1, 2), true);
  assert.deepEqual(T[0].stops.map((s) => s.place), ['Porto', 'Sintra', 'Lisbon']);
  assert.equal((await put(env, 'trips', T)).status, 200);
  const P = await personalData(env);
  assert.deepEqual(places(P), ['Porto', 'Sintra', 'Lisbon']); // the saved order, though Lisbon's dates come first
  // the page lists the stops in that order, each with a drag handle and up/down arrows (none past the ends)
  const html = page(P);
  assert.ok(html.indexOf('<b>Porto</b>') < html.indexOf('<b>Sintra</b>') && html.indexOf('<b>Sintra</b>') < html.indexOf('<b>Lisbon</b>'));
  assert.equal((html.match(/data-psgrip="/g) || []).length, 3);
  assert.match(html, /data-psmove="0\.-1" aria-label="Move Porto up" disabled/);
  assert.match(html, /data-psmove="2\.1" aria-label="Move Lisbon down" disabled/);
  assert.doesNotMatch(html, /data-psmove="1\.(-1|1)"[^>]*disabled/);
  // moves past either end change nothing
  assert.equal(moveStop(T, 0, 0, -1), false);
  assert.equal(moveStop(T, 0, 2, 3), false);
  assert.equal(moveStop(T, 5, 0, 1), false);
});

test('Trips: editing a stop saves every field and the rest of the trip is kept', async () => {
  const env = { DB: sqliteD1() };
  const T = TRIPS();
  T[0].stops[1].ex = 1;
  await put(env, 'trips', T);
  const v = { place: ' Sintra palaces ', from: '2026-12-04', to: '2026-12-06', notes: 'Pena first, 9:30 tickets', link: 'parquesdesintra.pt/en', k0: 'Train', c0: '12', o0: 'on', k1: 'Hotel', c1: '', k2: '', c2: '40' };
  assert.equal(editStop(T, 0, 1, v), '');
  assert.equal((await put(env, 'trips', T)).status, 200);
  const P = await personalData(env);
  const s = P.store.trips[0].stops[1];
  assert.deepEqual(s, {
    place: 'Sintra palaces', from: '2026-12-04', to: '2026-12-06', notes: 'Pena first, 9:30 tickets', link: 'https://parquesdesintra.pt/en', ex: 0,
    items: [{ k: 'Train', cost: 12, ok: true }, { k: 'Hotel', cost: '', ok: false }, { k: 'Car', cost: 40, ok: false }], // a blank name keeps the old one
  });
  assert.deepEqual(places(P), ['Lisbon', 'Sintra palaces', 'Porto']); // edited in place, not moved by its new dates
  assert.equal(P.store.trips[0].name, 'Portugal');
  assert.equal(P.store.trips[0].bud, 5000);
  // the list shows the notes and the link; the edit dialog opens filled in
  assert.match(page(P), /<p>Pena first, 9:30 tickets<\/p><a href="https:\/\/parquesdesintra.pt\/en" target="_blank"/);
  const dlg = page(P, { psPop: { kind: 'stop', i: 0, j: 1 } });
  assert.match(dlg, /<b class="hmedt">Edit Sintra palaces<\/b>/);
  assert.match(dlg, /name="place" value="Sintra palaces"/);
  assert.match(dlg, /name="to" value="2026-12-06"/);
  assert.match(dlg, /<textarea name="notes"[^>]*>Pena first, 9:30 tickets<\/textarea>/);
  assert.match(dlg, /name="k0" value="Train"/);
  assert.match(dlg, /name="o0" checked/);
  assert.match(dlg, />Save<\/button>/);
  // bad input is refused and nothing changes
  assert.equal(editStop(T, 0, 1, { ...v, place: '  ' }), 'Add the place');
  assert.equal(editStop(T, 0, 1, { ...v, from: '2026-12-07', to: '2026-12-05' }), 'Leave date is before arrive date');
  assert.equal(editStop(T, 0, 9, v), 'That stop is gone. Reload the page.');
  assert.equal(T[0].stops[1].place, 'Sintra palaces');
  // a link without a web scheme can't run script
  editStop(T, 0, 1, { ...v, link: 'javascript:alert(1)' });
  assert.equal(T[0].stops[1].link, 'https://javascript:alert(1)');
  // a booking name is Jon's text now: the list prints it escaped
  editStop(T, 0, 1, { ...v, k0: '<img src=x onerror=alert(1)>' });
  const listed = page({ store: { trips: T } });
  assert.doesNotMatch(listed, /<img src=x/);
  assert.match(listed, /&lt;img src=x onerror=alert\(1\)&gt; <i>booked<\/i><\/label>/);
});

test('Trips: the calendar view puts each stop on each of its days and opens its edit on click', () => {
  const T = TRIPS();
  T[0].stops.push({ place: 'Faro', from: '', to: '', items: items() });
  const P = { store: { trips: T } };
  const list = page(P);
  assert.match(list, /data-pstview="list" aria-pressed="true">List<\/button><button type="button" data-pstview="cal" aria-pressed="false">Calendar/);
  const cal = page(P, { psTView: 'cal' });
  assert.doesNotMatch(cal, /data-psgrip/);
  // one block per month: December 2026 only, its 31 days after the Monday-first padding (Dec 1 is a Tuesday)
  assert.deepEqual([...cal.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]), ['December 2026']);
  assert.equal((cal.match(/<div class="pscday pad"><\/div>/g) || []).length, 1);
  const days = [...cal.matchAll(/<div class="pscday[^"]*" data-ymd="([\d-]+)"><small><span class="pscdw">(\w+) <\/span>(\d+)<\/small><div class="pscchips">(.*?)<\/div>/g)]
    .map((m) => [m[1], m[2], [...m[4].matchAll(/data-psedstop="(\d)"[^>]*><img[^>]*>([^<]+)</g)].map((c) => c[2])]);
  assert.equal(days.length, 31);
  assert.deepEqual(days[0], ['2026-12-01', 'Tue', ['Lisbon']]);
  assert.deepEqual(days[3], ['2026-12-04', 'Fri', ['Lisbon', 'Sintra']]);
  assert.deepEqual(days[5], ['2026-12-06', 'Sun', ['Porto']]);
  assert.deepEqual(days[8], ['2026-12-09', 'Wed', ['Porto']]);
  assert.deepEqual(days[9], ['2026-12-10', 'Thu', []]);
  assert.match(cal, /<div class="pscday out empty" data-ymd="2026-12-10">/); // after the trip: faded, no + to add
  assert.match(cal, /data-ymd="2026-12-02">.*?<label class="psctadd"[^>]*><input type="file" accept="image\/\*" hidden data-psplan="2026-12-02">/);
  const withPlan = structuredClone(T); withPlan[0].plans = { '2026-12-02': [{ img: '/dashboard/f/abc.jpg' }] };
  assert.match(page({ store: { trips: withPlan } }, { psTView: 'cal' }), /<span class="psct"><a href="\/dashboard\/f\/abc.jpg"[^>]*><img alt="" loading="lazy" src="\/dashboard\/f\/abc.jpg"><\/a><button type="button" class="psctx" data-psplandel="2026-12-02.0"/);
  assert.match(cal, /No dates yet<\/span><div class="pscchips"><button type="button" class="pscchip"[^>]*data-psedstop="3"/); // Faro has no dates
});
