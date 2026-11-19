// Dashboard 3 EOS page (public/d3/js/eos.js; Jon, 2026-11-18; card t_75395eabd6774bdc): Scorecard, Rocks, Issues, Meetings and
// Your queue tabs drawn from GET /dashboard/api/v1/eos (its server side is tested in eos.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { renderEos, eosTab, weeks13, queueSorted, EOS_TABS } from '../public/d3/js/eos.js';

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
    { id: 'cash', name: 'Sponsor cash collected', seat: 'Sponsors', owner: 'Florence', goal: { op: '>=', value: 2500, text: '$2,500 a week' }, unit: '$', handKeyed: true,
      source: 'Hand-keyed: Sponsors money tracker card', values: [{ week: '2026-11-16', value: 2000, status: 'off', note: 'Topview' }, { week: '2026-11-09', value: 0, status: 'nodata' }] },
    { id: 'shipped', name: 'Cards shipped', seat: 'Dev', owner: 'Lucy', goal: { op: '>=', value: 10, text: '10 a week' }, unit: '',
      source: 'dash.py task history', values: [{ week: '2026-11-16', value: 12, status: 'ok' }, { week: '2026-11-09', value: 6, status: 'partial' }] },
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
  for (const cls of ['eostabs', 'eoswrap', 'eostbl', 'eosnum', 'eosv.off', 'eosv.partial', 'eosrow']) assert.match(css, new RegExp(`\\.d3 \\.${cls.replace('.', '\\.')}\\b`), cls);
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

test('scorecard: 13 Kelowna Monday weeks with this week on the right; no data says "no data yet", never 0 or $0; off, partial and hand-keyed show', () => {
  const w = weeks13(NOW);
  assert.equal(w.length, 13);
  assert.equal(w[12], '2026-11-16');
  assert.equal(w[0], '2026-08-24');
  const html = renderEos(null, EOS(), 'scorecard', NOW);
  assert.equal((html.match(/<th class="eoswk/g) || []).length, 13);
  assert.match(html, /<th class="eoswk cur">This week<br>Nov 16<\/th><\/tr>/);
  assert.match(html, /<td class="eosv off" title="Topview">\$2,000<\/td>/);
  assert.match(html, /<td class="eosv ok">12<\/td>/);
  assert.match(html, /<td class="eosv partial">6<\/td>/);
  // Nov 9 cash is nodata (value 0): it must not show as $0
  const cash = html.split('<tr>').find((r) => r.includes('Sponsor cash collected'));
  assert.doesNotMatch(cash, />\$0</);
  assert.doesNotMatch(cash, />0</);
  assert.equal((cash.match(/no data yet/g) || []).length, 12);
  assert.match(cash, /Sponsor cash collected<\/b> <span class="pill warn">hand-keyed<\/span><small>Florence · \$2,500 a week<\/small>/);
  const shipped = html.split('<tr>').find((r) => r.includes('Cards shipped'));
  assert.doesNotMatch(shipped, /hand-keyed/);
  assert.equal((shipped.match(/no data yet/g) || []).length, 11);
  // 17:00Z in Kelowna's time, whatever offset this Node's time-zone data gives November (BC dropped the fall-back)
  const hm = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(NOW));
  assert.ok(html.includes(`Updated Nov 18 ${hm}`), hm);
  assert.match(renderEos(null, EOS(), 'scorecard', NOW + 9 * 86400000), /over a week old/);
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
