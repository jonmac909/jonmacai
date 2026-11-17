// Cards page "Working now" block (Jon, 2026-11-17): who is active and on which card, at the top of #cards.
// Active = owns a card in Doing, or the dispatcher's live feed (fresh) shows a run going on the card. Read only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { cardsData, activeOf } from '../src/cards.js';
import { renderCards, activeBlock } from '../public/d3/js/cards.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-17T20:00:00Z');
const min = (m) => new Date(NOW - m * 60000).toISOString();
const cookie = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 10 * 365 * 86400)}`;
const withNow = async (fn) => { const real = Date.now; Date.now = () => NOW; try { return await fn(); } finally { Date.now = real; } };

let n = 0;
function card(db, o) {
  n += 1;
  const row = { id: `t_${String(n).padStart(16, '0')}`, title: `Card ${n}`, owner: 'ana', status: 'todo', note: null, created_by: 'ana', updated_by: 'ana', created_at: min(500), updated_at: min(60), done_at: null, ...o };
  const keys = Object.keys(row);
  db.sqlite.prepare(`INSERT INTO bot_tasks (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
  return row.id;
}
const live = (db, ageMin, running) => db.sqlite.prepare('INSERT INTO bot_feed_entries (id, name, bot, data, created_at) VALUES (?, ?, ?, ?, ?)')
  .run(`l${ageMin}`, 'dispatch_live', 'developer', JSON.stringify({ beat: min(ageMin), running }), min(ageMin));

function sample() {
  const db = sqliteD1();
  const ids = {};
  ids.flo = card(db, { title: 'Reply to the Acme sponsor', owner: 'sponsors', status: 'doing', updated_at: min(5) });
  ids.lucy1 = card(db, { title: 'Fix the Cards page', owner: 'developer', status: 'doing', updated_at: min(30) });
  ids.lucy2 = card(db, { title: 'Second dev card <b>x</b>', owner: 'developer', status: 'doing', updated_at: min(10) });
  ids.mk = card(db, { title: 'Marketing plan', owner: 'marketing', status: 'doing', updated_at: min(90) });
  ids.jon = card(db, { title: 'Jon picks a thumbnail', owner: 'jon', status: 'doing' });
  ids.idleTodo = card(db, { title: 'Olivia has only a to do', owner: 'video-editor', status: 'todo' });
  ids.idleRev = card(db, { title: 'Ana only has Review', owner: 'ana', status: 'review' });
  ids.qcRun = card(db, { title: 'QC card being run', owner: 'qc', status: 'qc', updated_at: min(120) });
  ids.done = card(db, { title: 'Finished', owner: 'accounting', status: 'done', done_at: min(10) });
  ids.del = card(db, { title: 'Deleted doing', owner: 'spotify', status: 'deleted' });
  return { db, ids };
}

test('active members and their cards come from Doing cards; several Doing cards are each listed; newest first', async () => {
  const { db, ids } = sample();
  const c = await cardsData({ DB: db }, NOW);
  const by = Object.fromEntries(c.active.map((m) => [m.owner, m]));
  assert.deepEqual(c.active.map((m) => m.owner), ['sponsors', 'developer', 'marketing']); // most recently active first
  assert.deepEqual(by.sponsors.names, ['Florence']);
  assert.deepEqual(by.developer.names, ['Lucy']);
  assert.deepEqual(by.marketing.names, ['Margot', 'Rhea', 'Cleo', 'Vera', 'Tess']);
  assert.deepEqual(by.developer.cards.map((x) => x.id), [ids.lucy2, ids.lucy1]);
  assert.deepEqual(by.sponsors.cards.map((x) => [x.title, x.status, x.running, x.age]), [['Reply to the Acme sponsor', 'doing', false, '5 min ago']]);
});

test('idle members, Jon, to-do/Review/done/deleted cards are not shown', async () => {
  const { db } = sample();
  const c = await cardsData({ DB: db }, NOW);
  const owners = c.active.map((m) => m.owner);
  for (const o of ['video-editor', 'ana', 'accounting', 'spotify', 'jon', 'qc']) assert.ok(!owners.includes(o), o);
  const html = renderCards(null, { ok: true, cards: c });
  const block = html.slice(html.indexOf('<section class="card ckactive"'), html.indexOf('<section class="card ckhead"'));
  assert.doesNotMatch(block, /Olivia|Ana|Spotify|Daisy|Jon picks|Finished|Deleted doing/);
});

