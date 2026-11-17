// Review "Discard" (Jon, 2026-11-17): the button on every Review item, POST /dashboard/api/v1/review/discard and /undo,
// the list and the sidebar count, the linked card (cancelled, never restarted), the Undo toast, and signed-out refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { sha256Hex, DISCARD_NOTE } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { railCounts } from '../public/d3/js/rail.js';
import { reviewItems, renderReview, reviewClick } from '../public/d3/js/review.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-17T19:00:00Z');
const H = (h) => new Date(NOW - h * 3600000).toISOString();
const BOT = `ccb_${'s'.repeat(43)}`;
const id = (p, n) => `${p}_${String(n).padStart(16, '0')}`;
const T = { plain: id('t', 1), video: id('t', 2), dev: id('t', 3) };
const Q = { onCard: id('q', 1), loose: id('q', 2) };
const A = { onCard: id('a', 1), loose: id('a', 2) };
const SAMPLE = () => JSON.parse(readFileSync(new URL('./fixtures/d2-sample.json', import.meta.url), 'utf8'));

async function withNow(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try { return await fn(); } finally { Date.now = real; }
}
const ins = (db, table, row) => {
  const keys = Object.keys(row);
  db.sqlite.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
};
const one = (db, sql, ...args) => db.sqlite.prepare(sql).get(...args);

async function setup() {
  const db = sqliteD1();
  await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(BOT), 'video-editor', H(100)).run();
  const t = (tid, title, owner, status, at, note = '') => ins(db, 'bot_tasks', { id: tid, title, owner, status, note, created_by: 'ana', updated_by: owner, created_at: at, updated_at: at });
  t(T.plain, 'Pick the cover colours', 'ana', 'review', H(6), 'Original card note');
  t(T.video, 'Kyoto homes - Naomi', 'video-editor', 'review', H(9), '');
  t(T.dev, 'Fix the footer', 'developer', 'review', H(3), '');
  ins(db, 'bot_proofs', { id: id('p', 1), task_id: T.video, kind: 'render', link: 'https://jonmac.ai/dashboard/review/kyoto-v1', status: 'passed', created_by: 'video-editor', created_at: H(8) });
  ins(db, 'bot_proofs', { id: id('p', 2), task_id: T.plain, kind: 'url', link: 'https://example.com/proof', status: 'passed', created_by: 'ana', created_at: H(7) });
  ins(db, 'bot_questions', { id: Q.onCard, asked_by: 'ana', question: 'Warm or cool?', task_id: T.plain, status: 'open', created_at: H(5), updated_at: H(5) });
  ins(db, 'bot_questions', { id: Q.loose, asked_by: 'ana', question: 'Which channel next?', status: 'open', created_at: H(4), updated_at: H(4) });
  ins(db, 'bot_approvals', { id: A.onCard, action: 'publish_draft', title: 'Publish the covers', requested_by: 'ana', task_id: T.plain, status: 'pending', created_at: H(5), updated_at: H(5) });
  ins(db, 'bot_approvals', { id: A.loose, action: 'send_invoice', title: 'Send invoice to Acme', requested_by: 'sponsors', status: 'pending', created_at: H(6), updated_at: H(6) });
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
const cookie = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
const d3Of = async (env) => withNow(NOW, async () => (await handleApi(new Request('https://jonmac.ai/dashboard/api/d3', { headers: { Cookie: await cookie() } }), env)).json());
const call = async (env, path, body, { bot = false, anon = false, noCC = false, method = 'POST' } = {}) => withNow(NOW, async () => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (bot) headers.set('Authorization', `Bearer ${BOT}`);
  else if (!anon) { headers.set('Cookie', await cookie()); if (!noCC) headers.set('X-CC', '1'); }
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
});
const discard = (env, item, opts) => call(env, '/review/discard', { item }, opts);
const undo = (env, item, opts) => call(env, '/review/undo', { item }, opts);
const ids = (d3) => d3.d3.queue.map((x) => x.id);

