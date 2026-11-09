import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import GOALS from '../src/d2-goals.json' with { type: 'json' };
import { DatabaseSync } from 'node:sqlite';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi, PAGES, liveNav } from '../src/api.js';
import worker from '../src/worker.js';
import { signSession, COOKIE } from '../src/auth.js';
import { mergeSnapshot } from '../src/snapshot.js';
import { listSnapshots, listDealStages, listHabits } from '../src/db.js';
import { todayData } from '../src/bots.js';
import { allChannels, channelData } from '../src/channels.js';
import { listFunnel } from '../src/webinar.js';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };

// The Daily Summary's weather is the one network call (Open-Meteo); no test reaches the real one.
globalThis.fetch = async (url) => {
  if (!/open-meteo/.test(String(url))) throw new Error(`no network in tests: ${url}`);
  return Response.json({ current: { temperature_2m: 6.4, weather_code: 61 }, daily: { temperature_2m_max: [9.1], temperature_2m_min: [2.2], precipitation_probability_max: [60] } });
};

const FOCUS = GOALS.goals.find((g) => g.key === 'hgp').focus;
// The server's own answer, which test/d2-ui.test.mjs reads (in its own process). Regenerate: UPDATE_FIXTURES=1 npm test.
const SAMPLE = new URL('./fixtures/d2-sample.json', import.meta.url);
const UPDATE = process.env.UPDATE_FIXTURES === '1';
const SAMPLE_MTIME = statSync(SAMPLE).mtimeMs;

const SECRET = 'test-session-secret-32-bytes-ok!';
const SUNDAY = Date.parse('2026-11-08T21:05:00Z'); // Sunday Nov 8, 2:05 PM in Kelowna
const FRIDAY = Date.parse('2026-11-06T14:00:00Z'); // Friday Nov 6, 7:00 AM
const NAMES = ['Florence', 'Elle', 'Sydney', 'Scarlett', 'Samantha', 'Olivia', 'Daisy', 'Elizabeth', 'Mila', 'Jon'];
const STATUS = ['On pace', 'Behind', 'Off pace', 'Done', 'No data', 'Not tracked yet', 'None due yet'];

