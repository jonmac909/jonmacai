// Home "Today" checklist (Jon, 2026-11-16): today's own meetings, cards, what waits on him and his daily checklist, nothing from
// another day, rolling over at midnight Vancouver time. Also the Money page's expense categories (closed by default) and the
// four pages removed from the menu (Team, Blockers, Scripts, System).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { renderHome, scheduleOf, todayList, nowOf, homeClick } from '../public/d3/js/home.js';
import { expensesCard, moneyBizHtml, personalClick } from '../public/d3/js/personal.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const SAMPLE = () => JSON.parse(readFileSync(new URL('./fixtures/d2-sample.json', import.meta.url), 'utf8')); // Sunday Nov 8, 2026
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ins = (db, table, row) => {
  const keys = Object.keys(row);
  db.sqlite.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
};
const d3At = async (db, ms) => {
  const real = Date.now;
  Date.now = () => ms;
  try {
    const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(ms / 1000) + 3600)}`;
    return await (await handleApi(new Request('https://jonmac.ai/dashboard/api/d3', { headers: { Cookie: cookie } }), { DB: db, SESSION_SECRET: SECRET })).json();
  } finally { Date.now = real; }
};
// A Vancouver wall-clock time as its instant, whatever offset this Node's time-zone data gives November (as d3-home.test.mjs does).
const VAN_NOON = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', hourCycle: 'h23' }).format(new Date('2026-11-10T12:00:00Z')));
const VAN_MS = (ymd, hm) => Date.parse(`${ymd}T${hm}:00Z`) + (12 - VAN_NOON) * 3600000;
const V = (ymd, hm) => new Date(VAN_MS(ymd, hm)).toISOString();
const LATE_16 = VAN_MS('2026-11-16', '23:30'); // 11:30 pm Nov 16
const EARLY_17 = VAN_MS('2026-11-17', '00:30'); // 12:30 am Nov 17
const AGO = (ms, h) => new Date(ms - h * 3600000).toISOString();

function cardsDb(now) {
  const db = sqliteD1();
  const t = (id, title, owner, status, due, extra = {}) => ins(db, 'bot_tasks', { id, title, owner, project: 'sponsors', status, due, created_by: 'ana', updated_by: 'ana', created_at: AGO(now, 30), updated_at: AGO(now, 3), ...extra });
  t('j1', 'Sign the Acme contract', 'jon', 'todo', '2026-11-16');
  t('j2', 'Pay the lawyer', 'jon', 'doing', '2026-11-17'); // tomorrow
  t('j3', 'Renew the passport', 'jon', 'todo', '2026-11-15'); // yesterday: another day
  t('j4', 'No due date', 'jon', 'todo', null);
  t('e1', 'Elle card due today', 'elle', 'doing', '2026-11-16'); // not Jon's
  t('w1', 'Pick the thumbnail', 'elle', 'waiting_on_jon', null);
  t('w2', 'Approve the Acme brief', 'jon', 'waiting_on_jon', '2026-11-16'); // Jon's, due today and waiting: listed once
  t('d1', 'Already done', 'jon', 'done', '2026-11-16');
  ins(db, 'bot_approvals', { id: 'a1', action: 'publish_draft', title: 'Munch reply', requested_by: 'sponsors', status: 'pending', created_at: AGO(now, 4), updated_at: AGO(now, 4) });
  ins(db, 'bot_approvals', { id: 'a2', action: 'publish_draft', title: 'Old approval, already decided', requested_by: 'sponsors', status: 'approved', created_at: AGO(now, 40), updated_at: AGO(now, 4) });
  ins(db, 'bot_questions', { id: 'q1', asked_by: 'sponsors', question: 'Which rate?', status: 'open', created_at: AGO(now, 6), updated_at: AGO(now, 6) });
  return db;
}

test('server: d3.today lists Jon-owned cards due today, Waiting-on-you cards, open approvals and questions, once each', async () => {
  const body = await d3At(cardsDb(LATE_16), LATE_16);
  const T = body.d3.today;
  assert.equal(T.ymd, '2026-11-16');
  assert.deepEqual(T.due.map((c) => c.title), ['Approve the Acme brief', 'Sign the Acme contract']);
  const names = JSON.stringify(T);
  for (const out of ['Pay the lawyer', 'Renew the passport', 'No due date', 'Elle card due today', 'Already done', 'Old approval']) assert.ok(!names.includes(out), out);
  // waiting on Jon: the elle card, the open approval and the open question; the Jon card already under "due" is not repeated
  assert.deepEqual(T.needs.map((n) => [n.type, n.title]).sort(), [['approval', 'Munch reply'], ['card', 'Pick the thumbnail'], ['question', 'Which rate?']]);
  assert.ok(T.needs.every((n) => n.age));
  assert.ok(T.needs.find((n) => n.type === 'approval').review);
});

test('server: the day is Vancouver\'s; at 12:30 am the next day yesterday\'s due cards are gone', async () => {
  const late = (await d3At(cardsDb(LATE_16), LATE_16)).d3.today;
  const early = (await d3At(cardsDb(EARLY_17), EARLY_17)).d3.today;
  assert.deepEqual([late.ymd, early.ymd], ['2026-11-16', '2026-11-17']);
  assert.deepEqual(late.due.map((c) => c.id).sort(), ['j1', 'w2']);
  assert.deepEqual(early.due.map((c) => c.id), ['j2']); // only the card due Nov 17
});

test('server: cards that cannot be read give null, not an empty all-clear', async () => {
  const db = sqliteD1();
  db.sqlite.exec('DROP TABLE bot_approvals');
  const T = (await d3At(db, LATE_16)).d3.today;
  assert.equal(T, null);
});

// ---- the page ----
const NOW = VAN_MS('2026-11-08', '13:05'); // Sunday Nov 8, 1:05 pm Vancouver (the fixture's day)
const task = (id, title, extra = {}) => ({ id, title, cat: 'personal', start: 600, end: 630, rep: 'daily', days: [], day: null, from: '2026-10-26', miss: 'next', retry: null, rem: 'none', text: false, note: '', kind: '', ...extra });
const HOME = () => ({
  today: '2026-11-08', tz: 'America/Vancouver', fx: null, goals: [], logs: [], habits: [],
  tasks: [
    task('daily1', 'Stretch'),
    task('once-y', 'Call the bank', { rep: 'none', day: '2026-11-07', from: '2026-11-07' }), // yesterday, missed: carried "Late"
    task('once-t', 'File the receipts', { rep: 'none', day: '2026-11-08', from: '2026-11-08', start: 900, end: 930 }),
    task('sat', 'Saturday errand', { rep: 'weekly', days: [5], miss: 'retry', retry: 900 }),
    task('mk', 'Dentist forms', { rep: 'none', day: '2026-11-07', from: '2026-11-07', miss: 'makeup' }),
  ],
  days: [{ id: 'mk', day: '2026-11-07', done: false, doneOn: null, skip: false, moveDay: '2026-11-08', start: 1000, end: 1030 }], // moved here from yesterday
  calendar: { connected: true, canConnect: true, events: [
    { title: 'Yesterday standup', start: V('2026-11-07', '10:00'), end: V('2026-11-07', '10:30') },
    { title: 'Ines call', start: V('2026-11-08', '10:00'), end: V('2026-11-08', '11:00') },
    { title: 'Tomorrow standup', start: V('2026-11-09', '09:00'), end: V('2026-11-09', '09:30') },
  ] },
});
const d3With = (today) => ({ ok: true, asOf: new Date(NOW).toISOString(), d3: { openCards: {}, goals: {}, today } });
const TODAY = { ymd: '2026-11-08', due: [{ id: 't_0123456789abcdef', title: 'Sign the <b>contract</b>', status: 'todo', project: 'Sponsors' }], needs: [
  { id: 'a:a1', type: 'approval', title: 'Munch reply', owner: 'Florence', age: '4h', card: null, review: true, why: '' },
  { id: 't:t_fedcba9876543210', type: 'card', title: 'Pick the thumbnail', owner: 'Elle', age: '1d', card: 't_fedcba9876543210', review: false, why: '' },
] };
const cardOf = (html) => html.slice(html.indexOf('aria-label="Schedule"'), html.indexOf('<h2>Progress</h2>'));

test('page: Today shows meetings from today only, due cards, what waits on Jon, and the daily checklist; nothing from another day', () => {
  const home = HOME();
  const card = cardOf(renderHome(SAMPLE(), d3With(TODAY), {}, NOW, home));
  assert.match(card, /<h2>Today<\/h2><span class="mut">Sun 8<\/span>/);
  const at = (s) => { const i = card.indexOf(s); assert.notEqual(i, -1, s); return i; };
  assert.ok(at('>Meetings') < at('>Due today') && at('>Due today') < at('>Daily checklist') && at('>Daily checklist') < at('>Needs you')); // the long list last
  assert.match(card, /10:00–11:00 AM<\/span>.*Ines call/); // AM or PM is always said
  assert.match(card, />3:00–3:30 PM<\/button>.*File the receipts/);
  // meetings: today's only
  assert.match(card, /Ines call/);
  assert.doesNotMatch(card, /Yesterday standup|Tomorrow standup/);
  // cards due today and waiting on Jon (escaped), each with its way in
  assert.match(card, /Sign the &lt;b&gt;contract&lt;\/b&gt;/);
  assert.doesNotMatch(card, /<b>contract/);
  assert.match(card, /href="\/dashboard\/\?card=t_0123456789abcdef"/);
  assert.match(card, /Munch reply<\/span><span class="hmtag">Approval<\/span>.*href="#review" data-rvgo="a:a1">Open in Review/);
  assert.match(card, /Pick the thumbnail<\/span><span class="hmtag">Card<\/span>.*Elle · 1d/);
  // daily checklist: today's own, ticked on the spot; the carried-over, moved-in and faded rows are not there
  assert.match(card, /data-hmtick="daily1\|2026-11-08\|2026-11-08\|"/);
  assert.match(card, /File the receipts/);
  assert.doesNotMatch(card, /Call the bank|Dentist forms|Saturday errand|from Sat|from Fri|Late|Missed|Moved|make-up/);
  // the week's data is still there for the pop-up (its day list and a click on a row); only the card is limited to today
  const sch = scheduleOf(SAMPLE(), d3With(TODAY), undefined, home, nowOf(NOW));
  assert.ok(sch.days.some((d) => d.ymd !== '2026-11-08' && d.items.length));
  assert.ok(sch.days.find((d) => d.today).items.some((x) => x.w.startsWith('Call the bank')));
  const L = todayList(sch, d3With(TODAY), '2026-11-08');
  assert.deepEqual(L.routines.map((x) => x.id).sort(), ['daily1', 'once-t']);
  assert.deepEqual(L.meetings.map((x) => x.w), ['Ines call']);
});

test('page: Needs you shows the first five and Show all opens the rest', () => {
  const many = { ...TODAY, needs: Array.from({ length: 8 }, (_, i) => ({ id: `t:t_${String(i).padStart(16, '0')}`, type: 'card', title: `Waiting ${i}`, owner: 'Elle', age: '1d', card: `t_${String(i).padStart(16, '0')}`, review: false, why: '' })) };
  const ui = {};
  const short = cardOf(renderHome(SAMPLE(), d3With(many), ui, NOW, HOME()));
  assert.match(short, />Needs you <small>8<\/small>/); // the count is all of them
  assert.equal((short.match(/Waiting \d/g) || []).length, 5);
  assert.match(short, /data-hmneeds aria-expanded="false">Show all 8 ▾/);
  assert.equal(homeClick({ target: { closest: (s) => (s === '[data-hmneeds]' ? {} : null), matches: () => false } }, ui, () => {}), true);
  const all = cardOf(renderHome(SAMPLE(), d3With(many), ui, NOW, HOME()));
  assert.equal((all.match(/Waiting \d/g) || []).length, 8);
  assert.match(all, /Show fewer ▴/);
  assert.doesNotMatch(cardOf(renderHome(SAMPLE(), d3With(TODAY), {}, NOW, HOME())), /data-hmneeds/); // two rows: no button
});

test('page: empty sections say so; a missing feed says No feed, never an empty all-clear', () => {
  const home = HOME();
  home.tasks = []; home.days = []; home.calendar.events = [];
  const quiet = renderHome(SAMPLE(), d3With({ ymd: '2026-11-08', due: [], needs: [] }), {}, NOW, home);
  assert.match(quiet, /No meetings today\./);
  assert.match(quiet, /None of your cards are due today\./);
  assert.match(quiet, /Nothing is waiting on you\./);
  assert.match(quiet, /Nothing on your checklist today\./);
  const nofeed = renderHome(SAMPLE(), d3With(null), {}, NOW, home);
  assert.match(nofeed, /No feed: your cards could not be read/);
  assert.match(nofeed, /No feed: the cards, questions and approvals waiting on you could not be read/);
  assert.doesNotMatch(nofeed, /Nothing is waiting on you|None of your cards are due today/);
});

test('page: midnight rolls Today over; before the new day\'s data arrives it says so, and shows nothing from the old day', () => {
  const home = HOME();
  const nextDay = VAN_MS('2026-11-09', '00:05'); // the data in hand is Nov 8's
  const card = cardOf(renderHome(SAMPLE(), d3With(TODAY), {}, nextDay, home));
  assert.match(card, /<h2>Today<\/h2><span class="mut">Mon 9<\/span>/);
  assert.match(card, /Loading the new day/);
  assert.doesNotMatch(card, /Munch reply|Sign the|Ines call|Stretch|Due today/);
  assert.equal(nowOf(nextDay).ymd, '2026-11-09');
  assert.equal(nowOf(VAN_MS('2026-11-08', '23:59')).ymd, '2026-11-08');
  assert.equal(nowOf(VAN_MS('2026-11-09', '00:00')).ymd, '2026-11-09'); // midnight
  // the shell re-reads at once when the clock's day passes the data's day
  assert.match(read('../public/d3/js/app.js'), /ymd !== nowOf\(S\.ui\.now \?\? undefined\)\.ymd/);
});

test('page: a tick on a daily item and its pencil still work; the retired switches are gone', () => {
  const html = renderHome(SAMPLE(), d3With(TODAY), {}, NOW, HOME());
  assert.match(html, /<input type="checkbox" data-hmtick="daily1\|2026-11-08\|2026-11-08\|" aria-label="Stretch: not done">/);
  assert.match(html, /class="hmedb" data-hmit="daily1\|2026-11-08\|2026-11-08\|" aria-label="Edit Stretch"/);
  assert.doesNotMatch(html, /data-hmview|data-hmmore|hmcal|hmev/);
  assert.equal(homeClick({ target: { closest: () => null, matches: () => false } }, {}, () => {}), false);
});

// ---- Money: business expense categories load closed ----
const P = () => ({ tags: {}, money: { business: { month: 1200, categories: [{ name: 'Software', count: 2, total: 700 }, { name: 'Travel', count: 1, total: 500 }], charges: [
  { id: 'c1', cat: 'Software', amount: 400, date: '2026-11-05', what: 'Editing suite' }, { id: 'c2', cat: 'Software', amount: 300, date: '2026-11-06', what: 'Hosting' }, { id: 'c3', cat: 'Travel', amount: 500, date: '2026-11-07', what: 'Flight' }] } } });

test('Money: expense categories load closed, open on a click, and a tag filter opens the matches', () => {
  const ui = {};
  const closed = moneyBizHtml(P(), ui, '2026-11-08');
  assert.equal((closed.match(/data-psexh="business\.[A-Za-z]+" aria-expanded="false"/g) || []).length, 2);
  assert.doesNotMatch(closed, /aria-expanded="true"|class="psexr"|Editing suite|Flight/);
  assert.match(closed, /▸ Software/);
  // a click opens that one; the other stays closed; a second click closes it
  const click = (key) => personalClick({ target: { closest: (s) => (s === '[data-psexh]' ? { dataset: { psexh: key } } : null), matches: () => false } }, { ui }, () => {}, null, null, null);
  assert.equal(click('business.Software'), true);
  const one = moneyBizHtml(P(), ui, '2026-11-08');
  assert.match(one, /data-psexh="business\.Software" aria-expanded="true"/);
  assert.match(one, /data-psexh="business\.Travel" aria-expanded="false"/);
  assert.match(one, /Editing suite/);
  assert.doesNotMatch(one, /Flight/);
  click('business.Software');
  assert.doesNotMatch(moneyBizHtml(P(), ui, '2026-11-08'), /aria-expanded="true"/);
  // filtering by a tag shows the matching charges, so it opens the categories that have them
  const tagged = P(); tagged.tags = { c3: 'sus' };
  const filtered = expensesCard('business', tagged, { exF: { business: 'sus' } }, '2026-11-08');
  assert.match(filtered, /data-psexh="business\.Travel" aria-expanded="true"/);
  assert.match(filtered, /Flight/);
});

test('removed pages: not in the menu or the routes, and their data and APIs stay', async () => {
  const index = read('../public/d3/index.html');
  const app = read('../public/d3/js/app.js');
  const routes = app.slice(app.indexOf('const PAGES'), app.indexOf('const SIGNIN'));
  for (const gone of ['team', 'blockers', 'scripts', 'system']) {
    assert.ok(!index.includes(`href="#${gone}"`) && !index.includes(`data-nav="${gone}"`), `menu ${gone}`);
    assert.ok(!new RegExp(`\\b${gone}: '`).test(routes), `route ${gone}`);
  }
  assert.ok(!/from '\.\/(team|blockers|scripts|system|needs|sources)\.js'/.test(app));
  // the d3 answer still carries what those pages read
  const body = await d3At(cardsDb(LATE_16), LATE_16);
  for (const k of ['team', 'blockers', 'scripts', 'sources']) assert.ok(k in body.d3, k);
  assert.ok(body.d3.blockers.some((b) => b.you));
});
