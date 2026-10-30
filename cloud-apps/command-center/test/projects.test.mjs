import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../src/api.js';
import { sha256Hex, todayData } from '../src/bots.js';
import { buildProjects, PROJECTS } from '../src/projects.js';
import { render as renderProjects } from '../public/js/pages/projects.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const BOTS = ['ana', 'sponsors', 'qc', 'developer', 'jon-mac-youtube', 'video-editor', 'viral-view', 'home-guide-press', 'short-form', 'accounting'];
const TOK = Object.fromEntries(BOTS.map((b) => [b, `ccb_${b.padEnd(43, 'x')}`]));
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
  // A bot task can't be handed to Jon to tick and taken back as done with no proof (review, 2026-10-29).
  assert.equal((await call(env, 'PATCH', `/v1/tasks/${bots.id}`, { bot: 'sponsors', body: { owner: 'jon' } })).status, 400);
  assert.equal((await call(env, 'PATCH', `/v1/tasks/${mine.id}`, { bot: 'sponsors', body: { owner: 'me' } })).status, 400);
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
          daily_checklists: { bot: 'ana', createdAt: '2026-10-29T15:00:00Z', data: { projects: {
            sponsors: ['Sort partners@', 'Chase payments', 'Find 5 leads'],
            'jon-mac': ['Edit pack handed over'],
            jonmacai: ['Edit pack handed over', 'AI clips made'],
          } } },
        },
        dailyTicks: [
          { day: '2026-10-29', project: 'sponsors', item: 'Sort partners@', bot: 'sponsors', link: 'https://jonmac.ai/review/s1', note: null, createdAt: '2026-10-29T17:00:00Z' },
          { day: '2026-10-29', project: 'sponsors', item: 'Chase payments', bot: 'sponsors', link: 'D:\\drafts\\chase.txt', note: 'sent 2', createdAt: '2026-10-29T18:30:00Z' },
          { day: '2026-10-29', project: 'jon-mac', item: 'Edit pack handed over', bot: 'video-editor', link: 'javascript:alert(1)', note: null, createdAt: '2026-10-29T18:00:00Z' },
        ],
      },
    },
  };
}

test('projects page: lanes, counts, board columns, Unsorted and goal cards; no mixed checklist', () => {
  const { out, by, cash, extra } = fixture();
  buildProjects(out, by, cash, extra, NOW);
  const p = out.pages.projects;
  const lane = (slug) => p.projects.find((x) => x.slug === slug);
  const col = (slug, key) => lane(slug).columns.find((c) => c.key === key).items.map((i) => i.id);
  assert.deepEqual(p.projects.map((x) => x.slug), [...PROJECTS.map((x) => x.slug), 'unsorted']);
  assert.deepEqual(p.projects.map((x) => [x.label, x.waiting]), [['Sponsors', 3], ['YT-JM', 0], ['YT-AI UGC', 0], ['Viral View', 2], ['Home Guide Press', 1],
    ['Short-form', 0], ['Accounting', 0], ['Coding', 0], ['Unsorted', 1]], 'questions + approvals + waiting_on_jon tasks + open jon tasks');
  assert.deepEqual(lane('sponsors').columns.map((c) => c.label), ['To do', 'Doing', 'Waiting on Jon', 'QC', 'Done']);
  assert.deepEqual([col('sponsors', 'todo'), col('sponsors', 'waiting_on_jon')], [['t1', 't2'], ['t3', 'q1']]);
  assert.deepEqual([col('viral-view', 'waiting_on_jon'), col('viral-view', 'done'), col('jon-mac', 'qc'), col('unsorted', 'doing')], [['t4', 'a1'], ['t5'], ['t9'], ['t8']]);
  const [t1, t2] = lane('sponsors').columns[0].items;
  assert.deepEqual([t1.from, t1.ageLabel, t1.tickUrl, t2.from, t2.tickUrl], ['sponsors', '2 hr ago', undefined, 'Jon', '/dashboard/api/v1/tasks/t2']);
  assert.deepEqual([lane('viral-view').columns[4].items[0].proof, lane('jon-mac').columns[3].items[0].proof], ['https://jonmac.ai/review/5', ''], 'web links only');
  const a1 = lane('viral-view').columns[2].items[1];
  assert.deepEqual([a1.kind, a1.decideUrl, a1.payloadPreview], ['approval', '/dashboard/api/v1/approvals/a1/decide', '{\n  "n": 3\n}'], "Today's approval item");
  assert.deepEqual(p.projects.map((x) => x.goals.map((g) => g.key)), [['sponsors'], [], [], ['viral', 'webinar'], ['ebooks'], [], [], [], []]);
  assert.deepEqual([p.summary.text, p.calendar.events, p.available, p.today], ['All good', [{ time: '09:30-10:00', title: 'Call' }], true, undefined]);

  const quiet = fixture();
  quiet.extra.today.tasks = quiet.extra.today.tasks.filter((x) => x.project);
  quiet.extra.today.feeds.calendar_today.data.date = '2026-10-28';
  buildProjects(quiet.out, quiet.by, quiet.cash, quiet.extra, NOW);
  const q = quiet.out.pages.projects;
  assert.equal(q.projects.some((x) => x.slug === 'unsorted'), false, 'Unsorted only when it has items');
  assert.equal(q.calendar.missing, "Ana posts today's calendar each morning.");
});

