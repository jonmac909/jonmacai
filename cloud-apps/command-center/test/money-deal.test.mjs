// Money page deal view (#money/<deal id>): a deal card opens its amount, stage, blocker, next step and Gmail thread;
// GPU1's wanted list holds the Money deals' threads as well as the Review drafts'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { buildSponsorsPage, dealThreadIds } from '../src/sponsors.js';
import { dealStages, dealOf, renderMoney } from '../public/d3/js/money.js';
import { threadHtml, threadClick } from '../public/d3/js/thread.js';

const SAMPLE = () => JSON.parse(readFileSync(new URL('./fixtures/d2-sample.json', import.meta.url), 'utf8'));
const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-11T19:00:00Z');
const board = (d2) => d2.d2.pipeline.boards.find((b) => b.goal === 'sponsors').sponsors.board;

// A deal planted on the d2 Sponsors board as buildSponsorsPage now writes it, and its 3-message thread.
function planted() {
  const d2 = SAMPLE();
  board(d2).columns.find((c) => c.title === 'Video Production').cards.unshift({
    id: 'gmail-thread-acme', name: 'Acme AI', boardStage: 'production', pill: 'In progress', pillCls: '', amt: 3200,
    amtLabel: '$3,200', detail: 'Acme x Jon Mac video', pct: 62, pg: '', threadId: 'abc123def456', status: 'Waiting on sponsor',
    blocker: 'Deposit not in the bank yet', next: 'Ask Ana for the wire trace',
  });
  board(d2).columns.find((c) => c.title === 'Leads').cards.push({ id: 'no-thread', name: 'Nothread Co', boardStage: 'new-lead', pill: 'Waiting on them', pillCls: 'risk', amt: 0, threadId: '', status: '', blocker: null, next: null });
  const threads = { abc123def456: { subject: 'Acme x Jon Mac', messages: [
    { from: 'Ann <ann@acme.ai>', date: '2026-11-01T17:00:00Z', body: 'First: we would love a video.', quoted: false },
    { from: 'Jon Mac <partners@jonmac.ai>', date: '2026-11-02T18:30:00Z', body: 'Second: rate is $3,200.', quoted: true },
    { from: 'Ann <ann@acme.ai>', date: '2026-11-03T20:15:00Z', body: 'Third: deal, deposit sent.', quoted: true },
  ] } };
  return { d2, ui: { deal: 'gmail-thread-acme', rvThreads: { at: '2026-11-11T18:00:00Z', threads } } };
}

