import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../src/api.js';
import { sha256Hex, todayData } from '../src/bots.js';
import { pullWebinarMonth } from '../src/cron.js';
import { buildToday, monthWindow, vanMidnight, sourceOf } from '../src/today.js';
import { funnelMonth } from '../src/webinar.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TOK = { ana: `ccb_${'a'.repeat(43)}`, 'home-guide-press': `ccb_${'h'.repeat(43)}`, sponsors: `ccb_${'s'.repeat(43)}` };
const NOW = Date.parse('2026-10-29T19:00:00Z'); // Thu Oct 29, 12:00 PT

async function setup() {
  const db = sqliteD1();
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
const cookie = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;
async function call(env, method, path, { bot, body, jon } = {}) {
  const h = new Headers();
  if (bot) h.set('Authorization', `Bearer ${TOK[bot]}`);
  if (jon) { h.set('Cookie', await cookie()); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}

test('feeds: only the named bot posts, data is checked, newest wins', async () => {
  const { env } = await setup();
  assert.equal((await call(env, 'PUT', '/v1/feeds/morning_summary', { bot: 'sponsors', body: { text: 'hi' } })).status, 403);
  assert.equal((await call(env, 'PUT', '/v1/feeds/morning_summary', { jon: true, body: { text: 'hi' } })).status, 403);
  assert.equal((await call(env, 'PUT', '/v1/feeds/nope', { bot: 'ana', body: {} })).status, 404);
  assert.equal((await call(env, 'PUT', '/v1/feeds/__proto__', { bot: 'ana', body: {} })).status, 404);
  assert.equal((await call(env, 'PUT', '/v1/feeds/morning_summary', { bot: 'ana', body: { text: '' } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/feeds/claude_usage', { bot: 'ana', body: { weekPct: 'lots' } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/feeds/claude_usage', { bot: 'ana', body: { weekPct: true } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/feeds/ebook_sales', { bot: 'home-guide-press', body: { month: '2026-13', usd: 5 } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/feeds/ebook_sales', { bot: 'home-guide-press', body: { month: '2026-10', usd: 5, orders: 1.5 } })).status, 400);
  await call(env, 'PUT', '/v1/feeds/morning_summary', { bot: 'ana', body: { text: 'old', date: '2026-10-28' } });
  const put = await call(env, 'PUT', '/v1/feeds/morning_summary', { bot: 'ana', body: { text: 'Line 1\nLine 2', date: '2026-10-29', extra: 'dropped' } });
  assert.equal(put.status, 201);
  assert.deepEqual(put.body.feed.data, { text: 'Line 1\nLine 2', date: '2026-10-29' });
  const got = await call(env, 'GET', '/v1/feeds/morning_summary', { jon: true });
  assert.deepEqual([got.body.feed.data.text, got.body.feed.bot], ['Line 1\nLine 2', 'ana']);
  assert.equal((await call(env, 'GET', '/v1/feeds/claude_usage', { bot: 'sponsors' })).body.feed, null);
});

test('month window and Vancouver midnight across daylight saving', () => {
  assert.equal(new Date(vanMidnight(2026, 3, 1)).toISOString(), '2026-03-01T08:00:00.000Z', 'PST');
  assert.equal(new Date(vanMidnight(2026, 10, 1)).toISOString(), '2026-10-01T07:00:00.000Z', 'PDT');
  // BC's offset after Nov 2026 depends on the tz data (2026e: permanent UTC-7), so check the local time.
  const local = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  for (const [m, d] of [[11, 1], [12, 1], [1, 1]]) assert.equal(local(vanMidnight(m === 1 ? 2027 : 2026, m, d)), `${m === 1 ? 2027 : 2026}-${String(m).padStart(2, '0')}-01, 00:00`);
  const w = monthWindow(NOW);
  assert.deepEqual([w.key, w.label, w.daysLeft], ['2026-10', 'October', 3]);
  assert.ok(w.elapsed > 0.9 && w.elapsed < 0.95);
  assert.equal(monthWindow(Date.parse('2026-11-01T06:30:00Z')).key, '2026-10', 'still Oct 31 in Vancouver');
  assert.equal(sourceOf('x', '2026-10-28T18:00:00Z', NOW).stale, true);
  assert.equal(sourceOf('x', '2026-10-29T18:00:00Z', NOW).stale, false);
  assert.equal(sourceOf('x', null, NOW).stale, true);
});

test('funnelMonth counts verified payments minus refunds inside the window', async () => {
  const c = new DatabaseSync(':memory:');
  c.exec(`CREATE TABLE clone_session_events (event_id TEXT PRIMARY KEY, session_date TEXT, kind TEXT, offer TEXT, amount_cents INTEGER, transaction_ref TEXT, occurred_at INTEGER)`);
  const ins = c.prepare('INSERT INTO clone_session_events VALUES (?, NULL, ?, ?, ?, NULL, ?)');
  ins.run('p1', 'payment', 'seat', 4700, Date.parse('2026-10-05T00:00:00Z'));
  ins.run('p2', 'payment', 'audit', 49700, Date.parse('2026-10-20T00:00:00Z'));
  ins.run('r1', 'refund', 'seat', 4700, Date.parse('2026-10-21T00:00:00Z'));
  ins.run('v1', 'visit', null, 0, Date.parse('2026-10-22T00:00:00Z'));
  ins.run('old', 'payment', 'seat', 4700, Date.parse('2026-09-30T06:00:00Z'));
  const db = { prepare: (sql) => ({ bind: (...a) => ({ first: async () => ({ ...c.prepare(sql).get(...a) }) }), first: async () => ({ ...c.prepare(sql).get() }) }) };
  const w = monthWindow(NOW);
  const f = await funnelMonth(db, w.start, w.end);
  assert.deepEqual([f.netCents, f.payments, f.visits, f.lastEventAt], [49700, 2, 1, '2026-10-22T00:00:00.000Z']);
  assert.equal(await funnelMonth(null, 0, 1), null);
});

function fixture() {
  const out = { pages: { today: {}, videos: { ready: [{ video: 'Ep 4', channel: 'Jon Mac', slug: 'ep4' }] }, money: { bankScan: { rows: [{ title: 'RBC', pill: 'Needs code' }] } } }, sources: { bank_scan: {} } };
  const by = {
    viralview: { collected_at: '2026-10-29T14:00:00Z', data: JSON.stringify({ subscriptions: { current: { mrrCents: 360000, activeCustomers: 40 }, customers: { newThisMonth: 6 }, trials: { newTrials: 9 } } }) },
    sponsors_cash: { collected_at: '2026-10-29T18:55:00Z' },
    webinar_funnel: { collected_at: '2026-10-29T18:50:00Z', data: JSON.stringify({ month: '2026-10', netCents: 0, payments: 0, visits: 37, lastEventAt: '2026-10-23T08:00:00Z' }) },
    jon_tasks: { collected_at: '2026-10-24T21:15:41-07:00' },
    needs_jon: { collected_at: '2026-10-29T18:00:00Z', data: JSON.stringify({ ok: true, items: [{ area: 'Domains', ask: 'Renew jonmac.ai' }] }) },
  };
  const cash = { available: true, month: { usd: 4500, payments: 2, unknown: 1 }, source: { kind: 'ledger', label: 'cash_ledger.csv', stale: true, note: 'Ledger is 5 days old.' } };
  const extra = {
    pendingDeliverables: [{ id: 'd1', title: 'Paul ep 3 cut', owner: 'Video Editor', kind: 'video', url: 'javascript:alert(1)', finished_at: '2026-10-28T04:16:32Z' }],
    questions: [
      { id: 'aq1', asked_at: '2026-10-24T09:00:00-07:00', asker: 'Ana', project: 'Sponsors', question: 'Old Ana question?', options: '["Yes","No"]', status: 'open', answer: null },
      { id: 'aq2', asked_at: '2026-10-25T09:00:00-07:00', asker: 'Ana', question: 'Answered one', options: '[]', status: 'answered', answer: 'ok' },
    ],
    today: {
      questions: [{ id: 'q_1', askedBy: 'sponsors', question: 'Bot question?', options: ['A'], createdAt: '2026-10-29T10:00:00Z' }],
      approvals: [{ id: 'a_1', action: 'send_pitches', title: 'Send 20 pitches', requestedBy: 'sponsors', payload: { count: 20 }, createdAt: '2026-10-29T11:00:00Z' }],
      feeds: {
        morning_summary: { bot: 'ana', createdAt: '2026-10-29T15:15:00Z', data: { text: 'All good', date: '2026-10-29' } },
        claude_usage: { bot: 'ana', createdAt: '2026-10-29T15:15:00Z', data: { weekPct: 78, resetsAt: '2026-10-31T17:00:00Z' } },
        ebook_sales: undefined,
      },
      runs7d: { tokens: 1200000, runs: 30 },
    },
  };
  return { out, by, cash, extra };
}

test('Today: four goals with sources, stale marks, and an honest total', () => {
  const { out, by, cash, extra } = fixture();
  buildToday(out, by, cash, extra, NOW);
  const t = out.pages.today;
  assert.deepEqual(t.goals.map((g) => g.key), ['sponsors', 'viral', 'webinar', 'ebooks']);
  const [s, v, w, e] = t.goals;
  // The collector re-sent the ledger 5 minutes ago, but the ledger itself is old: still stale.
  assert.deepEqual([s.value, s.pct, s.source.ageLabel, s.source.stale], ['$4,500', 45, 'updated 5 min ago', true]);
  assert.equal(s.warn, 'Ledger is 5 days old. 1 deposit has no amount yet and counts as $0.');
  assert.deepEqual([v.value, v.goal, v.status.text, v.source.stale], ['$3,600', '/ $10,000 MRR', '36% of goal', false]);
  assert.deepEqual([w.value, w.source.stale, w.drivers[2].value], ['$0', false, '6 days ago']);
  assert.deepEqual([e.value, e.usd, e.source.stale], ['no data', null, true]);
  assert.match(e.why, /No ebook sales posted for October yet/);
  assert.deepEqual([t.total.value, t.total.goal, t.total.reporting], ['$8,100', '$40,000', '3 of 4 goals reporting']);
  assert.equal(t.summary.text, 'All good');
  assert.deepEqual([t.usage.pct, t.usage.level.cls, t.usage.bots.tokens], [78, 'risk', 1200000]);

  // An old funnel read is stale; a funnel read for last month is not this month's figure.
  const old = fixture();
  old.by.webinar_funnel.collected_at = '2026-10-28T10:00:00Z';
  buildToday(old.out, old.by, old.cash, old.extra, NOW);
  assert.equal(old.out.pages.today.goals[2].source.stale, true);
  const sept = fixture();
  sept.by.webinar_funnel.data = JSON.stringify({ month: '2026-09', netCents: 4700 });
  buildToday(sept.out, sept.by, sept.cash, sept.extra, NOW);
  assert.equal(sept.out.pages.today.goals[2].usd, null);

  // Usage levels apply above 75% and 90%, not at them; an unreadable feeds table says so.
  for (const [pct, cls] of [[75, 'ok'], [75.5, 'risk'], [90, 'risk'], [91, 'crit']]) {
    const f = fixture();
    f.extra.today.feeds.claude_usage.data.weekPct = pct;
    buildToday(f.out, f.by, f.cash, f.extra, NOW);
    assert.equal(f.out.pages.today.usage.level.cls, cls, String(pct));
  }
  const broken = fixture();
  broken.extra.today.feeds = { morning_summary: null, claude_usage: null, ebook_sales: null };
  buildToday(broken.out, broken.by, broken.cash, broken.extra, NOW);
  assert.equal(broken.out.pages.today.summary.missing, 'The feeds table could not be read.');
  assert.equal(broken.out.pages.today.goals[3].why, 'The feeds table could not be read.');
});

test('Today: Needs you puts alerts first, then approvals, then questions oldest first', () => {
  const { out, by, cash, extra } = fixture();
  buildToday(out, by, cash, extra, NOW);
  const items = out.pages.today.needs.items;
  assert.deepEqual(items.map((i) => i.kind), ['alert', 'approval', 'deliverable', 'question', 'question', 'review', 'waiting']);
  assert.equal(items[0].title, 'Bank code needed: RBC');
  assert.equal(items[1].decideUrl, '/dashboard/api/v1/approvals/a_1/decide');
  assert.equal(items[1].payloadPreview, '{\n  "count": 20\n}', 'Jon sees the values the bot will run with');
  assert.equal('payload' in items[1], false, 'the full payload is not sent to the page');
  assert.deepEqual(items.filter((i) => i.kind === 'question').map((i) => i.answerUrl), ['/dashboard/api/questions/aq1/answer', '/dashboard/api/v1/questions/q_1/answer']);
  assert.deepEqual(items[3].options, ['Yes', 'No']);
  assert.equal(items.some((i) => i.title === 'Answered one'), false);
  assert.equal(out.pages.today.needs.sources[1].stale, true, "Ana's push is 5 days old");
});

test('approval payloads stay short enough for Jon to read all of them; ingest cannot fake the funnel', async () => {
  const { env } = await setup();
  const big = { recipients: Array.from({ length: 200 }, (_, i) => `person${i}@example.com`) };
  const r = await call(env, 'POST', '/v1/approvals', { bot: 'sponsors', body: { action: 'send_pitches', title: 'Too long', payload: big } });
  assert.deepEqual([r.status, /4000 characters/.test(r.body.error)], [400, true]);
  const ok = await call(env, 'POST', '/v1/approvals', { bot: 'sponsors', body: { action: 'send_pitches', title: 'Fits', payload: { list: 'D:\\pitches\\2026-10-29.csv', count: 20 } } });
  assert.equal(ok.status, 201);
  const ingest = await handleApi(new Request('https://jonmac.ai/dashboard/api/ingest', {
    method: 'POST', headers: { Authorization: 'Bearer gpu1-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'webinar_funnel', collectedAt: new Date().toISOString(), data: { month: '2026-10', netCents: 999999 } }),
  }), { ...env, MACHINE_TOKEN_GPU1: 'gpu1-token' });
  assert.equal(ingest.status, 401);
});

test('snapshot serves Today end to end and Jon can answer and approve from it', async () => {
  const { env } = await setup();
  await call(env, 'POST', '/v1/questions', { bot: 'sponsors', body: { question: 'Live question?', options: ['Yes'] } });
  const appr = (await call(env, 'POST', '/v1/approvals', { bot: 'sponsors', body: { action: 'send_pitches', title: 'Send pitches' } })).body.approval;
  await call(env, 'PUT', '/v1/feeds/claude_usage', { bot: 'ana', body: { weekPct: 92 } });
  const snap = await handleApi(new Request('https://jonmac.ai/dashboard/api/snapshot?pages=today', { headers: { Cookie: await cookie() } }), env);
  const t = (await snap.json()).pages.today;
  assert.equal(t.goals.length, 4);
  assert.deepEqual(t.needs.items.map((i) => i.kind), ['approval', 'question']);
  assert.equal(t.usage.level.cls, 'crit');
  assert.equal(t.goals[2].why, 'The funnel figure for October has not been read yet.');
  const ok = await call(env, 'POST', t.needs.items[0].decideUrl.replace('/dashboard/api', ''), { jon: true, body: { decision: 'approve' } });
  assert.equal(ok.body.approval.status, 'approved');
  assert.equal(ok.body.approval.id, appr.id);
  const ans = await call(env, 'POST', t.needs.items[1].answerUrl.replace('/dashboard/api', ''), { jon: true, body: { answer: 'Yes' } });
  assert.equal(ans.body.question.answer, 'Yes');
});

test('todayData: ebook sales for the asked month, and one missing table does not hide the rest', async () => {
  const { env, db } = await setup();
  const acct = `ccb_${'c'.repeat(43)}`;
  await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(acct), 'accounting', 'x').run();
  await call(env, 'PUT', '/v1/feeds/ebook_sales', { bot: 'home-guide-press', body: { month: '2026-10', usd: 250, orders: 9 } });
  await handleApi(new Request('https://jonmac.ai/dashboard/api/v1/feeds/ebook_sales', {
    method: 'PUT', headers: { Authorization: `Bearer ${acct}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ month: '2026-09', usd: 120 }),
  }), env);
  const d = await todayData(db, NOW, '2026-10');
  assert.deepEqual([d.feeds.ebook_sales.data.usd, d.feeds.ebook_sales.bot], [250, 'home-guide-press'], 'a later September post does not hide October');
  assert.equal(d.feeds.morning_summary, undefined, 'nothing posted yet');
  assert.deepEqual([d.questions, d.approvals], [[], []]);

  db.sqlite.exec('DROP TABLE bot_feed_entries');
  const half = await todayData(db, NOW, '2026-10');
  assert.deepEqual([half.feeds.morning_summary, half.feeds.ebook_sales, half.questions], [null, null, []]);
});

test('cron stores this month\'s webinar funnel figure as a snapshot', async () => {
  const c = new DatabaseSync(':memory:');
  c.exec('CREATE TABLE clone_session_events (event_id TEXT PRIMARY KEY, session_date TEXT, kind TEXT, offer TEXT, amount_cents INTEGER, transaction_ref TEXT, occurred_at INTEGER)');
  c.prepare('INSERT INTO clone_session_events VALUES (?, NULL, ?, ?, ?, NULL, ?)').run('p1', 'payment', 'seat', 4700, Date.parse('2026-10-05T00:00:00Z'));
  const clone = { prepare: (sql) => ({ bind: (...a) => ({ first: async () => ({ ...c.prepare(sql).get(...a) }) }) }) };
  const db = sqliteD1();
  await pullWebinarMonth({ DB: db, CLONE_DB: clone }, NOW);
  const row = await db.prepare("SELECT * FROM snapshots WHERE source = 'webinar_funnel'").first();
  assert.deepEqual(JSON.parse(row.data), { netCents: 4700, payments: 1, visits: 0, lastEventAt: '2026-10-05T00:00:00.000Z', month: '2026-10' });
  await pullWebinarMonth({ DB: db, CLONE_DB: null }, NOW + 60000);
  assert.equal((await db.prepare("SELECT collected_at FROM snapshots WHERE source = 'webinar_funnel'").first()).collected_at, new Date(NOW).toISOString(), 'an unreadable funnel keeps the old row so it turns stale');
});
