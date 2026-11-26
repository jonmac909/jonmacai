// jonmac.ai/jacq (card t_9f5156f3507742d6): the detailed Budget page. Served behind the dashboard sign-in, a month picker
// (GET /budget?month=YYYY-MM reads MoneyClaw's budgetMonths), month totals and % as the 09:00 brief prints them, every
// category with budget / spent / % / label, and a tap on a category lists its transactions (sum = its spent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { upsertSnapshot } from '../src/db.js';
import { budgetView, budgetMonths } from '../src/budget.js';
import { renderJacq, jacqClick, pct } from '../public/d3/js/jacq.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const BOT = `ccb_${'e'.repeat(43)}`;
const NOW = Date.parse('2026-11-26T19:00:00Z');

const tx = (merchant, amount, line, date, account = 'RBC Visa *1234', category = line) => ({ date, merchant, amount, category, line, pending: false, currency: 'CAD', account });
const cat = (name, spent, budget, basis, type, count, extra = {}) => ({ name, spent, budget, basis, type, over: budget != null && spent > budget, count, ...extra });
const sum = (list) => Math.round(list.reduce((s, t) => s + t.amount * 100, 0)) / 100;
// One month of MoneyClaw's budgetSimple view (only the month period matters here).
function month(ym, to, groups) {
  return {
    today: to, month: ym, latestPostedDate: to,
    groups: groups.map(({ key, budget, txns, categories, travel = [] }) => {
      const spent = sum(txns);
      const wt = [...txns, ...travel];
      const wspent = sum(wt);
      const tcat = travel.length ? [cat('Travel', sum(travel), 2083, 'prorated', null, travel.length)] : [];
      return { key, label: key === 'business' ? 'Business' : 'Personal', periods: { month: {
        period: 'month', startDate: `${ym}-01`, endDate: to, spent, budget, over: spent > budget, count: txns.length, excludedTravel: wspent - spent,
        txns, categories, paceBudget: budget, daysGone: 30, daysInMonth: 30, onTrack: spent <= budget,
        withTravel: { spent: wspent, over: wspent > budget, count: wt.length, txns: wt, categories: [...categories, ...tcat], onTrack: wspent <= budget },
      } } };
    }),
  };
}
const NOV = month('2026-11', '2026-11-25', [
  { key: 'personal', budget: 7500,
    txns: [tx('Mortgage payment', 3415.61, 'Mortgage', '2026-11-25', 'RBC Chequing *0348'), tx('COSTCO', 524.79, 'Groceries', '2026-11-17'), tx('SAVE ON', 727.63, 'Groceries', '2026-11-10'), tx('INDIGO', 196.69, 'Misc', '2026-11-03', 'RBC Visa *1234', 'Personal Misc')],
    categories: [cat('Groceries', 1252.42, 1140, 'prorated', null, 2), cat('Mortgage', 3415.61, 3416, 'fixed', 'fixed', 1), cat('Misc', 196.69, 214, 'prorated', null, 1), cat('Dentist', 0, 61, 'prorated', null, 0)] },
  { key: 'business', budget: 3000,
    txns: [tx('ANTHROPIC', 2107.76, 'Software', '2026-11-02'), tx('AMZN', 809.77, 'Amazon', '2026-11-12'), tx('CHV', 237.76, 'Fuel', '2026-11-20')],
    categories: [cat('Software', 2107.76, 1154, 'prorated', 'fixed', 1), cat('Amazon', 809.77, 200, 'prorated', 'cap', 1), cat('Fuel', 237.76, 331, 'prorated', 'cap', 1), cat('ICBC car insurance', 0, 1728, 'yearly', 'yearly', 0, { due: 'Apr' })],
    travel: [tx('AIR CANADA', 900, 'Travel', '2026-11-05')] },
]);
const OCT = month('2026-10', '2026-10-31', [
  { key: 'personal', budget: 7500, txns: [tx('Mortgage payment', 3415.61, 'Mortgage', '2026-10-25')], categories: [cat('Mortgage', 3415.61, 3416, 'fixed', 'fixed', 1)] },
  { key: 'business', budget: 3000, txns: [tx('OCTOBER SOFTWARE', 1500, 'Software', '2026-10-31')], categories: [cat('Software', 1500, 1154, 'prorated', 'fixed', 1)], travel: [tx('AIR CANADA', 900, 'Travel', '2026-10-15')] },
]);
// MoneyClaw stores a past month's list once (withTravel.txns); the no-Travel list is derived (row size, review fix 1).
OCT.latestPostedDate = '2026-11-25'; // the latest posted date overall, past the month
for (const g of OCT.groups) delete g.periods.month.txns;
const SUMMARY = { asOf: '2026-11-26', budgetSimple: NOV, budgetMonths: { '2026-10': OCT } };

