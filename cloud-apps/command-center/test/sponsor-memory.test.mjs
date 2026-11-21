// Sponsor memory (card t_dd14c08f25ea4179): the ingest, the open follow-ups list, the page's cards and who may call what.
// Each test plants the fault it guards: a double on re-scan, a reopened manual close, an open endpoint, a card per thread.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { ingestSponsorMemory, openFollowups, sponsorCards, slugOf, todayYmd } from '../src/sponsormemory.js';
import { sponsorMemoryHtml } from '../public/d3/js/money.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-21T19:00:00Z');
const T1 = 'a1b2c3d4e5f6';
const T2 = 'bbbb2222cccc';
const base = (extra = {}) => ({
  sponsors: [{ id: 'topview', name: 'Topview', status: 'active', contacts: [{ name: 'Dorothy', email: 'Dorothy@Topview.AI', last: '2026-11-20T10:00:00Z' }], rates: [{ amount: 2500, what: 'dedicated', date: '2026-10-02', thread: T1 }], summary: 'Film Studio 2.0, video 1 delivered', last_contact: '2026-11-20T10:00:00Z' }],
  threads: [{ thread_id: T1, sponsor_id: 'topview', subject: 'Q4 special', first_at: '2026-10-02T10:00:00Z', last_at: '2026-11-20T10:00:00Z', who: 'Dorothy <d@topview.ai>', last_is_us: false, n: 6, summary: 'Asked for a draft by Friday', labels: ['Action/Needs Reply'] }],
  followups: [{ id: `reply:${T1}:m9`, sponsor_id: 'topview', thread_id: T1, kind: 'reply', text: 'Dorothy asked for a draft by Friday', due: '2026-11-21' }],
  ...extra,
});
const hit = (env, path, { method = 'GET', body, token, cookie } = {}) => handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, {
  method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
}), env);

async function setup() {
  const db = sqliteD1();
  const env = { DB: db, SESSION_SECRET: SECRET, MACHINE_TOKEN_GPU1: 'gpu1-token-0123456789', MACHINE_TOKEN_GPU2: 'gpu2-token-0123456789', MACHINE_TOKEN_MAC: 'mac-token-0123456789' };
  const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
  return { db, env, cookie };
}

test('slugOf: one key per company, whatever the casing or punctuation', () => {
  assert.equal(slugOf('Soft Story Media'), 'softstorymedia');
  assert.equal(slugOf('  TOPVIEW.ai '), 'topviewai');
  assert.equal(todayYmd(Date.parse('2026-11-22T06:30:00Z')), '2026-11-21'); // 22:30 in Kelowna still the 21st
});

test('ingest: a re-scan updates the same rows and never doubles a follow-up', async () => {
  const { db } = await setup();
  await ingestSponsorMemory(db, base(), NOW);
  const first = (await db.prepare('SELECT created_at FROM sponsor_followups').first()).created_at;
  const out = await ingestSponsorMemory(db, base({ followups: [{ ...base().followups[0], due: '2026-11-24', text: 'moved' }] }), NOW + 3600e3);
  assert.deepEqual([out.sponsors, out.threads, out.followups], [1, 1, 1]);
  for (const t of ['sponsor_mem', 'sponsor_mem_threads', 'sponsor_followups']) assert.equal((await db.prepare(`SELECT COUNT(*) n FROM ${t}`).first()).n, 1, t);
  const row = await db.prepare('SELECT * FROM sponsor_followups').first();
  assert.equal(row.due, '2026-11-24');
  assert.equal(row.text, 'moved');
  assert.equal(row.created_at, first, 'created_at survives a re-scan');
  assert.equal((await db.prepare('SELECT contacts FROM sponsor_mem').first()).contacts.includes('dorothy@topview.ai'), true, 'emails are lower-cased');
});

