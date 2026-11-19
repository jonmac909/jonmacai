// Dashboard 3 EOS page (public/d3/js/eos.js; Jon, 2026-11-18; card t_75395eabd6774bdc): Scorecard, Rocks, Issues, Meetings and
// Your queue tabs drawn from GET /dashboard/api/v1/eos (its server side is tested in eos.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { renderEos, eosTab, weeks13, queueSorted, EOS_TABS, eosTone, eosKeep, eosAfter } from '../public/d3/js/eos.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
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
    { id: 'cash', name: 'Sponsor cash collected', seat: 'Sponsors', owner: 'Florence', goal: { op: '>=', value: 2500, text: '$2,500 a week ($10k in December)' }, unit: '$', handKeyed: true,
      source: 'Hand-keyed: Sponsors money tracker card', definition: 'Money in the bank that week',
      values: [{ week: '2026-11-16', value: 2000, status: 'off', note: 'Topview' }, { week: '2026-11-09', value: 0, status: 'nodata' }, { week: '2026-10-19', value: 4200, status: 'partial' }] },
    { id: 'shipped', name: 'Cards shipped', seat: 'Dev', owner: 'Lucy', goal: { op: '>=', value: 10, text: '10 a week (proposed)' }, unit: 'cards',
      source: 'dash.py task history', values: [{ week: '2026-11-16', value: 12, status: 'ok' }, { week: '2026-11-09', value: 6, status: 'partial' }, { week: '2026-10-26', value: 32, status: 'partial' }] },
    { id: 'reels', name: 'Reels posted', seat: 'Video', owner: 'Olivia', goal: { op: '>=', value: 7, text: '7 a week' }, unit: 'reels',
      source: 'dash.py approvals', values: [{ week: '2026-11-16', value: 2, status: 'ok' }, { week: '2026-11-09', value: 7, status: 'ok' }] },
    { id: 'corr', name: 'Jon corrections', seat: 'Integrator', owner: 'Ana', goal: { op: '<=', value: 10, text: '10 or fewer a week (proposed)' }, unit: 'messages',
      source: 'Ana scratch', values: [{ week: '2026-11-16', value: 73, status: 'partial' }, { week: '2026-11-09', value: 51, status: 'partial' }] },
    { id: 'falsedone', name: 'False dones', seat: 'QC', owner: 'Ana (owns QC)', goal: { op: '<=', value: 0, text: '0' }, unit: 'cards',
      source: 'dash.py task history', values: [{ week: '2026-11-16', value: 0, status: 'ok' }] },
    { id: 'usage', name: 'Weekly usage', seat: 'Integrator', owner: 'Ana', goal: { op: '<=', value: 75, text: '75%' }, unit: '%',
      source: 'dash.py feed', no_data_how: 'Needs the claude_usage feed', values: [] },
  ],
};
const EOS = () => ({
  ok: true,
  scorecard: CARD,
  rocks: [{ id: 't_r1', title: 'Rock Q4: Sponsor pipeline at $10k', owner: 'Florence', status: 'doing', proofLink: 'https://jonmac.ai/proof/r1' },
    { id: 't_r2', title: 'Rock Q4: 6 videos a day', owner: 'Olivia', status: 'blocked', proofLink: '' }],
  issues: [{ id: 't_i1', title: 'Issue: HeyGen daily cap', owner: 'Olivia', status: 'todo', proofLink: '' },
    { id: 't_i2', title: 'Issue: stale previews', owner: 'Lucy', status: 'done', proofLink: 'https://jonmac.ai/proof/i2' }],
  meetings: [{ date: '2026-11-16', summary: 'Scorecard reviewed.\nTwo issues solved.', rating: 8 }],
  queue: [{ id: 'q1', kind: 'question', title: 'Which reel music?', money: false, createdAt: '2026-11-05T00:00:00Z' },
    { id: 'a_inv', kind: 'approval', title: 'Send Topview invoice', money: true, createdAt: '2026-11-12T00:00:00Z' },
    { id: 'a_old', kind: 'approval', title: 'Post reel 5', money: false, createdAt: '2026-11-01T00:00:00Z' },
    { id: 'a_pay', kind: 'approval', title: 'Pay the HeyGen bill', money: true, createdAt: '2026-11-10T00:00:00Z' }],
});

