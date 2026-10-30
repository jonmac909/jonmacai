import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { askModal, taskModal } from '../public/js/modals.js';
import { render as renderProjects } from '../public/js/pages/projects.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TOK = { sponsors: `ccb_${'s'.repeat(43)}`, qc: `ccb_${'q'.repeat(43)}`, 'home-guide-press': `ccb_${'h'.repeat(43)}` };
const HOOKS = {
  sponsors: { url: 'https://hooks.example/sponsors', secret: 'whsec_sponsors-test' },
  ana: { url: 'https://hooks.example/ana', secret: 'whsec_ana-test' },
};

async function setup(webhooks = HOOKS) {
  const db = sqliteD1();
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  return { db, env: { DB: db, SESSION_SECRET: SECRET, ...(webhooks ? { WEBHOOKS: JSON.stringify(webhooks) } : {}) } };
}
const cookie = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;
async function call(env, method, path, { bot, body, jon, cc = true, ctx } = {}) {
  const h = new Headers();
  if (bot) h.set('Authorization', `Bearer ${TOK[bot]}`);
  if (jon) { h.set('Cookie', await cookie()); if (cc) h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  return { status: r.status, body: await r.json() };
}
const newTask = async (env, body) => (await call(env, 'POST', '/tasks', { bot: 'sponsors', body: { title: 'Pitch list', project: 'sponsors', ...body } })).body.task;

// Records every outgoing request; `reply` decides the answer (a status, or throw for a network error).
function mockFetch(t, reply = () => 202) {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init });
    return new Response(null, { status: reply(url) });
  };
  t.after(() => { globalThis.fetch = real; });
  return sent;
}