test('daily checklist: each tab shows only its own items, ticked by today\'s ticks; Unsorted has none', () => {
  const { out, by, cash, extra } = fixture();
  buildProjects(out, by, cash, extra, NOW);
  const p = out.pages.projects;
  const daily = (slug) => p.projects.find((x) => x.slug === slug).checklist;
  assert.deepEqual(daily('sponsors'), { done: 2, total: 3, items: [
    { text: 'Sort partners@', done: true, by: 'sponsors', ageLabel: '2 hr ago', link: 'https://jonmac.ai/review/s1' },
    { text: 'Chase payments', done: true, by: 'sponsors', ageLabel: '30 min ago', link: 'D:\\drafts\\chase.txt' },
    { text: 'Find 5 leads', done: false },
  ] });
  assert.deepEqual(daily('jon-mac').items.map((i) => [i.text, i.done]), [['Edit pack handed over', true]]);
  assert.deepEqual(daily('jonmacai').items.map((i) => [i.text, i.done]), [['Edit pack handed over', false], ['AI clips made', false]], 'a tick counts for its own project only');
  assert.deepEqual(daily('coding'), { missing: 'Ana syncs the daily checklist with dash.py daily-sync' }, 'no items for this tab');
  assert.equal(daily('unsorted'), undefined);

  // The renderer: read-only boxes, done/total, who and when, and only web proof links open.
  const card = (sub, page = p) => renderProjects(page, {}, sub).split('pjright')[1].split('<div class="card pad">').find((c) => c.includes('Daily checklist')) || '';
  const s = card('sponsors');
  assert.match(s, /<h2>Daily checklist<\/h2><span class="meta">2\/3<\/span>/);
  assert.equal((s.match(/<input type="checkbox" disabled[ >]/g) || []).length, 3, 'every item has a disabled box');
  assert.equal((s.match(/<input /g) || []).length, 3);
  assert.equal((s.match(/ checked>/g) || []).length, 2);
  assert.match(s, /<input type="checkbox" disabled checked><span><a href="https:\/\/jonmac.ai\/review\/s1" target="_blank" rel="noopener">Sort partners@<\/a><span class="pjm">sponsors<i>·<\/i>2 hr ago<\/span><\/span>/);
  assert.match(s, /<input type="checkbox" disabled checked><span>Chase payments<span class="pjm">sponsors<i>·<\/i>30 min ago<i>·<\/i>D:\\drafts\\chase.txt<\/span><\/span>/, 'a file path is plain text');
  assert.match(s, /<input type="checkbox" disabled><span>Find 5 leads<\/span><\/label>/);
  assert.doesNotMatch(s, /Edit pack|AI clips|data-ttick|data-card/, "only this tab's items, and no tick buttons");
  const jm = card('jon-mac');
  assert.match(jm, /<span class="meta">1\/1<\/span>/);
  assert.doesNotMatch(jm, /<a |href/, 'http(s) links only');
  assert.match(jm, /video-editor<i>·<\/i>1 hr ago<i>·<\/i>javascript:alert\(1\)/);
  assert.equal(card('unsorted'), '', 'Unsorted shows no checklist');

  const none = fixture();
  delete none.extra.today.feeds.daily_checklists;
  buildProjects(none.out, none.by, none.cash, none.extra, NOW);
  assert.match(card('sponsors', none.out.pages.projects), /<h2>Daily checklist<\/h2><\/div><p class="muted">Ana syncs the daily checklist with dash.py daily-sync<\/p>/);
});