test('the rail has one EOS link, last, and app.js routes #eos to renderEos with GET /dashboard/api/v1/eos', () => {
  const index = read('../public/d3/index.html');
  assert.equal((index.match(/data-nav="eos"/g) || []).length, 1);
  assert.match(index, /<a href="#eos" data-nav="eos">.*<\/svg>EOS<\/a>\n<\/nav>/);
  const app = read('../public/d3/js/app.js');
  assert.match(app, /import \{ renderEos, eosKeep, eosAfter \} from '\.\/eos\.js';/);
  assert.match(app, /getJson\('\/dashboard\/api\/v1\/eos'\)/);
  const css = read('../public/d3/css/d3.css');
  for (const cls of ['eostabs', 'eossc', 'eoskpi', 'eosseat', 'eosln', 'eosnow', 'eosc.off', 'eosc.behind', 'eosc.part', 'eost.ok', 'eosrow']) assert.match(css, new RegExp(`\\.d3 \\.${cls.replace('.', '\\.')}\\b`), cls);
});

test('tabs: each tab draws from the payload, the current tab is marked, an unknown tab is the Scorecard', () => {
  assert.deepEqual(EOS_TABS.map(([id]) => id), ['scorecard', 'rocks', 'issues', 'meetings', 'queue']);
  for (const sub of [undefined, '', 'nope', 'Scorecard']) assert.equal(eosTab(sub), 'scorecard');
  const tab = (sub) => renderEos(null, EOS(), sub, NOW);
  for (const [id] of EOS_TABS) {
    const html = tab(id);
    assert.match(html, new RegExp(`<a class="btn sm" href="#eos/${id}" aria-current="page">`), id);
    assert.equal((html.match(/aria-current/g) || []).length, 1, id);
    assert.match(html, new RegExp(`<div class="eos" data-tab="${id}">`), id);
  }
  assert.match(tab('nope'), /data-tab="scorecard"[\s\S]*Sponsor cash collected/);
  const rocks = tab('rocks');
  assert.match(rocks, /2 this quarter/);
  assert.match(rocks, /Rock Q4: Sponsor pipeline at \$10k[\s\S]*Florence[\s\S]*Doing[\s\S]*href="https:\/\/jonmac\.ai\/proof\/r1"/);
  assert.match(rocks, /Rock Q4: 6 videos a day[\s\S]*class="pill bad">Blocked[\s\S]*No proof yet/);
  const issues = tab('issues');
  assert.match(issues, /1 open/);
  assert.match(issues, /Issue: HeyGen daily cap[\s\S]*Issue: stale previews/);
  const meet = tab('meetings');
  assert.match(meet, /Mon Nov 16/);
  assert.match(meet, /Scorecard reviewed\.\nTwo issues solved\./);
  assert.match(meet, /class="pill ok">8 \/ 10/);
  assert.match(tab('queue'), /4 waiting · money first, then oldest/);
  // loading, failed read, and empty lists
  assert.match(renderEos(null, undefined, 'rocks', NOW), /Loading/);
  assert.match(renderEos(null, null, 'rocks', NOW), /Could not load the EOS page/);
  assert.match(renderEos(null, { ok: false }, 'rocks', NOW), /Could not load the EOS page/);
  const none = { ok: true, scorecard: null, rocks: [], issues: [], meetings: [], queue: [] };
  assert.match(renderEos(null, none, 'scorecard', NOW), /Scorecard: no data yet/);
  assert.match(renderEos(null, none, 'rocks', NOW), /No Rock cards yet/);
  assert.match(renderEos(null, none, 'issues', NOW), /No Issue cards yet/);
  assert.match(renderEos(null, none, 'meetings', NOW), /no data yet, first meeting Monday 08:00/);
  assert.match(renderEos(null, none, 'queue', NOW), /Nothing waiting on you/);
});

