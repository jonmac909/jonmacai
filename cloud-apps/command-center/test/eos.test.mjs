import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { isMoney, queueOrder } from '../src/eos.js';
import { eos, mountEos, scorecardHtml, rocksHtml, issuesHtml, meetingsHtml, queueHtml } from '../public/js/pages/eos.js';
import { sqliteD1 } from './sqlited1.mjs';

// EOS page (Jon, 2026-11-18; card t_75395eabd6774bdc): Scorecard, Rocks, Issues, Meetings and Your queue,
// all read from the dashboard's own cards, approvals and feeds. Nothing is typed into the page.

const SECRET = 'test-session-secret-32-bytes-ok!';
const BOTS = ['ana', 'developer', 'sponsors'];
const TOK = Object.fromEntries(BOTS.map((b) => [b, `ccb_${b.padEnd(43, 'x')}`]));

async function setup() {
  const db = sqliteD1();
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
async function call(env, method, path, { bot, body, jon } = {}) {
  const h = new Headers();
  if (bot) h.set('Authorization', `Bearer ${TOK[bot]}`);
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}
async function task(db, id, title, { owner = 'developer', status = 'doing', project = null, created = '2026-11-10T10:00:00Z' } = {}) {
  await db.prepare(`INSERT INTO bot_tasks (id, title, owner, status, project, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'ana', 'ana', ?, ?)`).bind(id, title, owner, status, project, created, created).run();
}

// Wednesday Nov 18 2026, 09:00 in Kelowna: this week's Monday is Nov 16.
const NOW = Date.parse('2026-11-18T17:00:00Z');
const WEEKS = Array.from({ length: 13 }, (_, i) => {
  const s = new Date(Date.parse('2026-11-16T12:00:00Z') - i * 7 * 86400000).toISOString().slice(0, 10);
  return { start: s, end: s, current: i === 0 };
});
const CARD = {
  generated: '2026-11-18T09:00:00-08:00',
  weeks: WEEKS,
  numbers: [
    { id: 'cash', name: 'Sponsor cash collected', seat: 'Sponsors', owner: 'Florence', goal: { op: '>=', value: 2500, text: '$2,500 a week' }, unit: '$',
      source: 'Hand-keyed: Sponsors money tracker card', values: [{ week: '2026-11-16', value: 2000, status: 'off', note: 'Topview' }, { week: '2026-11-09', value: 0, status: 'nodata' }] },
    { id: 'shipped', name: 'Cards shipped', seat: 'Dev', owner: 'Lucy', goal: { op: '>=', value: 10, text: '10 a week' }, unit: '',
      source: 'dash.py task history', values: [{ week: '2026-11-16', value: 12, status: 'ok' }] },
  ],
};

test('scorecard: only developer or ana post it, a bad one is refused, the page shows 13 weeks, off goal, hand-keyed and never a 0 for no data', async () => {
  const { env } = await setup();
  assert.equal((await call(env, 'GET', '/v1/eos', { jon: true })).body.scorecard, null, 'nothing posted yet');
  assert.equal((await call(env, 'PUT', '/v1/feeds/eos_scorecard', { bot: 'sponsors', body: CARD })).status, 403);
  for (const bad of [{ ...CARD, weeks: [...WEEKS, WEEKS[0]] }, { ...CARD, weeks: [{ start: 'monday' }] },
    { ...CARD, numbers: [{ ...CARD.numbers[0], owner: '' }] }, { ...CARD, numbers: [{ ...CARD.numbers[0], goal: {} }] },
    { ...CARD, numbers: [{ ...CARD.numbers[0], values: [{ week: '2026-11-16', value: 'x', status: 'ok' }] }] },
    { ...CARD, numbers: [{ ...CARD.numbers[0], values: [{ week: '2026-11-16', value: 1, status: 'great' }] }] }]) {
    assert.equal((await call(env, 'PUT', '/v1/feeds/eos_scorecard', { bot: 'developer', body: bad })).status, 400);
  }
  assert.equal((await call(env, 'PUT', '/v1/feeds/eos_scorecard', { bot: 'developer', body: CARD })).status, 201);
  const got = (await call(env, 'GET', '/v1/eos', { jon: true })).body;
  assert.equal(got.scorecard.weeks.length, 13);
  assert.equal(got.scorecard.numbers[0].handKeyed, true, 'source says Hand-keyed');
  assert.equal(got.scorecard.numbers[1].handKeyed, false);
  const html = scorecardHtml(got.scorecard, NOW);
  assert.equal((html.match(/<th class="eoswk/g) || []).length, 13, '13 weekly columns');
  assert.match(html, /<th class="eoswk cur">Nov 16</, 'this Vancouver week is the current column');

  assert.match(html, /Sponsor cash collected[\s\S]*Florence[\s\S]*\$2,500 a week/);
  assert.match(html, /class="eosv off"[^>]*>\$2,000/, 'off goal is marked');
  assert.match(html, /class="eosv ok"[^>]*>12</);
  assert.match(html, /hand-keyed/);
  assert.doesNotMatch(html.split('Cards shipped')[0], />\$0</, 'a nodata week never shows 0');
  assert.equal((html.match(/no data yet/g) || []).length, 13 * 2 - 2, 'every week without a value says no data yet');
  assert.match(scorecardHtml(null), /no data yet/);
});

test('rocks: every card titled "Rock Q4: ..." with owner, status and proof; deleted cards are left out', async () => {
  const { db, env } = await setup();
  await task(db, 't_r1', 'Rock Q4: EOS dashboard page', { owner: 'developer' });
  await task(db, 't_r2', 'Rock Q4: $10k sponsor month', { owner: 'sponsors', status: 'review' });
  await task(db, 't_r3', 'Rock Q4: old', { status: 'deleted' });
  await task(db, 't_x', 'Fix upload');
  await db.prepare(`INSERT INTO bot_proofs (id, task_id, kind, link, status, created_by, created_at) VALUES ('p1', 't_r2', 'link', 'https://jonmac.ai/x', 'passed', 'sponsors', '2026-11-11T00:00:00Z')`).run();
  const got = (await call(env, 'GET', '/v1/eos', { bot: 'ana' })).body;
  assert.deepEqual(got.rocks.map((r) => r.id).sort(), ['t_r1', 't_r2']);
  const html = rocksHtml(got.rocks);
  assert.match(html, /\$10k sponsor month[\s\S]*sponsors[\s\S]*In review[\s\S]*href="https:\/\/jonmac\.ai\/x"/);
  assert.match(html, /EOS dashboard page[\s\S]*No proof yet/);
  assert.match(rocksHtml([]), /No Rock cards yet/);
});

test('issues: cards titled "Issue: ..." only, open ones first', async () => {
  const { db, env } = await setup();
  await task(db, 't_i1', 'Issue: drafts sit unsent', { status: 'done', created: '2026-11-01T00:00:00Z' });
  await task(db, 't_i2', 'Issue: <b>late</b> cards', { status: 'todo' });
  await task(db, 't_r1', 'Rock Q4: EOS dashboard page');
  const got = (await call(env, 'GET', '/v1/eos', { jon: true })).body;
  assert.deepEqual(got.issues.map((r) => r.id), ['t_i2', 't_i1']);
  const html = issuesHtml(got.issues);
  assert.match(html, /&lt;b&gt;late&lt;\/b&gt; cards/, 'titles are escaped');
  assert.match(issuesHtml([]), /No Issue cards yet/);
});

test('meetings: ana posts Monday summaries with Jon\'s rating; none says when the first one is', async () => {
  const { env } = await setup();
  let got = (await call(env, 'GET', '/v1/eos', { jon: true })).body;
  assert.deepEqual(got.meetings, []);
  assert.match(meetingsHtml(got.meetings), /no data yet, first meeting Monday 08:00/);
  assert.equal((await call(env, 'PUT', '/v1/feeds/eos_meeting', { bot: 'developer', body: { date: '2026-11-23', summary: 'x' } })).status, 403);
  assert.equal((await call(env, 'PUT', '/v1/feeds/eos_meeting', { bot: 'ana', body: { date: '2026-11-24', summary: 'x' } })).status, 400, 'a meeting is on a Monday');
  assert.equal((await call(env, 'PUT', '/v1/feeds/eos_meeting', { bot: 'ana', body: { date: '2026-11-23', summary: 'x', rating: 11 } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/feeds/eos_meeting', { bot: 'ana', body: { date: '2026-11-23', summary: 'first draft' } })).status, 201);
  assert.equal((await call(env, 'PUT', '/v1/feeds/eos_meeting', { bot: 'ana', body: { date: '2026-11-23', summary: 'Rocks on track; 2 issues solved', rating: 8 } })).status, 201);
  assert.equal((await call(env, 'PUT', '/v1/feeds/eos_meeting', { bot: 'ana', body: { date: '2026-11-30', summary: 'Second' } })).status, 201);
  got = (await call(env, 'GET', '/v1/eos', { jon: true })).body;
  assert.deepEqual(got.meetings.map((m) => [m.date, m.rating ?? null]), [['2026-11-30', null], ['2026-11-23', 8]], 'newest per Monday, newest first');
  const html = meetingsHtml(got.meetings);
  assert.match(html, /Rocks on track[\s\S]*8 \/ 10/);
  assert.match(html, /Second[\s\S]*Not rated yet/);
});

test('your queue: pending approvals, open questions and cards waiting on Jon; money first, then oldest first', async () => {
  const { db, env } = await setup();
  const appr = (id, title, created, project = null, action = 'email', by = 'ana') => db.prepare(`INSERT INTO bot_approvals (id, action, title, payload, project, requested_by, status, created_at, updated_at)
    VALUES (?, ?, ?, '{}', ?, ?, 'pending', ?, ?)`).bind(id, action, title, project, by, created, created).run();
  await appr('a_old', 'Post reel 5', '2026-11-01T00:00:00Z', null, 'post');
  await appr('a_inv', 'Send Topview invoice', '2026-11-12T00:00:00Z', 'sponsors', 'email', 'sponsors');
  await appr('a_pay', 'Pay the HeyGen bill', '2026-11-10T00:00:00Z');
  await db.prepare(`INSERT INTO bot_approvals (id, action, title, payload, requested_by, status, created_at, updated_at) VALUES ('a_done', 'email', 'Old', '{}', 'ana', 'approved', '2026-10-01', '2026-10-01')`).run();
  await db.prepare(`INSERT INTO bot_questions (id, asked_by, question, options, status, created_at, updated_at) VALUES ('q1', 'ana', 'Which reel music?', '[]', 'open', '2026-11-05T00:00:00Z', '2026-11-05T00:00:00Z')`).run();
  await task(db, 't_w', 'Sign the Arcads contract', { status: 'waiting_on_jon', created: '2026-11-03T00:00:00Z' });
  const got = (await call(env, 'GET', '/v1/eos', { jon: true })).body;
  // a sponsor contract is sponsor money, so it is first (oldest money item)
  assert.deepEqual(got.queue.map((i) => i.id), ['t_w', 'a_pay', 'a_inv', 'a_old', 'q1']);
  assert.deepEqual(got.queue.map((i) => i.money), [true, true, true, false, false]);
  // the pure order on its own: money first by age, then the rest by age
  assert.deepEqual(queueOrder([{ id: 'b', money: false, createdAt: '2026-01-01' }, { id: 'c', money: true, createdAt: '2026-03-01' }, { id: 'a', money: true, createdAt: '2026-02-01' }]).map((i) => i.id), ['a', 'c', 'b']);
  const html = queueHtml(got.queue);
  assert.match(html, /Pay the HeyGen bill[\s\S]*Send Topview invoice[\s\S]*Post reel 5/);
  assert.match(html, /Money/);
  assert.match(queueHtml([]), /Nothing waiting on you/);
});

test('EOS page: tabs switch by hash, the mount paints the chosen tab, and nav lists it', async (t) => {
  const shell = eos(null, null, 'rocks');
  for (const t of ['Scorecard', 'Rocks', 'Issues', 'Meetings', 'Your queue']) assert.match(shell, new RegExp(`data-page="eos/[a-z]+"[^>]*>${t}<`));
  assert.match(shell, /class="chip on" data-page="eos\/rocks"/);
  assert.match(eos(null, null, 'nope'), /class="chip on" data-page="eos\/scorecard"/);
  const box = { innerHTML: '' };
  let alive = true;
  const el = { dataset: { tab: 'queue' }, get isConnected() { return alive; }, querySelector: () => box };
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, scorecard: null, rocks: [], issues: [], meetings: [], queue: [{ id: 'a1', kind: 'approval', title: 'Send invoice', money: true, createdAt: '2026-11-01T00:00:00Z' }] }) });
  mountEos(el);
  await new Promise((r) => setTimeout(r, 30));
  assert.match(box.innerHTML, /Send invoice/);
  alive = false;
  const { env } = await setup();
  const snap = (await call(env, 'GET', '/snapshot', { jon: true })).body;
  assert.ok(snap.nav.groups.some((g) => g.items.some((i) => i.id === 'eos')));
  assert.equal((await call(env, 'GET', '/v1/eos')).status, 401);
});

// ---- Review fixes (planted: each one failed on the first version) ----

test('money: word matches only, sponsor deal words and Sponsors items count', () => {
  for (const t of ['MoneyClaw deploy fix', 'Wire up the Track page', 'Paid promotion box left blank', 'No paid generators in the clip maker', 'Cashflow chart colours', 'Fix the HeyGen rate limit retry']) {
    assert.equal(isMoney(t, null, 'developer'), false, `not money: ${t}`);
  }
  for (const t of ['Approve Topview deal terms', 'Sign the Arcads contract', 'Topview counter-offer 1500 USD', 'Send Topview invoice', 'Pay the HeyGen bill', 'Wire transfer from Arcads', 'GST filing', '$500 refund']) {
    assert.equal(isMoney(t, null, 'ana'), true, `money: ${t}`);
  }
  assert.equal(isMoney('Pick a thumbnail', null, 'sponsors'), true, 'anything the Sponsors bot asks or owns is sponsor money');
  assert.equal(isMoney('Pick a thumbnail', 'accounting', 'ana'), true);
});

test('your queue: same filters as Needs you (hidden questions, deleted cards, Not now put-offs)', async () => {
  const { db, env } = await setup();
  const at = '2026-11-10T00:00:00Z';
  await task(db, 't_del', 'Old sponsor card', { status: 'deleted' });
  await task(db, 't_ok', 'Live card');
  await task(db, 't_wait', 'Pick the reel hook', { status: 'waiting_on_jon' });
  await task(db, 't_later', 'Pick the reel music', { status: 'waiting_on_jon' });
  const appr = (id, taskId) => db.prepare(`INSERT INTO bot_approvals (id, action, title, payload, requested_by, task_id, status, created_at, updated_at)
    VALUES (?, 'email', ?, '{}', 'ana', ?, 'pending', ?, ?)`).bind(id, `Approval ${id}`, taskId, at, at).run();
  const ask = (id, key, taskId = null) => db.prepare(`INSERT INTO bot_questions (id, asked_by, question, options, status, idem_key, task_id, created_at, updated_at)
    VALUES (?, 'ana', ?, '[]', 'open', ?, ?, ?, ?)`).bind(id, `Question ${id}`, key, taskId, at, at).run();
  await appr('a_keep', 't_ok');
  await appr('a_gone', 't_del');
  await appr('a_later', null);
  await ask('q_keep', null, 't_ok');
  await ask('q_guard', 'team-guard:dispatcher');
  await ask('q_cw', 'cw:heygen-2026-11');
  await ask('q_gone', null, 't_del');
  await ask('q_old_later', null);
  const later = (item, until) => db.prepare(`INSERT INTO needs_later (item, until, "by", at) VALUES (?, ?, 'jon', ?)`).bind(item, until, at).run();
  const soon = new Date(Date.now() + 3600000).toISOString();
  await later('a_later', soon);
  await later('t_later', soon);
  await later('q_old_later', '2026-11-01T00:00:00Z'); // its 24 hours are up: back on the list
  const ids = (await call(env, 'GET', '/v1/eos', { jon: true })).body.queue.map((i) => i.id).sort();
  assert.deepEqual(ids, ['a_keep', 'q_keep', 'q_old_later', 't_wait']);
});

test('your queue: "since" is the Kelowna day, so a 23:00 item shows that day', () => {
  const html = queueHtml([{ id: 'a1', kind: 'approval', title: 'Late night ask', money: false, createdAt: '2026-08-11T06:00:00Z' }]); // Aug 10 23:00 in Kelowna
  assert.match(html, /since Aug 10</);
  assert.match(queueHtml([{ id: 't1', kind: 'card', title: 'x', money: false, createdAt: '2026-11-10T18:00:00Z' }]), /Card · since Nov 10/);
});

test('scorecard: always 13 Kelowna Monday weeks, a missing week says no data yet; the feed takes only Mondays and real numbers', async () => {
  const { env } = await setup();
  const few = { ...CARD, weeks: WEEKS.slice(0, 3), numbers: [CARD.numbers[1]] };
  assert.equal((await call(env, 'PUT', '/v1/feeds/eos_scorecard', { bot: 'developer', body: few })).status, 201, '1 to 13 weeks are taken');
  const got = (await call(env, 'GET', '/v1/eos', { jon: true })).body;
  const html = scorecardHtml(got.scorecard, NOW);
  assert.equal((html.match(/<th class="eoswk/g) || []).length, 13, 'padded to 13 columns');
  assert.match(html, /<th class="eoswk">Aug 24<\/th>/, 'oldest column is 12 Mondays before this week');
  assert.equal((html.match(/no data yet/g) || []).length, 12);
  // 23:00 Sunday in Kelowna is still that week; Monday 00:30 Kelowna starts the next one
  assert.match(scorecardHtml(got.scorecard, Date.parse('2026-08-24T06:00:00Z')), /<th class="eoswk cur">Aug 17</);
  assert.match(scorecardHtml(got.scorecard, Date.parse('2026-08-24T07:30:00Z')), /<th class="eoswk cur">Aug 24</);
  assert.match(scorecardHtml({ ...got.scorecard, generated: '2026-08-18T06:30:00Z' }, NOW), /Updated Aug 17 23:30/, 'a UTC time shows in Kelowna time');
  assert.match(scorecardHtml(got.scorecard, NOW + 9 * 86400000), /over a week old/);
  const tue = { ...CARD, weeks: [{ start: '2026-11-17', end: '2026-11-23', current: true }] };
  const tueValue = { ...CARD, numbers: [{ ...CARD.numbers[1], values: [{ week: '2026-11-17', value: 1, status: 'ok' }] }] };
  for (const bad of [tue, tueValue, ...['', '2500', true].map((value) => ({ ...CARD, numbers: [{ ...CARD.numbers[0], goal: { ...CARD.numbers[0].goal, value } }] }))]) {
    assert.equal((await call(env, 'PUT', '/v1/feeds/eos_scorecard', { bot: 'developer', body: bad })).status, 400);
  }
});

test('rocks: any quarter (Rock Q1 to Q4), and the proof link is a QC-passed one first', async () => {
  const { db, env } = await setup();
  await task(db, 't_q1', 'Rock Q1: 2027 sponsor pipeline');
  await task(db, 't_q4', 'Rock Q4: EOS dashboard page');
  await task(db, 't_no', 'Rocky road for the team party');
  const proofRow = (id, link, status, at) => db.prepare(`INSERT INTO bot_proofs (id, task_id, kind, link, status, created_by, created_at) VALUES (?, 't_q4', 'link', ?, ?, 'developer', ?)`).bind(id, link, status, at).run();
  await proofRow('p_pass', 'https://jonmac.ai/passed', 'passed', '2026-11-10T00:00:00Z');
  await proofRow('p_new', 'https://jonmac.ai/pending', 'pending', '2026-11-12T00:00:00Z');
  const got = (await call(env, 'GET', '/v1/eos', { jon: true })).body;
  assert.deepEqual(got.rocks.map((r) => r.id), ['t_q1', 't_q4']);
  assert.equal(got.rocks[1].proofLink, 'https://jonmac.ai/passed');
});
