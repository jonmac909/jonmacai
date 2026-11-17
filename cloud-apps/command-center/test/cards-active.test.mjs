// Cards page "Working now" block (Jon, 2026-11-17): who is really working, and on which card, at the top of #cards.
// A card is listed only when the dispatcher's live feed (fresh, 10 min) shows a run on it, or its owner updated it in the last
// 60 minutes (a script's write, Jon's own action and a nudge do not count). Owning a Doing card is not enough. Read only.
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
const event = (db, id, by, kind, detail, at) => db.sqlite.prepare('INSERT INTO bot_task_events (id, task_id, at, "by", kind, detail) VALUES (?, ?, ?, ?, ?, ?)')
  .run(`e_${id}_${kind}_${at}`, id, at, by, kind, detail);
const comment = (db, id, author, body, at) => db.sqlite.prepare('INSERT INTO bot_task_comments (id, task_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)')
  .run(`c_${id}_${at}`, id, author, body, at);
const render = (c) => renderCards(null, { ok: true, cards: c });
const blockOf = (html) => html.slice(html.indexOf('<section class="card ckactive"'), html.indexOf('<section class="card ckhead"'));

function sample() {
  const db = sqliteD1();
  const ids = {};
  // 100 stale Doing cards, like the live data: untouched for hours or days, no run. None of them may show.
  for (let i = 0; i < 100; i += 1) card(db, { title: `Stale ${i}`, owner: i % 2 ? 'marketing' : 'developer', status: 'doing', updated_at: min(180 + i * 60) });
  ids.stale = card(db, { title: 'Stale doing, updated 3 h ago', owner: 'ana', status: 'doing', updated_at: min(180) });
  ids.run = card(db, { title: 'Run going <b>x</b>', owner: 'developer', status: 'doing', updated_at: min(400) });
  ids.fresh = card(db, { title: 'Updated 20 min ago', owner: 'sponsors', status: 'doing', updated_at: min(20), updated_by: 'sponsors' });
  ids.qcRun = card(db, { title: 'QC card being run', owner: 'qc', status: 'qc', updated_at: min(120) });
  ids.jon = card(db, { title: 'Jon picks a thumbnail', owner: 'jon', status: 'doing', updated_at: min(1), updated_by: 'jon' });
  ids.todo = card(db, { title: 'Only a to do, just edited', owner: 'video-editor', status: 'todo', updated_at: min(2), updated_by: 'video-editor' });
  ids.done = card(db, { title: 'Finished', owner: 'accounting', status: 'done', done_at: min(10), updated_at: min(10), updated_by: 'accounting' });
  ids.del = card(db, { title: 'Deleted doing', owner: 'spotify', status: 'deleted', updated_at: min(5), updated_by: 'spotify' });
  // Nudge-only and script writes: nothing counts.
  ids.moved = card(db, { title: 'Moved by the load balancer', owner: 'marketing', status: 'doing', updated_at: min(15), updated_by: 'developer' });
  event(db, ids.moved, 'developer', 'owner', 'owner developer → marketing', min(15));
  comment(db, ids.moved, 'developer', 'Moved from Lucy to Margot: overloaded (4 Doing).', min(14));
  ids.movedDev = card(db, { title: 'Moved to the developer bot (script writes as developer)', owner: 'developer', status: 'doing', updated_at: min(15), updated_by: 'developer' });
  event(db, ids.movedDev, 'developer', 'owner', 'owner marketing → developer', min(15));
  comment(db, ids.movedDev, 'developer', 'Moved from Margot to Lucy: overloaded (4 Doing).', min(14));
  ids.sentBack = card(db, { title: 'Jon sent it back 10 min ago', owner: 'marketing', status: 'doing', updated_at: min(10), updated_by: 'jon' });
  event(db, ids.sentBack, 'jon', 'status', 'status review → doing (sent back by Jon)', min(10));
  comment(db, ids.sentBack, 'jon', 'Redo the intro.', min(10));
  ids.nudged = card(db, { title: 'Nudged by the idle check, nothing written', owner: 'marketing', status: 'doing', updated_at: min(240), updated_by: 'marketing' });
  ids.old = card(db, { title: 'Updated 70 min ago', owner: 'sponsors', status: 'doing', updated_at: min(70), updated_by: 'sponsors' });
  // The owner's own proof / comment inside the hour counts even when the card row itself was not written.
  ids.proof = card(db, { title: 'Proof added 25 min ago', owner: 'video-editor', status: 'doing', updated_at: min(300), updated_by: 'video-editor' });
  event(db, ids.proof, 'video-editor', 'proof', 'proof added (render)', min(25));
  ids.say = card(db, { title: 'Owner commented 5 min ago', owner: 'accounting', status: 'doing', updated_at: min(300), updated_by: 'accounting' });
  comment(db, ids.say, 'accounting', 'Halfway through the March bank file.', min(5));
  return { db, ids };
}

test('stale Doing cards (updated hours ago, no run) are not listed, however many there are', async () => {
  const { db, ids } = sample();
  const c = await cardsData({ DB: db }, NOW);
  const got = new Set(c.active.map((r) => r.id));
  assert.ok(!got.has(ids.stale));
  assert.ok(!c.active.some((r) => /^Stale \d+$/.test(r.title)));
  assert.ok(!got.has(ids.old), 'updated 70 minutes ago is outside the hour');
  assert.ok(!got.has(ids.nudged), 'a nudge writes nothing to the card');
});

