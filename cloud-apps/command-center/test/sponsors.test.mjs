import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../src/api.js';
import { mergeSnapshot } from '../src/snapshot.js';
import { signSession, COOKIE } from '../src/auth.js';
import { memD1 } from './memd1.mjs';
import {
  mapColumn, boardStageFor, buildSponsorsPage, usd,
} from '../src/sponsors.js';
import live from './fixtures/sponsors.json' with { type: 'json' };

const NOW = Date.parse('2026-09-18T20:00:00-07:00');
const SECRET = 'test-session-secret-32-bytes-ok!';
const MAC = 'mac-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const GPU = 'gpu-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = process.platform === 'win32' ? 'python' : 'python3';

function envWith(db) {
  return {
    SESSION_SECRET: SECRET,
    DASHBOARD_PASSWORD: 'x',
    MACHINE_TOKEN_MAC: MAC,
    MACHINE_TOKEN_GPU2: GPU,
    DB: db,
  };
}

function req(path, { method = 'GET', cookie, headers = {}, body } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  return new Request(`https://jonmac.ai${path}`, { method, headers: h, body });
}

async function cookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${COOKIE}=${await signSession(SECRET, exp)}`;
}

test('board stages map onto the eight dashboard columns', () => {
  assert.equal(mapColumn('drafts'), 'New inquiry');
  assert.equal(mapColumn('new-lead'), 'New inquiry');
  assert.equal(mapColumn('negotiating'), 'Negotiating');
  assert.equal(mapColumn('contract-brief'), 'Negotiating');
  assert.equal(mapColumn('invoice-sent'), 'Waiting on deposit');
  assert.equal(mapColumn('deposit-paid'), 'Script approval');
  assert.equal(mapColumn('script-approval'), 'Script approval');
  assert.equal(mapColumn('production'), 'With editor');
  assert.equal(mapColumn('video-approval'), 'Video approval');
  assert.equal(mapColumn('publishing'), 'Live · send invoice');
  assert.equal(mapColumn('paid'), 'Paid in September');
  assert.equal(mapColumn('done'), 'Paid in September');
  assert.equal(boardStageFor('Waiting on deposit'), 'invoice-sent');
  assert.equal(boardStageFor('New inquiry'), 'new-lead');
});

test('sponsors page money matches collections.viralview.io', () => {
  const page = buildSponsorsPage(live, NOW);
  assert.equal(page.tiles[0].value, '$5,000');
  assert.equal(page.tiles[0].pct, 50);
  assert.equal(page.tiles[0].sub, 'Day 18 of 30 · pace would be $6,000');
  assert.equal(page.tiles[1].value, '$6,700');
  assert.equal(page.tiles[1].sub, '3 sponsors');
  assert.equal(page.tiles[2].value, '$8,802.33');
  assert.equal(page.tiles[2].label, 'Average of June–August');
  assert.equal(page.tiles[2].sub, '$1,197.67 a month short of goal');
  assert.equal(page.collect.meta, '3 open items · $6,700');
  assert.equal(page.collect.rows[0].sponsor, 'TopView');
  assert.equal(page.collect.rows[0].owed, '$1,500');
  assert.equal(page.collect.rows[1].sponsor, 'InVideo');
  assert.equal(page.collect.rows[2].sponsor, 'Viktor');
  assert.equal(page.collect.rows[2].paid, '$1,000');
  assert.equal(page.byMonth.rows[4].value, '$5,000');
  assert.equal(page.septemberBar.meta, '$11,700 if everything owed comes in');
  assert.equal(page.septemberBar.parts[0].amount, '$5,000');
  assert.equal(page.septemberBar.parts[1].amount, '$1,500');
  assert.equal(page.septemberBar.parts[2].amount, '$1,000');
  assert.equal(page.septemberBar.parts[3].amount, '$4,200');
  assert.equal(usd(8802.333333333333), '$8,802.33');
});

test('deal board hides archived and old done, keeps money and drafts', () => {
  const page = buildSponsorsPage(live, NOW);
  const names = page.board.columns.flatMap((c) => c.cards.map((k) => k.name));
  assert.ok(names.includes('Topview AI'));
  assert.ok(names.includes('Invideo'));
  assert.ok(names.includes('Flova AI'));
  assert.ok(names.includes('Poppy'));
  assert.ok(names.includes('LiveCo'));
  assert.ok(!names.includes('Nope'));
  assert.ok(!names.includes('Old Deal'));
  assert.ok(!names.includes('Random Cold'));
  assert.ok(!names.includes('1stcollab'));
  const waiting = page.board.columns.find((c) => c.stage === 'Waiting on deposit');
  assert.equal(waiting.cards.length, 2);
  assert.equal(waiting.cards.find((k) => k.name === 'Topview AI').amt, 1500);
  assert.equal(waiting.cards.find((k) => k.name === 'Topview AI').pill, '7 days late');
  const script = page.board.columns.find((c) => c.stage === 'Script approval');
  assert.equal(script.cards.find((k) => k.id === 'gmail-thread-viktor').pill, '8 days quiet');
  const nego = page.board.columns.find((c) => c.stage === 'Negotiating');
  assert.equal(nego.cards[0].pill, 'Your move');
  assert.equal(page.emails.rows.length, 1);
  assert.equal(page.emails.rows[0].id, 'gmail-thread-flova');
  assert.equal(page.tiles[3].value, '1');
});

test('mergeSnapshot replaces the sponsors page and home sponsor numbers', () => {
  const fixture = {
    nav: { badges: { sponsors: 3 } },
    goal: { label: '$10K SPONSOR GOAL', sub: '12 days left in September', pct: 50, see: 'See sponsors' },
    sources: { sponsors: { updatedAt: 'old' } },
    pages: {
      home: {
        tiles: [{ value: '$5,000', sub: 'fixture' }, { value: '$0' }],
        glance: { rows: [{ area: 'Sponsors', today: 'fixture', pct: 50, pill: '50%', page: 'sponsors' }] },
      },
      sponsors: { tiles: [{ value: '$5,000' }] },
    },
  };
  const data = { ...live, collections: { ...live.collections, incomeTotals: { ...live.collections.incomeTotals, September: 1234 } } };
  data.collections.items = live.collections.items.map((x) => ({ ...x }));
  const out = mergeSnapshot(fixture, [{
    source: 'sponsors',
    data: JSON.stringify(data),
    collected_at: '2026-09-18T17:04:33.939Z',
    received_at: '2026-09-18T17:05:00Z',
  }], NOW);
  assert.equal(out.pages.sponsors.tiles[0].value, '$1,234');
  assert.equal(out.pages.home.tiles[0].value, '$1,234');
  assert.match(out.pages.home.glance.rows[0].today, /\$1,234/);
  assert.equal(out.goal.pct, 12);
  assert.equal(out.nav.badges.sponsors, 1);
});

test('sponsor actions queue for the Mac runner', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  for (const kind of ['sponsor.send_draft', 'sponsor.nudge', 'sponsor.mark_paid', 'sponsor.send_invoice', 'sponsor.move_stage']) {
    const res = await handleApi(req('/dashboard/api/actions', {
      method: 'POST',
      cookie: ck,
      headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
      body: JSON.stringify({ kind, payload: { id: 'gmail-thread-flova', sponsor: 'TopView', stage: 'invoice-sent' }, idemKey: kind }),
    }), env);
    assert.equal(res.status, 200, kind);
    const row = await res.json();
    assert.equal(row.status, 'queued', kind);
    const claimed = await handleApi(req('/dashboard/api/actions/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MAC}` },
      body: JSON.stringify({ machine: 'mac' }),
    }), env);
    const { actions } = await claimed.json();
    assert.equal(actions[0].kind, kind);
    assert.equal(actions[0].target, 'mac');
    await handleApi(req(`/dashboard/api/actions/${row.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MAC}` },
      body: JSON.stringify({ ok: true, result: 'ok' }),
    }), env);
  }
});

