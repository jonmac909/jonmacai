// Money page (Jon, 2026-11-17): drag a deal card to another stage. Server: POST /dashboard/api/deals/move saves the stage the way
// dash.py deal-set --stage does, refuses a bad stage / unknown deal / signed-out call and changes nothing then. Browser side: the drag
// gesture (mouse, and touch after a hold), the card moving at once, and snapping back with an error when the save fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { pipelineOf } from '../public/d3/js/goals.js';
import { dealStages, renderMoney, DROP_ON } from '../public/d3/js/money.js';
import { dealDrag, dealDragging } from '../public/d3/js/dealdrag.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-11T19:00:00Z');
const card = (id, stage, extra = {}) => ({ id, sponsor: id, contact: '', stage, amount: null, status: '', latestDate: '2026-11-05T12:00:00Z', to: '', threadId: '', subject: `${id} subject`, reason: '', needsDraft: false, ...extra });
const A = 'gmail-thread-aaa111aaa111', B = 'gmail-thread-bbb222bbb222';
const DATA = () => ({ collections: { items: [] }, cards: [card(A, 'publishing', { amount: 3000 }), card(B, 'deposit-paid', { amount: 1000 })] });

async function setup() {
  const db = sqliteD1();
  db.sqlite.prepare('INSERT INTO snapshots (source, data, collected_at, received_at) VALUES (?, ?, ?, ?)').run('sponsors', JSON.stringify(DATA()), '2026-11-11T18:00:00Z', '2026-11-11T18:00:00Z');
  const env = { DB: db, SESSION_SECRET: SECRET };
  const Cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
  const move = async (body, headers = { Cookie, 'X-CC': '1' }) => {
    const res = await handleApi(new Request('https://jonmac.ai/dashboard/api/deals/move', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const d2 = async () => (await handleApi(new Request('https://jonmac.ai/dashboard/api/d2', { headers: { Cookie } }), env)).json();
  const rows = () => db.sqlite.prepare('SELECT deal_id, stage FROM deal_stage_overrides ORDER BY deal_id').all().map((r) => ({ ...r }));
  const actions = () => db.sqlite.prepare('SELECT COUNT(*) n FROM actions').get().n;
  const stageOf = (r, id) => dealStages(r).find((s) => s.deals.some((d) => d.id === id))?.name || null;
  return { db, env, Cookie, move, d2, rows, actions, stageOf };
}
const withNow = async (fn) => { const real = Date.now; Date.now = () => NOW; try { return await fn(); } finally { Date.now = real; } };

test('a move saves the stage, survives a reload, and the stage columns and money totals follow it', () => withNow(async () => {
  const t = await setup();
  const r0 = await t.d2();
  assert.equal(t.stageOf(r0, A), 'In production');
  assert.equal(t.stageOf(r0, B), 'In production');
  const p0 = pipelineOf(r0);
  const res = await t.move({ id: B, stage: 'invoice-sent' }); // In production -> Invoiced
  assert.deepEqual([res.status, res.body], [200, { ok: true, id: B, stage: 'invoice-sent' }]);
  assert.deepEqual(t.rows(), [{ deal_id: B, stage: 'invoice-sent' }]); // the same field dash.py deal-set --stage writes
  const r1 = await t.d2(); // a fresh read = a reload
  assert.equal(t.stageOf(r1, B), 'Invoiced');
  assert.equal(t.stageOf(r1, A), 'In production'); // the other card did not move
  const p1 = pipelineOf(r1);
  assert.notDeepEqual(p1.totals, p0.totals, 'Money owed / Deals to close recompute from the new stage');
  // and every one of the six columns accepts a drop
  for (const [name, stage] of Object.entries(DROP_ON)) {
    assert.equal((await t.move({ id: B, stage })).status, 200, name);
    assert.equal(t.stageOf(await t.d2(), B), name);
  }
}));

test('a bad stage, a missing or unknown deal, or a broken body is refused and nothing is saved', () => withNow(async () => {
  const t = await setup();
  const before = t.actions();
  const bad = [
    [{ id: B, stage: 'bogus' }, 400], [{ id: B, stage: '' }, 400], [{ id: B }, 400], [{ id: B, stage: 'archived' }, 400], [{ id: B, stage: 'Negotiating' }, 400],
    [{ stage: 'negotiating' }, 400], [{ id: 'gmail-thread-ffffffffffff', stage: 'negotiating' }, 404], ['not json', 400], ['[]', 400],
  ];
  for (const [body, status] of bad) assert.equal((await t.move(body)).status, status, JSON.stringify(body));
  assert.deepEqual(t.rows(), []);
  assert.equal(t.actions(), before);
  assert.equal(t.stageOf(await t.d2(), B), 'In production');
}));

test('signed out, or without the X-CC header, the move is refused and nothing changes', () => withNow(async () => {
  const t = await setup();
  const before = t.actions();
  assert.equal((await t.move({ id: B, stage: 'negotiating' }, { 'X-CC': '1' })).status, 401);
  assert.equal((await t.move({ id: B, stage: 'negotiating' }, {})).status, 401);
  assert.equal((await t.move({ id: B, stage: 'negotiating' }, { Cookie: `${COOKIE}=1.deadbeef`, 'X-CC': '1' })).status, 401);
  assert.equal((await t.move({ id: B, stage: 'negotiating' }, { Cookie: t.Cookie })).status, 403);
  assert.deepEqual(t.rows(), []);
  assert.equal(t.actions(), before);
  assert.equal(t.stageOf(await t.d2(), B), 'In production');
}));

test('the Money board draws each card with its id and each column with the stage it drops on', () => withNow(async () => {
  const t = await setup();
  const html = renderMoney(await t.d2(), { d3: { asOf: new Date(NOW).toISOString() } }, {}, '');
  for (const [name, stage] of Object.entries(DROP_ON)) assert.match(html, new RegExp(`data-stage="${name}" data-drop="${stage}"`));
  assert.match(html, new RegExp(`class="vcard dealcard"[^>]*data-dealid="${A}"`));
  assert.match(html, /data-stagecount>2</);
  assert.match(html, /id="dealErr"/);
}));

// ---- the gesture, on a small stand-in for the board: three columns side by side, 100 px wide ----
function fakeBoard() {
  const listeners = {};
  const cl = () => ({ s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } });
  const root = {
    classList: cl(), stages: [],
    querySelectorAll(sel) { return sel === '.stage[data-drop]' ? root.stages : sel === '.stagedrop' ? root.stages.filter((s) => s.classList.contains('stagedrop')) : []; },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    fire(t, e) { for (const f of listeners[t] || []) f(e); },
  };
  const mk = (name, drop, i, ids) => {
    const st = {
      dataset: { stage: name, drop }, classList: cl(), kids: [], count: { textContent: '' }, none: { hidden: false },
      getBoundingClientRect: () => ({ left: i * 100, right: i * 100 + 100, top: 0, bottom: 300 }),
      querySelectorAll: (sel) => (sel === '.dealcard' ? st.kids.filter((k) => k.dataset.dealid) : []),
      querySelector: (sel) => (sel === '[data-stagecount]' ? st.count : sel === '.dealnone' ? st.none : null),
      insertBefore(el, ref) {
        const old = el.parent.kids.indexOf(el);
        if (old >= 0) el.parent.kids.splice(old, 1);
        el.parent = st;
        const j = ref ? st.kids.indexOf(ref) : -1;
        st.kids.splice(j >= 0 ? j : st.kids.length, 0, el);
      },
    };
    for (const id of ids) {
      const el = { dataset: { dealid: id }, parent: st, classList: cl(), style: {}, isConnected: true, closest: (s) => (s === '.stage[data-drop]' ? el.parent : el), setPointerCapture() {}, querySelector: () => ({ textContent: id }), get parentNode() { return el.parent; }, get nextSibling() { return el.parent.kids[el.parent.kids.indexOf(el) + 1] || null; } };
      st.kids.push(el);
    }
    st.count.textContent = String(ids.length);
    st.none.hidden = ids.length > 0;
    root.stages.push(st);
    return st;
  };
  mk('Lead', 'new-lead', 0, ['d1', 'd2']); mk('Negotiating', 'negotiating', 1, []); mk('Agreed', 'contract-brief', 2, ['d3']);
  return root;
}
const ids = (st) => st.kids.map((k) => k.dataset.dealid);
const ptr = (type, x, y, el) => ({ pointerType: type, pointerId: 1, button: 0, clientX: x, clientY: y, target: { closest: (s) => (s.startsWith('.dealcard') ? el : null) }, preventDefault() {} });
const tick = () => new Promise((r) => setTimeout(r, 5));

test('mouse: dragging a card onto another column moves it at once, saves once, updates both counts; a plain click does nothing', async () => {
  const root = fakeBoard();
  const calls = [];
  dealDrag(root, async (id, stage) => { calls.push([id, stage]); return true; });
  const [lead, neg] = root.stages;
  const d1 = lead.kids[0];
  root.fire('pointerdown', ptr('mouse', 10, 10, d1));
  root.fire('pointerup', ptr('mouse', 10, 10, d1));
  assert.deepEqual(calls, []); // a click, not a drag
  root.fire('pointerdown', ptr('mouse', 10, 10, d1));
  root.fire('pointermove', ptr('mouse', 60, 12, d1));
  assert.equal(dealDragging(), true);
  root.fire('pointermove', ptr('mouse', 150, 20, d1));
  assert.equal(neg.classList.contains('stagedrop'), true);
  root.fire('pointerup', ptr('mouse', 150, 20, d1));
  await tick();
  assert.deepEqual(calls, [['d1', 'negotiating']]);
  assert.deepEqual([ids(lead), ids(neg)], [['d2'], ['d1']]);
  assert.deepEqual([lead.count.textContent, neg.count.textContent, neg.none.hidden, lead.none.hidden], ['1', '1', true, true]);
  assert.equal(dealDragging(), false);
  assert.equal(neg.classList.contains('stagedrop'), false);
  // the click that follows the drop is swallowed so the deal does not open
  let stopped = false;
  root.fire('click', { target: { closest: () => d1 }, preventDefault() {}, stopImmediatePropagation() { stopped = true; } });
  assert.equal(stopped, true);
});

test('dropping on the same column, or off the board, saves nothing', async () => {
  const root = fakeBoard();
  const calls = [];
  dealDrag(root, async (id, stage) => { calls.push([id, stage]); return true; });
  const [lead] = root.stages;
  const d1 = lead.kids[0];
  for (const x of [50, 900]) { // inside Lead / outside every column
    root.fire('pointerdown', ptr('mouse', 10, 10, d1));
    root.fire('pointermove', ptr('mouse', 30, 40, d1));
    root.fire('pointermove', ptr('mouse', x, 40, d1));
    root.fire('pointerup', ptr('mouse', x, 40, d1));
  }
  await tick();
  assert.deepEqual(calls, []);
  assert.deepEqual(ids(lead), ['d1', 'd2']);
});

test('a failed save puts the card back where it was, fixes the counts and shows the error', async () => {
  const root = fakeBoard();
  const errs = [];
  dealDrag(root, async () => { throw new Error('answered 500'); }, () => true, (t) => errs.push(t));
  const [lead, neg] = root.stages;
  const d1 = lead.kids[0];
  root.fire('pointerdown', ptr('mouse', 10, 10, d1));
  root.fire('pointermove', ptr('mouse', 50, 10, d1));
  root.fire('pointermove', ptr('mouse', 150, 10, d1));
  root.fire('pointerup', ptr('mouse', 150, 10, d1));
  await tick();
  assert.deepEqual([ids(lead), ids(neg)], [['d1', 'd2'], []]); // d1 is first again
  assert.deepEqual([lead.count.textContent, neg.count.textContent, neg.none.hidden], ['2', '0', false]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /Could not move d1 to Negotiating/);
});

test('touch: a finger drags only after a hold; moving first is a scroll; signed out nothing lifts', async () => {
  const root = fakeBoard();
  const calls = [];
  let on = true;
  dealDrag(root, async (id, stage) => { calls.push([id, stage]); return true; }, () => on);
  const [lead] = root.stages;
  const d2 = lead.kids[1];
  const wait = () => new Promise((r) => setTimeout(r, 520));
  root.fire('pointerdown', ptr('touch', 10, 10, d2));
  root.fire('pointermove', ptr('touch', 10, 50, d2)); // wandered first: scrolling
  await wait();
  root.fire('pointermove', ptr('touch', 150, 50, d2));
  root.fire('pointerup', ptr('touch', 150, 50, d2));
  assert.deepEqual(calls, []);
  on = false;
  root.fire('pointerdown', ptr('touch', 10, 10, d2));
  await wait();
  assert.equal(dealDragging(), false);
  root.fire('pointerup', ptr('touch', 10, 10, d2));
  on = true;
  root.fire('pointerdown', ptr('touch', 10, 10, d2));
  await wait(); // held
  assert.equal(dealDragging(), true);
  root.fire('pointermove', ptr('touch', 150, 40, d2));
  root.fire('pointerup', ptr('touch', 150, 40, d2));
  await tick();
  assert.deepEqual(calls, [['d2', 'negotiating']]);
});
