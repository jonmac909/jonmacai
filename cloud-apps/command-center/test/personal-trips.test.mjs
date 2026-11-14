// Trips (Personal › Trips › a trip): edit a stop, see the stops on a calendar, and put the stops in Jon's own order
// (card t_0f52cc6c34fe4393). The order is the saved list's order: the server keeps it, nothing re-sorts it by date.
import test from 'node:test';
import assert from 'node:assert/strict';
import { personalData, personalWrite } from '../src/personal.js';
import { renderPersonal, moveStop, editStop, savePlan, dropPlan, dropWant, groupNear, plansOf } from '../public/d3/js/personal.js';
import { sqliteD1 } from './sqlited1.mjs';

const items = () => [{ k: 'Flight', cost: '', ok: false }, { k: 'Hotel', cost: '', ok: false }, { k: 'Car', cost: '', ok: false }];
const TRIPS = () => [{ name: 'Portugal', bud: 5000, stops: [
  { place: 'Lisbon', from: '2026-12-01', to: '2026-12-04', items: items() },
  { place: 'Sintra', from: '2026-12-04', to: '2026-12-05', items: items() },
  { place: 'Porto', from: '2026-12-06', to: '2026-12-09', items: items() },
] }];
const put = (env, key, body) => personalWrite(env, 'PUT', `/${key}`, { json: async () => body, headers: new Map() });
const places = (P) => P.store.trips[0].stops.map((s) => s.place);
const page = (P, ui = {}, sub = ['trips', '0']) => renderPersonal({ personal: P, home: null }, sub, ui, Date.parse('2026-11-14T18:00:00Z'));

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
  assert.match(listed, /&lt;img src=x onerror=alert\(1\)&gt;<\/label><i class="psbkok">booked<\/i>/);
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
  assert.match(cal, /data-ymd="2026-12-02">.*?<button type="button" class="psctadd" data-psaddplan="2026-12-02"/);
  const withPlan = structuredClone(T); withPlan[0].plans = { '2026-12-02': [{ img: '/dashboard/f/abc.jpg', n: 'Belém', ok: true }] };
  assert.match(page({ store: { trips: withPlan } }, { psTView: 'cal' }), /<button type="button" class="psct ok" data-psplanedit="2026-12-02.0" title="Belém · booked"><img alt="" loading="lazy" src="\/dashboard\/f\/abc.jpg"><\/button>/);
  assert.match(cal, /No dates yet<\/span><div class="pscchips"><button type="button" class="pscchip"[^>]*data-psedstop="3"/); // Faro has no dates
});