// Colour rule (card t_e28750c475be4838). Planted faults first: each must come out red or grey, never the wrong colour.
test('scorecard colour, planted faults: 73 vs a goal of 10 (lower is better) this week is red; a past week below goal is red, not amber; the oldest part week is grey, never amber', () => {
  assert.equal(eosTone({ value: 73, op: '<=', goal: 10, current: true, elapsed: 3 }), 'off');
  assert.equal(eosTone({ value: 11, op: '<=', goal: 10, current: true, elapsed: 1 }), 'off');
  for (const value of [6, 9.9, 0]) assert.equal(eosTone({ value, op: '>=', goal: 10, current: false, elapsed: 3 }), 'off', String(value));
  for (const value of [0, 1, 4200]) assert.equal(eosTone({ value, op: '>=', goal: 2500, current: false, part: true }), 'part', String(value));
  assert.equal(eosTone({ value: 51, op: '<=', goal: 10, current: false, part: true }), 'part');
  // the rendered page: no past chip or tile is ever amber, and the feed's own "partial" or "off" labels are not trusted
  const html = renderEos(null, EOS(), 'scorecard', NOW);
  const row = (name) => html.split('<details class="eosln').find((r) => r.includes(`<b>${name}</b>`));
  assert.match(row('Jon corrections'), /<span class="eosnow off">73<\/span>/);
  assert.match(row('Jon corrections'), /<i class="eosc part" title="Nov 9, part week">51<\/i><\/span>/);
  assert.match(row('Cards shipped'), /<i class="eosc part" title="Oct 26, part week">32<\/i><i class="eosc nodata" title="Nov 2: no data">-<\/i><i class="eosc off" title="Nov 9">6<\/i>/);
  assert.match(row('Sponsor cash collected'), /<span class="eost part" title="Oct 19, part week"><small>Oct 19 part<\/small><b>4.2k<\/b>/);
  assert.equal((html.match(/eos[ct] behind/g) || []).length, 1); // only this week's tile may be amber
  assert.match(html, /<span class="eost behind" title="Nov 16"><small>Now<\/small>/);
});

test('scorecard colour, clean cases: on goal is green; this week slightly behind the pro-rata pace is amber; well behind is red; a Rock before its due date is green; no value is grey', () => {
  assert.equal(eosTone({ value: 10, op: '>=', goal: 10, current: false }), 'ok');
  assert.equal(eosTone({ value: 0, op: '<=', goal: 0, current: true, elapsed: 3 }), 'ok');
  assert.equal(eosTone({ value: 2000, op: '>=', goal: 2500, current: true, elapsed: 3 }), 'ok'); // pace 1,071 by Wednesday
  assert.equal(eosTone({ value: 2.5, op: '>=', goal: 7, current: true, elapsed: 3 }), 'behind'); // pace 3, under a day behind
  assert.equal(eosTone({ value: 1, op: '>=', goal: 7, current: true, elapsed: 3 }), 'off');
  assert.equal(eosTone({ value: 70, op: '>=', goal: 80, current: true, elapsed: 3, rate: true }), 'off'); // a rate is not pro-rated
  assert.equal(eosTone({ value: 0, op: '>=', goal: 3, current: true, due: '2026-12-31', weekEnd: '2026-11-22' }), 'ok');
  for (const value of [null, undefined, '', 'n/a']) assert.equal(eosTone({ value, op: '>=', goal: 10 }), 'nodata');
  const html = renderEos(null, EOS(), 'scorecard', NOW);
  assert.match(html, /<div class="eoskpi"><span class="off"><b>1<\/b>off goal<\/span><span class="behind"><b>1<\/b>behind pace<\/span><span class="ok"><b>3<\/b>on goal<\/span><span class="nodata"><b>1<\/b>not tracked<\/span><\/div>/);
  const row = (name) => html.split('<details class="eosln').find((r) => r.includes(`<b>${name}</b>`));
  assert.match(row('Reels posted'), /<span class="eosnow behind">2<\/span>/);
  assert.match(row('Cards shipped'), /<span class="eosnow ok">12<\/span>/);
  assert.match(row('Sponsor cash collected'), /<span class="eosnow ok">\$2.0k<\/span>/);
  assert.match(html, /Big number: this week, day 3 of 7\./);
});

