import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { buildTodo } from '../src/todo.js';
import { signSession, COOKIE } from '../src/auth.js';
import { render as renderTodo } from '../public/js/pages/todo.js';
import { render as renderFeed, rowHtml } from '../public/js/pages/feed.js';
import { entryHtml, editHtml, quickEntry, render as renderJournal } from '../public/js/pages/journal.js';
import { botName, dayLabel, linkify, whenLabel } from '../public/js/ui.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const BOTS = ['sponsors', 'qc', 'viral-view', 'ana'];
const TOK = Object.fromEntries(BOTS.map((b) => [b, `ccb_${b.padEnd(43, 'x')}`]));
const NOW = Date.parse('2026-10-30T17:50:00Z'); // Fri Oct 30, 10:50 PT

async function setup() {
  const db = sqliteD1();
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
const cookie = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;
async function call(env, method, path, { bot, body, jon, cc = true } = {}) {
  const h = new Headers();
  if (bot) h.set('Authorization', `Bearer ${TOK[bot]}`);
  if (jon) { h.set('Cookie', await cookie()); if (cc) h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}
// Visible text only: no tag or attribute, so an href never counts as a shown URL.
const textOf = (html) => html.replace(/<[^>]*>/g, '');

// ---- Journal ----

test('journal API: Jon only (bots 403, no session 401, X-CC on writes); add, list, edit, delete', async () => {
  const { env } = await setup();
  for (const [method, path, body] of [['GET', '/v1/journal'], ['POST', '/v1/journal', { title: 'x' }], ['PATCH', '/v1/journal/j_0123456789abcdef', { title: 'x' }], ['DELETE', '/v1/journal/j_0123456789abcdef']]) {
    assert.equal((await call(env, method, path, { body })).status, 401, `${method} without a session`);
    assert.equal((await call(env, method, path, { bot: 'ana', body })).status, 403, `${method} with a bot token`);
    if (method !== 'GET') assert.equal((await call(env, method, path, { jon: true, cc: false, body })).status, 403, `${method} without X-CC`);
  }

  const add = (body) => call(env, 'POST', '/v1/journal', { jon: true, body });
  const link = await add({ link: ' https://www.youtube.com/watch?v=abc&t=1 ' });
  assert.equal(link.status, 201);
  assert.deepEqual([link.body.entry.title, link.body.entry.link, link.body.entry.tags], ['youtube.com', 'https://www.youtube.com/watch?v=abc&t=1', []], 'a bare link is named after its site');
  const idea = await add({ title: '<script>alert(1)</script> Hook idea', note: 'From the call', tags: '#Ideas, yt  later,ideas' });
  assert.deepEqual([idea.status, idea.body.entry.title, idea.body.entry.tags], [201, '<script>alert(1)</script> Hook idea', ['ideas', 'yt', 'later']], 'stored as typed; tags folded, no repeats');
  assert.deepEqual((await add({ title: 'x', tags: ['A', ' b-2 '] })).body.entry.tags, ['a', 'b-2']);
  for (const body of [{}, { title: '  ' }, { title: 'x'.repeat(301) }, { title: 'x', note: 'x'.repeat(4001) },
    { link: 'javascript:alert(1)' }, { link: 'ftp://x.test/a' }, { link: 'www.x.test' }, { link: 'https://x.test/a b' }, { link: 'https://' }, { link: `https://x.test/${'a'.repeat(2000)}` },
    { title: 'x', tags: 'ok bad!' }, { title: 'x', tags: [1] }, { title: 'x', tags: 5 }, { title: 'x', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, { title: 'x', tags: 'x'.repeat(31) }]) {
    assert.equal((await add(body)).status, 400, JSON.stringify(body).slice(0, 60));
  }

  const list = async () => (await call(env, 'GET', '/v1/journal', { jon: true, cc: false })).body.entries;
  assert.deepEqual((await list()).map((e) => e.title).slice(-2), ['<script>alert(1)</script> Hook idea', 'youtube.com'], 'newest first');
  const id = idea.body.entry.id;
  const edit = await call(env, 'PATCH', `/v1/journal/${id}`, { jon: true, body: { title: 'Hook idea', link: 'https://x.test/a', tags: '' } });
  assert.deepEqual([edit.status, edit.body.entry.title, edit.body.entry.link, edit.body.entry.tags, edit.body.entry.note], [200, 'Hook idea', 'https://x.test/a', [], 'From the call']);
  assert.equal((await call(env, 'PATCH', `/v1/journal/${id}`, { jon: true, body: { link: null } })).body.entry.link, null, 'a link can be removed');
  for (const body of [{}, { title: '' }, { link: 'data:text/html,x' }]) assert.equal((await call(env, 'PATCH', `/v1/journal/${id}`, { jon: true, body })).status, 400, JSON.stringify(body));
  assert.equal((await call(env, 'PATCH', '/v1/journal/j_0000000000000000', { jon: true, body: { title: 'x' } })).status, 404);
  assert.equal((await call(env, 'PATCH', '/v1/journal/nope', { jon: true, body: { title: 'x' } })).status, 404);
  assert.equal((await call(env, 'DELETE', `/v1/journal/${id}`, { jon: true })).status, 200);
  assert.equal((await call(env, 'DELETE', `/v1/journal/${id}`, { jon: true })).status, 404, 'gone');
  assert.deepEqual((await list()).map((e) => e.id).includes(id), false);
});

test('journal page: links show as labels (never raw URLs), everything escaped, quick add splits a pasted link', () => {
  const e = { id: 'j_0123456789abcdef', title: 'See https://evil.test/x"><b>', link: 'https://www.youtube.com/watch?v=a&b="c"', note: 'Also <i>this</i> https://docs.google.com/d/1, ok', tags: ['ideas'], createdAt: '2026-10-30T16:05:00Z' };
  const html = entryHtml(e, NOW);
  assert.deepEqual(html.match(/href="[^"]*"/g), ['href="https://www.youtube.com/watch?v=a&amp;b=&quot;c&quot;"', 'href="https://docs.google.com/d/1"']);
  assert.match(html, />See evil\.test&quot;&gt;&lt;b&gt;<\/a> <span class="jnhost">youtube\.com<\/span>/, 'a URL in the title shows as its site');
  assert.match(html, /Also &lt;i&gt;this&lt;\/i&gt; <a href="https:\/\/docs.google.com\/d\/1" target="_blank" rel="noopener">docs\.google\.com<\/a>, ok/, 'the trailing comma stays text');
  assert.doesNotMatch(textOf(html), /https?:/, 'no raw URL on screen');
  assert.match(html, /data-page="journal\/ideas">#ideas<\/button>/);
  assert.match(html, /today 09:05/);
  assert.match(html, /data-jedit="j_0123456789abcdef".*data-jdel="j_0123456789abcdef"/s);
  const plain = entryHtml({ ...e, link: null, title: '<img src=x onerror=alert(1)>' }, NOW);
  assert.match(plain, /<h3 class="qq">&lt;img src=x onerror=alert\(1\)&gt;<\/h3>/);
  const bad = entryHtml({ ...e, link: null, title: 'javascript:alert(1)', note: null }, NOW);
  assert.doesNotMatch(bad, /href/);
  const form = editHtml({ ...e, title: '"><script>' });
  assert.match(form, /value="&quot;&gt;&lt;script&gt;"/);
  assert.match(form, /value="ideas"/);

  assert.deepEqual(quickEntry('  https://x.test/a?b=1  ', ''), { title: '', link: 'https://x.test/a?b=1', tags: '' });
  assert.deepEqual(quickEntry('Watch this https://x.test/v later', 'yt'), { title: 'Watch this later', link: 'https://x.test/v', tags: 'yt' });
  assert.deepEqual(quickEntry('Just an idea', undefined), { title: 'Just an idea', link: '', tags: '' });
  const long = quickEntry(`${'word '.repeat(70)}end`, '');
  assert.ok(long.title.length <= 300 && `${long.title} ${long.note}` === `${'word '.repeat(70)}end`, 'a long idea saves: start as title, rest as note');
  assert.match(renderJournal({}, {}, 'ideas'), /data-tag="ideas"/);
  assert.match(renderJournal({}, {}, '"><b>'), /data-tag=""/, 'an odd tag in the URL is dropped');
});

// ---- Feed ----

async function story(t) {
  const { env } = await setup();
  let min = 0;
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-30T16:00:00Z') });
  const at = (n) => { min = n; t.mock.timers.setTime(Date.parse('2026-10-30T16:00:00Z') + n * 60000); };
  at(1); const a = (await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'Pitch list', project: 'sponsors' } })).body.task;
  at(2); await call(env, 'POST', `/v1/tasks/${a.id}/proofs`, { bot: 'sponsors', body: { kind: 'url', link: 'https://jonmac.ai/review/1' } });
  at(3); await call(env, 'PATCH', `/v1/tasks/${a.id}`, { bot: 'sponsors', body: { status: 'qc' } });
  const proof = (await call(env, 'GET', '/v1/proofs?status=pending', { bot: 'qc' })).body.proofs[0];
  at(4); await call(env, 'POST', `/v1/proofs/${proof.id}/check`, { bot: 'qc', body: { result: 'passed' } });
  at(5); await call(env, 'POST', `/v1/tasks/${a.id}/comments`, { jon: true, body: { body: 'Looks <b>good</b> https://x.test/a' } });
  at(6); await call(env, 'PATCH', `/v1/tasks/${a.id}`, { jon: true, body: { status: 'done' } });
  at(7); const ap = (await call(env, 'POST', '/v1/approvals', { bot: 'viral-view', body: { action: 'post_clips', title: 'Post 3 clips' } })).body.approval;
  at(8); await call(env, 'POST', `/v1/approvals/${ap.id}/decide`, { jon: true, body: { decision: 'reject', note: 'too many' } });
  at(9); const q1 = (await call(env, 'POST', '/v1/questions', { bot: 'sponsors', body: { question: 'Send today?' } })).body.question;
  at(10); const q2 = (await call(env, 'POST', '/v1/questions', { bot: 'sponsors', body: { question: 'Which cover?' } })).body.question;
  at(11); await call(env, 'POST', `/v1/questions/${q2.id}/answer`, { jon: true, body: { answer: 'B' } });
  at(12); const b = (await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'Sign it', owner: 'jon' } })).body.task;
  at(13); await call(env, 'PATCH', `/v1/tasks/${b.id}`, { jon: true, body: { status: 'done' } });
  return { env, a, b, ap, q1, q2, min };
}