test('/jacq: dashboard sign-in page when signed out, the Budget page when signed in; nothing else under /jacq', async () => {
  const env = { SESSION_SECRET: SECRET, ASSETS: { fetch: async (r) => new Response(`asset:${new URL(r.url).pathname}`) } };
  const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;
  const get = async (p, c) => { const r = await worker.fetch(new Request(`https://jonmac.ai${p}`, c ? { headers: { Cookie: c } } : {}), env, {}); return r.status === 404 ? 404 : r.text(); };
  assert.equal(await get('/jacq'), 'asset:/d3/login.html');
  assert.equal(await get('/jacq?month=2026-10'), 'asset:/d3/login.html');
  assert.equal(await get('/jacq', cookie), 'asset:/d3/jacq.html');
  assert.equal(await get('/jacq/', cookie), 'asset:/d3/jacq.html');
  assert.equal(await get('/jacq?month=2026-10', cookie), 'asset:/d3/jacq.html');
  assert.equal(await get('/dash/js/jacq.js'), 'asset:/d3/js/jacq.js');
  for (const p of ['/jacq/x', '/jacq/jacq.html', '/jacqx', '/dash/jacq.html']) assert.equal(await get(p, cookie), 404, p);
  const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(cfg, /"pattern": "jonmac\.ai\/jacq", "zone_name": "jonmac\.ai"/);
  const html = readFileSync(new URL('../public/d3/jacq.html', import.meta.url), 'utf8');
  assert.match(html, /<main class="jq" id="jacq">/);
  assert.match(html, /src="\/dash\/js\/jacq\.js"/);
  assert.match(readFileSync(new URL('../public/d3/login.html', import.meta.url), 'utf8'), /jacq/); // signing in at /jacq stays on /jacq
});

test('month param: a past month is MoneyClaw\'s own view of it; this month or none is the snapshot; unknown is null', () => {
  const now = budgetView(SUMMARY, NOW);
  assert.deepEqual(now.months, ['2026-11', '2026-10']);
  assert.equal(now.groups.personal.periods.month.spent, NOV.groups[0].periods.month.spent);
  assert.deepEqual(budgetView(SUMMARY, NOW, '2026-11'), now);
  const oct = budgetView(SUMMARY, NOW, '2026-10');
  assert.equal(oct.month, '2026-10');
  const om = oct.groups.business.periods.month;
  assert.deepEqual([om.spent, om.from, om.to, om.label], [1500, '2026-10-01', '2026-10-31', 'October 2026']);
  assert.equal(om.transactions[0].account, 'RBC Visa *1234');
  assert.deepEqual(oct.months, ['2026-11', '2026-10']);
  assert.equal(budgetView(SUMMARY, NOW, '2026-09'), null);
  assert.equal(budgetView({ budgetSimple: NOV }, NOW, '2026-10'), null);
  assert.deepEqual(budgetMonths({ budgetSimple: NOV, budgetMonths: { '2026-08': OCT, bad: OCT, '2026-10': OCT } }), ['2026-11', '2026-10', '2026-08']);
});

test('API: GET /budget?month=YYYY-MM answers that month, 404 when MoneyClaw has not sent it, 400 when malformed', async () => {
  const db = sqliteD1();
  await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at, revoked_at) VALUES (?, ?, ?, NULL)').bind(await sha256Hex(BOT), 'developer', '2026-10-29T00:00:00.000Z').run();
  await upsertSnapshot(db, 'moneyclaw', JSON.stringify(SUMMARY), '2026-11-26T10:00:00.000Z', '2026-11-26T10:00:00.000Z');
  const env = { DB: db, SESSION_SECRET: SECRET };
  const call = (path) => handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, { headers: { Authorization: `Bearer ${BOT}` } }), env)
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  const oct = await call('/budget?month=2026-10');
  assert.equal(oct.status, 200);
  assert.equal(oct.body.budget.month, '2026-10');
  assert.equal(oct.body.budget.groups.business.periods.month.spent, 1500);
  const cur = await call('/budget');
  assert.equal(cur.body.budget.month, '2026-11');
  assert.deepEqual(cur.body.budget.months, ['2026-11', '2026-10']);
  const miss = await call('/budget?month=2026-09');
  assert.equal(miss.status, 404);
  assert.deepEqual(miss.body.months, ['2026-11', '2026-10']); // the picker can go back
  assert.equal((await call('/budget?month=oct')).status, 400);
});

