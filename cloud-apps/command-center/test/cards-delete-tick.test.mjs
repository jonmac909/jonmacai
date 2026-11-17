// Cards page (Jon, 2026-11-17): a tick box and a Delete on every card. Jon's session only; a delete is soft (the row, proofs and
// history stay) and a deleted card is in no board, list, count or bot query.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex, todayData } from '../src/bots.js';
import { cardsData } from '../src/cards.js';
import { signSession, COOKIE } from '../src/auth.js';
import { d3Data, buildD3 } from '../src/d3.js';
import { pendingData } from '../src/pending.js';
import { findCard } from '../src/reviewhook.js';
import { renderCards } from '../public/d3/js/cards.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TOKENS = { developer: `ccb_${'d'.repeat(43)}`, sponsors: `ccb_${'s'.repeat(43)}`, qc: `ccb_${'q'.repeat(43)}`, ana: `ccb_${'a'.repeat(43)}` };
const T0 = '2026-11-17T10:00:00.000Z';

async function setup() {
  const db = sqliteD1();
  for (const [bot, token] of Object.entries(TOKENS)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), bot, '2026-11-01T00:00:00.000Z').run();
  }
  const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;
  return { db, env: { DB: db, SESSION_SECRET: SECRET }, cookie };
}

// who: 'jon' (session + X-CC), a bot slug, or 'out' (no credentials at all).
function call(ctx, who, method, path, body) {
  const headers = new Headers();
  if (who === 'jon') { headers.set('Cookie', ctx.cookie); headers.set('X-CC', '1'); } else if (who !== 'out') headers.set('Authorization', `Bearer ${TOKENS[who]}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const init = { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
  return handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, init), ctx.env).then(async (r) => ({ status: r.status, body: await r.json() }));
}

let n = 0;
async function card(ctx, o = {}) {
  n += 1;
  const row = { id: `t_${String(n).padStart(16, '0')}`, title: `Card ${n}`, owner: 'developer', status: 'doing', created_by: 'developer', updated_by: 'developer', created_at: T0, updated_at: T0, ...o };
  const keys = Object.keys(row);
  await ctx.db.prepare(`INSERT INTO bot_tasks (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).bind(...keys.map((k) => row[k])).run();
  return row.id;
}
const rowOf = (ctx, id) => ctx.db.sqlite.prepare('SELECT * FROM bot_tasks WHERE id = ?').get(id);
const events = (ctx, id) => ctx.db.sqlite.prepare('SELECT "by", kind, detail FROM bot_task_events WHERE task_id = ? ORDER BY at, rowid').all(id).map((e) => ({ ...e }));
const titles = (r) => r.body.tasks.map((t) => t.title).sort();

test('tick sets done (done_at, history "Ticked done by Jon"); untick restores the status it had', async () => {
  const ctx = await setup();
  for (const status of ['todo', 'doing', 'waiting_on_jon', 'qc', 'review']) {
    const id = await card(ctx, { status, owner: status === 'waiting_on_jon' ? 'jon' : 'developer' });
    const up = await call(ctx, 'jon', 'POST', `/tasks/${id}/tick`, { on: true });
    assert.equal(up.status, 200, status);
    assert.equal(up.body.task.status, 'done');
    assert.equal(typeof up.body.task.doneAt, 'string');
    assert.equal(up.body.task.updatedBy, 'jon');
    assert.deepEqual(events(ctx, id).at(-1), { by: 'jon', kind: 'tick', detail: 'Ticked done by Jon' });
    const down = await call(ctx, 'jon', 'POST', `/tasks/${id}/tick`, { on: false });
    assert.equal(down.status, 200);
    assert.equal(down.body.task.status, status, 'back to its previous status');
    assert.equal(down.body.task.doneAt, null);
    assert.match(events(ctx, id).at(-1).detail, /^Unticked by Jon: back to /);
  }
});

test('tick works for every card type: video, sponsor and money cards as well as internal ones', async () => {
  const ctx = await setup();
  const ids = [
    await card(ctx, { title: 'Edit ep 4', owner: 'video-editor', project: 'jon-mac', stage: 'edit', status: 'review' }),
    await card(ctx, { title: 'Topview video 2', owner: 'sponsors', project: 'sponsors', status: 'review' }),
    await card(ctx, { title: 'Chase invoice', owner: 'accounting', project: 'accounting', status: 'doing' }),
    await card(ctx, { title: 'Sign the contract', owner: 'jon', status: 'todo' }),
  ];
  for (const id of ids) assert.equal((await call(ctx, 'jon', 'POST', `/tasks/${id}/tick`, { on: true })).body.task.status, 'done');
});

test('tick twice, or untick a card that is not done, changes nothing; bad input and unknown cards are refused', async () => {
  const ctx = await setup();
  const id = await card(ctx, { status: 'doing' });
  assert.equal((await call(ctx, 'jon', 'POST', `/tasks/${id}/tick`, { on: false })).body.unchanged, true);
  await call(ctx, 'jon', 'POST', `/tasks/${id}/tick`, { on: true });
  const again = await call(ctx, 'jon', 'POST', `/tasks/${id}/tick`, { on: true });
  assert.equal(again.body.unchanged, true);
  assert.equal(events(ctx, id).filter((e) => e.kind === 'tick').length, 1, 'one history line, not two');
  assert.equal((await call(ctx, 'jon', 'POST', `/tasks/${id}/tick`, {})).status, 400);
  assert.equal((await call(ctx, 'jon', 'POST', `/tasks/${id}/tick`, { on: 'yes' })).status, 400);
  assert.equal((await call(ctx, 'jon', 'POST', '/tasks/t_ffffffffffffffff/tick', { on: true })).status, 404);
  const gone = await card(ctx, { status: 'cancelled' });
  assert.equal((await call(ctx, 'jon', 'POST', `/tasks/${gone}/tick`, { on: true })).status, 409);
});

test('untick of a card that was approved or closed by someone else goes back to the status in its history, else todo', async () => {
  const ctx = await setup();
  const id = await card(ctx, { status: 'done', done_at: T0 });
  await ctx.db.prepare('INSERT INTO bot_task_events (id, task_id, at, "by", kind, detail) VALUES (?, ?, ?, ?, ?, ?)').bind('e_1', id, T0, 'jon', 'status', 'status review → done (approved by Jon)').run();
  assert.equal((await call(ctx, 'jon', 'POST', `/tasks/${id}/tick`, { on: false })).body.task.status, 'review');
  const bare = await card(ctx, { status: 'done', done_at: T0 });
  assert.equal((await call(ctx, 'jon', 'POST', `/tasks/${bare}/tick`, { on: false })).body.task.status, 'todo');
});

test('delete is soft: status deleted, row, proofs and history stay; undo restores the status', async () => {
  const ctx = await setup();
  const id = await card(ctx, { status: 'review', owner: 'video-editor' });
  await ctx.db.prepare("INSERT INTO bot_proofs (id, task_id, kind, link, status, created_by, created_at) VALUES ('p_1', ?, 'render', 'https://jonmac.ai/review/x', 'passed', 'qc', ?)").bind(id, T0).run();
  const del = await call(ctx, 'jon', 'POST', `/tasks/${id}/delete`);
  assert.equal(del.status, 200);
  assert.equal(del.body.task.status, 'deleted');
  const row = rowOf(ctx, id);
  assert.deepEqual([row.status, row.deleted_prev, typeof row.deleted_at], ['deleted', 'review', 'string']);
  assert.equal(ctx.db.sqlite.prepare('SELECT COUNT(*) AS n FROM bot_proofs WHERE task_id = ?').get(id).n, 1, 'proof kept');
  assert.deepEqual(events(ctx, id).at(-1), { by: 'jon', kind: 'delete', detail: 'Deleted by Jon' });
  const detail = await call(ctx, 'jon', 'GET', `/tasks/${id}`); // Jon can still open it (for Undo)
  assert.equal(detail.body.task.status, 'deleted');
  assert.equal(detail.body.task.proofs.length, 1);
  const undo = await call(ctx, 'jon', 'POST', `/tasks/${id}/undelete`);
  assert.equal(undo.body.task.status, 'review');
  assert.deepEqual([rowOf(ctx, id).deleted_prev, rowOf(ctx, id).deleted_at], [null, null]);
  assert.match(events(ctx, id).at(-1).detail, /^Restored by Jon/);
  assert.equal((await call(ctx, 'jon', 'POST', `/tasks/${id}/undelete`)).body.unchanged, true);
});

test('a done card deleted and restored is still done, and its untick still works', async () => {
  const ctx = await setup();
  const id = await card(ctx, { status: 'doing' });
  await call(ctx, 'jon', 'POST', `/tasks/${id}/tick`, { on: true });
  await call(ctx, 'jon', 'POST', `/tasks/${id}/delete`);
  assert.equal((await call(ctx, 'jon', 'POST', `/tasks/${id}/tick`, { on: true })).status, 409, 'a deleted card cannot be ticked');
  assert.equal((await call(ctx, 'jon', 'POST', `/tasks/${id}/undelete`)).body.task.status, 'done');
  assert.equal((await call(ctx, 'jon', 'POST', `/tasks/${id}/tick`, { on: false })).body.task.status, 'doing');
});

test('a deleted card is on no board or list: Cards page, Today board, Team and Review data, pending, hook lookup', async () => {
  const ctx = await setup();
  const keep = await card(ctx, { title: 'Keep me', status: 'review' });
  const gone = await card(ctx, { title: 'Delete me', status: 'review' });
  const goneDone = await card(ctx, { title: 'Delete me too', status: 'done', done_at: new Date().toISOString() });
  await ctx.db.prepare("INSERT INTO bot_questions (id, asked_by, question, task_id, status, created_at, updated_at) VALUES ('q_1', 'developer', 'Which one?', ?, 'open', ?, ?)").bind(gone, T0, T0).run();
  const now = Date.now();
  const before = await cardsData(ctx.env, now);
  assert.equal(before.counts.open, 2);
  await call(ctx, 'jon', 'POST', `/tasks/${gone}/delete`);
  await call(ctx, 'jon', 'POST', `/tasks/${goneDone}/delete`);
  const after = await cardsData(ctx.env, now);
  assert.deepEqual(after.open.map((c) => c.id), [keep]);
  assert.deepEqual(after.done, []);
  assert.deepEqual(after.counts, { open: 1, done: 0, macframesOpen: 0, macframesDone: 0 }, 'counts update');
  const html = renderCards(null, { ok: true, cards: after }, {});
  assert.match(html, /<b>1<\/b> open cards/);
  assert.doesNotMatch(html, /Delete me/);
  const today = await todayData(ctx.db, now, '2026-11');
  assert.deepEqual(today.tasks.map((t) => t.id), [keep]);
  assert.deepEqual(today.questions, [], "the deleted card's open question is gone from Needs you");
  const d3 = buildD3(await d3Data(ctx.env, now));
  assert.deepEqual((d3.queue || []).filter((x) => x.id === gone), []);
  assert.ok(!JSON.stringify(d3).includes('Delete me'));
  assert.deepEqual((await pendingData(ctx.db)).questions, []);
  assert.equal((await findCard(ctx.db, { task_id: gone })).task, null);
  assert.equal((await findCard(ctx.db, { task_id: keep })).task.id, keep);
  // Undo brings it all back.
  await call(ctx, 'jon', 'POST', `/tasks/${gone}/undelete`);
  assert.equal((await cardsData(ctx.env, now)).counts.open, 2);
  assert.equal((await todayData(ctx.db, now, '2026-11')).questions.length, 1);
});

test('bots and the dispatcher never get a deleted card: lists, status filters, proofs, writes', async () => {
  const ctx = await setup();
  const live = await card(ctx, { title: 'Live card', status: 'doing' });
  const gone = await card(ctx, { title: 'Deleted card', status: 'doing' });
  await ctx.db.prepare("INSERT INTO bot_proofs (id, task_id, kind, link, status, created_by, created_at) VALUES ('p_0000000000000009', ?, 'url', 'https://example.com/a', 'pending', 'developer', ?)").bind(gone, T0).run();
  await call(ctx, 'jon', 'POST', `/tasks/${gone}/delete`);
  for (const bot of ['developer', 'qc', 'ana']) {
    assert.deepEqual(titles(await call(ctx, bot, 'GET', '/tasks')), ['Live card'], bot);
    assert.deepEqual(titles(await call(ctx, bot, 'GET', '/tasks?status=doing')), ['Live card'], 'dash.py tasks --status doing / the dispatcher card query');
    assert.deepEqual(titles(await call(ctx, bot, 'GET', '/tasks?owner=developer&status=doing,todo')), ['Live card']);
  }
  assert.equal((await call(ctx, 'developer', 'GET', '/tasks?status=deleted')).status, 400, 'bots cannot even filter by it');
  const stub = await call(ctx, 'developer', 'GET', `/tasks/${gone}`);
  assert.deepEqual(stub.body.task, { id: gone, status: 'deleted', deleted: true }, 'the dispatcher sees "not doing" and skips; no title, note or proof');
  assert.deepEqual((await call(ctx, 'qc', 'GET', '/proofs?status=pending')).body.proofs, [], "QC's queue holds no deleted card's proof");
  assert.equal((await call(ctx, 'qc', 'POST', '/proofs/p_0000000000000009/check', { result: 'passed' })).status, 409);
  assert.equal(rowOf(ctx, gone).status, 'deleted', 'no bot write brought it back');
  for (const [method, path, body] of [
    ['PATCH', `/tasks/${gone}`, { status: 'doing' }], ['PATCH', `/tasks/${gone}`, { note: 'x' }],
    ['POST', `/tasks/${gone}/proofs`, { kind: 'url', link: 'https://example.com/b' }], ['POST', `/tasks/${gone}/comments`, { body: 'hi' }],
  ]) assert.equal((await call(ctx, 'developer', method, path, body)).status, 409, `${method} ${path}`);
  assert.equal((await call(ctx, 'developer', 'POST', '/questions', { question: 'q?', task: gone })).status, 400, 'no ask on a deleted card');
  assert.equal(ctx.db.sqlite.prepare('SELECT COUNT(*) AS n FROM bot_proofs WHERE task_id = ?').get(gone).n, 1);
  assert.equal((await call(ctx, 'developer', 'GET', `/tasks/${live}`)).body.task.title, 'Live card');
});

test('a bot token cannot tick, delete or restore, and cannot set status deleted or done', async () => {
  const ctx = await setup();
  const id = await card(ctx, { status: 'doing', owner: 'developer' });
  for (const bot of ['developer', 'ana', 'qc', 'sponsors']) {
    for (const [path, body] of [[`/tasks/${id}/delete`], [`/tasks/${id}/undelete`], [`/tasks/${id}/tick`, { on: true }]]) {
      const r = await call(ctx, bot, 'POST', path, body);
      assert.equal(r.status, 403, `${bot} ${path}`);
    }
    for (const method of ['DELETE', 'PUT']) assert.notEqual((await call(ctx, bot, method, `/tasks/${id}`)).status, 200);
    assert.equal((await call(ctx, bot, 'PATCH', `/tasks/${id}`, { status: 'deleted' })).status, 400);
    assert.equal((await call(ctx, bot, 'PATCH', `/tasks/${id}`, { status: 'done' })).status, 403);
  }
  assert.deepEqual([rowOf(ctx, id).status, rowOf(ctx, id).deleted_at, rowOf(ctx, id).tick_prev], ['doing', null, null]);
  assert.equal((await call(ctx, 'jon', 'POST', `/tasks/${id}/delete`)).status, 200, 'only Jon can');
});

test('signed out (or a forged session, or a session without the X-CC header) is refused and nothing changes', async () => {
  const ctx = await setup();
  const id = await card(ctx, { status: 'doing' });
  const dump = () => JSON.stringify(ctx.db.sqlite.prepare('SELECT * FROM bot_tasks ORDER BY id').all()) + JSON.stringify(ctx.db.sqlite.prepare('SELECT * FROM bot_task_events').all());
  const before = dump();
  for (const [path, body] of [[`/tasks/${id}/delete`], [`/tasks/${id}/undelete`], [`/tasks/${id}/tick`, { on: true }]]) {
    assert.equal((await call(ctx, 'out', 'POST', path, body)).status, 401, `signed out ${path}`);
    const forged = new Request(`https://jonmac.ai/dashboard/api/v1${path}`, { method: 'POST', headers: { Cookie: `${COOKIE}=1.2`, 'X-CC': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    assert.equal((await handleApi(forged, ctx.env)).status, 401, `forged session ${path}`);
    const noHeader = new Request(`https://jonmac.ai/dashboard/api/v1${path}`, { method: 'POST', headers: { Cookie: ctx.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    assert.equal((await handleApi(noHeader, ctx.env)).status, 403, `no X-CC ${path}`);
  }
  assert.equal(dump(), before);
});

test('Jon\'s own PATCH tick (owner jon) and approve still work as before', async () => {
  const ctx = await setup();
  const mine = await card(ctx, { owner: 'jon', status: 'todo' });
  assert.equal((await call(ctx, 'jon', 'PATCH', `/tasks/${mine}`, { status: 'done' })).body.task.status, 'done');
  const rv = await card(ctx, { status: 'review' });
  assert.equal((await call(ctx, 'jon', 'PATCH', `/tasks/${rv}`, { status: 'done' })).body.task.status, 'done');
  const gone = await card(ctx, { status: 'review' });
  await call(ctx, 'jon', 'POST', `/tasks/${gone}/delete`);
  assert.equal((await call(ctx, 'jon', 'PATCH', `/tasks/${gone}`, { status: 'done' })).status, 409, 'approve cannot bring a deleted card back');
});

test('the migration is additive: three nullable columns on bot_tasks, nothing else', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../migrations/0032_card_delete_tick.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(stmts, ['ALTER TABLE bot_tasks ADD COLUMN tick_prev TEXT', 'ALTER TABLE bot_tasks ADD COLUMN deleted_prev TEXT', 'ALTER TABLE bot_tasks ADD COLUMN deleted_at TEXT']);
});

test('Cards page markup: tick box, Delete, confirm text, Undo toast, detail view', () => {
  const cards = { open: [{ id: 't_0123456789abcdef', title: 'Write <b>it</b>', owner: 'ana', status: 'doing', macframes: false }], done: [{ id: 't_1123456789abcdef', title: 'Shipped', owner: 'ana', status: 'done', macframes: false }], counts: {}, cut: false };
  const html = renderCards(null, { ok: true, cards }, {});
  assert.match(html, /<button type="button" class="ckbox" data-ck-tick="t_0123456789abcdef" data-on="true" aria-pressed="false" aria-label="Mark done: Write &lt;b&gt;it&lt;\/b&gt;">/);
  assert.match(html, /<button type="button" class="ckbox on" data-ck-tick="t_1123456789abcdef" data-on="false" aria-pressed="true"/);
  assert.equal((html.match(/data-ck-del=/g) || []).length, 2);
  assert.doesNotMatch(html, /Delete this card\?/);
  const ask = renderCards(null, { ok: true, cards }, { ckConfirm: 't_0123456789abcdef' });
  assert.equal((ask.match(/Delete this card\?<\/span>/g) || []).length, 1, 'the confirm shows on the one row only');
  assert.match(ask, /data-ck-yes="t_0123456789abcdef"/);
  assert.match(ask, /data-ck-no/);
  const toast = renderCards(null, { ok: true, cards }, { ckToast: { kind: 'delete', id: 't_0123456789abcdef', title: 'Write it' } });
  assert.match(toast, /Card deleted: Write it<\/span><button type="button" class="btn sm" data-ck-undo>Undo<\/button>/);
  const task = { id: 't_0123456789abcdef', title: 'Write it', owner: 'ana', status: 'review', project: 'coding', note: 'a <script>', updatedAt: '2026-11-17T10:00:00.000Z', doneAt: null,
    proofs: [{ kind: 'url', status: 'passed', link: 'javascript:alert(1)' }, { kind: 'render', status: 'pending', link: 'https://jonmac.ai/review/x' }], history: [{ at: '2026-11-17T10:00:00.000Z', by: 'jon', kind: 'tick', detail: 'Ticked done by Jon' }] };
  const det = renderCards(null, { ok: true, cards }, { ckOpen: task.id, ckDetail: { task } });
  assert.match(det, /data-ck-tick="t_0123456789abcdef"/);
  assert.match(det, /data-ck-del="t_0123456789abcdef"/);
  assert.match(det, /data-ck-back/);
  assert.match(det, /Ticked done by Jon/);
  assert.match(det, /a &lt;script&gt;/);
  assert.doesNotMatch(det, /href="javascript:/i);
  assert.match(det, /<a href="https:\/\/jonmac\.ai\/review\/x" target="_blank" rel="noopener">/);
});
