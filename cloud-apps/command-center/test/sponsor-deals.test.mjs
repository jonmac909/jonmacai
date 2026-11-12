// Pipeline/Money deals: override stages survive (archived hides, balance-invoice kept, hand-placed cards curated) and
// deals added through sponsor.add_deal / sponsor.set_amount show identically on Pipeline and Money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { pipelineOf } from '../public/d3/js/goals.js';
import { dealStages } from '../public/d3/js/money.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-11T19:00:00Z');
const card = (id, stage, extra = {}) => ({ id, sponsor: id, contact: '', stage, amount: null, status: '', latestDate: '2026-11-05T12:00:00Z', to: '', threadId: '', subject: `${id} subject`, reason: '', needsDraft: false, ...extra });
const DATA = () => ({
  collections: { items: [] },
  cards: [
    card('gmail-thread-aaa111aaa111', 'production'), card('gmail-thread-bbb222bbb222', 'new-lead'),
    card('gmail-thread-ccc333ccc333', 'new-lead'), card('gmail-thread-ddd444ddd444', 'new-lead'),
    card('gmail-thread-eee555eee555', 'new-lead'), card('Newsy', 'new-lead', { subject: 'Weekly newsletter digest' }),
    card('Oldie', 'new-lead', { latestDate: '2026-08-01T12:00:00Z' }),
  ],
});

async function setup() {
  const db = sqliteD1();
  db.sqlite.prepare('INSERT INTO snapshots (source, data, collected_at, received_at) VALUES (?, ?, ?, ?)').run('sponsors', JSON.stringify(DATA()), '2026-11-11T18:00:00Z', '2026-11-11T18:00:00Z');
  const env = { DB: db, SESSION_SECRET: SECRET };
  const Cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
  const act = async (kind, payload) => {
    const res = await handleApi(new Request('https://jonmac.ai/dashboard/api/actions', { method: 'POST', headers: { Cookie, 'X-CC': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, payload }) }), env);
    return res.json();
  };
  const d2 = async () => (await handleApi(new Request('https://jonmac.ai/dashboard/api/d2', { headers: { Cookie } }), env)).json();
  const where = (resp, id) => {
    const cols = resp.d2.pipeline.boards.find((b) => b.goal === 'sponsors').sponsors.board.columns;
    return cols.find((c) => c.cards.some((k) => k.id === id))?.title || null;
  };
  return { db, env, act, d2, where };
}
const withNow = async (fn) => { const real = Date.now; Date.now = () => NOW; try { return await fn(); } finally { Date.now = real; } };

test('an archived override hides the card from the page and the board (not back in Leads)', () => withNow(async () => {
  const t = await setup();
  assert.equal(t.where(await t.d2(), 'gmail-thread-aaa111aaa111'), 'Video Production');
  await t.act('sponsor.move_stage', { id: 'gmail-thread-aaa111aaa111', stage: 'archived' });
  const r = await t.d2();
  assert.equal(t.db.sqlite.prepare("SELECT stage FROM deal_stage_overrides WHERE deal_id = 'gmail-thread-aaa111aaa111'").get().stage, 'archived');
  assert.equal(t.where(r, 'gmail-thread-aaa111aaa111'), null);
  const page = r.pages.sponsors.board.columns.flatMap((c) => c.cards);
  assert.ok(!page.some((k) => k.id === 'gmail-thread-aaa111aaa111'));
}));