test('scorecard layout: seat list, not a 13-column table; seats in feed order, off lines first; empty weeks hidden; unit said once; untracked numbers folded; HTML escaped', () => {
  const w = weeks13(NOW);
  assert.equal(w.length, 13);
  assert.equal(w[12], '2026-11-16');
  assert.equal(w[0], '2026-08-24');
  const html = renderEos(null, EOS(), 'scorecard', NOW);
  assert.doesNotMatch(html, /<table|eostbl|no data yet/);
  assert.match(html, /<section class="card eossc">/);
  const seats = [...html.matchAll(/<div class="eosseat"><span>([^<]*)<\/span><em class="(\w+)">([^<]*)<\/em>/g)].map((m) => m.slice(1).join('|'));
  assert.deepEqual(seats, ['Florence, Sponsors|ok|on goal', 'Lucy, Dev|ok|on goal', 'Olivia, Video|behind|1 behind', 'Ana, Integrator and QC|off|1 off']);
  assert.ok(html.indexOf('<b>Jon corrections</b>') < html.indexOf('<b>False dones</b>'), 'off line first in its seat');
  const row = (name) => html.split('<details class="eosln').find((r) => r.includes(`<b>${name}</b>`));
  // empty weeks hidden: cash has data on Nov 16 and Oct 19 only (Nov 9 is nodata with value 0 and must not show as 0 or $0)
  const cash = row('Sponsor cash collected');
  assert.equal((cash.match(/class="eost /g) || []).length, 2);
  assert.match(cash, /<small>Now<\/small><b>2k<\/b>|<small>Now<\/small><b>2.0k<\/b>/);
  assert.doesNotMatch(cash, />\$?0</);
  assert.match(cash, /<small>goal \$2,500 a week, typed in<\/small>/);
  assert.match(cash, /Goal: \$2,500 a week \(\$10k in December\) · Money in the bank that week/);
  assert.match(cash, /title="Nov 16: Topview"/);
  assert.match(cash, /data-id="cash"/);
  // the unit word is said once, under the name; chips, tiles and the big number are bare numbers
  const shipped = row('Cards shipped');
  assert.match(shipped, /<small>goal 10 a week · cards<\/small>/);
  assert.equal((shipped.match(/cards/g) || []).length, 1);
  assert.doesNotMatch(shipped, /typed in/);
  for (const m of html.matchAll(/<i class="eosc \w+"[^>]*>([^<]*)<\/i>|<b>([^<]*)<\/b><\/span>/g)) assert.match(m[1] ?? m[2], /^(-|-?[\d.,]+k?)$/, m[0]);
  // untracked numbers sit in one folded line, not in the seats or the counts
  assert.match(html, /<details class="eosln eosoff" data-id="_untracked"><summary>Not tracked yet \(1\): Weekly usage<\/summary><ul><li><b>Weekly usage<\/b> · Ana · goal 75% · Needs the claude_usage feed<\/li>/);
  assert.equal((html.match(/<b>Weekly usage<\/b>/g) || []).length, 1);
  assert.match(html, /Chips: Oct 26, Nov 2, Nov 9\./);
  // 17:00Z in Kelowna's time, whatever offset this Node's time-zone data gives November (BC dropped the fall-back)
  const hm = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(NOW));
  assert.ok(html.includes(`Updated Nov 18 ${hm}`), hm);
  assert.match(renderEos(null, EOS(), 'scorecard', NOW + 9 * 86400000), /over a week old/);
  // planted XSS in a name, a note and a goal
  const bad = EOS();
  bad.scorecard = { ...CARD, numbers: [{ ...CARD.numbers[1], id: 'x"y', name: '<img src=x onerror=alert(1)>', goal: { op: '>=', value: 10, text: '<b>10</b>' }, values: [{ week: '2026-11-16', value: 1, status: 'ok', note: '"><script>' }] }] };
  const xss = renderEos(null, bad, 'scorecard', NOW);
  assert.doesNotMatch(xss, /<img|<script|<b>10<\/b>|data-id="x"y"/);
  assert.match(xss, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('scorecard redraw keeps the lines Jon opened open', () => {
  const mk = (id, open) => ({ dataset: { id }, open });
  const before = [mk('cash', true), mk('reels', true)];
  const keep = eosKeep({ querySelectorAll: (sel) => (sel.endsWith('[open]') ? before : []) });
  assert.deepEqual(keep, ['cash', 'reels']);
  const after = [mk('cash', false), mk('shipped', false), mk('reels', false)];
  eosAfter({ querySelectorAll: () => after }, keep);
  assert.deepEqual(after.map((d) => d.open), [true, false, true]);
  assert.equal(eosKeep({}), null);
  eosAfter(null, null);
});

test('your queue: money first, then oldest first, whatever order the server sent', () => {
  assert.deepEqual(queueSorted(EOS().queue).map((i) => i.id), ['a_pay', 'a_inv', 'a_old', 'q1']);
  const html = renderEos(null, EOS(), 'queue', NOW);
  assert.match(html, /Pay the HeyGen bill[\s\S]*Send Topview invoice[\s\S]*Post reel 5[\s\S]*Which reel music\?/);
  assert.equal((html.match(/class="pill bad">Money</g) || []).length, 2);
  assert.match(html, /Approval · since Nov 9/); // 2026-11-10T00:00Z is Nov 9 in Kelowna
  assert.match(html, /Question · since Nov 4/);
});

test('Shell: #eos/queue opens the EOS page on Your queue, read from GET /dashboard/api/v1/eos', async () => {
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const realInterval = globalThis.setInterval;
  const nodes = new Map();
  const asked = [];
  const node = () => ({ innerHTML: '', textContent: '', hidden: false, dataset: {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, addEventListener() {}, querySelector: () => null });
  Object.assign(globalThis, {
    document: { documentElement: node(), title: '', visibilityState: 'visible', querySelectorAll: () => [], getElementById: (k) => nodes.get(k) || nodes.set(k, node()).get(k), addEventListener() {} },
    window: { addEventListener() {} }, location: { hash: '#eos/queue', replace() {} }, localStorage: store(), sessionStorage: store(),
    fetch: async (url) => {
      const u = String(url);
      asked.push(u);
      if (u.endsWith('/v1/eos')) return new Response(JSON.stringify(EOS()));
      if (u.endsWith('/d2')) return new Response(read('./fixtures/d2-sample.json'));
      return new Response(JSON.stringify({ ok: true, asOf: '2026-11-18T17:00:00.000Z', d3: { openCards: {}, goals: {} } }));
    },
  });
  globalThis.setInterval = () => 0;
  try { await import('../public/d3/js/app.js?eos=1'); await settle(); } finally { globalThis.setInterval = realInterval; }
  const html = nodes.get('main').innerHTML;
  assert.equal(globalThis.document.title, 'EOS · Jon Mac');
  assert.match(html, /<div class="eos" data-tab="queue">/);
  assert.match(html, /href="#eos\/queue" aria-current="page"/);
  assert.match(html, /Pay the HeyGen bill[\s\S]*Which reel music\?/);
  assert.ok(asked.some((u) => u.endsWith('/dashboard/api/v1/eos')));
});

test('the worker serves /dash/js/eos.js like every other page script', async () => {
  const env = { SESSION_SECRET: 'test-session-secret-32-bytes-ok!', ASSETS: { fetch: async (r) => new Response(`asset:${new URL(r.url).pathname}`) } };
  const out = await worker.fetch(new Request('https://jonmac.ai/dash/js/eos.js', { redirect: 'manual' }), env, {});
  assert.equal(await out.text(), 'asset:/d3/js/eos.js');
});