test('comments: Jon needs X-CC, a bot comments as itself, nobody else; the body is checked', async (t) => {
  const sent = mockFetch(t);
  const { env } = await setup();
  const task = await newTask(env);
  const path = `/tasks/${task.id}/comments`;
  assert.equal((await call(env, 'POST', path, { body: { body: 'hi' } })).status, 401);
  assert.equal((await call(env, 'POST', path, { jon: true, cc: false, body: { body: 'hi' } })).status, 403);
  for (const body of [{}, { body: '   ' }, { body: 'x'.repeat(4001) }, { body: { text: 'hi' } }]) {
    assert.equal((await call(env, 'POST', path, { jon: true, body })).status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal((await call(env, 'POST', '/tasks/t_0000000000000000/comments', { jon: true, body: { body: 'hi' } })).status, 404);
  assert.equal((await call(env, 'POST', '/tasks/nope/comments', { bot: 'qc', body: { body: 'hi' } })).status, 404);
  assert.equal(sent.length, 0, 'refused comments wake no one');

  const jon = await call(env, 'POST', path, { jon: true, body: { body: '  Use the blue logo  ' } });
  assert.equal(jon.status, 201);
  assert.match(jon.body.comment.id, /^c_[0-9a-f]{16}$/);
  assert.deepEqual([jon.body.comment.author, jon.body.comment.body, jon.body.comment.taskId, jon.body.comment.wakeStatus], ['jon', 'Use the blue logo', task.id, '202']);
  const bot = await call(env, 'POST', path, { bot: 'qc', body: { body: 'x'.repeat(4000) } });
  assert.deepEqual([bot.status, bot.body.comment.author, bot.body.comment.wakeStatus], [201, 'qc', null]);
  assert.equal(sent.length, 1, "a bot's comment wakes no one");

  const read = (await call(env, 'GET', `/tasks/${task.id}`, { bot: 'sponsors' })).body.task;
  assert.deepEqual(read.comments.map((c) => [c.author, c.body.length, c.wakeStatus]), [['jon', 17, '202'], ['qc', 4000, null]], 'oldest first');
});

test('history: create, status, owner/project/due, proof, QC check, tick and comments each write one row', async (t) => {
  mockFetch(t);
  const { env } = await setup();
  const task = await newTask(env, { key: 'k1' });
  await newTask(env, { key: 'k1' }); // a retried create is not a second "created"
  await call(env, 'PATCH', `/tasks/${task.id}`, { bot: 'sponsors', body: { status: 'doing', note: 'n', project: 'unsorted', due: '2026-11-02' } });
  await call(env, 'PATCH', `/tasks/${task.id}`, { bot: 'sponsors', body: { status: 'doing', owner: 'qc', title: 'Same status: no row' } });
  const proof = (await call(env, 'POST', `/tasks/${task.id}/proofs`, { bot: 'sponsors', body: { kind: 'url', link: 'https://jonmac.ai/review/1' } })).body.proof;
  await call(env, 'PATCH', `/tasks/${task.id}`, { bot: 'qc', body: { status: 'qc' } });
  await call(env, 'POST', `/proofs/${proof.id}/check`, { bot: 'qc', body: { result: 'failed', note: 'blurry' } });
  await call(env, 'POST', `/tasks/${task.id}/comments`, { jon: true, body: { body: 'Please redo' } });
  await call(env, 'POST', `/tasks/${task.id}/comments`, { bot: 'qc', body: { body: 'On it' } });

  const got = await call(env, 'GET', `/tasks/${task.id}`, { jon: true });
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.task.history.map((h) => [h.by, h.kind, h.detail]), [
    ['sponsors', 'created', 'created'],
    ['sponsors', 'project', 'project sponsors → none'],
    ['sponsors', 'due', 'due none → 2026-11-02'],
    ['sponsors', 'status', 'status todo → doing'],
    ['sponsors', 'owner', 'owner sponsors → qc'],
    ['sponsors', 'proof', 'proof added (url)'],
    ['qc', 'status', 'status doing → qc'],
    ['qc', 'check', 'proof failed'],
    ['qc', 'status', 'status qc → doing (QC failed)'],
    ['jon', 'comment', 'commented'],
    ['qc', 'comment', 'commented'],
  ]);
  assert.ok(got.body.task.history.every((h) => !Number.isNaN(Date.parse(h.at))));
  assert.deepEqual([got.body.task.proofs.length, got.body.task.comments.map((c) => c.body)], [1, ['Please redo', 'On it']]);

  const mine = await newTask(env, { owner: 'jon' });
  await call(env, 'PATCH', `/tasks/${mine.id}`, { jon: true, body: { status: 'done' } });
  const ticked = (await call(env, 'GET', `/tasks/${mine.id}`, { bot: 'qc' })).body.task;
  assert.deepEqual(ticked.history.map((h) => [h.by, h.kind, h.detail]), [['sponsors', 'created', 'created'], ['jon', 'tick', 'ticked done']]);
});

test('history: a task from before history began starts with "created by" and its earlier proofs', async (t) => {
  mockFetch(t);
  const { db, env } = await setup();
  await db.prepare(`INSERT INTO bot_tasks (id, title, owner, status, created_by, updated_by, created_at, updated_at)
    VALUES ('t_00000000000000aa', 'Old', 'sponsors', 'doing', 'ana', 'ana', '2026-10-20T10:00:00.000Z', '2026-10-20T10:00:00.000Z')`).bind().run();
  await db.prepare(`INSERT INTO bot_proofs (id, task_id, kind, link, status, created_by, created_at)
    VALUES ('p_00000000000000aa', 't_00000000000000aa', 'render', 'D:\\old.mp4', 'pending', 'sponsors', '2026-10-21T10:00:00.000Z')`).bind().run();
  const before = (await call(env, 'GET', '/tasks/t_00000000000000aa', { bot: 'qc' })).body.task;
  assert.deepEqual(before.history, [
    { at: '2026-10-20T10:00:00.000Z', by: 'ana', kind: 'created', detail: 'created' },
    { at: '2026-10-21T10:00:00.000Z', by: 'sponsors', kind: 'proof', detail: 'proof added (render)' },
  ]);
  assert.deepEqual(before.comments, []);
  await call(env, 'POST', '/tasks/t_00000000000000aa/proofs', { bot: 'sponsors', body: { kind: 'url', link: 'https://x.example/new' } });
  const after = (await call(env, 'GET', '/tasks/t_00000000000000aa', { bot: 'qc' })).body.task;
  assert.deepEqual(after.history.map((h) => [h.by, h.detail]), [['ana', 'created'], ['sponsors', 'proof added (render)'], ['sponsors', 'proof added (url)']],
    'the new proof is listed once, from its own row');
});

test("wake: Jon's comment POSTs card_comment to the owner's routine, signed like hook.py", async (t) => {
  const sent = mockFetch(t);
  const { env } = await setup();
  const task = await newTask(env);
  const res = await call(env, 'POST', `/tasks/${task.id}/comments`, { jon: true, body: { body: 'Ship it — "today"' } });
  const id = res.body.comment.id;
  assert.equal(sent.length, 1);
  const { url, init } = sent[0];
  assert.deepEqual([url, init.method], ['https://hooks.example/sponsors', 'POST']);
  const h = init.headers;
  assert.deepEqual(Object.keys(h).sort(), ['Content-Type', 'x-openbot-delivery-id', 'x-openbot-signature', 'x-openbot-timestamp']);
  assert.deepEqual([h['Content-Type'], h['x-openbot-delivery-id']], ['application/json', id]);
  assert.ok(Math.abs(Number(h['x-openbot-timestamp']) - Date.now() / 1000) < 5);
  // hook.py: hmac.new(secret.encode(), b'<ts>.<delivery>.' + body, sha256).hexdigest()
  const want = createHmac('sha256', HOOKS.sponsors.secret).update(`${h['x-openbot-timestamp']}.${id}.`).update(Buffer.from(init.body, 'utf8')).digest('hex');
  assert.equal(h['x-openbot-signature'], `sha256=${want}`);
  const body = JSON.parse(init.body);
  assert.match(body.occurredAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual(body, {
    type: 'card_comment', occurredAt: body.occurredAt,
    data: { task: task.id, title: 'Pitch list', project: 'sponsors', owner: 'sponsors', comment: 'Ship it — "today"', commentId: id, by: 'jon', url: 'https://jonmac.ai/dashboard/#projects/sponsors' },
  });
});

test("wake: owners without a complete route go to ana with forOwner; Jon's own card wakes no one; failures still save the comment", async (t) => {
  let status = 202;
  const sent = mockFetch(t, () => { if (status === 'down') throw new TypeError('fetch failed'); return status; });
  const { env, db } = await setup();
  const noSecret = { ...env, WEBHOOKS: JSON.stringify({ ...HOOKS, sponsors: { url: HOOKS.sponsors.url } }) };
  for (const [owner, e] of [['home-guide-press', env], ['sponsors', noSecret]]) {
    const task = await newTask(env, { owner, project: 'unsorted' });
    const c = (await call(e, 'POST', `/tasks/${task.id}/comments`, { jon: true, body: { body: 'hi' } })).body.comment;
    const { url, init } = sent.at(-1);
    const data = JSON.parse(init.body).data;
    assert.deepEqual([url, data.owner, data.forOwner, data.project, data.url, c.wakeStatus], ['https://hooks.example/ana', owner, owner, null, 'https://jonmac.ai/dashboard/#projects/unsorted', '202']);
    assert.equal(init.headers['x-openbot-signature'],
      `sha256=${createHmac('sha256', HOOKS.ana.secret).update(`${init.headers['x-openbot-timestamp']}.${c.id}.${init.body}`).digest('hex')}`);
  }
  const own = await newTask(env, { owner: 'jon' });
  const quiet = [];
  const note = await call(env, 'POST', `/tasks/${own.id}/comments`, { jon: true, body: { body: 'note to self' }, ctx: { waitUntil: (p) => quiet.push(p) } });
  assert.deepEqual([note.status, note.body.comment.wakeStatus, quiet.length, sent.length], [201, 'owner is Jon', 0, 2]);

  const task = await newTask(env);
  const post = async (e) => call(e, 'POST', `/tasks/${task.id}/comments`, { jon: true, body: { body: 'again' } });
  status = 503;
  const tries = sent.length;
  assert.deepEqual([(await post(env)).body.comment.wakeStatus, sent.length - tries], ['503', 1], 'awaited (no ctx): one try');
  status = 'down';
  const down = await post(env);
  assert.deepEqual([down.status, down.body.comment.wakeStatus], [201, 'unreachable']);
  const before = sent.length;
  for (const webhooks of [undefined, '{bad', JSON.stringify({ ana: { url: 'https://hooks.example/ana' } })]) {
    const r = await post({ ...env, WEBHOOKS: webhooks });
    assert.deepEqual([r.status, r.body.comment.wakeStatus], [201, 'not configured'], String(webhooks));
  }
  assert.equal(sent.length, before, 'nothing is sent without a url and secret');
  const saved = (await call(env, 'GET', `/tasks/${task.id}`, { jon: true })).body.task.comments.map((c) => c.wakeStatus);
  assert.deepEqual(saved, ['503', 'unreachable', 'not configured', 'not configured', 'not configured'], 'every comment saved, with its result');

  // In the Worker the wake runs after the response (ctx.waitUntil) and records its result when done.
  status = 202;
  const waits = [];
  const bg = await call(env, 'POST', `/tasks/${task.id}/comments`, { jon: true, body: { body: 'later' }, ctx: { waitUntil: (p) => waits.push(p) } });
  assert.deepEqual([bg.status, bg.body.comment.wakeStatus, waits.length], [201, null, 1]);
  await Promise.all(waits);
  assert.equal((await db.prepare('SELECT wake_status FROM bot_task_comments WHERE id = ?').bind(bg.body.comment.id).first()).wake_status, '202');
});

test('wake in the background: a 503 or unreachable routine is retried after 2 s, then 4 s, with the same delivery id', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const replies = [];
  const sent = mockFetch(t, () => { const r = replies.shift(); if (r === 'down') throw new TypeError('fetch failed'); return r; });
  const { env, db } = await setup();
  const task = await newTask(env);
  const turn = () => new Promise((r) => setImmediate(r));
  const sentReaches = async (n) => { for (let i = 0; i < 2000 && sent.length < n; i++) await turn(); assert.equal(sent.length, n); await turn(); };
  const comment = async (script) => {
    replies.push(...script);
    const waits = [];
    const from = sent.length;
    const c = (await call(env, 'POST', `/tasks/${task.id}/comments`, { jon: true, body: { body: 'x' }, ctx: { waitUntil: (p) => waits.push(p) } })).body.comment;
    return { c, from, done: Promise.all(waits) };
  };
  const statusOf = async (id) => (await db.prepare('SELECT wake_status FROM bot_task_comments WHERE id = ?').bind(id).first()).wake_status;

  const a = await comment([503, 'down', 202]);
  await sentReaches(a.from + 1);
  t.mock.timers.tick(1999); await turn();
  assert.equal(sent.length, a.from + 1, 'not before 2 s');
  t.mock.timers.tick(1);
  await sentReaches(a.from + 2);
  t.mock.timers.tick(3999); await turn();
  assert.equal(sent.length, a.from + 2, 'not before 4 more s');
  t.mock.timers.tick(1);
  await sentReaches(a.from + 3);
  await a.done;
  assert.equal(await statusOf(a.c.id), '202');
  assert.deepEqual(sent.slice(a.from).map((s) => s.init.headers['x-openbot-delivery-id']), [a.c.id, a.c.id, a.c.id]);

  const b = await comment(['down', 503, 503]);
  for (const n of [1, 2, 3]) { await sentReaches(b.from + n); t.mock.timers.tick(4000); }
  await b.done;
  assert.deepEqual([await statusOf(b.c.id), sent.length - b.from], ['503', 3], 'gives up after two retries; the last result is kept');

  const c = await comment([401]);
  await c.done;
  assert.deepEqual([await statusOf(c.c.id), sent.length - c.from], ['401', 1], 'a refusal is not retried');
});

const TASK = {
  id: 't_0123456789abcdef', title: '<b>Edit</b> ep 4', owner: 'video-editor', status: 'waiting_on_jon', note: 'Cut <script>x</script>', project: 'jon-mac', due: '2026-10-30', minutes: 15,
  proofs: [
    { kind: 'url', link: 'https://jonmac.ai/review/4?a=1&b="2"', status: 'passed', note: null, checkNote: '<i>ok</i>' },
    { kind: 'url', link: 'javascript:alert(1)', status: 'failed', note: 'bad', checkNote: null },
    { kind: 'render', link: 'D:\\renders\\ep4.mp4', status: 'pending', note: null, checkNote: null },
  ],
  history: [{ at: '2026-10-29T17:00:00Z', by: 'ana', kind: 'created', detail: 'created' }, { at: '2026-10-29T18:00:00Z', by: 'qc', kind: 'status', detail: 'status doing → qc' }],
  comments: [
    { id: 'c_1', author: 'jon', body: 'Use <img src=x onerror=alert(1)>', createdAt: '2026-10-29T18:10:00Z', wakeStatus: '202' },
    { id: 'c_2', author: 'jon', body: 'And this', createdAt: '2026-10-29T18:11:00Z', wakeStatus: '503' },
    { id: 'c_3', author: 'video-editor', body: 'Done', createdAt: '2026-10-29T18:20:00Z', wakeStatus: null },
    { id: 'c_4', author: 'jon', body: 'Thanks', createdAt: '2026-10-29T18:30:00Z', wakeStatus: 'owner is Jon' },
  ],
};

test('card modal: escaped, only http(s) proof links clickable, the thread with wake lines, and no comment form on asks', () => {
  const html = taskModal(TASK, 'YT-JM');
  assert.doesNotMatch(html, /<script|<b>Edit|<img|<i>ok/);
  assert.match(html, /<h2>&lt;b&gt;Edit&lt;\/b&gt; ep 4<\/h2>/);
  assert.match(html, /<p class="cmmeta">Olivia · Waiting on you · YT-JM · due 2026-10-30 · 15 min of your time<\/p>/);
  assert.match(html, /<a class="btn line cmopen" href="https:\/\/jonmac.ai\/review\/4[^"]*" target="_blank" rel="noopener">Watch video<\/a>/, 'proof as a labelled button');
  assert.doesNotMatch(html, />https?:\/\//, 'no raw URL as text');
  assert.match(html, /<details class="cmhist"><summary>History \(2\)<\/summary>/, 'history collapsed');
  assert.deepEqual(html.match(/href="[^"]*"/g), ['href="https://jonmac.ai/review/4?a=1&amp;b=&quot;2&quot;"']);
  assert.match(html, /title="javascript:alert\(1\)"/, 'a non-web link is text, not a link');
  assert.match(html, /<span class="cmfile" title="D:\\renders\\ep4\.mp4">Local file: ep4\.mp4<\/span>/);
  assert.match(html, /<strong>QC:<\/strong> &lt;i&gt;ok&lt;\/i&gt;/);
  assert.ok(html.indexOf('created <span class="cmby">· Ana') < html.indexOf('status doing → qc <span class="cmby">· Jessica'), 'history oldest first, by name');
  assert.ok(html.indexOf('Use &lt;img') < html.indexOf('And this') && html.indexOf('And this') < html.indexOf('>Done<'), 'comments oldest first');
  assert.match(html, /sent to Olivia/);
  assert.match(html, /couldn&#39;t notify \(503\)/);
  assert.equal((html.match(/sent to|sending|couldn|owner is/g) || []).length, 2, "Jon's woken comments have a wake line; bots' and his own card's don't");
  assert.match(html, /data-csend="\/dashboard\/api\/v1\/tasks\/t_0123456789abcdef\/comments"/);

  const q = askModal({ kind: 'question', id: 'q1', title: 'Which <cover>?', context: 'A or B', options: ['A'], from: 'home-guide-press', answerUrl: '/dashboard/api/v1/questions/q1/answer' });
  const a = askModal({ kind: 'approval', id: 'a1', title: 'Post 3 clips', action: 'post_clips', payloadPreview: '{"n": 3}', from: 'viral-view', decideUrl: '/dashboard/api/v1/approvals/a1/decide' });
  assert.match(q, /Which &lt;cover&gt;\?.*A or B.*data-tsend="\/dashboard\/api\/v1\/questions\/q1\/answer"/s);
  assert.match(a, /data-tdecide="\/dashboard\/api\/v1\/approvals\/a1\/decide" data-decision="approve".*data-decision="reject"/s);
  for (const m of [q, a]) assert.doesNotMatch(m, /data-csend|Write a comment|data-open/);
});

test('board: every card opens the modal (task, question and approval)', () => {
  const cols = (items) => ['todo', 'doing', 'waiting_on_jon', 'qc', 'done'].map((key) => ({ key, label: key, items: key === 'waiting_on_jon' ? items : [] }));
  const d = {
    available: true, summary: { missing: 'x' }, calendar: { missing: 'x' }, today: { groups: [], total: '0 min' },
    projects: [{
      slug: 'sponsors', label: 'Sponsors', waiting: 3, goals: [], columns: cols([
        { kind: 'task', id: 't_0123456789abcdef', title: 'T', from: 'sponsors' },
        { kind: 'question', id: 'q_0123456789abcdef', title: 'Q', options: [], answerUrl: '/dashboard/api/v1/questions/q_0123456789abcdef/answer' },
        { kind: 'approval', id: 'a_0123456789abcdef', title: 'A', decideUrl: '/dashboard/api/v1/approvals/a_0123456789abcdef/decide' },
      ]),
    }],
  };
  const html = renderProjects(d, {}, 'sponsors');
  assert.deepEqual([...html.matchAll(/<li class="[^"]*" tabindex="0" data-open="([^"]+)"/g)].map((m) => m[1]), ['t_0123456789abcdef', 'q_0123456789abcdef', 'a_0123456789abcdef']);
});

test("card modal actions: a waiting-on-Jon card shows its question and approval buttons, Done only on Jon's own task", async (t) => {
  mockFetch(t);
  const { env } = await setup();
  const task = await newTask(env, { status: 'waiting_on_jon' });
  await call(env, 'POST', '/questions', { bot: 'sponsors', body: { question: 'Send it?', options: ['Yes', 'No'], task: task.id } });
  await call(env, 'POST', '/approvals', { bot: 'sponsors', body: { action: 'send_pitches', title: 'Send 3 pitches', payload: { count: 3 }, task: task.id } });
  const other = await newTask(env, { title: 'Unlinked' });
  await call(env, 'POST', '/questions', { bot: 'sponsors', body: { question: 'Not this card', task: other.id } });
  const read = (await call(env, 'GET', `/tasks/${task.id}`, { jon: true })).body.task;
  assert.deepEqual(read.asks.map((a) => a.kind), ['approval', 'question']);
  const html = taskModal(read, 'Sponsors');
  assert.match(html, /<h3>Your move<\/h3>/);
  assert.match(html, /data-qopt="Yes"/);
  assert.match(html, /data-tsend="\/dashboard\/api\/v1\/questions\/q_[0-9a-f]+\/answer"/);
  assert.match(html, /data-tdecide="\/dashboard\/api\/v1\/approvals\/a_[0-9a-f]+\/decide"[^>]*data-decision="approve"|data-decision="approve"[^>]*data-tdecide="\/dashboard\/api\/v1\/approvals\/a_/);
  assert.doesNotMatch(html, /Not this card/);
  assert.doesNotMatch(html, /data-ttick/, "a bot's task has no Done");
  assert.doesNotMatch(html, /type="checkbox"/, 'no checkbox approves anything');
  assert.equal((html.match(/class="qtext cmtext"/g) || []).length, 1, 'one comment box, separate from the answer box');

  const mine = await call(env, 'POST', '/tasks', { bot: 'sponsors', body: { title: 'Sign the contract', project: 'sponsors', owner: 'jon' } });
  const jonTask = (await call(env, 'GET', `/tasks/${mine.body.task.id}`, { jon: true })).body.task;
  assert.match(taskModal(jonTask, 'Sponsors'), new RegExp(`data-ttick="/dashboard/api/v1/tasks/${jonTask.id}"`));
  await call(env, 'PATCH', `/tasks/${jonTask.id}`, { jon: true, body: { status: 'done' } });
  const ticked = (await call(env, 'GET', `/tasks/${jonTask.id}`, { jon: true })).body.task;
  assert.doesNotMatch(taskModal(ticked, 'Sponsors'), /data-ttick/, 'a done task has no Done button');
});

test('card modal note: Markdown with What happened / Your move / Next headings, bold, bullets, labelled links', () => {
  const note = '**What happened**\n- Neeti offers **affiliate only** (20%)\n- Draft: https://mail.google.com/mail/u/1/#drafts\n\n**Your move**\n- Send the draft\n\nNext\n- Close as lost if silent by Nov 6';
  const html = taskModal({ id: 't_0123456789abcdef', title: 'HeyGen (Neeti)', owner: 'sponsors', status: 'waiting_on_jon', note, proofs: [], history: [], comments: [], asks: [],
    deliverable: { link: 'https://mail.google.com/mail/u/1/#drafts', kind: 'url', web: true } }, 'Sponsors');
  assert.match(html, /<p class="cmmeta">Florence · Waiting on you · Sponsors<\/p>/);
  assert.match(html, /<section class="cmact"><h3>Your move<\/h3><div class="qopts"><a class="pjdeliv btn line" href="https:\/\/mail.google.com\/mail\/u\/1\/#drafts"[^>]*>Open draft in Gmail<\/a>/);
  assert.match(html, /<h4>What happened<\/h4><ul><li>Neeti offers <strong>affiliate only<\/strong> \(20%\)<\/li><li>Draft: <a href="https:\/\/mail.google.com\/mail\/u\/1\/#drafts" target="_blank" rel="noopener">Open draft in Gmail<\/a><\/li><\/ul>/);
  assert.match(html, /<h4>Your move<\/h4>.*<h4>Next<\/h4>/s);
  assert.match(html, /<textarea class="qtext cmtext" rows="2"/, 'compact comment box');
});