test('Trips: plans are saved per day, moved when their day changes, listed under their stop and counted in the budget', () => {
  const T = TRIPS(); T[0].bud = 5000;
  const before = page({ store: { trips: structuredClone(T) } });
  assert.equal(savePlan(T, 0, { n: '', img: '', d: '2026-12-02' }), 'Add what it is, or a photo');
  assert.equal(savePlan(T, 0, { n: 'Sintra day trip', d: '' }), 'Pick the day');
  assert.equal(savePlan(T, 0, { n: ' Sintra day trip ', d: '2026-12-02', cost: '80', link: 'getyourguide.com/x', ok: 'on' }), '');
  assert.equal(savePlan(T, 0, { n: 'Fado night', d: '2026-12-02', cost: '' }), '');
  assert.deepEqual(plansOf(T[0]).map((x) => [x.d, x.k, x.n, x.cost, x.ok, x.link]), [
    ['2026-12-02', 0, 'Sintra day trip', 80, true, 'https://getyourguide.com/x'], ['2026-12-02', 1, 'Fado night', '', false, '']]);
  // a new day moves it; the old day is dropped when empty
  assert.equal(savePlan(T, 0, { n: 'Fado night', d: '2026-12-07' }, { d: '2026-12-02', k: 1 }), '');
  assert.deepEqual(Object.keys(T[0].plans).sort(), ['2026-12-02', '2026-12-07']);
  assert.equal(savePlan(T, 0, { n: 'x', d: '2026-12-07' }, { d: '2026-12-02', k: 5 }), 'That plan changed on another screen. Close and open it again.');
  // the trip page only links to each city; the city page holds its plans
  const trip = page({ store: { trips: T } });
  assert.match(trip, /<a class="pscityl" href="#personal\/trips\/0\/0"><span>1 plan · 1 booked<\/span><b>Open Lisbon ›<\/b><\/a>/);
  assert.doesNotMatch(trip, /class="psplan/);
  const html = page({ store: { trips: T } }, {}, ['trips', '0', '0']);
  assert.match(html, /<\/span> <a href="#personal\/trips\/0">Portugal<\/a> <span>›<\/span> Lisbon<\/h1>/);
  // Lisbon (Dec 1-4) lists its four days, each with its plans as rounded squares and a + for that day
  assert.deepEqual([...html.matchAll(/<div class="pscdrow"><div class="pscdd"><small>(\w+)<\/small><b>(\d+)<\/b>/g)].map((m) => `${m[1]} ${m[2]}`), ['Tue 1', 'Wed 2', 'Thu 3', 'Fri 4']);
  assert.match(html, /<b>2<\/b><span>Dec<\/span><\/div><div class="pscdtiles"><div class="psbt"><button type="button" class="psbti ok" data-psplanedit="2026-12-02.0" title="Sintra day trip · booked"><span>S<\/span><\/button><span>Sintra day trip<\/span><\/div><button type="button" class="pscdadd" data-psaddplan="2026-12-02" data-psj="0"/);
  assert.match(html, /data-psaddplan="" data-psj="0">\+ Add plan/);
  assert.match(page({ store: { trips: T } }, {}, ['trips', '0', '2']), /data-psplanedit="2026-12-07.0" title="Fado night">/); // Porto's page
  assert.doesNotMatch(before, /\$80 of/);
  assert.match(trip, /\$80 of \$5,000 budget/); // the plan's cost is in the trip budget
  assert.ok(dropPlan(T, 0, '2026-12-07', 0));
  assert.equal(T[0].plans['2026-12-07'], undefined);
  assert.equal(dropPlan(T, 0, '2026-12-07', 0), false);
  const dlg = page({ store: { trips: T } }, { psPop: { kind: 'plan', i: 0, at: { d: '2026-12-02', k: 0 }, draft: { ...T[0].plans['2026-12-02'][0], d: '2026-12-02' } } });
  assert.match(dlg, /<b class="hmedt">Edit plan<\/b>/);
  assert.match(dlg, /name="n" autocomplete="off" value="Sintra day trip"/);
  assert.match(dlg, /name="ok" checked/);
  assert.match(dlg, /data-psplanrm>Remove/);
});

test('Trips: a city keeps a Want to do list by category; Build my days puts places near each other on the same free day', () => {
  const T = TRIPS();
  assert.equal(savePlan(T, 0, { n: 'Belém Tower', cat: 'Sights', d: '' }, null, 0), '');
  assert.equal(savePlan(T, 0, { n: 'Pastéis de Belém', cat: 'Food', d: '' }, null, 0), '');
  assert.equal(savePlan(T, 0, { n: 'Sintra', cat: 'Day trip', d: '' }, null, 0), '');
  assert.equal(savePlan(T, 0, { n: 'x', d: '' }), 'Pick the day'); // no day needs a city
  assert.deepEqual(T[0].stops[0].want.map((x) => [x.n, x.cat]), [['Belém Tower', 'Sights'], ['Pastéis de Belém', 'Food'], ['Sintra', 'Day trip']]);
  const html = page({ store: { trips: T } }, {}, ['trips', '0', '0']);
  assert.match(html, /<b>Want to do<\/b><span class="mut">3 not on a day yet<\/span><button type="button" class="btn sm" data-psbuild="0">Build my days<\/button>/);
  assert.deepEqual([...html.matchAll(/<div class="pswcat"><small>([^<]+)<\/small>/g)].map((m) => m[1]), ['Food', 'Sights', 'Day trip']);
  assert.match(html, /data-pswantedit="0.0" title="Belém Tower">/);
  // giving a want-to-do item a day moves it onto that day, keeping where it is on the map
  T[0].stops[0].want[1].lat = 38.69; T[0].stops[0].want[1].lon = -9.2;
  assert.equal(savePlan(T, 0, { n: 'Pastéis de Belém', cat: 'Food', d: '2026-12-03' }, { j: 0, w: 1 }, 0), '');
  assert.deepEqual(T[0].stops[0].want.map((x) => x.n), ['Belém Tower', 'Sintra']);
  assert.deepEqual([T[0].plans['2026-12-03'][0].n, T[0].plans['2026-12-03'][0].lat], ['Pastéis de Belém', 38.69]);
  assert.ok(dropWant(T, 0, 0, 1)); assert.equal(dropWant(T, 0, 0, 5), false);
  // the pop-up on a city page picks one of its days, or Want to do
  const dlg = page({ store: { trips: T } }, { psPop: { kind: 'plan', i: 0, j: 0, draft: { n: '', d: '' } } }, ['trips', '0', '0']);
  assert.deepEqual([...dlg.matchAll(/data-psdpick="([\d-]*)"/g)].map((m) => m[1]), ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '']);
  assert.match(dlg, /<button type="button" class="psdp want on" data-psdpick="" aria-pressed="true">/);
  assert.match(dlg, /<b>3<\/b><span>1 plan<\/span>/);
  // grouping: Belém pair together, Alfama pair together, the day trip alone, the one with no spot left over
  const at = (w, lat, lon, cat = '') => ({ w, lat, lon, cat });
  const g = groupNear([at(0, 38.6916, -9.2160), at(1, 38.6975, -9.2065), at(2, 38.7139, -9.1334), at(3, 38.7115, -9.1300), at(4, 38.8029, -9.3817, 'Day trip'), { w: 5 }], ['2026-12-01', '2026-12-02', '2026-12-03']);
  assert.deepEqual(g.days.map((x) => [x.d, [...x.ws].sort()]), [['2026-12-01', [4]], ['2026-12-02', [0, 1]], ['2026-12-03', [2, 3]]]);
  assert.deepEqual(g.left, [5]);
  assert.deepEqual(groupNear([at(0, 1, 1), at(1, 1, 1.001)], []).left, [0, 1]); // no days, nothing placed
});