test('daily_checklists feed: ana or developer, known projects, at most 12 items of 200 characters, no repeats', async () => {
  const { env } = await setup();
  const put = (bot, body) => call(env, 'PUT', '/v1/feeds/daily_checklists', { bot, body });
  assert.equal((await put('sponsors', { projects: { sponsors: ['x'] } })).status, 403);
  for (const projects of [undefined, null, [], 'x', { webinar: ['x'] }, { unsorted: ['x'] }, { sponsors: 'x' }, { sponsors: Array.from({ length: 13 }, (_, i) => `item ${i}`) },
    { sponsors: [''] }, { sponsors: ['  '] }, { sponsors: [5] }, { sponsors: ['x'.repeat(201)] }, { sponsors: ['Chase', ' chase '] }]) {
    assert.equal((await put('ana', { projects })).status, 400, JSON.stringify(projects));
  }
  const twelve = Array.from({ length: 12 }, (_, i) => `item ${i + 1}`);
  const ok = await put('ana', { projects: { sponsors: [' Sort partners@ ', 'x'.repeat(200)], coding: twelve, accounting: [] } });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.feed.data.projects, { sponsors: ['Sort partners@', 'x'.repeat(200)], coding: twelve, accounting: [] });
  assert.equal((await put('developer', { projects: { coding: ['Live sites checked'] } })).status, 201);
  assert.deepEqual((await call(env, 'GET', '/v1/feeds/daily_checklists', { jon: true })).body.feed.data, { projects: { coding: ['Live sites checked'] } }, 'newest wins');
});

const TICKERS = {
  sponsors: ['sponsors'], 'jon-mac': ['jon-mac-youtube', 'video-editor'], jonmacai: ['jon-mac-youtube', 'video-editor'], 'viral-view': ['viral-view'],
  'home-guide-press': ['home-guide-press'], 'short-form': ['short-form'], accounting: ['accounting'], coding: ['developer'],
};

test('POST /v1/daily: only the owning bot ticks, by item text or number, with a proof link; again the same day updates it', async () => {
  const { env } = await setup();
  const tick = (body, bot = 'sponsors') => call(env, 'POST', '/v1/daily', { bot, body: { project: 'sponsors', link: 'https://jonmac.ai/review/1', ...body } });
  const early = await tick({ item: 1 });
  assert.deepEqual([early.status, early.body.error.endsWith('none yet')], [400, true], 'nothing to tick before daily-sync');

  // Who ticks what: every bot against every project.
  assert.deepEqual(Object.keys(TICKERS), PROJECTS.map((x) => x.slug));
  await call(env, 'PUT', '/v1/feeds/daily_checklists', { bot: 'ana', body: { projects: Object.fromEntries(PROJECTS.map((x) => [x.slug, [`${x.label} daily`]])) } });
  for (const [project, ok] of Object.entries(TICKERS)) {
    let first = true;  // on a shared tab the first allowed bot ticks; the next can't overwrite it
    for (const bot of BOTS) {
      const want = !ok.includes(bot) ? 403 : first ? 200 : 409;
      if (ok.includes(bot)) first = false;
      assert.equal((await tick({ project, item: 1 }, bot)).status, want, `${bot} on ${project}`);
    }
  }
  assert.equal((await call(env, 'POST', '/v1/daily', { jon: true, body: { project: 'sponsors', item: 1, link: 'https://x.test/p' } })).status, 403, 'Jon only reads');
  assert.equal((await handleApi(new Request('https://jonmac.ai/dashboard/api/v1/daily'), env)).status, 401);
  const all = (await call(env, 'GET', '/v1/daily', { jon: true })).body.ticks;
  assert.deepEqual(all.map((x) => [x.project, x.item, x.bot]).sort(), PROJECTS.map((x) => [x.slug, `${x.label} daily`, BOTS.find((b) => TICKERS[x.slug].includes(b))]).sort(), 'one row per item; a second bot cannot overwrite it');

  await call(env, 'PUT', '/v1/feeds/daily_checklists', { bot: 'ana', body: { projects: { sponsors: ['Sort partners@ and draft replies', 'Chase overdue payments (drafts)'] } } });
  const byText = await tick({ item: '  chase OVERDUE payments (DRAFTS) ' });
  assert.deepEqual([byText.status, byText.body.tick.item, byText.body.tick.bot], [200, 'Chase overdue payments (drafts)', 'sponsors'], 'stored as the canonical text');
  for (const item of [1, '1', ' 1 ']) assert.equal((await tick({ item })).body.tick.item, 'Sort partners@ and draft replies', JSON.stringify(item));
  for (const item of [0, 3, '1.0', 'Chase overdue', '', null]) assert.equal((await tick({ item })).status, 400, JSON.stringify(item));
  for (const project of ['webinar', 'unsorted', '']) assert.equal((await tick({ project, item: 1 })).status, 400, project);
  for (const link of [undefined, '', 'ftp://x/y', 'javascript:alert(1)', 'jonmac.ai/review', '//host/x']) assert.equal((await tick({ item: 1, link })).status, 400, String(link));
  assert.equal((await tick({ item: 1, link: 'D:\\renders\\sort.png' })).status, 200, 'a file path is proof too');

  await tick({ item: 1, link: 'https://jonmac.ai/review/2', note: 'second pass' });
  const rows = async () => (await call(env, 'GET', `/v1/daily?day=${all[0].day}`, { bot: 'qc' })).body.ticks.filter((x) => x.project === 'sponsors' && x.item.startsWith('Sort'));
  assert.deepEqual((await rows()).map((x) => [x.link, x.note]), [['https://jonmac.ai/review/2', 'second pass']], 'the last tick that day wins');
  await tick({ item: 1, link: 'https://jonmac.ai/review/3' });
  assert.deepEqual((await rows()).map((x) => [x.link, x.note]), [['https://jonmac.ai/review/3', null]]);
  assert.equal((await call(env, 'GET', '/v1/daily?day=2026-13-01', { bot: 'sponsors' })).status, 400);
});