test('activity API: every update newest first, bot or Jon can read, the bot filter, and paging', async (t) => {
  const { env, a, b, ap, q1, q2 } = await story(t);
  assert.equal((await call(env, 'GET', '/v1/activity')).status, 401);
  const all = (await call(env, 'GET', '/v1/activity', { bot: 'ana' })).body;
  assert.equal(all.next, null);
  const brief = (items) => items.map((i) => [i.who, i.kind, i.body]);
  const tie = [['qc', 'check', 'proof passed'], ['qc', 'status', 'status qc → review (QC passed)']];
  const got = brief(all.items);
  assert.deepEqual([...got.slice(0, 9), ...got.slice(11)], [
    ['jon', 'tick', 'ticked done'], ['sponsors', 'created', 'created'], ['jon', 'answer', 'B'], ['sponsors', 'question', null], ['sponsors', 'question', null],
    ['jon', 'decision', 'rejected: too many'], ['viral-view', 'approval', null], ['jon', 'status', 'status review → done (approved by Jon)'],
    ['jon', 'comment', 'Looks <b>good</b> https://x.test/a'],
    ['sponsors', 'status', 'status todo → qc'], ['sponsors', 'proof', 'url'], ['sponsors', 'created', 'created'],
  ]);
  assert.deepEqual(got.slice(9, 11).sort(), tie, 'the two QC rows share a time');
  const ats = all.items.map((i) => i.at);
  assert.deepEqual(ats, [...ats].sort().reverse(), 'newest first');
  const row = (kind, id) => all.items.find((i) => i.kind === kind && (i.id === id || i.taskId === id));
  assert.deepEqual([row('comment', a.id).title, row('comment', a.id).owner, row('proof', a.id).link], ['Pitch list', 'sponsors', 'https://jonmac.ai/review/1']);
  assert.deepEqual([row('question', q1.id).title, row('question', q1.id).pending, row('question', q2.id).pending, row('answer', q2.id).title], ['Send today?', true, false, 'Which cover?']);
  assert.deepEqual([row('approval', ap.id).pending, row('decision', ap.id).owner, row('tick', b.id).owner], [false, 'viral-view', 'jon']);
  assert.equal((await call(env, 'GET', '/v1/activity', { jon: true, cc: false })).body.items.length, 14, 'Jon reads it too');

  const filter = async (bot) => brief((await call(env, 'GET', `/v1/activity?bot=${bot}`, { jon: true })).body.items).map(([who, kind]) => `${who} ${kind}`);
  assert.deepEqual(await filter('viral-view'), ['jon decision', 'viral-view approval'], "the bot's own rows and Jon's decision on them");
  assert.deepEqual((await filter('qc')).sort(), ['qc check', 'qc status']);
  assert.deepEqual(await filter('jon'), ['jon tick', 'sponsors created', 'jon answer', 'jon decision', 'jon status', 'jon comment']);
  assert.equal((await filter('sponsors')).length, 11, "Florence's rows plus everything done on her work");
  assert.deepEqual(await filter('inbox'), []);
  for (const q of ['bot=Not A Bot', 'bot=../x', 'before=yesterday', 'before=2026-10-30T16:00:00.000Z', 'before=2026-10-30T16:00:00.000Z|x_1']) {
    assert.equal((await call(env, 'GET', `/v1/activity?${q}`, { jon: true })).status, 400, q);
  }

  const pages = [];
  let next = '';
  do {
    const page = (await call(env, 'GET', `/v1/activity?limit=5${next ? `&before=${encodeURIComponent(next)}` : ''}`, { bot: 'sponsors' })).body;
    pages.push(page.items.map((i) => i.id + i.kind));
    next = page.next;
  } while (next);
  assert.deepEqual(pages.map((p) => p.length), [5, 5, 4]);
  assert.deepEqual(pages.flat(), all.items.map((i) => i.id + i.kind), 'paging returns every row once, even across a shared time');
});

