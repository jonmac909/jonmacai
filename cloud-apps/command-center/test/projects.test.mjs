import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex, todayData } from '../src/bots.js';
import { buildProjects, PROJECTS } from '../src/projects.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TOK = { ana: `ccb_${'a'.repeat(43)}`, sponsors: `ccb_${'s'.repeat(43)}`, qc: `ccb_${'q'.repeat(43)}` };
const NOW = Date.parse('2026-10-29T19:00:00Z'); // Thu Oct 29, 12:00 PT

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

test('project, minutes and due: checked on the way in, returned on the way out', async () => {
  const { env } = await setup();
  const t = await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'Pitch list', project: ' Sponsors ', minutes: 20, due: '2026-10-30' } });
  assert.equal(t.status, 201);
  assert.deepEqual([t.body.task.project, t.body.task.minutes, t.body.task.due], ['sponsors', 20, '2026-10-30']);
  for (const project of ['unsorted', '', null]) {
    assert.equal((await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'x', project } })).body.task.project, null, String(project));
  }
  const bad = await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'x', project: 'webinar' } });
  assert.deepEqual([bad.status, bad.body.error.startsWith('project must be one of: sponsors, jon-mac,')], [400, true]);
  for (const minutes of [0, 481, 1.5, 'lots', true]) {
    assert.equal((await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'x', minutes } })).status, 400, String(minutes));
  }
  for (const due of ['2026-13-01', 'tomorrow', '2026-10-29T10:00']) {
    assert.equal((await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'x', due } })).status, 400, due);
  }
  const upd = await call(env, 'PATCH', `/v1/tasks/${t.body.task.id}`, { bot: 'sponsors', body: { project: 'unsorted', minutes: null, due: '2026-11-02' } });
  assert.deepEqual([upd.status, upd.body.task.project, upd.body.task.minutes, upd.body.task.due], [200, null, null, '2026-11-02']);
  assert.equal((await call(env, 'PATCH', `/v1/tasks/${t.body.task.id}`, { bot: 'sponsors', body: { project: 'nope' } })).status, 400);

  const q = await call(env, 'POST', '/v1/questions', { bot: 'sponsors', body: { question: 'Which?', project: 'jonmacai', minutes: 3 } });
  assert.deepEqual([q.status, q.body.question.project, q.body.question.minutes], [201, 'jonmacai', 3]);
  assert.equal((await call(env, 'POST', '/v1/questions', { bot: 'sponsors', body: { question: 'x', project: 'x' } })).status, 400);
  const a = await call(env, 'POST', '/v1/approvals', { bot: 'sponsors', body: { action: 'send_pitches', title: 'Send', project: 'sponsors', minutes: 480 } });
  assert.deepEqual([a.status, a.body.approval.project, a.body.approval.minutes], [201, 'sponsors', 480]);
  assert.equal((await call(env, 'POST', '/v1/approvals', { bot: 'sponsors', body: { action: 'send_pitches', title: 'x', minutes: 500 } })).status, 400);
  assert.equal((await call(env, 'GET', `/v1/questions/${q.body.question.id}`, { bot: 'sponsors' })).body.question.project, 'jonmacai');
});

test('?project= filters tasks, questions and approvals; unsorted lists the ones with none', async () => {
  const { env } = await setup();
  for (const project of ['sponsors', 'viral-view', undefined]) {
    await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: `task ${project}`, project } });
    await call(env, 'POST', '/v1/questions', { bot: 'sponsors', body: { question: `q ${project}`, project } });
    await call(env, 'POST', '/v1/approvals', { bot: 'sponsors', body: { action: 'send_pitches', title: `a ${project}`, project } });
  }
  const titles = async (path, key, field) => (await call(env, 'GET', path, { jon: true })).body[key].map((x) => x[field]);
  assert.deepEqual(await titles('/v1/tasks?project=viral-view', 'tasks', 'title'), ['task viral-view']);
  assert.deepEqual(await titles('/v1/tasks?project=unsorted', 'tasks', 'title'), ['task undefined']);
  assert.equal((await titles('/v1/tasks?project=', 'tasks', 'title')).length, 3, 'empty means no filter');
  assert.deepEqual(await titles('/v1/questions?project=sponsors', 'questions', 'question'), ['q sponsors']);
  assert.deepEqual(await titles('/v1/approvals?project=unsorted&status=pending', 'approvals', 'title'), ['a undefined']);
  assert.equal((await call(env, 'GET', '/v1/approvals?project=nope', { bot: 'sponsors' })).status, 400);
});