test('dragging a card writes deal_stage_overrides', async () => {
  const db = memD1();
  const env = envWith(db);
  const ck = await cookie();
  const res = await handleApi(req('/dashboard/api/deals/gmail-thread-flova/stage', {
    method: 'POST',
    cookie: ck,
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ stage: 'production' }),
  }), env);
  assert.equal(res.status, 200);
  assert.equal(db.deals.get('gmail-thread-flova').stage, 'production');
  const page = buildSponsorsPage(live, NOW, { 'gmail-thread-flova': 'production' });
  const editor = page.board.columns.find((c) => c.stage === 'With editor');
  assert.ok(editor.cards.some((k) => k.id === 'gmail-thread-flova'));
});

test('mark paid updates collections.json totals', () => {
  const lib = join(root, 'collectors/lib').replace(/\\/g, '/');
  const r = spawnSync(py, ['-c',
    `import json,sys
sys.path.insert(0, r"${lib}")
from sponsors import mark_paid
raw = json.loads(sys.stdin.read())
out = mark_paid(raw, "TopView")
item = next(x for x in out["items"] if x["sponsor"]=="TopView")
print(item["paid"])
print(item["owed"])
print(out["incomeTotals"]["September"])
`,
  ], { encoding: 'utf8', input: JSON.stringify(live.collections) });
  assert.equal(r.status, 0, r.stderr);
  const [paid, owed, sep] = r.stdout.trim().split(/\r?\n/);
  assert.equal(paid, '1500');
  assert.equal(owed, '0');
  assert.equal(sep, '6500');
});
