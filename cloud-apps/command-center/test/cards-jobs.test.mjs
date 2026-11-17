// Cards page "Working now": background helper jobs (Jon, 2026-11-17: "how is no one working right now?"). The dispatcher's live feed
// (dispatch_live, posted by tools/dash_live_feed.py) carries a "jobs" list; the block shows each under its bot's name with "running Nm"
// and the card link when known. A feed older than 10 minutes shows nothing. Read only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { cardsData, jobsOf } from '../src/cards.js';
import { renderCards, activeBlock } from '../public/d3/js/cards.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-17T20:00:00Z');
const min = (m) => new Date(NOW - m * 60000).toISOString();
const TOK = `ccb_${'developer'.padEnd(43, 'x')}`;
const cookie = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 10 * 365 * 86400)}`;
const withNow = async (fn) => { const real = Date.now; Date.now = () => NOW; try { return await fn(); } finally { Date.now = real; } };

let n = 0;
function card(db, o) {
  n += 1;
  const row = { id: `t_${String(n).padStart(16, '0')}`, title: `Card ${n}`, owner: 'ana', status: 'doing', note: null, created_by: 'ana', updated_by: 'ana', created_at: min(500), updated_at: min(300), done_at: null, ...o };
  const keys = Object.keys(row);
  db.sqlite.prepare(`INSERT INTO bot_tasks (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
  return row.id;
}
const feed = (db, ageMin, data) => db.sqlite.prepare('INSERT INTO bot_feed_entries (id, name, bot, data, created_at) VALUES (?, ?, ?, ?, ?)')
  .run(`l${ageMin}${Math.random()}`, 'dispatch_live', 'developer', JSON.stringify({ at: min(ageMin), beat: min(ageMin), running: [], ...data }), min(ageMin));
const job = (o) => ({ name: 'hyper-thumbs', bot: 'ana', title: 'Hyper home: project tiles show their last thumbnail', card: '', started: min(21), updated: min(1), ...o });
const blockOf = (html) => html.slice(html.indexOf('<section class="card ckactive"'), html.indexOf('<section class="card ckhead"'));
const render = (c) => renderCards(null, { ok: true, cards: c });