test('daily ticks reset at midnight PT: a tick counts only on the day it was made', async (t) => {
  const { env, db } = await setup();
  const at = (iso) => t.mock.timers.setTime(Date.parse(iso));
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-30T06:59:00Z') }); // Thu Oct 29, 23:59 PT
  await call(env, 'PUT', '/v1/feeds/daily_checklists', { bot: 'ana', body: { projects: { sponsors: ['Sort partners@', 'Chase payments'] } } });
  const tick = () => call(env, 'POST', '/v1/daily', { bot: 'sponsors', body: { project: 'sponsors', item: 1, link: 'https://jonmac.ai/review/1' } });
  const page = async () => {
    const out = { pages: { projects: {} } };
    buildProjects(out, {}, { available: false }, { today: await todayData(db, Date.now(), '2026-10') }, Date.now());
    return out.pages.projects.projects[0].checklist;
  };
  assert.equal((await tick()).body.tick.day, '2026-10-29');
  assert.deepEqual([(await page()).done, (await page()).items[0].by], [1, 'sponsors']);

  at('2026-10-30T07:01:00Z'); // Fri Oct 30, 00:01 PT
  assert.deepEqual([(await page()).done, (await page()).items[0].done], [0, false], 'a new day starts unticked');
  assert.deepEqual((await call(env, 'GET', '/v1/daily', { jon: true })).body, { ok: true, day: '2026-10-30', ticks: [] });
  assert.equal((await tick()).body.tick.day, '2026-10-30', "a new row, not yesterday's");
  assert.equal((await page()).done, 1);
  assert.equal((await call(env, 'GET', '/v1/daily?day=2026-10-29', { jon: true })).body.ticks.length, 1, 'yesterday is kept');
});