test('overrides to negotiating / drafts / contract-brief / balance-invoice land in their columns with no sheet row or draft', () => withNow(async () => {
  const t = await setup();
  const want = { 'gmail-thread-aaa111aaa111': ['negotiating', 'Negotiations'],     'gmail-thread-ccc333ccc333': ['contract-brief', 'Deals'], 'gmail-thread-ddd444ddd444': ['balance-invoice', 'Balance Invoice'] };
  for (const [id, [stage]] of Object.entries(want)) await t.act('sponsor.move_stage', { id, stage });
  const r = await t.d2();
  for (const [id, [stage, col]] of Object.entries(want)) {
    assert.equal(t.db.sqlite.prepare('SELECT stage FROM deal_stage_overrides WHERE deal_id = ?').get(id).stage, stage);
    assert.equal(t.where(r, id), col, id);
  }
  // A drafts override with no sheet row or draft is not curated (junk guard); add_deal is the way to place such a lead.
  await t.act('sponsor.move_stage', { id: 'gmail-thread-bbb222bbb222', stage: 'drafts' });
  assert.equal(t.where(await t.d2(), 'gmail-thread-bbb222bbb222'), null);
  // Curated cards are exempt from the junk filter and the 60-day quiet archive.
  await t.act('sponsor.move_stage', { id: 'Newsy', stage: 'negotiating' });
  await t.act('sponsor.move_stage', { id: 'Oldie', stage: 'negotiating' });
  const r2 = await t.d2();
  assert.equal(t.where(r2, 'Newsy'), 'Negotiations');
  assert.equal(t.where(r2, 'Oldie'), 'Negotiations');
}));

test('sponsor.add_deal + sponsor.set_amount: identical on Pipeline and Money, amountSet wins, nothing queued to the Mac', () => withNow(async () => {
  const t = await setup();
  const a = await t.act('sponsor.add_deal', { brand: 'Topview', stage: 'invoice-sent', amount: 1000, threadId: '1a1213c3e19344a7', contact: 'a@topview.ai', next: 'Chase invoice 1073' });
  assert.equal(a.status, 'done');
  const b = await t.act('sponsor.add_deal', { brand: 'Munch', stage: 'contract-brief', threadId: '1a1c0d26b71240b5' });
  assert.equal(b.status, 'done');
  const s = await t.act('sponsor.set_amount', { id: 'gmail-thread-1a1213c3e19344a7', amount: 2000 });
  assert.equal(s.status, 'done');
  assert.equal(t.db.sqlite.prepare("SELECT COUNT(*) n FROM actions WHERE target = 'mac' AND kind IN ('sponsor.add_deal','sponsor.set_amount')").get().n, 0);
  // Not a stale feed row.
  const r = await t.d2();
  const p = pipelineOf(r);
  const m = dealStages(r).flatMap((x) => x.deals);
  const pl = [...p.collect, ...p.close].find((x) => x.name === 'Topview');
  const mo = m.find((x) => x.name === 'Topview');
  assert.equal(pl.amt, 2000);
  assert.equal(mo.amt, 2000);
  assert.equal(pl.id, mo.id);
  assert.equal(mo.next, 'Chase invoice 1073');
  assert.equal(mo.threadId, '1a1213c3e19344a7');
  assert.ok(p.collect.some((x) => x.name === 'Munch'), 'Munch in To collect (Deals)');
  assert.ok(m.some((x) => x.name === 'Munch'));
  assert.equal(p.totals.collect, 2000);
  assert.ok(!(r.sources?.sponsor_deals), 'the deals row is not a feed');
  // GPU1 reads the added deals' threads too.
  const env = { ...t.env, MACHINE_TOKEN_GPU1: 'g' };
  const w = await (await handleApi(new Request('https://jonmac.ai/dashboard/api/sponsor-threads/wanted', { headers: { Authorization: 'Bearer g' } }), env)).json();
  assert.ok(w.threads.includes('1a1213c3e19344a7') && w.threads.includes('1a1c0d26b71240b5'));
}));