function ins(db, table, row) {
  const keys = Object.keys(row);
  db.sqlite.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => (row[k] && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k])));
}
let n = 0;
const id = (p) => `${p}_${String(++n).padStart(16, '0')}`;
const task = (db, t) => { const row = { id: id('t'), owner: 'sponsors', status: 'todo', created_by: 'ana', updated_by: 'ana', created_at: '2026-11-01T16:00:00Z', updated_at: '2026-11-07T16:00:00Z', ...t }; ins(db, 'bot_tasks', row); return row.id; };
const ask = (db, q) => ins(db, 'bot_questions', { id: id('q'), status: 'open', question: 'Which one?', options: ['A', 'B'], created_at: '2026-11-05T16:00:00Z', updated_at: '2026-11-05T16:00:00Z', ...q });
const tick = (db, day, project, item, at = `${day}T16:00:00Z`, link = 'https://example.com/proof') => ins(db, 'bot_daily_ticks', { id: id('d'), day, project, item, bot: project, link, created_at: at });
const cal = (db, channel, day, status, title = `Video ${channel} ${day}`) => ins(db, 'yt_calendar', { id: id('v'), channel, title, day, status, created_by: 'ana', updated_by: 'ana', created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-08T18:00:00Z' });
const snap = (db, source, data, at) => ins(db, 'snapshots', { source, data, collected_at: at, received_at: at });

// MoneyClaw's markets and expenses (with charge lists) for the Daily Summary: a repeated Canva charge, a big Adobe one, a new OpenAI one.
const charge = (date, description, amount, extra = {}) => ({ date, description, amount, pending: false, ...extra });
const period = (total, extra = {}) => ({ total, pending: 0, posted: total, totalCents: Math.round(total * 100), pendingCents: 0, ...extra });
const MONEY_EXTRA = {
  expenses: {
    business: {
      yesterday: period(209.97), week: period(250), month: period(500),
      lastMonth: period(110, { startDate: '2026-10-01', endDate: '2026-10-31', charges: [
        charge('2026-10-05', 'ADOBE CREATIVE CLOUD', 20), charge('2026-10-12', 'ADOBE CREATIVE CLOUD', 20), charge('2026-10-19', 'ADOBE CREATIVE CLOUD', 20),
        charge('2026-10-10', 'CANVA 04123', 14.99), charge('2026-10-26', 'ZOOM.US', 15.99),
      ] }),
      month: period(500, { startDate: '2026-11-01', endDate: '2026-11-07', charges: [
        charge('2026-11-06', 'ADOBE CREATIVE CLOUD', 90), charge('2026-11-07', 'CANVA 98765', 14.99), charge('2026-11-07', 'CANVA 98766', 14.99),
        charge('2026-11-07', 'OPENAI API', 180.01), charge('2026-11-02', 'ZOOM.US', 15.99, { currency: 'EUR' }),
      ] }),
    },
    personal: { yesterday: period(0), week: period(12), month: period(42), lastMonth: period(80) },
  },
  markets: { core: [
    { symbol: 'VOO', label: 'VOO', price: 701.89, allTimeHigh: 716.39, todayPct: 0.1, pctOffHigh: 2 },
    { symbol: 'QQQ', label: 'QQQ', price: 721.35, allTimeHigh: 748.65, todayPct: 0.6, pctOffHigh: 3.6 },
  ] },
};

// One week of team data: Sunday Nov 8, 2026.
function seed() {
  const db = sqliteD1();
  const draft = { status: 'needs-review', body: 'Hi there' };
  snap(db, 'sponsors', {
    updatedAt: '2026-11-08T20:00:00Z', sourceEditedAt: '2026-11-08T19:00:00Z',
    collections: {
      items: [{ sponsor: 'Invideo', total: 4200, paid: 2100, owed: 2100, bucket: 'delivery-balance', bucketLabel: 'Owed after posting', lastEmail: 'November 4, 2026' }],
      incomeTotals: { October: 6000 }, completedIncomeMonths: ['October'], currentIncomeMonth: 'November',
    },
    cards: [
      { id: 'c-invideo', sponsor: 'Invideo', contact: 'Nehal', stage: 'publishing', latestDate: 'Wed, 04 Nov 2026 10:00:00 -0700', to: 'nehal@invideo.io', subject: 'Video 1 is live' },
      { id: 'c-poppy', sponsor: 'Poppy', contact: 'Ann', stage: 'negotiating', amount: 2500, latestDate: 'Mon, 02 Nov 2026 10:00:00 -0700', to: 'ann@poppy.ai', subject: 'Paid collab', draftReply: draft },
      { id: 'c-receipt', sponsor: 'Kie', contact: 'Kie', stage: 'new-lead', latestDate: 'Sat, 07 Nov 2026 10:00:00 -0700', to: 'receipts@stripe.com', subject: 'Your receipt from Kie.ai', draftReply: draft },
      { id: 'c-refund', sponsor: 'Commas', contact: 'Commas', stage: 'new-lead', latestDate: 'Sat, 07 Nov 2026 10:00:00 -0700', to: 'support@commas.io', subject: 'Refund processed for order 123', draftReply: draft },
      { id: 'c-news', sponsor: 'Creator Weekly', contact: 'Creator Weekly', stage: 'new-lead', latestDate: 'Fri, 06 Nov 2026 10:00:00 -0700', to: 'newsletter@creatorweekly.com', subject: 'This week in creators', draftReply: draft },
      { id: 'c-quiet', sponsor: 'Topview', contact: 'Dorothy', stage: 'script-approval', latestDate: 'Thu, 03 Sep 2026 10:00:00 -0700', to: 'dorothy@topview.ai', subject: 'Collab' },
      { id: 'c-arcads', sponsor: 'Arcads', contact: 'Lee', stage: 'production', latestDate: 'Thu, 05 Nov 2026 10:00:00 -0700', to: 'lee@arcads.ai', subject: 'Arcads collab' },
      { id: 'c-paid', sponsor: 'Creatify', contact: 'Sam', stage: 'paid', amount: 1000, latestDate: 'Sun, 01 Nov 2026 10:00:00 -0700', to: 'sam@creatify.ai', subject: 'Paid' },
    ],
  }, '2026-11-08T21:00:00Z');
  snap(db, 'sponsors_cash', { ok: true, ledgerEditedAt: '2026-11-08T18:00:00Z', rows: [] }, '2026-11-08T21:00:00Z');
  snap(db, 'moneyclaw', { income: { since: '2026-10-01', asOf: '2026-11-07', deposits: [
    { date: '2026-11-01', amount: 1000, description: 'POPPY WIRE' }, { date: '2026-11-03', amount: 2100, description: 'INVIDEO WIRE' },
  ] }, asOf: '2026-11-07', ...MONEY_EXTRA }, '2026-11-08T20:00:00Z');
  ins(db, 'bot_feed_entries', { id: id('f'), name: 'calendar_today', bot: 'ana', data: { date: '2026-11-08', events: [{ start: '15:00', end: '15:30', title: 'Call with Poppy', calendar: 'jon@' }] }, created_at: '2026-11-08T15:00:00Z' });
  snap(db, 'bank_scan', { accounts: [
    { id: 'rbc-business', title: 'RBC business accounts', scanned: 0, total: 4, status: 'failed', scannedAt: '2026-11-08T15:10:00Z' },
    { id: 'rbc-personal', title: 'Personal accounts', scanned: 0, total: 3, status: 'failed', scannedAt: '2026-11-08T15:10:00Z' },
  ] }, '2026-11-08T15:10:00Z');
  snap(db, 'webinar_funnel', { month: '2026-11', netCents: 4700, payments: 1, visits: 40, lastEventAt: '2026-11-07T18:00:00Z' }, '2026-11-08T21:00:00Z');
  ins(db, 'bot_feed_entries', { id: id('f'), name: 'ebook_sales', bot: 'home-guide-press', data: { month: '2026-11', usd: 27, orders: 1 }, created_at: '2026-11-08T16:00:00Z' });

  // Calendars: Jon Mac 2 published + 1 scheduled this week; HGP Peter 3, Jack 1; Rosa Cooks and Eleanor have videos (parked).
  for (const d of ['2026-11-03', '2026-11-05']) cal(db, 'jon-mac', d, 'published');
  cal(db, 'jon-mac', '2026-11-08', 'scheduled');
  cal(db, 'jon-mac', '2026-11-01', 'published');
  cal(db, 'jonmacai', '2026-11-04', 'published');
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-04']) cal(db, 'peter-collins', d, 'published');
  cal(db, 'jack-mercer', '2026-11-06', 'published');
  cal(db, 'rosa-cooks', '2026-10-20', 'published');
  cal(db, 'rosa-cooks', '2026-11-04', 'published', 'Invideo review - Rosa'); // Invideo's video is live on YouTube
  cal(db, 'rosa-cooks', '2026-10-28', 'published', 'Topview review - Rosa');
  cal(db, 'rosa-cooks', '2026-11-04', 'published', 'Topview review 2 - Rosa');
  cal(db, 'eleanor-whitfield', '2026-11-12', 'scheduled');

  // Sponsor cards: Invideo's deal is old (video 1 delivered this week, video 2 late); Poppy's first card is this week.
  task(db, { title: 'Invideo video 1: dedicated', project: 'sponsors', status: 'done', created_at: '2026-10-20T16:00:00Z', done_at: '2026-11-04T18:00:00Z' });
  task(db, { title: 'Invideo video 2: dedicated', project: 'sponsors', status: 'doing', created_at: '2026-10-20T16:00:00Z', due: '2026-11-07' });
  task(db, { title: 'Topview video 2: dedicated', project: 'sponsors', status: 'review', created_at: '2026-10-20T16:00:00Z', due: '2026-11-04' }); // live since Nov 4, card still In Review
  task(db, { title: 'Notion video 1: dedicated', project: 'sponsors', status: 'waiting_on_jon', created_at: '2026-10-20T16:00:00Z', due: '2026-11-07',
    note: 'What happened:\n- Draft ready\nYour move:\n- Approve the script so editing can start\nNext:\n- Edit' });
  const poppy = task(db, { title: 'Poppy video 1: integration', project: 'sponsors', created_at: '2026-11-03T16:00:00Z' });
  task(db, { title: 'Soro video 1', project: 'sponsors', status: 'cancelled', created_at: '2026-11-05T16:00:00Z' });
  // Shorts done: Nov 1 (last week), 3 on Nov 2, 3 on Nov 3, 2 today.
  for (const at of ['2026-11-01T18:00:00Z', ...Array(3).fill('2026-11-02T18:00:00Z'), ...Array(3).fill('2026-11-03T18:00:00Z'), '2026-11-08T17:00:00Z', '2026-11-08T18:00:00Z']) {
    task(db, { title: 'Clip', owner: 'short-form', project: 'short-form', status: 'done', done_at: at });
  }
  const waiting = task(db, { title: 'Peter Collins first video - Peter Collins', owner: 'home-guide-press', project: 'home-guide-press', status: 'waiting_on_jon',
    note: 'What happened:\n- Pack made\nYour move:\n- Approve the thumbnail D:\\AgentTeam\\packs\\peter\\thumb.png\nNext:\n- Upload', updated_at: '2026-11-07T20:00:00Z' });
  const jmTask = task(db, { title: 'Jon Mac upload - Jon Mac', owner: 'jon-mac-youtube', project: 'jon-mac', status: 'waiting_on_jon', updated_at: '2026-11-06T20:00:00Z' });
  const edit = task(db, { title: 'Jack Mercer video 2 edit - Jack Mercer', owner: 'video-editor', project: 'home-guide-press', status: 'review' });
  ins(db, 'bot_proofs', { id: id('p'), task_id: edit, kind: 'render', link: 'https://jonmac.ai/review/jack-2', status: 'passed', created_by: 'video-editor', created_at: '2026-11-08T16:00:00Z', checked_by: 'qc', checked_at: '2026-11-08T17:00:00Z' });
  const daisy = task(db, { title: 'Complete Histories daily', owner: 'spotify', project: null, status: 'doing' });

  // Questions and approvals: 2 bot-health, 3 known charges, and the rest for Jon.
  ask(db, { asked_by: 'ana', idem_key: 'team-guard-abc', project: 'coding', question: 'Ana quiet 40 minutes. Restart?' });
  ask(db, { asked_by: 'ana', idem_key: 'team-guard-def', project: 'coding', question: 'GPU2 down. Restart?' });
  for (const [i, at] of ['2026-11-02T16:00:00Z', '2026-11-03T16:00:00Z', '2026-11-04T16:00:00Z'].entries()) {
    ask(db, { asked_by: 'moneyclaw', idem_key: `cw:charge-${i}`, project: 'accounting', question: `New charge ${i}: $12 Canva`, created_at: at });
  }
  ask(db, { asked_by: 'sponsors', project: 'sponsors', question: 'Poppy offers $2,000. Accept?', task_id: poppy, created_at: '2026-11-07T16:00:00Z' });
  ask(db, { asked_by: 'home-guide-press', project: 'home-guide-press', question: 'Which cover?', context: 'Both on https://homeguidepress.com/peter', created_at: '2026-11-04T16:00:00Z' });
  ask(db, { asked_by: 'short-form', project: 'short-form', question: 'Post this clip?', created_at: '2026-11-01T16:00:00Z' });
  ins(db, 'bot_approvals', { id: id('a'), action: 'publish_draft', title: 'Make Jon Mac video public', payload: { review_link: 'https://jonmac.ai/review/jm-5' }, task_id: jmTask, project: 'jon-mac', requested_by: 'jon-mac-youtube', status: 'pending', created_at: '2026-11-06T16:00:00Z', updated_at: '2026-11-06T16:00:00Z' });
  ins(db, 'bot_approvals', { id: id('a'), action: 'post_clips', title: 'Post 3 clips', payload: { platforms: ['tiktok'] }, project: 'short-form', requested_by: 'short-form', status: 'pending', minutes: 3, created_at: '2026-11-03T16:00:00Z', updated_at: '2026-11-03T16:00:00Z' });

  // Daily ticks. Florence cleared partners@ today; Elle checked the site Mon, Tue, Thu and Sat.
  tick(db, '2026-11-08', 'sponsors', 'Sort partners@ and draft replies', '2026-11-08T16:30:00Z');
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-07']) tick(db, d, 'home-guide-press', 'Site and checkouts checked');
  // Elizabeth: both every day but Wednesday (no receipts) and today (import only, past the 10:00 deadline).
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']) tick(db, d, 'accounting', '08:00 RBC import run', `${d}T15:30:00Z`);
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-07']) tick(db, d, 'accounting', 'Receipts matched', `${d}T16:30:00Z`);

  // Daisy: both up Mon, Tue, Fri, Sat; Wed's post only in a proof; nothing on Thu; today the episode only (before 18:00).
  const both = 'Spotify episode live and community post live on Complete Histories with Henry. Post link https://www.youtube.com/channel/UCabc/posts Show https://open.spotify.com/show/033SNXxQnj7GTvFFB1afwQ';
  const run = (day, note, status = 'ok') => ins(db, 'bot_runs', { id: id('r'), bot: 'spotify', started_at: `${day}T17:00:00Z`, status, note, created_at: `${day}T17:00:00Z` });
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-06', '2026-11-07']) run(d, both);
  run('2026-11-04', 'Episode live on the Spotify show: https://open.spotify.com/show/033SNXxQnj7GTvFFB1afwQ .');
  ins(db, 'bot_proofs', { id: id('p'), task_id: daisy, kind: 'url', link: 'https://www.youtube.com/post/UgkxAbc', status: 'pending', created_by: 'spotify', created_at: '2026-11-04T17:30:00Z' });
  run('2026-11-05', 'Spotify upload failed; community post not live', 'failed');
  run('2026-11-08', 'Episode live on the Spotify show: https://open.spotify.com/show/033SNXxQnj7GTvFFB1afwQ . Community post not up yet.');
  return { db, ids: { poppy, waiting, jmTask } };
}

// The homeguidepress D1 (read only in the Worker): one paid Peter Collins order, a test and a refund that don't count.
function hgpDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('CREATE TABLE orders (transaction_id TEXT PRIMARY KEY, slug TEXT, amount_cents INTEGER, is_test INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, revoked_at TEXT)');
  const add = raw.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)');
  add.run('tx1', 'gary', 2700, 0, '2026-11-03T18:00:00.000Z', null);
  add.run('tx2', 'prepared', 2700, 1, '2026-11-04T18:00:00.000Z', null);
  add.run('tx3', 'prepared', 2700, 0, '2026-11-05T18:00:00.000Z', '2026-11-06T18:00:00.000Z');
  add.run('tx4', 'gary', 2700, 0, '2026-10-30T18:00:00.000Z', null);
  return { prepare: (sql) => ({ bind: (...a) => ({ all: async () => ({ results: raw.prepare(sql).all(...a) }) }) }) };
}