test('Trips: the trip and each city say how many days, counting both ends', async () => {
  const { nDays } = await import('../public/d3/js/personal.js');
  assert.equal(nDays('2027-01-14', '2027-01-20'), 7);
  assert.equal(nDays('2027-01-14', '2027-04-17'), 94);
  assert.equal(nDays('', '2027-01-20'), 0);
  assert.equal(nDays('2027-01-20', '2027-01-14'), 0);
});

test('Trips: booking details (how you get there, accommodation, car), paperwork and the map pins', async () => {
  const { saveBk, bkSum, mapPts, MODES } = await import('../public/d3/js/personal.js');
  const T = TRIPS();
  assert.deepEqual(MODES, ['Flight', 'Train', 'Bus', 'Ferry', 'Drive']);
  // the first box switches to Train; only that mode's fields are kept; files keep their names
  assert.equal(saveBk(T, 0, 0, 0, 'Flight', { k: 'Train', det: { from: ' Lisbon ', to: 'Porto', dep: '2026-12-04T09:39', no: 'IC 521', junk: 'x' }, docs: [{ n: 'ticket.pdf', url: '/dashboard/f/a.pdf' }, { n: 'no url' }], cost: '30', ok: true }), '');
  const it = T[0].stops[0].items[0];
  assert.deepEqual([it.k, it.det, it.docs, it.cost, it.ok], ['Train', { from: 'Lisbon', to: 'Porto', dep: '2026-12-04T09:39', no: 'IC 521' }, [{ n: 'ticket.pdf', url: '/dashboard/f/a.pdf' }], 30, true]);
  assert.equal(bkSum(it), 'IC 521 · Lisbon → Porto · Dec 4 09:39');
  assert.match(saveBk(T, 0, 0, 0, 'Flight', { k: 'Bus' }), /changed on another screen/); // someone else changed it
  // the accommodation box (still called Hotel on older trips) can't become a train; its spot stays while the address does
  T[0].stops[0].items[1].det = { addr: 'Rua A 1, Lisbon', lat: 38.7, lon: -9.1 };
  assert.equal(saveBk(T, 0, 0, 1, 'Hotel', { k: 'Train', det: { name: 'Memmo', addr: 'Rua A 1, Lisbon' } }), '');
  assert.deepEqual([T[0].stops[0].items[1].k, T[0].stops[0].items[1].det.lat], ['Hotel', 38.7]);
  assert.equal(bkSum(T[0].stops[0].items[1]), 'Memmo · Rua A 1, Lisbon');
  const html = page({ store: { trips: T } }, {}, ['trips', '0', '0']);
  assert.match(html, /> Accommodation<\/label>/);
  assert.match(html, /data-psbkatt="0.0">/); // the upload icon
  assert.match(html, /data-psbkdet="0.0"><b>Lisbon → Porto<\/b><small>IC 521 · Dec 4 09:39<\/small><\/button>/);
  assert.match(html, /<div class="psbkfiles"><a class="psbkfile" href="\/dashboard\/f\/a.pdf" target="_blank" rel="noopener noreferrer" title="Open ticket.pdf"><b>PDF<\/b>ticket.pdf<\/a><\/div>/);
  assert.match(html, /data-psbkdet="0.2"><b>Rental car<\/b><small class="none">Add the rental<\/small>/);
  // travel boxes pick their mode from a dropdown on the box
  assert.match(html, /<select class="psbkmode" data-psbkk="0.0"[^>]*><option>Flight<\/option><option selected>Train<\/option>/);
  assert.match(html, /data-pscview="map" aria-pressed="false">Map/);
  assert.match(html, /<form class="psquick" data-psform="quick" data-psj="0">/);
  assert.match(page({ store: { trips: T } }, { psCView: 'map' }, ['trips', '0', '0']), /<div class="psmap" data-psmap="0.0">/);
  // pins: plans (booked or not), want-to-do places and the accommodation; the trip map pins each stop
  T[0].plans = { '2026-12-02': [{ n: 'Sintra', ok: true, lat: 38.8, lon: -9.4 }, { n: 'No spot' }] };
  T[0].stops[0].want = [{ n: 'Óbidos', lat: 39.36, lon: -9.16 }];
  assert.deepEqual(mapPts(T[0], 0).map((p) => [p.n, p.kind]), [['Sintra', 'ok'], ['Óbidos', 'want'], ['Memmo', 'hotel']]);
  T[0].stops[1].lat = 41.15; T[0].stops[1].lon = -8.6;
  assert.deepEqual(mapPts(T[0]).map((p) => [p.n, p.kind]), [['Memmo', 'hotel'], ['Sintra', 'stop']]);
  // the plan pop-up asks for what and the day; the rest waits behind More details
  const pop = page({ store: { trips: T } }, { psPop: { kind: 'plan', i: 0, j: 0, draft: { n: '', d: '' } } }, ['trips', '0', '0']);
  assert.doesNotMatch(pop, /name="cat"/); assert.match(pop, /data-psmore/);
});