test('a run going now (fresh dispatcher feed) makes a member active on that card, even outside Doing; listed once', async () => {
  const { db, ids } = sample();
  live(db, 2, [{ slot: 1, bot: 'qc', card: ids.qcRun, since: min(4) }, { slot: 2, bot: 'sponsors', card: ids.flo, since: min(3) }, { slot: 3, bot: 'ana', card: 't_nope', since: min(1) }]);
  const c = await cardsData({ DB: db }, NOW);
  const by = Object.fromEntries(c.active.map((m) => [m.owner, m]));
  assert.deepEqual(by.qc.names, ['Jessica', 'Nina']);
  assert.deepEqual(by.qc.cards.map((x) => [x.id, x.running, x.age]), [[ids.qcRun, true, '4 min ago']]);
  assert.equal(by.sponsors.cards.length, 1); // Doing and running: one entry
  assert.equal(by.sponsors.cards[0].running, true);
  assert.ok(!by.ana, 'a run on a card that is not open adds nothing');
  assert.match(renderCards(null, { ok: true, cards: c }), /Run going/);
});

test('a stale dispatcher feed (over 10 minutes) adds nothing', async () => {
  const { db, ids } = sample();
  live(db, 15, [{ slot: 1, bot: 'qc', card: ids.qcRun, since: min(20) }]);
  const c = await cardsData({ DB: db }, NOW);
  assert.ok(!c.active.some((m) => m.owner === 'qc'));
});

test('activeOf is pure: unknown owner (retired bot) keeps its slug, empty input gives []', () => {
  const a = activeOf([{ id: 't_1', title: 'x', owner: 'mila', status: 'doing', updated_at: min(1) }], [], [], NOW);
  assert.deepEqual(a.map((m) => [m.owner, m.names]), [['mila', []]]);
  assert.deepEqual(activeOf([], [], [], NOW), []);
  assert.deepEqual(activeOf([{ id: 't_2', title: 'y', owner: 'ana', status: 'todo' }], null, null, NOW), []);
});

test('Working now block: one row per member, each card a link that opens it like the lists do; titles escaped; above everything', async () => {
  const { db, ids } = sample();
  const c = await cardsData({ DB: db }, NOW);
  const html = renderCards(null, { ok: true, cards: c });
  const block = html.slice(html.indexOf('<section class="card ckactive"'), html.indexOf('<section class="card ckhead"'));
  assert.equal((block.match(/class="ckact"/g) || []).length, 3); // one row per member
  assert.match(block, /<b class="ckname">Florence<\/b>/);
  assert.match(block, /<b class="ckname">Lucy<\/b>/);
  assert.match(block, /<b class="ckname">Margot, Rhea, Cleo, Vera, Tess<\/b>/);
  assert.equal((block.match(/data-ck-open=/g) || []).length, 4); // 4 Doing cards of team members
  assert.match(block, new RegExp(`data-ck-open="${ids.flo}">Reply to the Acme sponsor</button>`));
  assert.match(block, /Second dev card &lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(block, /<b>x<\/b>/);
  const at = html.indexOf('ckactive');
  assert.ok(at > 0 && at < html.indexOf('ckhead') && at < html.indexOf('data-ckg=') && at < html.indexOf('<li class="ckrow'));
  // The lists below are the same as before: one row per open and done card (deleted left out).
  assert.equal((html.match(/<li class="ckrow/g) || []).length, 9);
});

test('empty state: one short line when nobody is active', async () => {
  const db = sqliteD1();
  card(db, { title: 'Only a to do', owner: 'ana', status: 'todo' });
  card(db, { title: 'Jon doing', owner: 'jon', status: 'doing' });
  const c = await cardsData({ DB: db }, NOW);
  assert.deepEqual(c.active, []);
  const html = renderCards(null, { ok: true, cards: c });
  assert.equal((html.match(/Nobody is working on a card right now\./g) || []).length, 1);
  assert.doesNotMatch(html, /class="ckact"/);
  assert.equal(activeBlock(undefined), ''); // an answer without the field shows nothing extra
});

test('signed out sees nothing: /dashboard/api/cards needs the session, so no names or titles leave', async () => {
  const { db } = sample();
  const env = { SESSION_SECRET: SECRET, DB: db };
  const call = (headers = {}) => withNow(() => handleApi(new Request('https://jonmac.ai/dashboard/api/cards', { headers }), env, {}));
  for (const h of [{}, { Cookie: `${COOKIE}=1.2` }, { Authorization: 'Bearer nope' }]) {
    const r = await call(h);
    assert.equal(r.status, 401);
    assert.doesNotMatch(await r.text(), /Florence|Lucy|Acme|active/);
  }
  const ok = await (await call({ Cookie: await cookie() })).json();
  assert.equal(ok.cards.active.length, 3);
});

test('loading and error states show no Working now block', () => {
  assert.doesNotMatch(renderCards(null, undefined), /ckactive/);
  assert.doesNotMatch(renderCards(null, { ok: false }), /ckactive/);
});