test('feed page: first names, friendly times, escaped rows with link labels, and which rows open a card', () => {
  const now = NOW;
  const r = (more) => ({ id: 'e_0123456789abcdef', at: '2026-10-30T17:50:00Z', who: 'qc', owner: 'sponsors', kind: 'status', taskId: 't_0123456789abcdef', title: 'Pitch list', body: 'status qc → review (QC passed)', link: null, pending: false, ...more });
  const moved = rowHtml(r(), now);
  assert.match(moved, /<li class="fdrow" tabindex="0" data-open="t_0123456789abcdef">/);
  assert.match(moved, /<b>Jessica<\/b><span>moved QC → Review \(QC passed\)<\/span><time datetime="2026-10-30T17:50:00Z">today 10:50<\/time>/);
  const comment = rowHtml(r({ who: 'jon', kind: 'comment', title: 'Fix <b>this</b> https://t.test/x', body: 'Use <img src=x onerror=alert(1)> see https://www.loom.com/share/abc?a=1&b=2.' , at: '2026-10-29T23:00:00Z' }), now);
  assert.match(comment, /<b>Jon<\/b><span>commented<\/span><time [^>]*>yesterday 16:00<\/time>/);
  assert.match(comment, /Fix &lt;b&gt;this&lt;\/b&gt; <a href="https:\/\/t.test\/x"/);
  assert.match(comment, /Use &lt;img src=x onerror=alert\(1\)&gt; see <a href="https:\/\/www.loom.com\/share\/abc\?a=1&amp;b=2" target="_blank" rel="noopener">loom\.com<\/a>\./);
  assert.doesNotMatch(textOf(comment), /https?:/, 'no raw URL on screen');
  const proof = rowHtml(r({ who: 'sponsors', kind: 'proof', body: 'render', link: 'javascript:alert(1)' }), now);
  assert.doesNotMatch(proof, /href/, 'only web links are links');
  assert.match(rowHtml(r({ who: 'sponsors', kind: 'proof', body: 'url', link: 'https://jonmac.ai/review/1' }), now), /<a class="pjdeliv" href="https:\/\/jonmac.ai\/review\/1"[^>]*>Watch video<\/a>/);
  const ask = (more) => rowHtml(r({ id: 'q_0123456789abcdef', who: 'home-guide-press', kind: 'question', taskId: null, title: 'Which cover?', body: null, ...more }), now);
  assert.match(ask({ pending: true }), /data-open="q_0123456789abcdef".*<b>Elle<\/b><span>asked<\/span>/s, 'an open question opens its card');
  assert.doesNotMatch(ask({ pending: false }), /data-open/, 'an answered one without a task has no card');
  assert.match(rowHtml(r({ who: 'jon', kind: 'decision', taskId: null, title: 'Post clips', body: 'rejected: too many' }), now), /<span>rejected: too many<\/span>/);
  assert.match(rowHtml(r({ who: 'ana', kind: 'check', body: 'proof failed', at: '2026-10-26T17:00:00Z' }), now), /<b>Ana<\/b><span>proof failed<\/span><time [^>]*>Mon 10:00<\/time>/);

  const page = renderFeed({}, {}, 'video-editor');
  assert.match(page, /class="chip on" data-page="feed\/video-editor" aria-current="page">Olivia</);
  assert.match(page, /data-bot="video-editor"/);
  for (const name of ['All', 'Florence', 'Olivia', 'Scarlett', 'Sydney', 'Elle', 'Samantha', 'Elizabeth', 'Lucy', 'Jessica', 'Ana', 'Zendaya', 'Daisy', 'Jon']) assert.match(page, new RegExp(`>${name}</button>`));
  assert.match(renderFeed({}, {}, '"><script>'), /class="chip on" data-page="feed" aria-current="page">All</, 'an unknown filter shows all');
  assert.doesNotMatch(renderFeed({}, {}, '"><script>'), /<script>/);
});

