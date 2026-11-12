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
  const want = { 'gmail-thread-aaa111aaa111': ['negotiating', 'Negotiations'], 'gmail-thread-bbb222bbb222': ['drafts', 'Leads'],
    'gmail-thread-ccc333ccc333': ['contract-brief', 'Deals'], 'gmail-thread-ddd444ddd444': ['balance-invoice', 'Balance Invoice'] };
  for (const [id, [stage]] of Object.entries(want)) await t.act('sponsor.move_stage', { id, stage });
  const r = await t.d2();
  for (const [id, [stage, col]] of Object.entries(want)) {
    assert.equal(t.db.sqlite.prepare('SELECT stage FROM deal_stage_overrides WHERE deal_id = ?').get(id).stage, stage);
    assert.equal(t.where(r, id), col, id);
  }
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