test('owner jon: bots assign it, only Jon ticks it done, and only on jon-owned tasks', async () => {
  const { env } = await setup();
  const mine = (await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'Sign the contract', owner: 'Jon', project: 'sponsors', due: '2026-10-29' } })).body.task;
  assert.equal(mine.owner, 'jon');
  const bots = (await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'Bot work' } })).body.task;
  assert.deepEqual((await call(env, 'GET', '/v1/tasks?owner=jon', { bot: 'sponsors' })).body.tasks.map((x) => x.id), [mine.id]);

  assert.equal((await call(env, 'PATCH', `/v1/tasks/${mine.id}`, { bot: 'sponsors', body: { status: 'done' } })).status, 409, 'bots still need QC-passed proof');
  assert.equal((await call(env, 'PATCH', `/v1/tasks/${mine.id}`, { jon: true, cc: false, body: { status: 'done' } })).status, 403, 'X-CC required');
  assert.equal((await call(env, 'PATCH', `/v1/tasks/${bots.id}`, { jon: true, body: { status: 'done' } })).status, 403, 'not on bot-owned tasks');
  assert.equal((await call(env, 'PATCH', `/v1/tasks/${mine.id}`, { jon: true, body: { status: 'doing' } })).status, 400, 'the tick is done only');
  assert.equal((await call(env, 'PATCH', '/v1/tasks/t_0000000000000000', { jon: true, body: { status: 'done' } })).status, 404);
  const tick = await call(env, 'PATCH', `/v1/tasks/${mine.id}`, { jon: true, body: { status: 'done', title: 'ignored' } });
  assert.deepEqual([tick.status, tick.body.task.status, tick.body.task.updatedBy, tick.body.task.title, !!tick.body.task.doneAt], [200, 'done', 'jon', 'Sign the contract', true]);
  assert.equal((await call(env, 'PATCH', `/v1/tasks/${mine.id}`, { jon: true, body: { status: 'done' } })).status, 409, 'once');
  assert.equal((await call(env, 'GET', `/v1/tasks/${bots.id}`, { jon: true })).body.task.status, 'todo');
});

test('calendar_today: Ana only, checked and trimmed, and todayData returns it', async () => {
  const { env, db } = await setup();
  const put = (bot, body) => call(env, 'PUT', '/v1/feeds/calendar_today', { bot, body });
  const ev = { start: ' 09:30 ', end: '10:00', title: ' Call with Acme ', calendar: 'Work' };
  assert.equal((await put('sponsors', { date: '2026-10-29', events: [ev] })).status, 403);
  assert.equal((await put('ana', { events: [ev] })).status, 400, 'date is required');
  assert.equal((await put('ana', { date: '2026-10-29' })).status, 400, 'events is required');
  assert.equal((await put('ana', { date: '2026-10-29', events: Array(61).fill(ev) })).status, 400, 'at most 60');
  assert.equal((await put('ana', { date: '2026-10-29', events: ['x'] })).status, 400);
  assert.equal((await put('ana', { date: '2026-10-29', events: [{ ...ev, title: ' ' }] })).status, 400);
  assert.equal((await put('ana', { date: '2026-10-29', events: [{ ...ev, title: 'x'.repeat(301) }] })).status, 400);
  const ok = await put('ana', { date: '2026-10-29', events: [ev, { start: '13:00', end: '14:00', title: 'Gym', extra: 'dropped' }] });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.feed.data.events, [{ start: '09:30', end: '10:00', title: 'Call with Acme', calendar: 'Work' }, { start: '13:00', end: '14:00', title: 'Gym' }]);
  assert.equal((await todayData(db, NOW, '2026-10')).feeds.calendar_today.data.date, '2026-10-29');
});