test('a card updated 20 min ago by its owner is listed with its age; a proof or a comment by the owner counts too', async () => {
  const { db, ids } = sample();
  const c = await cardsData({ DB: db }, NOW);
  const by = Object.fromEntries(c.active.map((r) => [r.id, r]));
  assert.deepEqual([by[ids.fresh].owner, by[ids.fresh].names, by[ids.fresh].running, by[ids.fresh].age], ['sponsors', ['Florence'], false, '20 min ago']);
  assert.equal(by[ids.proof].age, '25 min ago');
  assert.equal(by[ids.say].age, '5 min ago');
});

test('a run going now (fresh feed) is listed even on a card nobody touched for hours, and outside Doing; listed once', async () => {
  const { db, ids } = sample();
  live(db, 2, [{ slot: 1, bot: 'developer', card: ids.run, since: min(4) }, { slot: 2, bot: 'qc', card: ids.qcRun, since: min(3) },
    { slot: 3, bot: 'sponsors', card: ids.fresh, since: min(1) }, { slot: 4, bot: 'ana', card: 't_nope', since: min(1) }]);
  const c = await cardsData({ DB: db }, NOW);
  const by = Object.fromEntries(c.active.map((r) => [r.id, r]));
  assert.equal(by[ids.run].running, true);
  assert.equal(by[ids.qcRun].running, true);
  assert.deepEqual(by[ids.qcRun].names, ['Jessica', 'Nina']);
  assert.equal(by[ids.fresh].running, true); // updated and running: one row
  assert.equal(c.active.filter((r) => r.id === ids.fresh).length, 1);
  assert.ok(!c.active.some((r) => r.id === 't_nope'), 'a run on a card that is not open adds nothing');
  assert.deepEqual(c.active.slice(0, 3).map((r) => r.running), [true, true, true]); // running first
});

test('nudge-only updates do not count: a script move and its "Moved from" comment, Jon sending a card back, a wake that wrote nothing', async () => {
  const { db, ids } = sample();
  const c = await cardsData({ DB: db }, NOW);
  const got = new Set(c.active.map((r) => r.id));
  for (const k of ['moved', 'movedDev', 'sentBack', 'nudged']) assert.ok(!got.has(ids[k]), k);
});

test('only real work is listed: exactly the 20-min update, the owner proof, the owner comment (no run)', async () => {
  const { db, ids } = sample();
  const c = await cardsData({ DB: db }, NOW);
  assert.deepEqual(c.active.map((r) => r.id).sort(), [ids.fresh, ids.proof, ids.say].sort());
  assert.match(blockOf(render(c)), /<span class="mut">3<\/span>/); // header count = cards listed
});

test('a stale dispatcher feed (over 10 minutes) adds nothing', async () => {
  const { db, ids } = sample();
  live(db, 15, [{ slot: 1, bot: 'qc', card: ids.qcRun, since: min(20) }]);
  const c = await cardsData({ DB: db }, NOW);
  assert.ok(!c.active.some((r) => r.id === ids.qcRun));
});

test('Jon, to-do, done and deleted cards are never listed', async () => {
  const { db } = sample();
  const c = await cardsData({ DB: db }, NOW);
  assert.doesNotMatch(blockOf(render(c)), /Jon picks|Only a to do|Finished|Deleted doing/);
});

test('activeOf is pure: unknown owner (retired bot) keeps its slug, empty input gives []', () => {
  const a = activeOf([{ id: 't_1', title: 'x', owner: 'mila', status: 'doing', updated_at: min(1) }], [], [], NOW, new Map([['t_1', min(1)]]));
  assert.deepEqual(a.map((m) => [m.owner, m.names, m.age]), [['mila', [], '1 min ago']]);
  assert.deepEqual(activeOf([], [], [], NOW, new Map()), []);
  assert.deepEqual(activeOf([{ id: 't_2', title: 'y', owner: 'ana', status: 'doing', updated_at: min(1) }], null, null, NOW), []); // owning a Doing card is not enough
  assert.deepEqual(activeOf([{ id: 't_3', title: 'z', owner: 'ana', status: 'doing' }], [], [], NOW, new Map([['t_3', min(61)]])), []);
});

test('Working now block: one row per card with name, link and status; titles escaped; above everything', async () => {
  const { db, ids } = sample();
  live(db, 2, [{ slot: 1, bot: 'developer', card: ids.run, since: min(4) }]);
  const c = await cardsData({ DB: db }, NOW);
  const html = render(c);
  const block = blockOf(html);
  assert.equal((block.match(/class="ckact"/g) || []).length, 4); // the run, the 20-min update, the proof, the comment
  assert.match(block, /<span class="mut">4<\/span>/);
  assert.match(block, /<b class="ckname">Lucy<\/b>/);
  assert.match(block, /<b class="ckname">Florence<\/b>/);
  assert.match(block, new RegExp(`data-ck-open="${ids.fresh}">Updated 20 min ago</button>`));
  assert.match(block, /Run going &lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(block, /<b>x<\/b>/);
  assert.equal((block.match(/running now/g) || []).length, 1);
  assert.match(block, /updated 20 min ago/);
  assert.equal((block.match(/data-ck-open=/g) || []).length, 4);
  const at = html.indexOf('ckactive');
  assert.ok(at > 0 && at < html.indexOf('ckhead') && at < html.indexOf('data-ckg=') && at < html.indexOf('<li class="ckrow'));
  // The lists below are the same as before: one row per open card and per done card (deleted left out).
  assert.equal((html.match(/<li class="ckrow/g) || []).length, c.open.length + c.done.length);
});

test('empty state: one short line when nothing is really active', async () => {
  const db = sqliteD1();
  card(db, { title: 'Stale doing', owner: 'ana', status: 'doing', updated_at: min(180) });
  card(db, { title: 'Jon doing', owner: 'jon', status: 'doing', updated_at: min(1), updated_by: 'jon' });
  const c = await cardsData({ DB: db }, NOW);
  assert.deepEqual(c.active, []);
  const html = render(c);
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