test('ingest: bad rows are counted and skipped, the good ones still land', async () => {
  const { db } = await setup();
  const out = await ingestSponsorMemory(db, base({
    threads: [{ thread_id: 'not hex!', sponsor_id: 'topview' }, base().threads[0]],
    followups: [{ id: 'x', sponsor_id: 'topview', kind: 'nonsense', due: '2026-11-21', text: 'x' }, { id: 'y', sponsor_id: 'topview', kind: 'chase', due: 'tomorrow', text: 'x' }, base().followups[0]],
    sponsors: [{ name: '' }, ...base().sponsors],
  }), NOW);
  assert.equal(out.skipped, 4);
  assert.deepEqual([out.sponsors, out.threads, out.followups], [1, 1, 1]);
});

test('close: a follow-up closes with its reason, leaves the open list, and a re-scan does not reopen a manual close', async () => {
  const { db } = await setup();
  await ingestSponsorMemory(db, base(), NOW);
  assert.equal((await openFollowups(db)).length, 1);
  assert.equal((await openFollowups(db, '2026-11-20')).length, 0, 'not due yet on the 20th');
  assert.equal((await openFollowups(db, '2026-11-21')).length, 1);
  // auto close (a reply went out): a later scan that still lists it (e.g. a late mail) may reopen it...
  await ingestSponsorMemory(db, { close: [{ id: `reply:${T1}:m9`, reason: 'reply sent' }] }, NOW);
  assert.equal((await openFollowups(db)).length, 0);
  const row = await db.prepare('SELECT status, closed_reason, closed_by FROM sponsor_followups').first();
  assert.deepEqual({ ...row }, { status: 'closed', closed_reason: 'reply sent', closed_by: 'auto' });
  await ingestSponsorMemory(db, base(), NOW);
  assert.equal((await openFollowups(db)).length, 1, 'an auto-closed row the scan still wants comes back');
  // ...but Jon's or Florence's own close sticks.
  await ingestSponsorMemory(db, { close: [{ id: `reply:${T1}:m9`, reason: 'Jon answered by phone', by: 'manual' }] }, NOW);
  await ingestSponsorMemory(db, base(), NOW);
  assert.equal((await openFollowups(db)).length, 0, 'planted fault: a scan reopened a manual close');
});

test('open follow-ups come soonest first with the sponsor name', async () => {
  const { db } = await setup();
  await ingestSponsorMemory(db, base({ followups: [
    { id: 'chase:b', sponsor_id: 'topview', kind: 'chase', due: '2026-11-25', text: 'later' },
    { id: 'payment:a', sponsor_id: 'topview', kind: 'payment', due: '2026-11-19', text: 'overdue' },
  ] }), NOW);
  const rows = await openFollowups(db);
  assert.deepEqual(rows.map((r) => r.id), ['payment:a', 'chase:b']);
  assert.equal(rows[0].sponsor, 'Topview');
});

test('API: the machine routes need the GPU1 token, the page needs the session', async () => {
  const { env, cookie } = await setup();
  for (const [method, path] of [['GET', '/sponsor-memory/followups'], ['GET', '/sponsor-memory/source'], ['POST', '/sponsor-memory/ingest']]) {
    assert.equal((await hit(env, path, { method, body: method === 'POST' ? base() : undefined })).status, 401, `${path} with no token`);
    assert.equal((await hit(env, path, { method, token: 'gpu2-token-0123456789', body: method === 'POST' ? base() : undefined })).status, 401, `${path} with the GPU2 token`);
    assert.equal((await hit(env, path, { method, cookie, body: method === 'POST' ? base() : undefined })).status, 401, `${path} with Jon's cookie`);
  }
  assert.equal((await hit(env, '/sponsor-memory')).status, 401, 'the page without a session');
  assert.equal((await hit(env, '/sponsor-memory', { token: 'gpu1-token-0123456789' })).status, 401, 'the page with a machine token');
  assert.equal((await hit(env, '/sponsor-memory', { cookie })).status, 200);
});