test('page: month totals and % as the brief prints them, every category with budget, spent, %, label; picker lists the months', () => {
  const b = budgetView(SUMMARY, NOW);
  const html = renderJacq({ ok: true, budget: b }, { bgTravel: false });
  assert.equal(pct(9122.8, 7500), 121); // brief: int(9122.8 / 7500 * 100)
  assert.equal(pct(4962.4, 3000), 165);
  assert.equal(pct(300, 300), 100);
  const pm = b.groups.personal.periods.month;
  assert.ok(html.includes(`$${Math.round(pm.spent).toLocaleString('en-CA')} / $7,500 · ${pct(pm.spent, 7500)}%`));
  assert.ok(html.indexOf('<h2>Personal</h2>') < html.indexOf('<h2>Business</h2>')); // the brief's order
  for (const g of ['personal', 'business']) for (const c of b.groups[g].periods.month.categories) assert.ok(html.includes(`data-line="${c.name}"`), c.name);
  assert.match(html, /<b>Software<\/b><em>fixed<\/em>/);
  assert.match(html, /<b>Amazon<\/b><em>cap<\/em>/);
  assert.match(html, /<b>ICBC car insurance<\/b><em>yearly<\/em>[\s\S]*?of \$1,728 a year, due Apr/);
  assert.match(html, /<b>Groceries<\/b><i>/); // personal variable lines: no label, as in the brief
  assert.match(html, /<span class="jqp">109%<\/span>/); // Groceries 1,252.42 of 1,140
  assert.match(html, /<option value="2026-11" selected>November 2026<\/option><option value="2026-10">October 2026<\/option>/);
  assert.match(html, /Travel not counted/);
  assert.match(renderJacq({ ok: true, budget: b }, { bgTravel: true }), /Travel counted[\s\S]*data-line="Travel"/);
  assert.match(renderJacq(null, {}), /Loading/);
  const miss = renderJacq({ error: 'No budget for 2026-09 yet', months: ['2026-11', '2026-10'] }, { month: '2026-09' });
  assert.match(miss, /No budget for 2026-09 yet/);
  assert.match(miss, /<option value="2026-11">November 2026<\/option><option value="2026-10">October 2026<\/option><option value="2026-09" selected>/);
  assert.match(html, /data through Nov 25/);
  const past = renderJacq({ ok: true, budget: budgetView(SUMMARY, NOW, '2026-10') }, {});
  assert.match(past, /data through Oct 31/); // month end, not the latest date overall (Nov 25)
  assert.doesNotMatch(past, /data through Nov/);
});

test('past month: the no-Travel list is the stored list without Travel', () => {
  const om = budgetView(SUMMARY, NOW, '2026-10').groups.business.periods.month;
  assert.ok(om.transactions.length > 0);
  assert.ok(om.transactions.every((t) => t.line !== 'Travel'));
  assert.equal(om.withTravel.transactions.length, om.transactions.length + 1);
  assert.equal(sum(om.transactions), om.spent);
});

test('API: GET /budget?month answers 401 when signed out (no auth, bad cookie)', async () => {
  const db = sqliteD1();
  await upsertSnapshot(db, 'moneyclaw', JSON.stringify(SUMMARY), '2026-11-26T10:00:00.000Z', '2026-11-26T10:00:00.000Z');
  const env = { DB: db, SESSION_SECRET: SECRET };
  for (const headers of [{}, { Cookie: `${COOKIE}=forged.value` }]) {
    const r = await handleApi(new Request('https://jonmac.ai/dashboard/api/v1/budget?month=2026-10', { headers }), env);
    assert.equal(r.status, 401, JSON.stringify(headers));
  }
});

test('tap a category: its transactions for the month (date, merchant, amount, account), sum = the category spent', () => {
  for (const ym of [null, '2026-10']) {
    const b = budgetView(SUMMARY, NOW, ym);
    for (const g of ['personal', 'business']) {
      for (const c of b.groups[g].periods.month.categories) {
        const ui = { bgOpen: null, bgTravel: false };
        const target = { closest: (sel) => (sel === '[data-jqcat]' ? { dataset: { jqcat: g, line: c.name } } : null) };
        assert.equal(jacqClick({ target }, ui), true);
        assert.deepEqual(ui.bgOpen, { g, k: 'month', view: 'line', line: c.name });
        const html = renderJacq({ ok: true, budget: b }, ui);
        const amounts = [...html.split('class="bgdl"')[1].matchAll(/<strong>-?\$([\d,]+\.\d\d)<\/strong>/g)].map((m) => Number(m[1].replace(/,/g, '')));
        assert.equal(amounts.length, c.count, `${g} ${c.name} count`);
        assert.equal(Math.round(amounts.reduce((s, a) => s + a, 0) * 100), Math.round(c.spent * 100), `${g} ${c.name} sum`);
        if (c.count) assert.match(html, /<span>2026-\d\d-\d\d · RBC [^<]+<\/span>/); // date and account
      }
    }
  }
  const ui = { bgOpen: null };
  assert.equal(jacqClick({ target: { closest: (sel) => (sel === '[data-jqall]' ? { dataset: { jqall: 'business' } } : null) } }, ui), true);
  assert.deepEqual(ui.bgOpen, { g: 'business', k: 'month', view: 'all', line: null });
});

test('month picker writes /jacq/?month= (the route jonmac.ai/jacq misses /jacq?month=, a reload went to the 404 site)', () => {
  const js = readFileSync(new URL('../public/d3/js/jacq.js', import.meta.url), 'utf8');
  const urls = [...js.matchAll(/replaceState\([^;]*/g)].map((m) => m[0]);
  assert.ok(urls.length > 0);
  for (const u of urls) { assert.doesNotMatch(u, /`\?month=/); assert.match(u, /\/jacq\/\?month=/); }
});