test('Trips: an empty leg reads from home or the stop before; trips sit by year in Snowbird or Fall escape, and a locked one stays', async () => {
  const { legOf, bkFace, tripSlot, placeTrip } = await import('../public/d3/js/personal.js');
  const T = TRIPS();
  assert.deepEqual(legOf(T[0], 0), { from: 'Kelowna', to: 'Lisbon' });
  assert.deepEqual(legOf({ stops: [{ place: 'Porto' }, { place: 'Gran Canaria' }, { place: 'Estoril/Cascais' }] }, 2), { from: 'Gran Canaria', to: 'Estoril' });
  assert.deepEqual(bkFace({ k: 'Flight' }, { from: 'Kelowna', to: 'Lisbon' }), { top: 'Kelowna → Lisbon', sub: '', none: 'Add times and details' });
  assert.equal(bkFace({ k: 'Flight', det: { from: 'YLW', to: 'LIS' } }, { from: 'Kelowna', to: 'Lisbon' }).top, 'YLW → LIS');
  assert.match(page({ store: { trips: T } }, {}, ['trips', '0']), /data-psbkdet="0.0"><b>Kelowna → Lisbon<\/b><small class="none">Add times and details<\/small>/);
  // where a trip sits: saved, or from its first date (Jan = that winter, Aug-Oct = fall, Nov = next winter), or not placed
  assert.deepEqual(tripSlot({ stops: [{ from: '2027-01-14' }] }), { yr: 2027, sea: 'snow' });
  assert.deepEqual(tripSlot({ stops: [{ from: '2027-08-20' }] }), { yr: 2027, sea: 'fall' });
  assert.deepEqual(tripSlot({ stops: [{ from: '2027-11-20' }] }), { yr: 2028, sea: 'snow' });
  assert.deepEqual(tripSlot({ stops: [] }), { yr: null, sea: 'snow' });
  assert.deepEqual(tripSlot({ yr: 2028, sea: 'fall', stops: [{ from: '2027-01-01' }] }), { yr: 2028, sea: 'fall' });
  const L = [{ name: 'Portugal', yr: 2027, sea: 'snow', lock: true, stops: [] }, { name: 'Aegean', sea: 'snow', stops: [] }, { name: 'Paris', yr: 2027, sea: 'fall', mini: 1, stops: [] }];
  assert.equal(placeTrip(L, 0, 2028, 'snow'), false); // locked
  assert.equal(placeTrip(L, 1, 2028, 'snow'), true); assert.equal(L[1].yr, 2028);
  const html = page({ store: { trips: L } }, {}, ['trips']);
  assert.deepEqual([...html.matchAll(/<section class="pstyear"><h2>([^<]+)<\/h2>/g)].map((m) => m[1]), ['2027', '2028', '2029', 'Not placed yet']);
  assert.match(html, /data-psdrop="2027.snow">[\s\S]*?data-pstcard="0"[\s\S]*?🔒 Locked/);
  assert.match(html, /<a class="pscard pstcard locked" href="#personal\/trips\/0" draggable="false"/);
  assert.match(html, /<a class="pstmini" href="#personal\/trips\/2" draggable="true" data-pstcard="2">/);
  assert.match(html, /data-pstripnew="2027.fall.1">\+ Short trip/);
});

test('want-to-do tiles have a remove button, and the plan pop-up can move a plan to another city', async () => {
  const { savePlan } = await import('../public/d3/js/personal.js');
  const T = [{ name: 'Portugal', stops: [{ place: 'Lisbon', items: [], want: [{ n: 'braga' }] }, { place: 'Porto', items: [], want: [] }] }];
  assert.equal(savePlan(T, 0, { n: 'braga', d: '' }, { j: 0, w: 0 }, 1), '');
  assert.deepEqual(T[0].stops[0].want, []);
  assert.equal(T[0].stops[1].want[0].n, 'braga');
});