test('Money deal view: a planted deal shows all 3 thread messages oldest first, amount, stage, blocked flag and reason, next step', () => {
  const { d2, ui } = planted();
  const html = renderMoney(d2, null, ui);
  assert.match(html, /<h2[^>]*>Acme AI<\/h2>/);
  assert.match(html, /Amount<\/span><b class="krv">\$3,200<\/b>/);
  assert.match(html, /Stage<\/span><span>In production <span class="mut">· Video Production<\/span>/);
  assert.match(html, /Blocked<\/span><span class="stack"[^>]*><b class="dealbad">Yes, blocked<\/b><span[^>]*>Deposit not in the bank yet</);
  assert.match(html, /Next step<\/span><span[^>]*>Ask Ana for the wire trace</);
  assert.match(html, /Status<\/span><span[^>]*>Waiting on sponsor</);
  assert.match(html, /3 messages, oldest first/);
  const at = ['First: we would love', 'Second: rate is', 'Third: deal'].map((s) => html.indexOf(s));
  assert.ok(at.every((i) => i > 0) && at[0] < at[1] && at[1] < at[2], `in order: ${at}`);
  // Dates in Kelowna time; the newest two open, the oldest folded.
  assert.match(html, /Nov 1, 2026, 10:00 AM/);
  const opens = [...html.matchAll(/<details class="rvmsg"( open)?>/g)].map((m) => !!m[1]);
  assert.deepEqual(opens, [false, true, true]);
  assert.equal((html.match(/earlier quoted text hidden/g) || []).length, 2);
  // The board itself isn't drawn under the deal view; the way back is.
  assert.doesNotMatch(html, /Sponsor deals/);
  assert.match(html, /href="#money" data-dealback/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('Money deal view: no thread id says "No thread found"; no sheet row says "not set"; a missing deal says so', () => {
  const { d2, ui } = planted();
  const html = renderMoney(d2, null, { ...ui, deal: 'no-thread' });
  assert.match(html, /Email thread<\/span><span class="nf">No thread found/);
  for (const l of ['Amount', 'Blocked', 'Next step', 'Status']) assert.match(html, new RegExp(`${l}</span><span class="nf">not set`), l);
  // Thread id set but GPU1 hasn't read it (or it's gone from partners@): also "No thread found"; not loaded yet: "Loading".
  assert.match(threadHtml('ffff0000', ui), /No thread found/);
  assert.match(threadHtml('abc123def456', {}), /Loading the thread/);
  assert.match(threadHtml('abc123def456', { rvThreads: { error: 'answered 500' } }), /Could not load the thread \(answered 500\)/);
  // Sheet row with an empty blocker: "No".
  board(d2).columns.find((c) => c.title === 'Video Production').cards[0].blocker = '';
  assert.match(renderMoney(d2, null, ui), /Blocked<\/span><span>No<\/span>/);
  assert.match(renderMoney(d2, null, { ...ui, deal: 'gone' }), /This deal is not on the Sponsors board now/);
});

test('Money board: every deal card links to its deal view; +N more opens the whole stage; clicks fold a message', () => {
  const { d2, ui } = planted();
  const lead = board(d2).columns.find((c) => c.title === 'Leads');
  for (let i = 0; i < 10; i++) lead.cards.push({ id: `lead-${i}`, name: `Lead ${i}`, boardStage: 'new-lead', pill: '', amt: 0 });
  const html = renderMoney(d2, null, {});
  assert.match(html, /<a class="vcard dealcard" href="#money\/gmail-thread-acme"/);
  assert.match(html, /data-dealmore="Lead">\+3 more</);
  assert.ok(!html.includes('href="#money/lead-9"'));
  const all = renderMoney(d2, null, { dealsAll: { Lead: true } });
  assert.ok(all.includes('href="#money/lead-9"'));
  assert.match(all, /data-dealmore="Lead">Show fewer</);
  assert.equal(dealOf(d2, 'gmail-thread-acme').threadId, 'abc123def456');
  assert.equal(dealStages(d2)[3].deals[0].next, 'Ask Ana for the wire trace');
  // A click on the oldest message's summary opens it (kept in ui.rvOpen).
  let drawn = 0;
  const summary = { dataset: { rvmsg: 'abc123def456:0' }, parentElement: { open: false } };
  const e = { target: { closest: (sel) => (sel === '[data-rvmsg]' ? summary : null) }, preventDefault() {} };
  assert.equal(threadClick(e, ui, () => { drawn++; }), true);
  assert.equal(ui.rvOpen['abc123def456:0'], true);
  assert.equal(drawn, 1);
  assert.match(renderMoney(d2, null, ui), /^<details class="rvmsg" open><summary data-rvmsg="abc123def456:0">/m);
  assert.equal(threadClick({ target: { closest: () => null } }, ui, () => {}), false);
});

// ---- Data: the board cards carry the thread id, status, blocker and next step ----
const card = (id, stage, extra = {}) => ({ id, sponsor: id, contact: '', stage, amount: null, status: 'Waiting on sponsor', latestDate: '2026-11-05T12:00:00Z', to: '', threadId: '', subject: `${id} subject`, reason: '', needsDraft: false, ...extra });
const DRAFT = { status: 'needs-review', body: 'Hi', to: 'a@b.c', subject: 'Re' };
const sponsorsData = () => ({
  collections: { items: [{ sponsor: 'Acme', total: 3200, paid: 0, owed: 3200, bucket: 'collect-now', blocker: 'Deposit missing', action: 'Ask for the trace', lastEmail: 'November 5, 2026' }] },
  cards: [
    card('Acme', 'production', { threadId: '1a2b3c4d5e6f' }), // Money deal (sheet row: blocker and next step)
    card('Drafty', 'new-lead', { threadId: 'aaaa1111bbbb', draftReply: DRAFT }), // Review draft and Money Lead
    card('Quiet', 'production', { threadId: 'cccc2222dddd', latestDate: '2026-08-01T12:00:00Z' }), // archived: 60+ days quiet
    card('Cold', 'new-lead', { threadId: 'eeee3333ffff' }), // not on the board (no draft, no sheet row, not active)
    card('Moved', 'new-lead', { threadId: '9999888877776666' }), // dragged to production on the board (override)
    card('Junkid', 'production', { threadId: 'not-a-thread!' }), // bad id never asked for
    card('Gone', 'archived', { threadId: '0000aaaa0000', draftReply: DRAFT }),
  ],
});

test('buildSponsorsPage: board cards carry threadId, status, blocker and next step (null when the sheet has no row)', () => {
  const page = buildSponsorsPage(sponsorsData(), NOW);
  const ks = Object.fromEntries(page.board.columns.flatMap((c) => c.cards).map((k) => [k.id, k]));
  assert.deepEqual([ks.Acme.threadId, ks.Acme.status, ks.Acme.blocker, ks.Acme.next], ['1a2b3c4d5e6f', 'Waiting on sponsor', 'Deposit missing', 'Ask for the trace']);
  assert.deepEqual([ks.Drafty.threadId, ks.Drafty.blocker, ks.Drafty.next], ['aaaa1111bbbb', null, null]);
  assert.deepEqual(dealThreadIds(sponsorsData(), NOW), ['1a2b3c4d5e6f', 'aaaa1111bbbb']);
  assert.deepEqual(dealThreadIds(sponsorsData(), NOW, { Moved: 'production' }), ['1a2b3c4d5e6f', 'aaaa1111bbbb', '9999888877776666']);
  assert.deepEqual(dealThreadIds(null, NOW), []);
});

test('GET /sponsor-threads/wanted: GPU1 only, Review drafts plus every Money deal thread, stage overrides applied', async () => {
  const db = sqliteD1();
  db.sqlite.prepare('INSERT INTO snapshots (source, data, collected_at, received_at) VALUES (?, ?, ?, ?)').run('sponsors', JSON.stringify(sponsorsData()), '2026-11-11T18:00:00Z', '2026-11-11T18:00:00Z');
  db.sqlite.prepare('INSERT INTO deal_stage_overrides (deal_id, stage, updated_at) VALUES (?, ?, ?)').run('Moved', 'production', '2026-11-10T00:00:00Z');
  const env = { DB: db, SESSION_SECRET: SECRET, MACHINE_TOKEN_GPU1: 'gpu1-token', MACHINE_TOKEN_MAC: 'mac-token' };
  const ask = (token, path = '/dashboard/api/sponsor-threads/wanted') => handleApi(new Request(`https://jonmac.ai${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {}), env);
  const real = Date.now;
  Date.now = () => NOW;
  try {
    assert.equal((await ask()).status, 401);
    assert.equal((await ask('mac-token')).status, 401);
    const res = await ask('gpu1-token');
    assert.equal(res.status, 200);
    const { threads } = await res.json();
    assert.deepEqual([...threads].sort(), ['1a2b3c4d5e6f', '9999888877776666', 'aaaa1111bbbb']);
    assert.ok(!threads.includes('cccc2222dddd') && !threads.includes('eeee3333ffff') && !threads.includes('0000aaaa0000'));
    // No sponsors snapshot yet: an empty list, not an error.
    const empty = await handleApi(new Request('https://jonmac.ai/dashboard/api/sponsor-threads/wanted', { headers: { Authorization: 'Bearer gpu1-token' } }), { ...env, DB: sqliteD1() });
    assert.deepEqual((await empty.json()).threads, []);
    // The page reads them with Jon's session: the snapshot GPU1 sent (only GPU1 may send it).
    const send = (token) => handleApi(new Request('https://jonmac.ai/dashboard/api/ingest', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'sponsor_threads', collectedAt: '2026-11-11T18:30:00Z', data: { threads: { '1a2b3c4d5e6f': { subject: 's', messages: [{ from: 'a', date: '2026-11-01T00:00:00Z', body: 'hi' }] } } } }) }), env);
    assert.equal((await send('mac-token')).status, 401);
    assert.equal((await send('gpu1-token')).status, 200);
    assert.equal((await ask(null, '/dashboard/api/sponsor-threads')).status, 401);
    const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
    const page = await handleApi(new Request('https://jonmac.ai/dashboard/api/sponsor-threads', { headers: { Cookie: cookie } }), env);
    const body = await page.json();
    assert.equal(body.at, '2026-11-11T18:30:00Z');
    assert.equal(body.threads['1a2b3c4d5e6f'].messages[0].body, 'hi');
  } finally {
    Date.now = real;
  }
});