test('add_deal / set_amount validation returns 400 and stores nothing', () => withNow(async () => {
  const t = await setup();
  const post = async (kind, payload, headers) => {
    const res = await handleApi(new Request('https://jonmac.ai/dashboard/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ kind, payload }) }), t.env);
    return res.status;
  };
  const Cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
  const ok = { Cookie, 'X-CC': '1' };
  const id = 'gmail-thread-1a1213c3e19344a7';
  const cases = [
    ['sponsor.add_deal', { id: 'x', brand: 'A' }], ['sponsor.add_deal', { id, brand: 'A', amount: 'Infinity' }], ['sponsor.add_deal', { id, brand: 'A', amount: 2e6 }],
    ['sponsor.add_deal', { id, brand: 'A', amount: -5 }], ['sponsor.add_deal', { id, brand: 'A'.repeat(201) }], ['sponsor.add_deal', { id, brand: 'A', stage: 'bogus' }],
    ['sponsor.add_deal', { threadId: 'zz', brand: 'A' }], ['sponsor.set_amount', { id, amount: 'abc' }], ['sponsor.set_amount', { id }], ['sponsor.set_amount', { id: 'nope', amount: 5 }],
  ];
  for (const [k, p] of cases) assert.equal(await post(k, p, ok), 400, `${k} ${JSON.stringify(p).slice(0, 60)}`);
  assert.equal(t.db.sqlite.prepare("SELECT COUNT(*) n FROM snapshots WHERE source = 'sponsor_deals'").get().n, 0);
  assert.equal(await post('sponsor.add_deal', { id, brand: 'A', stage: 'negotiating', amount: 1000 }, ok), 200);
  // Missing X-CC or session is rejected on the new kinds.
  assert.equal(await post('sponsor.add_deal', { id, brand: 'B' }, { Cookie }), 403);
  assert.equal(await post('sponsor.set_amount', { id, amount: 5 }, { 'X-CC': '1' }), 401);
  assert.equal(await post('sponsor.add_deal', { id, brand: 'B' }, {}), 401);
}));

test('ingest of the sponsor_deals source is Worker-only (401 for a machine token)', async () => {
  const t = await setup();
  const env = { ...t.env, MACHINE_TOKEN_GPU1: 'g' };
  const res = await handleApi(new Request('https://jonmac.ai/dashboard/api/ingest', { method: 'POST', headers: { Authorization: 'Bearer g', 'Content-Type': 'application/json' }, body: JSON.stringify({ machine: 'gpu1', source: 'sponsor_deals', collectedAt: '2026-11-11T18:00:00Z', data: { deals: {} } }) }), env);
  assert.equal(res.status, 401);
});

test('old new-lead overrides on junk threads stay hidden; a prior-month done override stays cut; add_deal drafts stay curated', () => withNow(async () => {
  const t = await setup();
  await t.act('sponsor.move_stage', { id: 'Newsy', stage: 'new-lead' });
  await t.act('sponsor.move_stage', { id: 'Oldie', stage: 'drafts' });
  await t.act('sponsor.move_stage', { id: 'gmail-thread-eee555eee555', stage: 'done' });
  await t.act('sponsor.add_deal', { id: 'gmail-thread-1a082b1c04b4fcfb', brand: 'Creatify', stage: 'drafts' });
  const r = await t.d2();
  assert.equal(t.where(r, 'Newsy'), null);
  assert.equal(t.where(r, 'Oldie'), null);
  assert.equal(t.where(r, 'gmail-thread-1a082b1c04b4fcfb'), 'Leads');
}));

test('tool/workspace invite emails are junk, but an added deal with that subject stays; set_amount brand fixes a mangled name', () => withNow(async () => {
  const t = await setup();
  const row = JSON.parse(t.db.sqlite.prepare("SELECT data FROM snapshots WHERE source='sponsors'").get().data);
  row.cards.push(card('Envato', 'drafts', { subject: 'Envato has invited you to a new paid campaign', needsDraft: true, status: 'Draft ready', draftReply: { status: 'needs-review', subject: 'Re: x', body: 'Hi' }, reason: 'Contract, brief, usage, or assets language. Latest sponsor: 1stCollab' }), card('Relume', 'new-lead', { subject: 'Relume has invited you to join their team' }), card('gmail-thread-1a0aa308142f5466', 'contract-brief', { sponsor: 'Luminarysm', subject: 'Enter Paid YouTube Cooperation' }));
  t.db.sqlite.prepare("UPDATE snapshots SET data=? WHERE source='sponsors'").run(JSON.stringify(row));
  await t.act('sponsor.add_deal', { id: 'gmail-thread-1a082b1c04b4fcfb', brand: 'Real', stage: 'drafts', subject: 'Acme has invited you to a sponsorship' });
  await t.act('sponsor.move_stage', { id: 'gmail-thread-1a0aa308142f5466', stage: 'contract-brief' });
  await t.act('sponsor.set_amount', { id: 'gmail-thread-1a0aa308142f5466', amount: 3000, brand: 'Enter' });
  const r = await t.d2();
  assert.equal(t.where(r, 'Envato'), null);
  assert.equal(t.where(r, 'Relume'), null);
  assert.equal(t.where(r, 'gmail-thread-1a082b1c04b4fcfb'), 'Leads');
  const cards = r.d2.pipeline.boards.find((b) => b.goal === 'sponsors').sponsors.board.columns.flatMap((c) => c.cards);
  assert.equal(cards.find((k) => k.id === 'gmail-thread-1a0aa308142f5466').name, 'Enter');
}));

test('bot v1 sponsor routes: 401 no/bad token, 403 other bots, 400 other kinds, move/add/set_amount work, GET returns columns', () => withNow(async () => {
  const t = await setup();
  const { sha256Hex } = await import('../src/bots.js');
  const tok = (b) => `ccb_${b.padEnd(40, 'x')}`;
  for (const b of ['developer', 'sponsors']) t.db.sqlite.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').run(await sha256Hex(tok(b)), b, 'x');
  const call = (path, auth, body) => handleApi(new Request(`https://jonmac.ai/dashboard/api/v1/${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), t.env);
  const add = { kind: 'sponsor.add_deal', payload: { brand: 'Topview', stage: 'balance-invoice', amount: 2000, threadId: '1a1213c3e19344a7' } };
  assert.equal((await call('sponsors/actions', null, add)).status, 401);
  assert.equal((await call('sponsors/actions', tok('nobody'), add)).status, 401);
  assert.equal((await call('sponsors/actions', tok('sponsors'), add)).status, 403);
  assert.equal((await call('sponsors', null)).status, 401);
  for (const kind of ['money.move_and_remember', 'life.x', 'sponsor.send_reply', undefined]) assert.equal((await call('sponsors/actions', tok('developer'), { ...add, kind })).status, 400, String(kind));
  assert.equal((await call('sponsors/actions', tok('developer'), { kind: 'sponsor.add_deal', payload: { id: 'x' } })).status, 400);
  const ok = await call('sponsors/actions', tok('developer'), add);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, 'done');
  const id = 'gmail-thread-1a1213c3e19344a7';
  const setAmt = await call('sponsors/actions', tok('developer'), { kind: 'sponsor.set_amount', payload: { id, amount: 2500 } });
  assert.equal(setAmt.status, 200);
  assert.equal((await setAmt.json()).status, 'done');
  const move = await call('sponsors/actions', tok('developer'), { kind: 'sponsor.move_stage', payload: { id: 'gmail-thread-bbb222bbb222', stage: 'negotiating' } });
  assert.equal(move.status, 200);
  assert.equal(t.db.sqlite.prepare("SELECT stage FROM deal_stage_overrides WHERE deal_id = 'gmail-thread-bbb222bbb222'").get().stage, 'negotiating');
  const g = await (await call('sponsors', tok('developer'))).json();
  assert.ok(g.ok && Array.isArray(g.board.columns) && g.board.columns.length > 5);
  const col = (id2) => g.board.columns.find((c) => c.cards.some((k) => k.id === id2))?.title;
  assert.equal(col(id), 'Balance Invoice');
  assert.equal(g.board.columns.find((c) => c.title === 'Balance Invoice').cards.find((k) => k.id === id).name, 'Topview');
  assert.equal(col('gmail-thread-bbb222bbb222'), 'Negotiations');
  assert.equal(g.pipeline.totals.collect, 2500);
  assert.ok(g.sponsors);
  // The bot route never takes Jon-only kinds even for an allowed bot, and nothing reached the Mac queue.
  assert.equal(t.db.sqlite.prepare("SELECT COUNT(*) n FROM actions WHERE kind NOT LIKE 'sponsor.%'").get().n, 0);
}));