test('dash.py daily-sync reads "## <tab label>" sections and "- item" lines; the Worker accepts the result', async () => {
  const sample = [
    '# Daily checklists (Jon, 2026-10-29)',
    'One checklist per project tab. The owning bot ticks an item with `dash.py`.',
    '- before any tab: ignored',
    '',
    '## Sponsors',
    '- Sort partners@ and draft replies',
    '-   ',
    '- Chase overdue payments (drafts)',
    'not an item',
    '',
    '## YT-JM',
    '- Edit pack handed to Video Editor',
    '  - indented: ignored',
    '* star: ignored',
    '',
    '## Webinar',
    '- unknown tab: ignored',
    '',
    '## Coding ',
    '- Live sites checked',
    '',
    ...['YT-AI UGC', 'Viral View', 'Home Guide Press', 'Short-form', 'Accounting'].flatMap((t) => [`## ${t}`, `- ${t} daily`]),
    "The video tabs' \"Finished render\" item needs Video Editor's render.",
  ].join('\r\n');
  const dir = mkdtempSync(join(tmpdir(), 'daily-'));
  writeFileSync(join(dir, 'sample.md'), sample);
  writeFileSync(join(dir, 'empty.md'), '# Nothing\n- no tabs\n');
  writeFileSync(join(dir, 'typo.md'), sample.replace('## YT-AI UGC', '## YT AI UGC'));
  const code = [
    'import json, sys, dash',
    'def refused(path):',
    '    try:',
    '        dash.daily_lists(path)',
    '        return 0',
    '    except dash.Fail as err:',
    '        return err.code',
    'print(json.dumps({"lists": dash.daily_lists(sys.argv[1]), "labels": list(dash.LABELS.items()),',
    '                  "empty": refused(sys.argv[2]), "typo": refused(sys.argv[3])}))',
  ].join('\n');
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const bots = join(dirname(fileURLToPath(import.meta.url)), '..', 'bots');
  const r = spawnSync(py, ['-c', code, join(dir, 'sample.md'), join(dir, 'empty.md'), join(dir, 'typo.md')], { encoding: 'utf8', cwd: bots });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.deepEqual(got.lists, {
    sponsors: ['Sort partners@ and draft replies', 'Chase overdue payments (drafts)'],
    'jon-mac': ['Edit pack handed to Video Editor'],
    coding: ['Live sites checked'],
    jonmacai: ['YT-AI UGC daily'],
    'viral-view': ['Viral View daily'],
    'home-guide-press': ['Home Guide Press daily'],
    'short-form': ['Short-form daily'],
    accounting: ['Accounting daily'],
  });
  assert.deepEqual(got.labels, PROJECTS.map((x) => [x.label, x.slug]), 'same labels and slugs as PROJECTS');
  assert.equal(got.empty, 2, 'a file with no tab items is refused locally');
  assert.equal(got.typo, 2, 'a typo in a tab heading is refused, so that tab is never emptied');
  const { env } = await setup();
  assert.equal((await call(env, 'PUT', '/v1/feeds/daily_checklists', { bot: 'ana', body: { projects: got.lists } })).status, 201);
});

test('snapshot serves Projects from the bot tables: the board with Jon\'s tick, and each tab\'s daily checklist', async () => {
  const { env } = await setup();
  const mine = (await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'Sign it', owner: 'jon', project: 'sponsors', minutes: 10 } })).body.task;
  const work = (await call(env, 'POST', '/v1/tasks', { bot: 'sponsors', body: { title: 'Draft pitches', project: 'sponsors', status: 'doing' } })).body.task;
  await call(env, 'POST', `/v1/tasks/${work.id}/proofs`, { bot: 'sponsors', body: { kind: 'url', link: 'https://jonmac.ai/review/p1' } });
  await call(env, 'POST', `/v1/tasks/${work.id}/proofs`, { bot: 'sponsors', body: { kind: 'render', link: 'D:\\later.mp4' } });
  await call(env, 'PUT', '/v1/feeds/daily_checklists', { bot: 'ana', body: { projects: { sponsors: ['Sort partners@', 'Chase payments'], coding: ['Live sites checked'] } } });
  assert.equal((await call(env, 'POST', '/v1/daily', { bot: 'sponsors', body: { project: 'sponsors', item: 2, link: 'https://jonmac.ai/review/c1' } })).status, 200);
  const snap = async () => (await (await handleApi(new Request('https://jonmac.ai/dashboard/api/snapshot?pages=projects', { headers: { Cookie: await cookie() } }), env)).json()).pages.projects;
  const p = await snap();
  const sponsors = p.projects[0];
  assert.deepEqual([sponsors.slug, sponsors.waiting, sponsors.goals.map((g) => g.key)], ['sponsors', 1, ['sponsors']]);
  assert.deepEqual(sponsors.columns[1].items.map((i) => [i.title, i.proof]), [['Draft pitches', 'https://jonmac.ai/review/p1']], 'newest web proof');
  assert.deepEqual(sponsors.checklist.items.map((i) => [i.text, i.done, i.by ?? null, i.link ?? null]),
    [['Sort partners@', false, null, null], ['Chase payments', true, 'sponsors', 'https://jonmac.ai/review/c1']]);
  assert.deepEqual(p.projects.find((x) => x.slug === 'coding').checklist.items.map((i) => [i.text, i.done]), [['Live sites checked', false]]);
  assert.equal(p.today, undefined, 'no mixed checklist');
  const tick = await call(env, 'PATCH', sponsors.columns[0].items[0].tickUrl.replace('/dashboard/api', ''), { jon: true, body: { status: 'done' } });
  assert.equal(tick.body.task.id, mine.id);
  const after = (await snap()).projects[0];
  assert.deepEqual([after.columns[4].items.map((i) => i.title), after.waiting], [['Sign it'], 0]);
});