const task = (id, project, owner, status, more = {}) => ({ id, title: `Task ${id}`, project, owner, status, createdAt: '2026-10-29T17:00:00Z', minutes: null, due: null, doneAt: null, proofLink: null, ...more });

function fixture() {
  return {
    out: { pages: { projects: {} } },
    by: {},
    cash: { available: false },
    extra: {
      today: {
        tasks: [
          task('t1', 'sponsors', 'sponsors', 'todo'),
          task('t2', 'sponsors', 'jon', 'todo', { due: '2026-10-29' }),
          task('t3', 'sponsors', 'jon', 'waiting_on_jon', { due: '2026-11-02' }),
          task('t4', 'viral-view', 'viral-view', 'waiting_on_jon'),
          task('t5', 'viral-view', 'viral-view', 'done', { doneAt: '2026-10-28T10:00:00Z', proofLink: 'https://jonmac.ai/review/5' }),
          task('t6', 'viral-view', 'viral-view', 'done', { doneAt: '2026-10-01T10:00:00Z' }),
          task('t7', 'sponsors', 'sponsors', 'cancelled'),
          task('t8', null, 'jon', 'doing', { minutes: 30 }),
          task('t9', 'jon-mac', 'video-editor', 'qc', { proofLink: 'D:\\renders\\ep4.mp4' }),
        ],
        questions: [
          { id: 'q1', askedBy: 'sponsors', question: 'Send today?', options: ['Yes'], project: 'sponsors', minutes: 5, createdAt: '2026-10-29T10:00:00Z' },
          { id: 'q2', askedBy: 'home-guide-press', question: 'Which cover?', options: [], project: 'home-guide-press', minutes: null, createdAt: '2026-10-29T11:00:00Z' },
        ],
        approvals: [{ id: 'a1', action: 'post_clips', title: 'Post 3 clips', requestedBy: 'viral-view', payload: { n: 3 }, project: 'viral-view', minutes: null, createdAt: '2026-10-29T12:00:00Z' }],
        feeds: {
          morning_summary: { bot: 'ana', createdAt: '2026-10-29T15:15:00Z', data: { text: 'All good', date: '2026-10-29' } },
          calendar_today: { bot: 'ana', createdAt: '2026-10-29T15:15:00Z', data: { date: '2026-10-29', events: [{ start: '09:30', end: '10:00', title: 'Call' }] } },
        },
      },
    },
  };
}