test('discarding a card removes it from the list and the Review count; nothing is deleted', async () => {
  const { db, env } = await setup();
  const before = await d3Of(env);
  assert.deepEqual(ids(before).sort(), [`a:${A.loose}`, `a:${A.onCard}`, `q:${Q.loose}`, `q:${Q.onCard}`, `t:${T.dev}`, `t:${T.plain}`, `t:${T.video}`].sort());
  const n = before.d3.review.count;
  const rail = railCounts(SAMPLE(), before).review;
  const proofs = one(db, 'SELECT COUNT(*) AS n FROM bot_proofs').n;
  const r = await discard(env, `t:${T.plain}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.card, T.plain);
  const after = await d3Of(env);
  assert.ok(!ids(after).includes(`t:${T.plain}`));
  // The card's own question and approval close with it: three items leave, the count drops by three
  assert.equal(after.d3.review.count, n - 3);
  assert.equal(railCounts(SAMPLE(), after).review, rail - 3);
  // The card: cancelled by Jon, with the note first and the old note kept under it; proofs untouched
  const card = one(db, 'SELECT * FROM bot_tasks WHERE id = ?', T.plain);
  assert.equal(card.status, 'cancelled');
  assert.equal(card.updated_by, 'jon');
  assert.ok(card.note.startsWith(DISCARD_NOTE));
  assert.match(card.note, /Original card note/);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM bot_proofs').n, proofs);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM bot_tasks').n, 3);
  assert.match(one(db, "SELECT detail FROM bot_task_events WHERE task_id = ? AND kind = 'status'", T.plain).detail, /review → cancelled \(discarded by Jon on Review\)/);
  const rec = one(db, 'SELECT * FROM review_discards WHERE item = ?', `t:${T.plain}`);
  assert.equal(rec.status, 'discarded');
  assert.equal(rec.card_id, T.plain);
  // Pressing it twice is harmless
  const again = await discard(env, `t:${T.plain}`);
  assert.equal(again.status, 200);
  assert.equal(again.body.already, true);
});

test('Undo puts the card back as it was: Review, old note, old waiting time, its question and approval open again', async () => {
  const { db, env } = await setup();
  const before = await d3Of(env);
  await discard(env, `t:${T.plain}`);
  const r = await undo(env, `t:${T.plain}`);
  assert.equal(r.status, 200);
  const after = await d3Of(env);
  assert.deepEqual(ids(after).sort(), ids(before).sort());
  assert.equal(after.d3.review.count, before.d3.review.count);
  const card = one(db, 'SELECT * FROM bot_tasks WHERE id = ?', T.plain);
  assert.equal(card.status, 'review');
  assert.equal(card.note, 'Original card note');
  assert.equal(card.updated_at, H(6));
  assert.equal(one(db, 'SELECT status FROM bot_questions WHERE id = ?', Q.onCard).status, 'open');
  assert.equal(one(db, 'SELECT status FROM bot_approvals WHERE id = ?', A.onCard).status, 'pending');
  assert.equal(one(db, 'SELECT status FROM review_discards WHERE item = ?', `t:${T.plain}`).status, 'restored');
  // Discard again after an undo works the same way
  assert.equal((await discard(env, `t:${T.plain}`)).status, 200);
  assert.equal(one(db, 'SELECT status FROM bot_tasks WHERE id = ?', T.plain).status, 'cancelled');
});

test('a discarded card stays cancelled: no bot can restart it and it is in no open list', async () => {
  const { db, env } = await setup();
  await discard(env, `t:${T.video}`);
  // The owning bot tries to move it back to doing / review: refused (Jon closed it)
  for (const status of ['doing', 'todo', 'review']) {
    const r = await call(env, `/tasks/${T.video}`, { status }, { bot: true, method: 'PATCH' });
    assert.equal(r.status, 409, status);
    assert.match(r.body.error, /Jon closed this task/);
  }
  assert.equal(one(db, 'SELECT status FROM bot_tasks WHERE id = ?', T.video).status, 'cancelled');
  // The dispatcher picks cards from the open statuses (doing for a restart); the card is in none of them
  const open = await call(env, '/tasks?status=todo,doing,waiting_on_jon,qc,review', undefined, { bot: true, method: 'GET' });
  assert.equal(open.status, 200);
  assert.ok(!open.body.tasks.some((x) => x.id === T.video));
  const cancelled = await call(env, '/tasks?status=cancelled', undefined, { bot: true, method: 'GET' });
  assert.ok(cancelled.body.tasks.some((x) => x.id === T.video && x.status === 'cancelled'));
  // The video's proofs are still there
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM bot_proofs WHERE task_id = ?', T.video).n, 1);
  // Undo (Jon only) brings it back; after that a bot can work on it normally again
  assert.equal((await undo(env, `t:${T.video}`)).status, 200);
  assert.equal(one(db, 'SELECT status FROM bot_tasks WHERE id = ?', T.video).status, 'review');
});

test('a question closes and an approval is cancelled, each undoable; the card they sit on is left alone', async () => {
  const { db, env } = await setup();
  const n = (await d3Of(env)).d3.review.count;
  assert.equal((await discard(env, `q:${Q.onCard}`)).status, 200);
  assert.equal((await discard(env, `a:${A.onCard}`)).status, 200);
  assert.equal(one(db, 'SELECT status FROM bot_questions WHERE id = ?', Q.onCard).status, 'closed');
  assert.equal(one(db, 'SELECT status FROM bot_approvals WHERE id = ?', A.onCard).status, 'cancelled');
  assert.equal(one(db, 'SELECT status FROM bot_tasks WHERE id = ?', T.plain).status, 'review');
  assert.equal((await d3Of(env)).d3.review.count, n - 2);
  assert.equal((await undo(env, `q:${Q.onCard}`)).status, 200);
  assert.equal((await undo(env, `a:${A.onCard}`)).status, 200);
  assert.equal(one(db, 'SELECT status FROM bot_questions WHERE id = ?', Q.onCard).status, 'open');
  assert.equal(one(db, 'SELECT status, done_note FROM bot_approvals WHERE id = ?', A.onCard).status, 'pending');
  assert.equal((await d3Of(env)).d3.review.count, n);
});

test('a sponsor email draft is hidden from the list by its discard record, and comes back on Undo', async () => {
  const { env } = await setup();
  const d2 = SAMPLE();
  const first = (await d3Of(env));
  const mail = reviewItems(d2, first).filter((x) => x.type === 'email');
  assert.ok(mail.length > 0, 'fixture has sponsor drafts');
  const item = mail[0].id;
  assert.equal((await discard(env, item)).status, 200);
  const after = await d3Of(env);
  assert.deepEqual(after.d3.discarded, [item]);
  assert.ok(!reviewItems(d2, after).some((x) => x.id === item));
  assert.equal(reviewItems(d2, after).length, reviewItems(d2, first).length - 1);
  assert.equal((await undo(env, item)).status, 200);
  const back = await d3Of(env);
  assert.deepEqual(back.d3.discarded, []);
  assert.ok(reviewItems(d2, back).some((x) => x.id === item));
});

test('signed out: the POST is refused and nothing changes; a bot token and a missing X-CC are refused too', async () => {
  const { db, env } = await setup();
  const state = () => JSON.stringify([db.sqlite.prepare('SELECT * FROM bot_tasks ORDER BY id').all(), db.sqlite.prepare('SELECT * FROM review_discards').all(),
    db.sqlite.prepare('SELECT * FROM bot_questions ORDER BY id').all(), db.sqlite.prepare('SELECT * FROM bot_approvals ORDER BY id').all()]);
  const was = state();
  for (const path of ['/review/discard', '/review/undo']) {
    const out = await call(env, path, { item: `t:${T.plain}` }, { anon: true });
    assert.equal(out.status, 401, path);
    const bot = await call(env, path, { item: `t:${T.plain}` }, { bot: true });
    assert.equal(bot.status, 403, path);
    const nocc = await call(env, path, { item: `t:${T.plain}` }, { noCC: true });
    assert.equal(nocc.status, 403, path);
  }
  assert.equal(state(), was);
  // And through the real Worker entry, with no cookie at all
  const res = await withNow(NOW, () => handleApi(new Request('https://jonmac.ai/dashboard/api/v1/review/discard', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: JSON.stringify({ item: `t:${T.plain}` }) }), env));
  assert.equal(res.status, 401);
  assert.equal(state(), was);
});

test('bad input: unknown id 404, wrong shape 400, a card no longer in Review 409, and Undo of a card someone changed is refused', async () => {
  const { db, env } = await setup();
  assert.equal((await discard(env, `t:${id('t', 99)}`)).status, 404);
  assert.equal((await discard(env, 'nonsense')).status, 400);
  assert.equal((await discard(env, `t:${id('q', 1)}`)).status, 400);
  assert.equal((await call(env, '/review/discard', {})).status, 400);
  assert.equal((await undo(env, `t:${T.plain}`)).status, 404); // never discarded
  db.sqlite.prepare("UPDATE bot_tasks SET status = 'doing' WHERE id = ?").run(T.dev);
  assert.equal((await discard(env, `t:${T.dev}`)).status, 409);
  // Discarded, then a person set the card to something else: Undo does not overwrite it
  await discard(env, `t:${T.plain}`);
  db.sqlite.prepare("UPDATE bot_tasks SET status = 'done' WHERE id = ?").run(T.plain);
  assert.equal((await undo(env, `t:${T.plain}`)).status, 409);
  assert.equal(one(db, 'SELECT status FROM bot_tasks WHERE id = ?', T.plain).status, 'done');
});

test('before the migration is on the database: Discard says it is not set up and changes nothing', async () => {
  const { db, env } = await setup();
  db.sqlite.exec('DROP TABLE review_discards');
  const r = await discard(env, `t:${T.plain}`);
  assert.equal(r.status, 503);
  assert.equal(one(db, 'SELECT status FROM bot_tasks WHERE id = ?', T.plain).status, 'review');
  assert.ok((await d3Of(env)).d3.queue.length > 0); // the page still loads
});

test('the Discard button is on every kind of Review item, after Send back, with the same size', async () => {
  const { env } = await setup();
  const d2 = SAMPLE();
  const d3 = await d3Of(env);
  const mail = reviewItems(d2, d3).find((x) => x.type === 'email');
  const html = (sel) => renderReview(d2, d3, { rvSel: sel });
  const has = (sel) => {
    const h = html(sel);
    assert.match(h, new RegExp(`<button type="button" class="btn lg dis" data-rv="discard" data-id="${sel.replace(/[$]/g, '\\$')}"[^>]*>Discard</button>`), sel);
    return h;
  };
  // card: Approve, Send back, Discard in that order
  assert.match(has(`t:${T.plain}`), />Approve<\/button><button[^>]*data-rv="open-back"[^>]*>Send back<\/button><button[^>]*data-rv="discard"/);
  // dev card: Done, Send back, Discard
  assert.match(has(`t:${T.dev}`), />Done<\/button><button[^>]*data-rv="open-back"[^>]*>Send back<\/button><button[^>]*data-rv="discard"/);
  // a video with its own review page: the link to it, then Discard
  assert.match(has(`t:${T.video}`), /Approve or send back on the review page<\/a><button[^>]*data-rv="discard"/);
  // approval, question, sponsor email
  assert.match(has(`a:${A.loose}`), />Reject<\/button><button[^>]*data-rv="discard"/);
  assert.match(has(`q:${Q.loose}`), />Submit<\/button><button[^>]*data-rv="discard"/);
  assert.match(has(mail.id), />Edit first<\/button><button[^>]*data-rv="discard"/);
  // not while the Send back box is open, nor on a finished row
  assert.doesNotMatch(renderReview(d2, d3, { rvSel: `t:${T.plain}`, rvBack: `t:${T.plain}` }), /data-rv="discard"/);
  assert.doesNotMatch(renderReview(d2, d3, { rvSel: `t:${T.plain}`, rvDone: { [`t:${T.plain}`]: 'Approved' } }), /data-rv="discard"/);
});

test('clicking Discard: no confirm, one POST, item leaves, no Undo toast (Jon, 2026-11-17)', async () => {
  const { env } = await setup();
  const d2 = SAMPLE();
  const d3 = await d3Of(env);
  const real = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
  const calls = [];
  const asked = [];
  globalThis.fetch = async (url, o) => { calls.push([url, o.method, JSON.parse(o.body)]); return new Response('{"ok":true}', { status: 200 }); };
  globalThis.window = { confirm: (m) => { asked.push(m); return true; } };
  const body = { children: [], append(n) { this.children.push(n); } };
  globalThis.document = { createElement: () => ({}), body, querySelector: () => null };
  const el = (attrs) => ({ dataset: attrs, disabled: false });
  const ev = (attrs) => ({ target: { closest: (sel) => (sel === '[data-rv]' ? el(attrs) : null) } });
  let reloads = 0;
  const S = { d2, d3, ui: { rvSel: `t:${T.plain}` } };
  try {
    await reviewClick(ev({ rv: 'discard', id: `t:${T.plain}` }), S, () => {}, async () => { reloads += 1; });
    assert.deepEqual(asked, []); // no confirm pop-up
    assert.deepEqual(calls, [['/dashboard/api/v1/review/discard', 'POST', { item: `t:${T.plain}` }]]);
    assert.equal(reloads, 1);
    assert.notEqual(S.ui.rvSel, `t:${T.plain}`); // moved on to another item
    assert.ok(!S.ui.rvDone?.[`t:${T.plain}`]); // it is gone, not kept as a done row
    assert.equal(body.children.length, 0); // no Undo toast
    // a video with a review page can be discarded from the page (its other buttons stay link-only)
    await reviewClick(ev({ rv: 'discard', id: `t:${T.video}` }), S, () => {}, async () => {});
    assert.equal(calls.at(-1)[2].item, `t:${T.video}`);
  } finally {
    Object.assign(globalThis, real);
  }
});
