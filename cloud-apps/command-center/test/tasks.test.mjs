import test from 'node:test';
import assert from 'node:assert/strict';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import { buildTasks, askedLabel, updatedLabel, ownerTag } from '../src/tasks.js';
import { mergeSnapshot } from '../src/snapshot.js';

const NOW = Date.parse('2026-10-22T23:30:00Z');
const payload = {
  updated: '2026-10-22T16:24:57-07:00',
  tasks: [
    { id: 'T1', asked: '2026-10-22 06:48', task: 'Done thing', owner: 'Ana', status: 'done', note: 'Shipped', link: '', project: 'Team & systems' },
    { id: 'T2', asked: '2026-10-22 15:25', task: 'Needs Jon', owner: 'Paul', status: 'waiting_on_jon', note: 'Needs yes', link: 'https://jonmac.ai/x', project: 'Sponsors' },
    { id: 'T3', asked: '2026-10-21 23:10', task: 'Blocked thing', owner: 'Joel', status: 'blocked', note: '', link: 'javascript:alert(1)', project: 'Funnels & webinar' },
    { id: 'T4', asked: 'bogus', task: 'Queued thing', owner: '', status: 'oops', note: '', link: '', project: 'Team & systems' },
    { id: 'T5', asked: '2026-10-22 09:00', task: 'Running thing', owner: 'Ana / Paul', status: 'doing', note: 'Half done', link: '', project: 'YouTube & video' },
  ],
};

test('Active is needs you, then in progress, then blocked; Up next is todo', () => {
  const t = buildTasks(payload, NOW);
  assert.deepEqual(t.active.map((x) => x.id), ['T2', 'T5', 'T3']);
  assert.deepEqual(t.upNext.map((x) => x.id), ['T4']);
  assert.deepEqual(t.doneToday.map((x) => x.id), ['T1']);
  assert.equal(t.needsYou, 1);
  assert.equal(t.done, 1);
  assert.equal(t.total, 5);
});

test('status words and colours follow the design', () => {
  const t = buildTasks(payload, NOW);
  const tone = Object.fromEntries(t.active.concat(t.upNext, t.doneToday).map((x) => [x.id, [x.statusLabel, x.tone]]));
  assert.deepEqual(tone.T2, ['Needs you', 'ok']);
  assert.deepEqual(tone.T5, ['In progress', 'blue']);
  assert.deepEqual(tone.T3, ['Blocked', 'crit']);
  assert.deepEqual(tone.T4, ['To do', 'idle']);
  assert.deepEqual(tone.T1, ['Done', 'idle']);
});

test('asked times are clock times today, dated when older', () => {
  assert.equal(askedLabel('2026-10-22 06:48', '2026-10-22'), '6:48 AM');
  assert.equal(askedLabel('2026-10-22 15:25', '2026-10-22'), '3:25 PM');
  assert.equal(askedLabel('2026-10-21 23:10', '2026-10-22'), 'Oct 21 · 11:10 PM');
  assert.equal(askedLabel('bogus', '2026-10-22'), 'bogus');
});

test('updated stamp reads as time ago', () => {
  assert.equal(updatedLabel('2026-10-22T16:24:57-07:00', NOW), '5 min ago');
  assert.equal(updatedLabel('2026-10-22T16:29:30-07:00', NOW), 'just now');
  assert.equal(updatedLabel('2026-10-22T14:30:00-07:00', NOW), '2 hr ago');
  assert.equal(updatedLabel('2026-10-19T16:30:00-07:00', NOW), '3 days ago');
  assert.equal(updatedLabel('bogus', NOW), '');
});

test('owner tag is a handle, and links are http only', () => {
  assert.equal(ownerTag('Paul'), '#paul');
  assert.equal(ownerTag('Ana / Paul'), '#ana / #paul');
  assert.equal(ownerTag('Heston Blumenthal'), '#heston-blumenthal');
  assert.equal(ownerTag(''), '');
  const t = buildTasks(payload, NOW);
  assert.equal(t.active[0].link, 'https://jonmac.ai/x');
  assert.equal(t.active[2].link, '');
});

test('empty or missing payload renders an empty panel', () => {
  for (const p of [null, undefined, {}, { tasks: [] }]) {
    const t = buildTasks(p, NOW);
    assert.equal(t.available, false);
    assert.deepEqual(t.active, []);
    assert.deepEqual(t.upNext, []);
    assert.deepEqual(t.doneToday, []);
  }
  assert.equal(buildTasks({ tasks: [{ task: '   ' }] }, NOW).total, 0);
});

test('no em dashes anywhere in the panel data', () => {
  assert.equal(JSON.stringify(buildTasks(payload, NOW)).includes('—'), false);
});

test('tasks group by project in the agreed order', () => {
  const t = buildTasks(payload, NOW);
  assert.deepEqual(t.projects.map((p) => p.name), ['YouTube & video', 'Funnels & webinar', 'Sponsors', 'Team & systems']);
  const team = t.projects.find((p) => p.name === 'Team & systems');
  assert.equal(team.activeCount, 0);
  assert.equal(team.upNextCount, 1);
  assert.equal(team.doneCount, 1);
  assert.equal(team.needsYou, 0);
  assert.equal(t.projects.find((p) => p.name === 'Sponsors').needsYou, 1);
});

test('a task with no project lands in Other', () => {
  assert.equal(buildTasks({ tasks: [{ task: 'No project' }] }, NOW).projects[0].name, 'Other');
});

test('mergeSnapshot puts the panel on the tasks page, not Home', () => {
  const rows = [{ source: 'jon_tasks', data: JSON.stringify(payload), collected_at: '2026-10-22T23:24:57Z' }];
  const out = mergeSnapshot(snapshot, rows, NOW, {}, [], [], [], {});
  assert.equal(out.pages.tasks.tasks.total, 5);
  assert.equal(out.pages.tasks.title, 'Tasks');
  assert.equal(out.pages.tasks.tasks.updatedLabel, '5 min ago');
  assert.equal(out.pages.tasks.tasks.projects.find((p) => p.name === 'Sponsors').needsYou, 1);
  assert.equal(out.pages.home.tasks, undefined);
});
