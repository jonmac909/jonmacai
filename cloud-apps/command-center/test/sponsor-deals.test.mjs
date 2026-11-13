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
  // Topview (Deposit Invoice, priced) is to close; Munch (Deals, no amount yet) counts in neither (Jon, 2026-11-13).
  assert.ok(p.close.some((x) => x.name === 'Topview'), 'Topview in To close (Deposit Invoice)');
  assert.ok(![...p.close, ...p.collect].some((x) => x.name === 'Munch'), 'unpriced Munch in neither list');
  assert.ok(m.some((x) => x.name === 'Munch'));
  assert.equal(p.totals.close, 2000);
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

test('bot v1 sponsor routes: 401 no/bad token, 403 other bots (developer), 400 other kinds, move/add/set_amount work, GET returns columns', () => withNow(async () => {
  const t = await setup();
  const { sha256Hex } = await import('../src/bots.js');
  const tok = (b) => `ccb_${b.padEnd(40, 'x')}`;
  for (const b of ['developer', 'sponsors']) t.db.sqlite.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').run(await sha256Hex(tok(b)), b, 'x');
  const call = (path, auth, body) => handleApi(new Request(`https://jonmac.ai/dashboard/api/v1/${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), t.env);
  const add = { kind: 'sponsor.add_deal', payload: { brand: 'Topview', stage: 'balance-invoice', amount: 2000, threadId: '1a1213c3e19344a7' } };
  assert.equal((await call('sponsors/actions', null, add)).status, 401);
  assert.equal((await call('sponsors/actions', tok('nobody'), add)).status, 401);
  assert.equal((await call('sponsors/actions', tok('developer'), add)).status, 403);
  assert.equal((await call('sponsors', null)).status, 401);
  for (const kind of ['money.move_and_remember', 'life.x', 'sponsor.send_reply', undefined]) assert.equal((await call('sponsors/actions', tok('sponsors'), { ...add, kind })).status, 400, String(kind));
  assert.equal((await call('sponsors/actions', tok('sponsors'), { kind: 'sponsor.add_deal', payload: { id: 'x' } })).status, 400);
  const ok = await call('sponsors/actions', tok('sponsors'), add);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, 'done');
  const id = 'gmail-thread-1a1213c3e19344a7';
  const setAmt = await call('sponsors/actions', tok('sponsors'), { kind: 'sponsor.set_amount', payload: { id, amount: 2500 } });
  assert.equal(setAmt.status, 200);
  assert.equal((await setAmt.json()).status, 'done');
  const move = await call('sponsors/actions', tok('sponsors'), { kind: 'sponsor.move_stage', payload: { id: 'gmail-thread-bbb222bbb222', stage: 'negotiating' } });
  assert.equal(move.status, 200);
  assert.equal(t.db.sqlite.prepare("SELECT stage FROM deal_stage_overrides WHERE deal_id = 'gmail-thread-bbb222bbb222'").get().stage, 'negotiating');
  const g = await (await call('sponsors', tok('sponsors'))).json();
  assert.ok(g.ok && Array.isArray(g.board.columns) && g.board.columns.length > 5);
  const col = (id2) => g.board.columns.find((c) => c.cards.some((k) => k.id === id2))?.title;
  assert.equal(col(id), 'Balance Invoice');
  assert.equal(g.board.columns.find((c) => c.title === 'Balance Invoice').cards.find((k) => k.id === id).name, 'Topview');
  assert.equal(col('gmail-thread-bbb222bbb222'), 'Negotiations');
  assert.equal(g.pipeline.totals.collect, 2500);
  assert.ok(g.sponsors);
  // The rejected Jon-only kinds stored no action row (only the sponsor.* calls above did).
  assert.equal(t.db.sqlite.prepare("SELECT COUNT(*) n FROM actions WHERE kind NOT LIKE 'sponsor.%'").get().n, 0);
}));

test('bot v1 sponsor routes: ana allowed, revoked/cookie/bad body rejected, extra fields stripped, move_stage checked, keys namespaced', () => withNow(async () => {
  const t = await setup();
  const { sha256Hex } = await import('../src/bots.js');
  const tok = (b) => `ccb_${b.padEnd(40, 'y')}`;
  for (const b of ['ana', 'sponsors', 'gone']) t.db.sqlite.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').run(await sha256Hex(tok(b)), b === 'gone' ? 'sponsors' : b, 'x');
  t.db.sqlite.prepare('UPDATE bot_tokens SET revoked_at = ? WHERE token_hash = ?').run('y', await sha256Hex(tok('gone')));
  const Cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
  const req = (path, headers, body) => handleApi(new Request(`https://jonmac.ai/dashboard/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), t.env);
  const bearer = (b) => ({ Authorization: `Bearer ${tok(b)}` });
  const id = 'gmail-thread-1a1213c3e19344a7';
  const add = { kind: 'sponsor.add_deal', payload: { id, brand: 'Topview', stage: 'negotiating', msg: 'injected', isolated: true, extra: 'x' }, idemKey: 'k1' };
  assert.equal((await req('v1/sponsors/actions', bearer('ana'), add)).status, 200);
  assert.equal((await req('v1/sponsors/actions', bearer('gone'), add)).status, 401);
  assert.equal((await req('v1/sponsors/actions', { Cookie, 'X-CC': '1' }, add)).status, 401);
  assert.equal((await req('actions', bearer('sponsors'), add)).status, 401);
  for (const b of ['[1,2]', '"str"', '42', 'null', 'not json']) assert.equal((await req('v1/sponsors/actions', bearer('sponsors'), b)).status, 400, b);
  const row = t.db.sqlite.prepare("SELECT payload, result, idem_key FROM actions WHERE kind = 'sponsor.add_deal'").get();
  assert.deepEqual(Object.keys(JSON.parse(row.payload)).sort(), ['brand', 'id', 'stage']);
  assert.ok(!String(row.result).includes('injected'));
  assert.equal(row.idem_key, 'bot:ana:k1');
  for (const p of [{ id: 'x', stage: 'negotiating' }, { id, stage: 'bogus' }, { id }, { stage: 'paid' }]) {
    assert.equal((await req('v1/sponsors/actions', bearer('sponsors'), { kind: 'sponsor.move_stage', payload: p })).status, 400, JSON.stringify(p));
  }
  assert.equal(t.db.sqlite.prepare("SELECT COUNT(*) n FROM deal_stage_overrides WHERE stage = 'bogus' OR deal_id = 'x'").get().n, 0);
  // A bot can't read one of Jon's actions back by its key.
  await t.act('sponsor.set_amount', { id, amount: 900 });
  const jon = t.db.sqlite.prepare("SELECT id, idem_key FROM actions WHERE kind = 'sponsor.set_amount'").get();
  const r = await (await req('v1/sponsors/actions', bearer('sponsors'), { kind: 'sponsor.set_amount', payload: { id, amount: 901 }, idemKey: jon.idem_key })).json();
  assert.notEqual(r.id, jon.id);
}));

test('bot deals routes (t_0d63a48a3be4423c): list, set amount makes the home Sponsors total appear, paid leaves Money owed, 403/400/404', () => withNow(async () => {
  const t = await setup();
  const { sha256Hex } = await import('../src/bots.js');
  const { homeGoals } = await import('../public/d3/js/home.js');
  const tok = (b) => `ccb_${b.padEnd(40, 'z')}`;
  for (const b of ['sponsors', 'ana', 'developer', 'scarlett']) t.db.sqlite.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').run(await sha256Hex(tok(b)), b, 'x');
  const call = (auth, body) => handleApi(new Request('https://jonmac.ai/dashboard/api/v1/sponsors/deals', { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${tok(auth)}` } : {}) }, ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }), t.env);
  const home = async () => {
    const cats = homeGoals(await t.d2(), null);
    const r = (k) => cats.find((c) => c.key === 'sponsors').month.find((x) => x.k === k);
    return { owed: r('owed'), close: r('close') };
  };
  // Planted: every deal unpriced, so Money owed reads "Not priced" and Deals to close (priced only) is empty.
  const lead = 'gmail-thread-bbb222bbb222'; // moved to Deals on Jon's board: Deals to close once priced
  const prod = 'gmail-thread-aaa111aaa111'; // Video Production: Money owed
  await t.act('sponsor.move_stage', { id: lead, stage: 'contract-brief' });
  let h = await home();
  assert.deepEqual([h.close.v, h.close.info], ['$0', 'None open']);
  assert.equal(h.owed.v, 'Not priced');
  // Only sponsors and ana; others 403, no token 401.
  assert.equal((await call(null)).status, 401);
  for (const b of ['developer', 'scarlett']) {
    assert.equal((await call(b)).status, 403, b);
    assert.equal((await call(b, { id: prod, amount: 2000 })).status, 403, b);
  }
  const list = await (await call('ana')).json();
  assert.ok(list.ok);
  const row = (id) => list.deals.find((d) => d.id === id);
  assert.deepEqual(row(lead), { id: lead, sponsor: lead, stage: 'Deals', boardStage: 'contract-brief', amount: null, threadId: '', bucket: null });
  assert.equal(row(prod).bucket, 'owed');
  assert.equal(row(prod).stage, 'Video Production');
  // Set amounts: the home rows show dollar totals instead of Not priced.
  const s1 = await call('sponsors', { id: prod, amount: 2000 });
  assert.equal(s1.status, 200);
  assert.deepEqual(await s1.json(), { ok: true, id: prod, amount: 2000 });
  assert.equal((await call('ana', { id: lead, amount: '1500' })).status, 200);
  h = await home();
  assert.equal(h.owed.v, '$2,000');
  assert.equal(h.close.v, '$1,500');
  assert.equal((await (await call('sponsors')).json()).deals.find((d) => d.id === lead).bucket, 'to-close');
  assert.equal((await (await call('sponsors')).json()).deals.find((d) => d.id === prod).amount, 2000);
  // Stage to paid moves it out of Money owed (amount kept), in one call with a new amount too.
  const s2 = await call('sponsors', { id: prod, stage: 'paid', amount: 2100 });
  assert.equal(s2.status, 200);
  assert.deepEqual(await s2.json(), { ok: true, id: prod, amount: 2100, stage: 'paid' });
  const after = (await (await call('sponsors')).json()).deals.find((d) => d.id === prod);
  assert.equal(after.bucket, null);
  assert.equal(after.amount, 2100);
  h = await home();
  assert.notEqual(h.owed.v, '$2,000');
  assert.ok(!(await t.d2()).d2.pipeline.boards.find((b) => b.goal === 'sponsors').sponsors.board.columns.filter((c) => c.title !== 'Paid & Done' && !c.archived).some((c) => c.cards.some((k) => k.id === prod)));
  // Bad amount 400, and nothing changes (not even a stage sent with it).
  for (const amount of [-1, 1000001, 'abc']) assert.equal((await call('sponsors', { id: lead, amount, stage: 'invoice-sent' })).status, 400, String(amount));
  assert.equal(t.db.sqlite.prepare('SELECT stage FROM deal_stage_overrides WHERE deal_id = ?').get(lead).stage, 'contract-brief');
  assert.equal((await (await call('sponsors')).json()).deals.find((d) => d.id === lead).amount, 1500);
  // Bad id 400, unknown id 404, bad stage / nothing to set / bad body 400.
  for (const id of ['x', 'gmail-thread-zz', '', 'Newsy']) assert.equal((await call('sponsors', { id, amount: 5 })).status, 400, id);
  assert.equal((await call('sponsors', { id: 'gmail-thread-fff999fff999', amount: 5 })).status, 404);
  assert.equal((await call('sponsors', { id: lead, stage: 'bogus' })).status, 400);
  assert.equal((await call('sponsors', { id: lead })).status, 400);
  for (const body of ['[1]', 'not json', 'null']) assert.equal((await call('sponsors', body)).status, 400, body);
  // No deal added or removed, and only sponsor.set_amount / move_stage rows were written.
  assert.equal((await (await call('sponsors')).json()).deals.length, list.deals.length);
  assert.deepEqual(t.db.sqlite.prepare('SELECT DISTINCT kind FROM actions ORDER BY kind').all().map((r) => r.kind), ['sponsor.move_stage', 'sponsor.set_amount']);
  assert.deepEqual(Object.keys(JSON.parse(t.db.sqlite.prepare("SELECT data FROM snapshots WHERE source = 'sponsor_deals'").get().data).deals).sort(), [lead, prod].sort());
}));
