// Review page -> dashboard card (2026-11-09): the hook the review Worker calls (src/reviewhook.js). The end-to-end run,
// with the review Worker in workerd, is cloud-apps/review/test/approvals.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { cardByTitle, titleParts } from '../src/reviewhook.js';
import { sqliteD1 } from './sqlited1.mjs';

const TOKEN = 'review-agent-token-0123456789abcdef';
const HOOKS = { 'video-editor': { url: 'https://hooks.example/video-editor', secret: 'whsec_video-editor-test' } };

test('titles match on the name alone: case, punctuation, a (vN) tail and the " - <channel>" suffix are ignored', () => {
  assert.deepEqual(titleParts("Why Your Clothes Need Two Dryer Cycles - Rosa's Clean Home (v4)"), ['why your clothes need two dryer cycles', 'rosas clean home']);
  assert.deepEqual(titleParts('WHY your clothes need two dryer-cycles!  v8'), ['why your clothes need two dryer cycles', '']);
  assert.deepEqual(titleParts('11 Army Lessons - Part 2 - Rosa’s Clean Home'), ['11 army lessons part 2', 'rosas clean home']);
  const t = (id, title, status = 'doing', project = 'home-guide-press', updated_at = '2026-11-01') => ({ id, title, status, project, updated_at });
  const cards = [
    t('done', 'Why Your Clothes Need Two Dryer Cycles - Rosa\'s Clean Home', 'done', 'home-guide-press', '2026-11-09'),
    t('other-channel', 'Why your clothes need two dryer cycles - Peggy Donovan', 'doing', 'home-guide-press', '2026-11-09'),
    t('coding', 'Why Your Clothes Need Two Dryer Cycles - Rosa\'s Clean Home', 'doing', 'coding', '2026-11-09'),
    t('cancelled', 'Why Your Clothes Need Two Dryer Cycles - Rosa\'s Clean Home', 'cancelled'),
    t('open', 'Why Your Clothes Need Two Dryer Cycles - Rosa\'s Clean Home', 'qc'),
  ];
  assert.equal(cardByTitle("Why Your Clothes Need Two Dryer Cycles - Rosa's Clean Home (v5)", cards).id, 'open', 'same channel, open beats done');
  assert.equal(cardByTitle("Why Your Clothes Need Two Dryer Cycles - Rosa's Clean Home", cards.slice(0, 4)).id, 'done', 'a done card on the channel, never another channel');
  assert.equal(cardByTitle('Why Your Clothes Need Two Dryer Cycles', cards.slice(1, 4)).id, 'other-channel', 'no suffix: any channel; Coding and cancelled cards never match');
  assert.equal(cardByTitle('Why your clothes need two dryer cycles - Someone Else', cards.slice(1)), null, "another channel's card with the same name");
  assert.equal(cardByTitle('Why Your Clothes Need Two Dryer Cycles - Peggy Donovan Home', cards).id, 'other-channel', 'a shorter channel name on the card');
  assert.equal(cardByTitle('Something else - Rosa\'s Clean Home', cards), null);
});