test('friendly dates and first names', () => {
  assert.deepEqual(['2026-10-30T17:50:00Z', '2026-10-30T07:05:00Z', '2026-10-30T06:59:00Z', '2026-10-25T18:00:00Z', '2026-10-23T18:00:00Z', '2025-12-01T18:00:00Z', 'nope']
    .map((at) => whenLabel(at, NOW)), ['today 10:50', 'today 00:05', 'yesterday 23:59', 'Sun 11:00', 'Oct 23', 'Dec 1, 2025', '']);
  assert.deepEqual(['2026-10-30', '2026-10-29', '2026-10-31', '2026-10-01', '2027-01-02', 'x'].map((d) => dayLabel(d, NOW)), ['today', 'yesterday', 'tomorrow', 'Oct 1', 'Jan 2, 2027', '']);
  assert.deepEqual(['sponsors', 'video-editor', 'jon', 'developer', 'someone-new'].map(botName), ['Florence', 'Olivia', 'Jon', 'Lucy', 'someone-new']);
  assert.equal(linkify('a <b> https://x.test/p?q=1&r=2) b'), 'a &lt;b&gt; <a href="https://x.test/p?q=1&amp;r=2" target="_blank" rel="noopener">x.test</a>) b');
});

// ---- Todo ----

const task = (id, owner, status, more = {}) => ({ id, title: `Task ${id}`, project: 'sponsors', owner, status, createdBy: 'sponsors', createdAt: '2026-10-29T17:00:00Z', minutes: null, due: null, doneAt: null, deliverable: null, ...more });