test('projects page: lanes, counts, board columns, Unsorted, checklist and goal cards', () => {
  const { out, by, cash, extra } = fixture();
  buildProjects(out, by, cash, extra, NOW);
  const p = out.pages.projects;
  const lane = (slug) => p.projects.find((x) => x.slug === slug);
  const col = (slug, key) => lane(slug).columns.find((c) => c.key === key).items.map((i) => i.id);
  assert.deepEqual(p.projects.map((x) => x.slug), [...PROJECTS.map((x) => x.slug), 'unsorted']);
  assert.deepEqual(p.projects.map((x) => x.waiting), [3, 0, 0, 2, 1, 0, 0, 1], 'questions + approvals + waiting_on_jon tasks + open jon tasks');
  assert.deepEqual(lane('sponsors').columns.map((c) => c.label), ['To do', 'Doing', 'Waiting on Jon', 'QC', 'Done']);
  assert.deepEqual([col('sponsors', 'todo'), col('sponsors', 'waiting_on_jon')], [['t1', 't2'], ['t3', 'q1']]);
  assert.deepEqual([col('viral-view', 'waiting_on_jon'), col('viral-view', 'done'), col('jon-mac', 'qc'), col('unsorted', 'doing')], [['t4', 'a1'], ['t5'], ['t9'], ['t8']]);
  const [t1, t2] = lane('sponsors').columns[0].items;
  assert.deepEqual([t1.from, t1.ageLabel, t1.tickUrl, t2.from, t2.tickUrl], ['sponsors', '2 hr ago', undefined, 'Jon', '/dashboard/api/v1/tasks/t2']);
  assert.deepEqual([lane('viral-view').columns[4].items[0].proof, lane('jon-mac').columns[3].items[0].proof], ['https://jonmac.ai/review/5', ''], 'web links only');
  const a1 = lane('viral-view').columns[2].items[1];
  assert.deepEqual([a1.kind, a1.decideUrl, a1.payloadPreview], ['approval', '/dashboard/api/v1/approvals/a1/decide', '{\n  "n": 3\n}'], "Today's approval item");

  assert.deepEqual(p.today.items.map((i) => [i.id, i.project, i.minutes]),
    [['t2', 'Sponsors', 15], ['q1', 'Sponsors', 5], ['a1', 'Viral View', 2], ['q2', 'Home Guide Press', 2], ['t8', 'Unsorted', 30]],
    'questions, approvals, and jon tasks due today or undated (not t3, due later)');
  assert.deepEqual([p.today.minutes, p.today.total], [54, '54 min']);
  assert.deepEqual([p.today.items[0].tickUrl, p.today.items[1].tickUrl, p.today.items[1].page, p.today.items[1].card],
    ['/dashboard/api/v1/tasks/t2', undefined, 'projects/sponsors', '/dashboard/api/v1/questions/q1/answer']);

  assert.deepEqual(p.projects.map((x) => x.goals.map((g) => g.key)), [['sponsors'], [], [], ['viral', 'webinar'], ['ebooks'], [], [], []]);
  assert.deepEqual([p.summary.text, p.calendar.events, p.available], ['All good', [{ time: '09:30-10:00', title: 'Call' }], true]);

  const quiet = fixture();
  quiet.extra.today.tasks = quiet.extra.today.tasks.filter((x) => x.project);
  quiet.extra.today.feeds.calendar_today.data.date = '2026-10-28';
  quiet.extra.today.questions[0].minutes = 90;
  buildProjects(quiet.out, quiet.by, quiet.cash, quiet.extra, NOW);
  const q = quiet.out.pages.projects;
  assert.equal(q.projects.some((x) => x.slug === 'unsorted'), false, 'Unsorted only when it has items');
  assert.deepEqual([q.calendar.missing, q.today.total], ["Ana posts today's calendar each morning.", '1 hr 49 min']);
});

test('snapshot serves Projects from the bot tables, and Jon ticks his task from it', async () => {
  const { env } = await setup();
  const mine = (await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'Sign it', owner: 'jon', project: 'sponsors', minutes: 10 } })).body.task;
  const work = (await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'Draft pitches', project: 'sponsors', status: 'doing' } })).body.task;
  await call(env, 'POST', `/v1/tasks/${work.id}/proofs`, { bot: 'sponsors', body: { kind: 'url', link: 'https://jonmac.ai/review/p1' } });
  await call(env, 'POST', `/v1/tasks/${work.id}/proofs`, { bot: 'sponsors', body: { kind: 'render', link: 'D:\\later.mp4' } });
  const snap = async () => (await (await handleApi(new Request('https://jonmac.ai/dashboard/api/snapshot?pages=projects', { headers: { Cookie: await cookie() } }), env)).json()).pages.projects;
  const p = await snap();
  const sponsors = p.projects[0];
  assert.deepEqual([sponsors.slug, sponsors.waiting, sponsors.goals.map((g) => g.key)], ['sponsors', 1, ['sponsors']]);
  assert.deepEqual(sponsors.columns[1].items.map((i) => [i.title, i.proof]), [['Draft pitches', 'https://jonmac.ai/review/p1']], 'newest web proof');
  assert.deepEqual(p.today.items.map((i) => [i.title, i.minutes]), [['Sign it', 10]]);
  const tick = await call(env, 'PATCH', p.today.items[0].tickUrl.replace('/dashboard/api', ''), { jon: true, body: { status: 'done' } });
  assert.equal(tick.body.task.id, mine.id);
  const after = await snap();
  assert.deepEqual([after.today.items, after.projects[0].columns[4].items.map((i) => i.title), after.projects[0].waiting], [[], ['Sign it'], 0]);
});