async function withNow(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try { return await fn(); } finally { Date.now = real; }
}
const cookieAt = async (ms) => `${COOKIE}=${await signSession(SECRET, Math.floor(ms / 1000) + 3600)}`;
const get = async (env, path, ms) => withNow(ms, async () => handleApi(new Request(`https://jonmac.ai${path}`, { headers: { Cookie: await cookieAt(ms) } }), env));
async function d2At(env, ms) {
  const res = await get(env, '/dashboard/api/d2', ms);
  assert.equal(res.status, 200);
  return res.json();
}

test('Daily Summary: a malformed market feed does not take /d2 down; the other sections still render', async () => {
  const { db } = seed();
  const row = db.sqlite.prepare("SELECT data FROM snapshots WHERE source = 'moneyclaw'").get();
  const mc = JSON.parse(row.data);
  mc.markets.core = [null, ...mc.markets.core];
  mc.expenses.business.month.charges = [null, ...mc.expenses.business.month.charges];
  db.sqlite.prepare("UPDATE snapshots SET data = ? WHERE source = 'moneyclaw'").run(JSON.stringify(mc));
  const body = await d2At({ DB: db, HGP_DB: hgpDb(), SESSION_SECRET: SECRET, CF_VERSION_METADATA: { id: 'v1' } }, SUNDAY);
  const by = Object.fromEntries(body.d2.summary.sections.map((s) => [s.key, s]));
  assert.equal(by.markets.rows[0].value, '$701.89');
  assert.equal(by.calendar.rows[0].value, 'Call with Poppy');
  assert.match(by.expenses.rows[0].value, /^Yesterday /);
  assert.equal(by.sponsors.rows.length, 5);
  assert.ok(body.d2.today && body.d2.goals.length === 6, 'the rest of d2 is intact');
});