test('feed parse: the Worker keeps a "jobs" list (name, bot, title, card, started, updated) and checks its shape', async () => {
  const db = sqliteD1();
  await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(TOK), 'developer', 'x').run();
  const env = { DB: db, SESSION_SECRET: SECRET };
  const put = async (body) => {
    const r = await handleApi(new Request('https://jonmac.ai/dashboard/api/v1/feeds/dispatch_live', { method: 'PUT', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
    return { status: r.status, body: await r.json() };
  };
  const base = { at: min(0) };
  const ok = await put({ ...base, jobs: [job({ card: 't_0123456789abcdef', extra1: 'x', long: 'y'.repeat(500) })] });
  assert.equal(ok.status, 201);
  const j = ok.body.feed.data.jobs[0];
  assert.deepEqual([j.name, j.bot, j.card, j.started, j.updated], ['hyper-thumbs', 'ana', 't_0123456789abcdef', min(21), min(1)]);
  assert.ok(Object.keys(j).length <= 8);
  assert.equal((await put(base)).body.feed.data.jobs.length, 0, 'a push from before this change (no jobs) is still accepted');
  assert.equal((await put({ ...base, jobs: 'x' })).status, 400);
  assert.equal((await put({ ...base, jobs: [5] })).status, 400);
  assert.equal((await put({ ...base, jobs: Array.from({ length: 31 }, () => job()) })).status, 400);
});

test('a running helper job shows under its bot with "running Nm"; Ana is the default bot', async () => {
  const db = sqliteD1();
  feed(db, 1, { jobs: [job(), job({ name: 'call-reply', title: 'Live calls: Ana must answer', started: min(2), bot: 'developer' })] });
  const c = await cardsData({ DB: db }, NOW);
  assert.deepEqual(c.jobs.map((j) => [j.name, j.owner, j.names, j.mins]), [['hyper-thumbs', 'ana', ['Ana'], 21], ['call-reply', 'developer', ['Lucy'], 2]]);
  const block = blockOf(render(c));
  assert.equal((block.match(/class="ckact ckjob"/g) || []).length, 2);
  assert.match(block, /<b class="ckname">Ana<\/b>/);
  assert.match(block, /Hyper home: project tiles show their last thumbnail/);
  assert.match(block, /running 21m/);
  assert.match(block, /running 2m/);
  assert.match(block, /<span class="mut">2<\/span>/); // header count includes the jobs
  assert.doesNotMatch(block, /Nobody is working/);
  assert.doesNotMatch(block, /data-ck-open/, 'no card named: no link');
});

test('the card link shows when the job names a known card, and not when the card is unknown', async () => {
  const db = sqliteD1();
  const id = card(db, { title: 'Hyper page <slow>' });
  const done = card(db, { title: 'Closed card', status: 'done', done_at: min(30), updated_at: min(30) });
  feed(db, 1, { jobs: [job({ card: id }), job({ name: 'b', card: 't_ffffffffffffffff' }), job({ name: 'c', card: done })] });
  const c = await cardsData({ DB: db }, NOW);
  const by = Object.fromEntries(c.jobs.map((j) => [j.name, j]));
  assert.equal(by['hyper-thumbs'].card, id);
  assert.equal(by.b.card, null);
  const block = blockOf(render(c));
  assert.match(block, new RegExp(`data-ck-open="${id}">Hyper page &lt;slow&gt;</button>`));
  assert.doesNotMatch(block, /<slow>/);
  assert.doesNotMatch(block, /t_ffffffffffffffff/);
  assert.equal((block.match(/data-ck-open=/g) || []).length, 2);
});

test('staleness: a feed older than 10 minutes shows no jobs; 9 minutes still shows them', async () => {
  const old = sqliteD1();
  feed(old, 11, { jobs: [job()] });
  const c = await cardsData({ DB: old }, NOW);
  assert.deepEqual(c.jobs, []);
  assert.match(render(c), /Nobody is working on a card right now\./);
  const fresh = sqliteD1();
  feed(fresh, 9, { jobs: [job()] });
  assert.equal((await cardsData({ DB: fresh }, NOW)).jobs.length, 1);
  const none = sqliteD1(); // no feed at all
  assert.deepEqual((await cardsData({ DB: none }, NOW)).jobs, []);
});

test('only the newest feed counts: a later push without jobs clears them (a job that ended)', async () => {
  const db = sqliteD1();
  feed(db, 4, { jobs: [job()] });
  feed(db, 1, { jobs: [] });
  assert.deepEqual((await cardsData({ DB: db }, NOW)).jobs, []);
});

test('jobsOf is pure and defensive: bad entries dropped, Jon never listed, odd bot becomes Ana, future start dropped', () => {
  assert.deepEqual(jobsOf(null, [], NOW), []);
  assert.deepEqual(jobsOf({ jobs: 'x' }, [], NOW), []);
  const out = jobsOf({ jobs: [null, 5, {}, { name: 'x', started: 'soon' }, job({ name: 'jon-job', bot: 'jon' }), job({ name: 'odd', bot: 'Not A Slug!' }),
    job({ name: 'future', started: new Date(NOW + 3600000).toISOString() }), job({ name: 'ok', started: new Date(NOW).toISOString() })] }, [], NOW);
  assert.deepEqual(out.map((j) => [j.name, j.owner, j.mins]), [['odd', 'ana', 21], ['ok', 'ana', 0]]);
});

test('a running job and a run on a card both show; nothing else on the page changes', async () => {
  const db = sqliteD1();
  const id = card(db, { title: 'Run on this', owner: 'developer', updated_at: min(400) });
  feed(db, 1, { running: [{ slot: 1, bot: 'developer', card: id, since: min(4) }], jobs: [job()] });
  const c = await cardsData({ DB: db }, NOW);
  const html = render(c);
  const block = blockOf(html);
  assert.equal((block.match(/class="ckact"/g) || []).length, 1);
  assert.equal((block.match(/class="ckact ckjob"/g) || []).length, 1);
  assert.match(block, /<span class="mut">2<\/span>/);
  assert.equal((html.match(/<section class="card ckactive"/g) || []).length, 1, 'still one block, no new section');
  assert.equal((html.match(/<li class="ckrow/g) || []).length, c.open.length + c.done.length);
});

test('activeBlock without jobs is exactly as before; an answer without the field shows nothing extra', () => {
  assert.equal(activeBlock(undefined, [job()]), '');
  assert.match(activeBlock([], undefined), /Nobody is working on a card right now\./);
  assert.match(activeBlock([], []), /Nobody is working on a card right now\./);
  assert.doesNotMatch(activeBlock([], [{ ...job(), owner: 'ana', names: ['Ana'], mins: 3 }]), /Nobody/);
});

test('signed out sees no jobs: /dashboard/api/cards needs the session', async () => {
  const db = sqliteD1();
  feed(db, 1, { jobs: [job({ title: 'Secret job title' })] });
  const env = { SESSION_SECRET: SECRET, DB: db };
  const call = (headers = {}) => withNow(() => handleApi(new Request('https://jonmac.ai/dashboard/api/cards', { headers }), env, {}));
  for (const h of [{}, { Cookie: `${COOKIE}=1.2` }, { Authorization: 'Bearer nope' }]) {
    const r = await call(h);
    assert.equal(r.status, 401);
    assert.doesNotMatch(await r.text(), /Secret job title/);
  }
  assert.equal((await (await call({ Cookie: await cookie() })).json()).cards.jobs.length, 1);
});