test('the hook needs the review token; the backfill fills only open cards and wakes no one without a card', async (t) => {
  const db = sqliteD1();
  await db.prepare("INSERT INTO bot_tasks (id, title, owner, status, project, created_by, updated_by, created_at, updated_at) VALUES ('t_00000000000000d1', 'Old Video - Test', 'video-editor', 'done', 'home-guide-press', 'ana', 'ana', 'x', 'x')").run();
  const env = { DB: db, REVIEW_API_TOKEN: TOKEN, WEBHOOKS: JSON.stringify(HOOKS) };
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 202 }); };
  t.after(() => { globalThis.fetch = real; });
  const hook = (body, token = TOKEN, path = 'submission') => worker.fetch(new Request(`https://jonmac.ai/dashboard/api/review-hook/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  }), env, {});
  const old = { kind: 'approve', slug: 'old-1-v2', title: 'Old Video - Test', version: 'v2', at: '2026-11-01T10:00:00Z' };

  assert.equal((await hook(old, 'wrong-token-0123456789')).status, 401);
  assert.equal((await hook({ kind: 'ship', slug: 'old-1-v2' })).status, 400);
  assert.deepEqual(await (await hook({ ...old, backfill: true })).json().then((r) => [r.result, r.task.id]), ['skipped', 't_00000000000000d1']);
  assert.equal((await (await hook({ ...old, slug: 'none-1-v1', title: 'No Card - Test', backfill: true })).json()).result, 'no_card');
  assert.equal(sent.length, 0, 'the backfill woke no one');

  // Live: a done card still gets Jon's note, dated when it is late; no card at all wakes video-editor.
  const live = await (await hook(old)).json();
  assert.deepEqual([live.result, live.matched_by], ['posted', 'title']);
  const { body } = await db.prepare("SELECT body FROM bot_task_comments WHERE task_id = 't_00000000000000d1'").first();
  assert.match(body, /^Jon approved v2 of "Old Video - Test" on the review page \(approved Nov 1, posted late\)\./);
  // approved before the QC gate, no QC pass: the owner is told to QC it first, not to upload it
  assert.match(body, /\. It hadn't passed QC yet: get this version through QC first \(fix any fault on top of it, no new version\), then upload it\.\n/);
  assert.doesNotMatch(body, /That version is final/);
  const none = await (await hook({ ...old, slug: 'none-1-v1', title: 'No Card - Test' })).json();
  assert.deepEqual([none.result, none.wakes], ['no_card', 'video-editor']);
  assert.equal(sent.at(-1).url, 'https://hooks.example/video-editor');
  assert.equal(sent.at(-1).body.data.review.slug, 'none-1-v1');

  await db.prepare("INSERT INTO bot_proofs (id, task_id, kind, link, status, created_by, created_at) VALUES ('p_00000000000000d1', 't_00000000000000d1', 'render', 'https://jonmac.ai/review/old-1-v2', 'passed', 'qc', 'x')").run();
  assert.deepEqual((await (await hook(null, TOKEN, 'qc')).json()).passes, { 'old-1-v2': 'x' });
  // with its QC pass on the dashboard, the same approval says it's final and ready to upload
  await hook(old);
  const { results } = await db.prepare("SELECT body FROM bot_task_comments WHERE task_id = 't_00000000000000d1' ORDER BY rowid").all();
  assert.equal(results.length, 2);
  assert.match(results[1].body, /posted late\)\. That version is final: upload it, and don't post a newer one unless he asks for changes\.\n/);
});

test("the Factory's own QC pass (2026-11-12): token only, recorded with who, note, file and time, and counted in /qc", async () => {
  const db = sqliteD1();
  const env = { DB: db, REVIEW_API_TOKEN: TOKEN };
  const hook = (body, token = TOKEN, path = 'qc-pass') => worker.fetch(new Request(`https://jonmac.ai/dashboard/api/review-hook/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  }), env, {});
  const at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await hook({ slug: 'nora-5-v1', by: 'factory', note: 'x' }, 'wrong-token-0123456789')).status, 401);
  for (const bad of [{ by: 'factory' }, { slug: 'Bad Slug!', by: 'factory' }, { slug: 'nora-5-v1' }, { slug: 'nora-5-v1', by: '  ' }]) assert.equal((await hook(bad)).status, 400, JSON.stringify(bad));
  const ok = await hook({ slug: 'nora-5-v1', by: 'factory', note: 'Factory final checks passed', video_key: 'review/nora-5-v1/video-a.mp4', at });
  assert.equal(ok.status, 201);
  const { pass } = await ok.json();
  assert.deepEqual([pass.slug, pass.by, pass.note, pass.video_key, pass.at], ['nora-5-v1', 'factory', 'Factory final checks passed', 'review/nora-5-v1/video-a.mp4', at], "the review Worker's time is kept");
  const row = await db.prepare("SELECT slug, video_key, passed_by, note, at FROM review_qc_passes").first();
  assert.deepEqual(row, { slug: 'nora-5-v1', video_key: 'review/nora-5-v1/video-a.mp4', passed_by: 'factory', note: 'Factory final checks passed', at });
  // A time far off this clock is not trusted: the pass is stamped now.
  const late = await (await hook({ slug: 'rosa-house-8-v1', by: 'factory', at: '2020-01-01T00:00:00Z' })).json();
  assert.ok(Date.now() - Date.parse(late.pass.at) < 5000);
  // /qc: the newest pass per slug, proofs and Factory passes together.
  await db.prepare("INSERT INTO bot_tasks (id, title, owner, status, project, created_by, updated_by, created_at, updated_at) VALUES ('t_00000000000000e1', 'A - Test', 'video-editor', 'review', 'home-guide-press', 'ana', 'ana', 'x', 'x')").run();
  await db.prepare("INSERT INTO bot_proofs (id, task_id, kind, link, status, created_by, created_at) VALUES ('p_00000000000000e1', 't_00000000000000e1', 'render', 'https://jonmac.ai/review/nora-5-v1', 'passed', 'qc', '2020-01-01T00:00:00.000Z')").run();
  const { passes } = await (await hook(null, TOKEN, 'qc')).json();
  assert.deepEqual(passes, { 'nora-5-v1': at, 'rosa-house-8-v1': late.pass.at });
});