const goal = (body, key) => body.d2.goals.find((g) => g.key === key);

test('d2 answers the contract for all five sections', async () => {
  const { db } = seed();
  const body = await d2At({ DB: db, HGP_DB: hgpDb(), SESSION_SECRET: SECRET, CF_VERSION_METADATA: { id: 'v1' } }, SUNDAY);
  assert.equal(body.ok, true);
  assert.equal(body.build, 'v1');
  assert.equal(body.asOf, new Date(SUNDAY).toISOString());
  assert.deepEqual(Object.keys(body.pages), ['today', 'projects', 'sponsors', 'viral', 'money', 'calendar', 'content']); // only what public/d2 reads
  assert.deepEqual(Object.keys(body.d2), ['period', 'goals', 'stale', 'checks', 'today', 'pipeline', 'money', 'summary']);
  assert.deepEqual(body.d2.goals.map((g) => g.key), ['sponsors', 'hgp', 'jonmac', 'jonmacai', 'viral', 'shortform']);
  for (const g of body.d2.goals) {
    for (const k of ['key', 'title', 'owner', 'team', 'project', 'channels', 'month', 'week', 'day', 'trend']) assert.ok(k in g, `${g.key}.${k}`);
    assert.ok(NAMES.includes(g.owner) && g.team.every((x) => NAMES.includes(x)), g.key);
    for (const m of [g.month, ...g.week, ...g.day]) {
      assert.deepEqual(Object.keys(m), ['key', 'label', 'unit', 'target', 'actual', 'display', 'pace', 'status', 'owner', 'source', 'note', 'behind', 'rows', 'days', 'facts'], `${g.key}.${m.key}`);
      assert.ok(STATUS.includes(m.status.text), `${g.key}.${m.key}: ${m.status.text}`);
      assert.ok(['ok', 'risk', 'crit', 'idle'].includes(m.status.cls));
      assert.ok(NAMES.includes(m.owner));
      assert.deepEqual(Object.keys(m.source), ['label', 'at', 'ageLabel', 'stale']);
      for (const b of m.behind) assert.ok(NAMES.includes(b.owner), b.owner);
    }
    assert.equal(g.trend.length, 6);
  }
  const { today, pipeline, money, period } = body.d2;
  assert.deepEqual(Object.keys(today), ['jon', 'needs', 'expenses', 'targets', 'blockers']);
  assert.deepEqual(Object.keys(today.needs), ['count', 'items', 'healthToAna', 'chargesFolded']);
  for (const it of [...today.needs.items, ...today.expenses.items]) assert.ok('goal' in it && 'minutes' in it && 'link' in it);
  for (const b of today.blockers) assert.ok(NAMES.includes(b.owner), b.owner);
  assert.deepEqual(pipeline.boards.map((b) => [b.goal, b.project]), [['sponsors', 'sponsors'], ['hgp', 'home-guide-press'], ['jonmac', 'jon-mac'], ['jonmacai', 'jonmacai'], ['viral', 'viral-view'], ['shortform', 'short-form']]);
  assert.deepEqual(pipeline.boards.map((b) => b.channels.length > 0), [false, true, true, true, false, false]);
  assert.ok(pipeline.boards[1].channels.filter((c) => !c.focus).every((c) => !FOCUS.includes(c.slug)));
  assert.equal(money.tiles.length, 6);
  assert.deepEqual(money.tiles.map((t) => t.value), ['$3,100', '$2,100', 'no data', '$47', '$27', 'Through Nov 7']);
  assert.equal(money.tiles[0].sub, 'Deposits this month: 2 · $2,100 owed');
  for (const t of money.tiles) assert.deepEqual(Object.keys(t), ['label', 'value', 'sub', 'source']);
  assert.equal(period.tz, 'America/Vancouver');
  // No raw ids or file paths in what Jon reads.
  const text = (JSON.stringify(body.d2.goals) + JSON.stringify(today.blockers) + JSON.stringify(money)).replace(/"open":"t_\d{16}"/g, ''); // a card id is for the click, not shown
  assert.doesNotMatch(text, /[A-Z]:\\\\|t_\d{16}|"owner":"(sponsors|home-guide-press|video-editor|spotify)"/);
  if (UPDATE) writeFileSync(SAMPLE, `${JSON.stringify(body, null, 1)}\n`);
  else assert.deepEqual(JSON.parse(readFileSync(SAMPLE, 'utf8')), body, 'test/fixtures/d2-sample.json is out of date: run UPDATE_FIXTURES=1 npm test');
});

test('a test run never rewrites the tracked d2 sample', { skip: UPDATE && 'UPDATE_FIXTURES=1' }, () => {
  assert.equal(statSync(SAMPLE).mtimeMs, SAMPLE_MTIME);
});