function todoFixture() {
  return {
    tasks: [
      task('t1', 'jon', 'todo', { due: '2026-10-30', minutes: 30 }),
      task('t2', 'jon', 'doing', { due: '2026-10-28', minutes: 60 }),
      task('t3', 'jon', 'waiting_on_jon', { minutes: 5 }),
      task('t4', 'jon', 'todo', { due: '2026-10-31', minutes: 1 }),
      task('t5', 'jon', 'done', { due: '2026-10-29' }),
      task('t6', 'sponsors', 'waiting_on_jon', { minutes: 1 }),
      task('t7', 'video-editor', 'review', { minutes: 10, project: 'jon-mac', deliverable: { link: 'https://jonmac.ai/review/7', kind: 'render', web: true } }),
      task('t8', 'sponsors', 'qc', { minutes: 1 }),
      task('t9', 'jon', 'todo', { due: '2026-10-29' }),
    ],
    questions: [{ id: 'q1', askedBy: 'home-guide-press', question: 'Which cover?', options: ['A', 'B'], project: 'home-guide-press', minutes: 2, createdAt: '2026-10-30T16:00:00Z' }],
    approvals: [{ id: 'a1', action: 'post_clips', title: 'Post 3 clips', requestedBy: 'viral-view', payload: { n: 3 }, project: 'viral-view', minutes: null, createdAt: '2026-10-30T15:00:00Z' }],
  };
}

test("todo: Jon's open tasks due today, overdue or undated, plus questions, approvals and review; overdue first, then quickest", () => {
  const out = { pages: { todo: {} } };
  buildTodo(out, { today: todoFixture() }, NOW);
  const p = out.pages.todo;
  assert.deepEqual(p.items.map((i) => [i.id, i.overdue, i.minutes]), [
    ['t2', true, 60], ['t9', true, null], ['q1', false, 2], ['t3', false, 5], ['t7', false, 10], ['t1', false, 30], ['a1', false, null],
  ], 'no future, done, bot-owned or QC tasks');
  assert.deepEqual([p.available, p.minutes], [true, 107]);
  const [t2] = p.items;
  assert.deepEqual([t2.tickUrl, t2.reviewUrl, t2.from, t2.project], ['/dashboard/api/v1/tasks/t2', undefined, 'sponsors', 'Sponsors']);
  const t7 = p.items.find((i) => i.id === 't7');
  assert.deepEqual([t7.reviewUrl, t7.tickUrl, t7.from, t7.project, t7.deliverable.link], ['/dashboard/api/v1/tasks/t7', undefined, 'video-editor', 'YT-JM', 'https://jonmac.ai/review/7']);
  assert.equal(p.items.find((i) => i.id === 'a1').decideUrl, '/dashboard/api/v1/approvals/a1/decide');

  const none = { pages: { todo: {} } };
  buildTodo(none, { today: null }, NOW);
  assert.deepEqual([none.pages.todo.items, none.pages.todo.available], [[], false]);
});