test('API: GPU1 ingests, reads the due list, closes, and the page shows one card per sponsor', async () => {
  const { env, cookie } = await setup();
  const gpu1 = 'gpu1-token-0123456789';
  const put = await (await hit(env, '/sponsor-memory/ingest', { method: 'POST', token: gpu1, body: base() })).json();
  assert.equal(put.ok, true);
  const due = await (await hit(env, '/sponsor-memory/followups?through=2026-11-21', { token: gpu1 })).json();
  assert.equal(due.followups.length, 1);
  assert.equal(due.followups[0].sponsor, 'Topview');
  let page = await (await hit(env, '/sponsor-memory', { cookie })).json();
  assert.equal(page.sponsors.length, 1, 'one card, not one per thread');
  assert.equal(page.open, 1);
  assert.equal(page.sponsors[0].nextFollowup, '2026-11-21');
  await hit(env, '/sponsor-memory/ingest', { method: 'POST', token: gpu1, body: { close: [{ id: `reply:${T1}:m9`, reason: 'reply sent' }] } });
  page = await (await hit(env, '/sponsor-memory', { cookie })).json();
  assert.equal(page.open, 0);
  assert.equal(page.sponsors[0].nextFollowup, null);
});

test('cards: board deals and collections items join the card of the same company, not a second card', async () => {
  const { db } = await setup();
  await ingestSponsorMemory(db, base({ threads: [base().threads[0], { ...base().threads[0], thread_id: T2, subject: 'Invoice 1073' }] }), NOW);
  const data = {
    collections: { items: [{ sponsor: 'Topview', total: 5000, paid: 2000, owed: 3000, bucket: 'delivery-balance', bucketLabel: 'Owed after posting', lastEmail: 'Nov 20, 2026', action: 'Send invoice after delivery', blocker: '' }, { sponsor: 'Arcads', total: 3000, paid: 1500, owed: 1500, bucket: 'delivery-balance', bucketLabel: 'Owed after posting', lastEmail: 'Nov 13, 2026', action: '', blocker: '' }] },
    cards: [{ id: 'gmail-thread-a1b2c3d4e5f6', sponsor: 'Topview', contact: '', stage: 'production', amount: 5000, status: 'in edit', latestDate: '2026-11-20T10:00:00Z', threadId: T1, subject: 'Film Studio 2.0' }],
  };
  const out = await sponsorCards(db, data, {}, {}, NOW);
  const names = out.sponsors.map((s) => s.name).sort();
  assert.deepEqual(names, ['Arcads', 'Topview']); // Arcads has money but no emails yet: still a card
  const tv = out.sponsors.find((s) => s.id === 'topview');
  assert.equal(tv.threads.length, 2);
  assert.equal(tv.deals.length, 1);
  assert.equal(tv.deals[0].amount, 5000);
  assert.equal(tv.money.owed, 3000);
  assert.equal(tv.nextFollowup, '2026-11-21');
});

test('page html: a card per sponsor, owed and follow-up pills, markup in an email subject is escaped', () => {
  const mem = { today: '2026-11-21', open: 1, sponsors: [{
    id: 'topview', name: 'Topview', status: 'active', summary: '', lastContact: '2026-11-20T10:00:00Z', nextFollowup: '2026-11-21',
    contacts: [{ name: 'Dorothy', email: 'd@topview.ai' }], rates: [{ amount: 2500, what: 'dedicated', date: '2026-10-02' }], deals: [], extraDeals: [], extraInvoices: [{ no: '1073', amount: 3000, state: 'owed', date: '2026-10-24' }],
    followups: [{ id: 'f', kind: 'reply', text: 'Reply <b>now</b>', due: '2026-11-21' }],
    money: { total: 5000, paid: 2000, owed: 3000, bucket: 'Owed after posting' },
    threads: [{ id: T1, subject: '<script>alert(1)</script>', last: '2026-11-20T10:00:00Z', who: 'Dorothy', us: false, n: 6, summary: '' }],
  }] };
  const html = sponsorMemoryHtml(mem, { topview: true });
  assert.equal((html.match(/data-sponsor="/g) || []).length, 1);
  assert.match(html, /\$3,000 owed/);
  assert.match(html, /follow up now/);
  assert.match(html, /<details[^>]*data-sponsor="topview" open/);
  assert.doesNotMatch(html, /<script>|<b>now/);
  assert.match(sponsorMemoryHtml(undefined), /Loading/);
  assert.match(sponsorMemoryHtml({ error: 'boom' }), /No feed: boom/);
  assert.match(sponsorMemoryHtml({ sponsors: [] }), /has not run/);
});