test('d2 counts the month, week and day on a Sunday', async () => {
  const { db } = seed();
  const body = await d2At({ DB: db, HGP_DB: hgpDb(), SESSION_SECRET: SECRET }, SUNDAY);
  const { period } = body.d2;
  assert.deepEqual(period.today, { ymd: '2026-11-08', label: 'Sunday, November 8', clock: '2:05 PM', weekday: 6 });
  assert.equal(period.week.label, 'Nov 2 to 8');
  assert.deepEqual(period.week.days.map((d) => d.label), ['Mon 2', 'Tue 3', 'Wed 4', 'Thu 5', 'Fri 6', 'Sat 7', 'Sun 8']);
  assert.deepEqual(period.month.weeks.map((w) => w.label), ['Oct 26 to Nov 1', 'Nov 2 to 8', 'Nov 9 to 15', 'Nov 16 to 22', 'Nov 23 to 29', 'Nov 30 to Dec 6']);
  assert.equal(period.month.daysInMonth, 30);

  const jm = goal(body, 'jonmac');
  assert.equal(jm.month.target, 13); // round(3 x 30/7)
  assert.equal(jm.month.actual, 3);
  assert.equal(jm.week[0].display, '2 of 3');
  assert.match(jm.week[0].note, /1 more scheduled/);
  assert.deepEqual(jm.week[0].days.map((d) => d.actual), [0, 1, 0, 1, 0, 0, 0]);
  assert.equal(jm.week[0].status.text, 'Behind'); // 2 of a 2.7 pace
  assert.deepEqual(jm.trend.map((w) => w.actual), [1, 2, null, null, null, null]);
  assert.deepEqual(jm.trend.map((w) => w.target), [0, 3, 3, 3, 3, 0]);

  const sf = goal(body, 'shortform');
  assert.deepEqual([sf.day[0].actual, sf.week[0].actual, sf.month.actual], [2, 8, 9]);
  assert.deepEqual(sf.week[0].days.map((d) => d.actual), [3, 3, 0, 0, 0, 0, 2]);
  assert.equal(sf.week[0].days[0].target, 3);

  const sp = goal(body, 'sponsors');
  assert.equal(sp.month.actual, 3100);
  assert.equal(sp.month.display, body.pages.today.goals[0].value); // the Today page's Sponsors card
  assert.deepEqual(sp.month.source, body.pages.today.goals[0].source);
  assert.deepEqual(sp.trend.slice(0, 2).map((w) => w.actual), [1000, 2100]);
  const [signed, delivered, invoiced] = sp.week;
  assert.equal(signed.actual, 1);
  assert.match(signed.note, /Poppy/);
  assert.equal(delivered.actual, 1);
  assert.deepEqual(delivered.behind.map((b) => [b.title, b.owner]), [['Invideo video 2', 'Florence'], ['Notion video 1', 'Florence'], ['Poppy video 1', 'Florence']], 'Topview is live, so it is not behind');
  assert.equal(delivered.behind.find((b) => b.title === 'Notion video 1').why, 'Waiting on you: Approve the script so editing can start', 'the Your move line, not just the status');
  assert.deepEqual([invoiced.actual, invoiced.display, invoiced.behind[0].title], [1, '1 waiting', 'Invideo']);
  assert.match(invoiced.note, /confirmed live/);
  assert.deepEqual(sp.day.map((m) => [m.key, m.actual, m.status.text]), [['replies', 1, 'Done'], ['prices', 1, 'Behind']]);

  const hgp = goal(body, 'hgp');
  const [videos, checkout] = hgp.week;
  assert.equal(videos.rows.find((r) => r.label === 'Peter Collins').display, '3 of 3');
  assert.deepEqual(videos.behind.find((b) => b.title === 'Jack Mercer'), { title: 'Jack Mercer', owner: 'Elle', why: '1 of 3 published', page: 'pipeline/hgp/jack-mercer/calendar' });
  assert.equal(jm.week[0].behind[0].page, 'pipeline/jonmac/jon-mac/calendar');
  assert.ok(!videos.behind.some((b) => b.title === 'Peter Collins'));
  assert.deepEqual([checkout.actual, checkout.display], [4, '4 of 7 days checked']);
  assert.match(checkout.behind[0].why, /Wed 4, Fri 6/);
  assert.deepEqual(checkout.facts, [{ label: 'Last check', value: 'Nov 7 (Sat 7)' }, { label: 'Missed', value: 'Elle: Wed 4, Fri 6' }]);
  assert.deepEqual(videos.facts.map((f) => [f.label, f.value]), [['Published today', '0'], ['Waiting for your review', '1']]);
  assert.deepEqual([hgp.month.actual, hgp.month.rows.find((r) => r.label === 'Peter Collins').actual, hgp.month.rows.find((r) => r.label === 'Jack Mercer').actual], [4, 3, 1]); // videos published, from the channel calendars
  assert.deepEqual([hgp.day[0].actual, hgp.day[0].target], [1, 4]); // floor(14 h / 3)

  const viral = goal(body, 'viral');
  assert.deepEqual([viral.month.display, viral.month.status.text], ['Not set', 'Behind']);
  assert.deepEqual([viral.week[0].actual, viral.week[0].status.text], [1, 'Done']);
  assert.equal(viral.week[1].status.text, 'Not tracked yet');
  assert.equal(viral.day[0].status.text, 'Not tracked yet');

  assert.ok(body.d2.today.targets.length >= 4);
  assert.ok(body.d2.stale.some((s) => s.label === 'Viral View subscriptions feed' && s.ageLabel === 'never reported'));
  assert.equal(new Set(body.d2.stale.map((s) => s.label)).size, body.d2.stale.length);
});