test("todo page: the board's own buttons, deliverable link, first names, no checkbox, all escaped", () => {
  const out = { pages: { todo: {} } };
  const data = todoFixture();
  data.tasks[1].title = '<img src=x onerror=alert(1)>';
  buildTodo(out, { today: data }, NOW);
  const html = renderTodo(out.pages.todo, {}, undefined, NOW);
  assert.match(html, /<h1>Todo<\/h1><p>7 things · about 107 min<\/p>/);
  assert.equal((html.match(/<li class="qcard nyi[^"]*" tabindex="0" data-open="/g) || []).length, 7, 'every row opens its card');
  assert.match(html, /<li class="qcard nyi crit" tabindex="0" data-open="t2">\s*<div class="qmeta"><span class="pill crit">Overdue<\/span> <span class="jttag">Florence<\/span><i>·<\/i><span>Sponsors<\/span><i>·<\/i><span>60 min<\/span><i>·<\/i><span>due Oct 28<\/span><\/div>\s*<h3 class="qq">&lt;img src=x onerror=alert\(1\)&gt;<\/h3>/);
  assert.match(html, /<span>due yesterday<\/span>/);
  assert.match(html, /data-ttick="\/dashboard\/api\/v1\/tasks\/t2">Done<\/button>/);
  assert.match(html, /<span class="jttag">Olivia<\/span>.*<a class="pjdeliv" href="https:\/\/jonmac.ai\/review\/7"[^>]*>Watch video<\/a>.*data-ttick="\/dashboard\/api\/v1\/tasks\/t7" data-confirm="Approve &quot;Task t7&quot;\? It moves to Done.">Approve<\/button><button type="button" class="btn line" data-sendback="t7">Send back<\/button>/s);
  assert.match(html, /<span class="jttag">Elle<\/span>.*<span>2 min · today 09:00<\/span>.*data-qopt="A".*data-tsend="\/dashboard\/api\/v1\/questions\/q1\/answer"/s);
  assert.match(html, /<span class="jttag">Scarlett<\/span>.*data-tdecide="\/dashboard\/api\/v1\/approvals\/a1\/decide" data-decision="approve".*data-decision="reject"/s);
  assert.doesNotMatch(html, /type="checkbox"/, 'no checkbox approves anything');
  assert.ok(html.indexOf('data-open="t2"') < html.indexOf('data-open="q1"') && html.indexOf('data-open="t1"') < html.indexOf('data-open="a1"'), 'in the built order');
  assert.match(renderTodo({ items: [], available: true }), /All clear.*Nothing for you today\./s);
  assert.match(renderTodo({ items: [], available: false }), /The bot tables could not be read\./);
});

test('snapshot serves Todo from the bot tables, and Jon ticks from it', async () => {
  const { env } = await setup();
  const mine = (await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'Sign it', owner: 'jon', project: 'sponsors', minutes: 10 } })).body.task;
  await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'Later', owner: 'jon', due: '2099-01-01' } });
  await call(env, 'POST', '/v1/questions', { bot: 'sponsors', body: { question: 'Send?', minutes: 1 } });
  const todo = async () => (await (await handleApi(new Request('https://jonmac.ai/dashboard/api/snapshot?pages=todo', { headers: { Cookie: await cookie() } }), env)).json()).pages.todo;
  const p = await todo();
  assert.deepEqual(p.items.map((i) => [i.kind, i.title]), [['question', 'Send?'], ['task', 'Sign it']]);
  assert.equal((await call(env, 'PATCH', p.items[1].tickUrl.replace('/dashboard/api', ''), { jon: true, body: { status: 'done' } })).body.task.id, mine.id);
  assert.deepEqual((await todo()).items.map((i) => i.title), ['Send?']);
});