// Jon's list lives on GPU1; the Worker can't read it, so d2-goals.json keeps a copy and this fails when they drift.
const FOCUS_FILE = 'D:\\AgentTeam\\rules\\facts\\focus-channels.txt';
test('d2 focus list is the same as Jon\'s focus-channels.txt', { skip: !existsSync(FOCUS_FILE) && 'not on GPU1' }, () => {
  const file = readFileSync(FOCUS_FILE, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  assert.deepEqual([...FOCUS].sort(), [...file].sort());
});

test('d2 focus channels: Jon\'s whole list in its order, even channels the dashboard has no calendar for; the rest are parked', async () => {
  const { db } = seed();
  const hgp = goal(await d2At({ DB: db, SESSION_SECRET: SECRET }, SUNDAY), 'hgp');
  assert.deepEqual(hgp.channels.map((c) => c.slug), FOCUS);
  assert.ok(!allChannels([]).some((c) => c.slug === 'edna-haynes'), 'edna-haynes has no channel yet');
  assert.deepEqual(hgp.channels.find((c) => c.slug === 'edna-haynes'), { slug: 'edna-haynes', label: 'Edna Haynes', focus: true });
  const [videos] = hgp.week;
  assert.equal(videos.target, 3 * FOCUS.length); // 48
  assert.deepEqual(videos.rows.map((r) => r.label), hgp.channels.map((c) => c.label));
  assert.equal(videos.rows.find((r) => r.label === 'Edna Haynes').note, 'No calendar yet');
  assert.deepEqual(videos.behind.find((b) => b.title === 'Edna Haynes'), { title: 'Edna Haynes', owner: 'Elle', why: 'No calendar yet', page: 'pipeline/hgp/edna-haynes/calendar' });
  const parked = allChannels([]).filter((c) => c.group === 'Home Guide Press' && !FOCUS.includes(c.slug)).map((c) => c.slug);
  assert.ok(parked.includes('rosa-cooks') && parked.includes('ruth-calder'));
  assert.deepEqual(hgp.parked.map((c) => c.slug), parked);
  assert.ok(!videos.rows.some((r) => r.label === 'Rosa Cooks'));
  // Viral View gets a channel tab only once a 'viral-view' calendar channel is registered.
  ins(db, 'yt_channels', { slug: 'viral-view', label: 'Viral View', grp: 'Viral View', updated_by: 'ana', updated_at: '2026-11-08T10:00:00Z' });
  const viral = goal(await d2At({ DB: db, SESSION_SECRET: SECRET }, SUNDAY), 'viral');
  assert.deepEqual(viral.channels, [{ slug: 'viral-view', label: 'Viral View', focus: true }]);
});

test('d2 Needs you hides bot health, folds known charges, and picks at most 3 for Jon', async () => {
  const { db, ids } = seed();
  const body = await d2At({ DB: db, SESSION_SECRET: SECRET }, SUNDAY);
  const { needs, expenses, jon, blockers } = body.d2.today;
  assert.equal(body.pages.today.needs.count, 10); // /dashboard still shows every item
  assert.equal(needs.healthToAna, 2);
  assert.equal(needs.chargesFolded, 3);
  assert.equal(expenses.count, 3);
  // 10 - 2 bot health - 3 charges + the one expenses item = 6: Jon's top 3, and the other 3 in needs.items.
  assert.equal(jon.length, 3);
  assert.deepEqual(jon.map((i) => [i.goal, i.title]), [['sponsors', 'Poppy offers $2,000. Accept?'], ['hgp', 'Which cover?'], ['jonmac', 'Make Jon Mac video public']]);
  assert.ok(!jon.some((i) => i.kind === 'expenses')); // Sunday
  assert.equal(needs.count, 3);
  assert.deepEqual(needs.items.map((i) => i.title), ['Post 3 clips', 'Post this clip?', 'Expenses review (Friday)']);
  const all = [...jon, ...needs.items];
  assert.ok(!all.some((i) => /Restart|New charge/.test(i.title)));
  assert.deepEqual(all.map((i) => i.from), ['Florence', 'Elle', 'Sydney', 'Samantha', 'Samantha', 'Mila']);
  const exp = needs.items.at(-1);
  assert.deepEqual([exp.id, exp.kind, exp.minutes], ['expenses', 'expenses', 15]);
  assert.deepEqual(expenses.items.map((i) => i.from), ['Mila', 'Mila', 'Mila']);
  assert.deepEqual(jon[1].link, { label: 'Open link', href: 'https://homeguidepress.com/peter' });
  assert.deepEqual(jon[2].link, { label: 'Watch video', href: 'https://jonmac.ai/review/jm-5' });
  assert.deepEqual([needs.items[0].minutes, needs.items[1].minutes], [3, 5]);
  assert.equal(body.pages.today.needs.items.find((i) => i.title === 'Make Jon Mac video public').from, 'jon-mac-youtube'); // pages untouched
  // Blockers: both waiting tasks, the question on Poppy's card, and the missed check days.
  const peter = blockers.find((b) => b.open === ids.waiting);
  assert.deepEqual([peter.owner, peter.goal], ['Elle', 'hgp']);
  assert.equal(peter.why, 'Approve the thumbnail thumb.png');
  assert.ok(blockers.some((b) => b.open === ids.jmTask && b.owner === 'Sydney'));
  assert.ok(blockers.some((b) => b.open === ids.poppy && b.owner === 'Florence' && /Poppy offers/.test(b.why)));
});

test('d2 Expenses review is Jon\'s only on a Friday', async () => {
  const at = (ms) => {
    const db = sqliteD1();
    for (const i of [1, 2]) ask(db, { asked_by: 'moneyclaw', idem_key: `cw:x${i}`, project: 'accounting', question: 'New charge', created_at: '2026-11-02T16:00:00Z' });
    ask(db, { asked_by: 'sponsors', project: 'sponsors', question: 'Rate?', created_at: '2026-11-03T16:00:00Z' });
    return d2At({ DB: db, SESSION_SECRET: SECRET }, ms);
  };
  const fri = await at(FRIDAY);
  assert.equal(fri.d2.period.today.weekday, 4);
  assert.deepEqual(fri.d2.today.jon.map((i) => i.title), ['Rate?', 'Expenses review (Friday)']);
  assert.deepEqual(fri.d2.today.needs.items, []);
  assert.deepEqual((await at(SUNDAY)).d2.today.jon.map((i) => i.title), ['Rate?']);
});

test('d2 daily checks: a missed past day is red and a blocker; today before its run is not', async () => {
  const { db } = seed();
  const sun = await d2At({ DB: db, SESSION_SECRET: SECRET }, SUNDAY);
  const [hist, rbc] = sun.d2.checks;
  assert.deepEqual([hist.key, hist.owner, rbc.key, rbc.owner], ['histories', 'Daisy', 'rbc', 'Elizabeth']);
  assert.deepEqual(hist.days.map((d) => d.ok), [true, true, true, false, true, true, null]);
  assert.equal(hist.days[3].cls, 'crit');
  assert.equal(hist.today.status.cls, 'idle'); // episode up, post not yet, before 18:00
  assert.deepEqual(hist.today.facts, [{ label: 'Spotify episode', value: 'Live' }, { label: 'Community post', value: 'Not seen yet' }]);
  assert.deepEqual(hist.today.links, [{ label: 'Spotify show', href: 'https://open.spotify.com/show/033SNXxQnj7GTvFFB1afwQ' }]);
  // RBC: Wednesday has no receipts tick; today is past 10:00 with no receipts and a failed bank scan.
  assert.deepEqual(rbc.days.map((d) => d.ok), [true, true, false, true, true, true, false]);
  assert.equal(rbc.today.status.text, 'Missed');
  assert.match(rbc.days[6].note, /Receipts not matched, bank scan failed/);
  assert.deepEqual(rbc.today.facts.map((f) => f.value), ['0 of 7', 'Today', 'Nov 7', 'Not yet']);
  const { blockers } = sun.d2.today;
  for (const t of ['Complete Histories missed Thu 5', 'RBC expenses missed Wed 4', 'RBC expenses missed today']) assert.ok(blockers.some((b) => b.title === t), t);
  assert.ok(!blockers.some((b) => b.title === 'Complete Histories missed today'));

  // Friday 7:00 AM: Friday has no ticks or runs yet in this data, and it is before both deadlines.
  const fri = await d2At({ DB: sqliteD1(), SESSION_SECRET: SECRET }, FRIDAY);
  for (const k of fri.d2.checks) {
    assert.equal(k.today.ok, null);
    assert.equal(k.today.status.cls, 'idle');
    assert.deepEqual(k.days.slice(4).map((d) => d.ok), [null, null, null]);
    assert.deepEqual(k.days.slice(0, 4).map((d) => d.cls), ['crit', 'crit', 'crit', 'crit']);
  }
});

test('d2 cleans a copy of the sponsors board and leaves pages.sponsors as /dashboard shows it', async () => {
  const { db } = seed();
  const body = await d2At({ DB: db, SESSION_SECRET: SECRET }, SUNDAY);
  const page = body.pages.sponsors;
  const all = (p) => p.board.columns.flatMap((c) => c.cards.map((k) => k.id));
  assert.deepEqual(all(page).sort(), ['c-arcads', 'c-invideo', 'c-news', 'c-paid', 'c-poppy', 'c-quiet', 'c-receipt', 'c-refund']);
  assert.ok(!page.hidden && !page.value);
  const clean = body.d2.pipeline.boards[0].sponsors;
  assert.deepEqual(clean.hidden, { receipts: 1, refunds: 1, newsletters: 1 });
  const archived = clean.board.columns.at(-1);
  assert.deepEqual([archived.title, archived.archived, archived.cards.map((k) => k.id)], ['Archived', true, ['c-quiet']]);
  assert.deepEqual(all({ board: { columns: clean.board.columns.slice(0, -1) } }).sort(), ['c-arcads', 'c-invideo', 'c-paid', 'c-poppy']);
  assert.deepEqual(clean.value, { usd: 6700, priced: 2, unpriced: 1 }); // Invideo 4,200 + Poppy 2,500; Paid left out
  assert.deepEqual(clean.tiles, page.tiles);
  // Each card sits in the column of its own feed stage; the Today "Negotiating, to close" tile still finds Poppy.
  const colOf = (id) => clean.board.columns.find((c) => c.cards.some((k) => k.id === id))?.title;
  assert.equal(colOf('c-poppy'), 'Negotiations');
  assert.equal(colOf('c-paid'), 'Paid & Done');
  const neg = body.d2.today.rows?.find?.((r) => r.label === 'Negotiating, to close');
  if (neg) assert.match(String(neg.value), /1 deal/);
});

test('/snapshot answers exactly as before for the same data', async () => {
  const { db } = seed();
  const env = { DB: db, SESSION_SECRET: SECRET };
  for (const pages of [null, 'today,sponsors', 'calendar']) {
    const res = await get(env, `/dashboard/api/snapshot${pages ? `?pages=${pages}` : ''}`, SUNDAY);
    // The handler before Dashboard 2, inline.
    const want = pages ? pages.split(',') : PAGES;
    const base = JSON.parse(JSON.stringify({ pages: Object.fromEntries(want.map((p) => [p, (!['calendar', 'content', 'track'].includes(p) && snapshot.pages[p]) || {}])), nav: liveNav(snapshot.nav), sources: snapshot.sources }));
    const extra = { habits: await listHabits(db), funnel: await listFunnel(undefined) };
    if (base.pages.today || base.pages.projects || base.pages.todo) extra.today = await todayData(db, SUNDAY, '2026-11');
    if (base.pages.calendar || base.pages.content) extra.channels = await channelData(db, SUNDAY);
    const expected = JSON.stringify({ ...mergeSnapshot(base, await listSnapshots(db), SUNDAY, await listDealStages(db), extra), build: null });
    assert.equal(await res.text(), expected, pages || 'all');
  }
});

test('/dashboard-2 serves its own pages behind the dashboard session', async () => {
  const env = { SESSION_SECRET: SECRET, ASSETS: { fetch: async (r) => new Response(`asset:${new URL(r.url).pathname}`) } };
  const fetch = (path, cookie) => worker.fetch(new Request(`https://jonmac.ai${path}`, cookie ? { headers: { Cookie: cookie } } : {}), env, {});
  const bare = await fetch('/dashboard-2');
  assert.equal(bare.status, 308);
  assert.equal(bare.headers.get('Location'), 'https://jonmac.ai/dashboard-2/');
  assert.equal(await (await fetch('/dashboard-2/')).text(), 'asset:/d2/login.html');
  assert.equal(await (await fetch('/dashboard-2/index.html')).text(), 'asset:/d2/login.html');
  const cookie = await cookieAt(Date.now());
  const index = await fetch('/dashboard-2/', cookie);
  assert.equal(await index.text(), 'asset:/d2/index.html');
  assert.equal(index.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(index.headers.get('Cache-Control'), 'no-cache');
  const js = await fetch('/dashboard-2/js/app.js');
  assert.equal(await js.text(), 'asset:/d2/js/app.js');
  assert.equal(js.headers.get('Cache-Control'), 'no-cache');
  assert.equal((await fetch('/dashboard')).headers.get('Location'), 'https://jonmac.ai/dashboard/');
  assert.equal(await (await fetch('/dashboard/')).text(), 'asset:/login.html');
  assert.equal((await fetch('/dashboard-22')).status, 404);
  assert.equal((await handleApi(new Request('https://jonmac.ai/dashboard/api/d2'), env)).status, 401);
});

test('Dashboard 2 files open only under /dashboard-2, and no path skips its sign-in', async () => {
  const env = { SESSION_SECRET: SECRET, ASSETS: { fetch: async (r) => new Response(`asset:${new URL(r.url).pathname}`) } };
  const fetch = async (path, cookie) => {
    const res = await worker.fetch(new Request(`https://jonmac.ai${path}`, cookie ? { headers: { Cookie: cookie } } : {}), env, {});
    return res.status === 404 ? 404 : res.text();
  };
  // Under /dashboard they were 404s before Dashboard 2, and still are.
  for (const p of ['/dashboard/d2/index.html', '/dashboard/d2/', '/dashboard/d2', '/dashboard//d2/index.html', '/dashboard/%642/index.html',
    '/dashboard/D2/index.html', '/dashboard/d2%2Findex.html', '/dashboard/x/..%2F..%2Fd2/js/app.js', '/dashboard/d2/js/app.js']) {
    assert.equal(await fetch(p), 404, p);
  }
  assert.equal(await fetch('/dashboard/js/app.js'), 'asset:/js/app.js');
  assert.equal(await fetch('/dashboard/call'), 'asset:/login.html');
  // /dashboard-2: index and login, its css and js; nothing else, and no spelling of index.html gets past the gate.
  const cookie = await cookieAt(Date.now());
  for (const p of ['/dashboard-2/', '/dashboard-2/index.html', '/dashboard-2/./index.html', '/dashboard-2/css/../index.html', '/dashboard-2/js/%2e%2e/index.html']) {
    assert.equal(await fetch(p), 'asset:/d2/login.html', p);
    assert.equal(await fetch(p, cookie), 'asset:/d2/index.html', p);
  }
  for (const p of ['/dashboard-2//index.html', '/dashboard-2/%69ndex.html', '/dashboard-2/index.htm', '/dashboard-2/d2/index.html', '/dashboard-2/favicon.ico',
    '/dashboard-2/js/app.js.map', '/dashboard-2/js/%2e%2e%2findex.html', '/dashboard-2/css/d2.css%00.html']) {
    assert.equal(await fetch(p), 404, p);
  }
  assert.equal(await fetch('/dashboard-2/login.html'), 'asset:/d2/login.html');
  assert.equal(await fetch('/dashboard-2/css/d2.css'), 'asset:/d2/css/d2.css');
  assert.equal(await fetch('/dashboard-2/js/pages/week.js'), 'asset:/d2/js/pages/week.js');
});

test('d2 short-form month target is 3 a day: 90 in November, 93 in December, 84 in February', async () => {
  for (const [at, month] of [['2026-11-08T21:05:00Z', 90], ['2026-12-08T21:05:00Z', 93], ['2027-02-08T21:05:00Z', 84]]) {
    const sf = goal(await d2At({ SESSION_SECRET: SECRET }, Date.parse(at)), 'shortform');
    assert.deepEqual([sf.month.target, sf.week[0].target, sf.day[0].target], [month, 21, 3], at);
  }
});

test('d2 QC target before 3 AM is none due yet, not Done', async () => {
  const body = await d2At({ DB: sqliteD1(), SESSION_SECRET: SECRET }, Date.parse('2026-11-08T09:00:00Z')); // 1:00 AM
  const qc = goal(body, 'hgp').day[0];
  assert.deepEqual([qc.target, qc.actual, qc.display, qc.status], [0, 0, 'None due yet', { text: 'None due yet', cls: 'idle' }]);
  assert.equal(body.d2.today.targets.find((t) => t.goal === 'hgp').display, 'None due yet');
});

test('d2 QC count only reads proofs from the last 14 days', async () => {
  const { db } = seed();
  const old = task(db, { title: 'Old edit - Jack Mercer', owner: 'video-editor', project: 'home-guide-press', status: 'review' });
  ins(db, 'bot_proofs', { id: id('p'), task_id: old, kind: 'url', link: 'https://jonmac.ai/review/old', status: 'passed', created_by: 'video-editor', created_at: '2026-10-20T16:00:00Z', checked_by: 'qc', checked_at: '2026-11-08T18:00:00Z' });
  assert.equal(goal(await d2At({ DB: db, SESSION_SECRET: SECRET }, SUNDAY), 'hgp').day[0].actual, 1);
});

test('d2 counts the newest cards when there are more than the 3000 it reads', async () => {
  const db = sqliteD1();
  const add = db.sqlite.prepare(`INSERT INTO bot_tasks (id, title, owner, status, project, created_by, updated_by, created_at, updated_at, done_at)
    VALUES (?, 'Clip', 'short-form', 'done', 'short-form', 'ana', 'ana', '2026-11-01T16:00:00Z', '2026-11-02T18:00:00Z', '2026-11-02T18:00:00Z')`);
  for (let i = 0; i < 3000; i++) add.run(id('t'));
  task(db, { title: 'Clip', owner: 'short-form', project: 'short-form', status: 'done', created_at: '2026-11-08T16:00:00Z', done_at: '2026-11-08T17:00:00Z' });
  assert.equal(goal(await d2At({ DB: db, SESSION_SECRET: SECRET }, SUNDAY), 'shortform').day[0].actual, 1);
});

test('d2 blocker notes drop bullets but keep hyphens inside words and ranges', async () => {
  const db = sqliteD1();
  task(db, { title: 'Book page - Peter Collins', owner: 'home-guide-press', project: 'home-guide-press', status: 'waiting_on_jon',
    note: 'What happened:\n- Page built\nYour move:\n- Pick the 5-7 days shipping for the e-book\n• then reply\nNext:\n- Publish' });
  const [b] = (await d2At({ DB: db, SESSION_SECRET: SECRET }, SUNDAY)).d2.today.blockers;
  assert.equal(b.why, 'Pick the 5-7 days shipping for the e-book then reply');
});

test('d2 without HGP_DB, CLONE_DB or any D1 answers with nulls and notes, never a 500', async () => {
  const { db } = seed();
  const body = await d2At({ DB: db, SESSION_SECRET: SECRET }, SUNDAY);
  const hgp = goal(body, 'hgp');
  assert.equal(hgp.month.actual, 4, 'the month goal counts published videos from the calendars, so the sales database being down does not blank it');
  assert.equal(hgp.month.label, 'Videos published (3 a week per focus channel)');
  assert.ok(!body.d2.stale.some((s) => s.label === 'Home Guide Press orders'), 'the sales database is no longer behind a goal, so it is not a stale source on Month');
  const none = await d2At({ SESSION_SECRET: SECRET }, SUNDAY);
  assert.equal(goal(none, 'jonmac').week[0].actual, null);
  assert.equal(none.d2.checks[0].today.status.text, 'No data');
  assert.equal(none.d2.today.needs.count, 0);
  // An unreadable table is a null too.
  const broken = sqliteD1();
  broken.sqlite.exec('DROP TABLE yt_calendar; DROP TABLE bot_daily_ticks');
  const b = await d2At({ DB: broken, SESSION_SECRET: SECRET }, SUNDAY);
  assert.equal(goal(b, 'jonmac').week[0].actual, null);
  assert.equal(goal(b, 'sponsors').day[0].actual, null);
});
