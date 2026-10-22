import test from 'node:test';
import assert from 'node:assert/strict';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import { buildTasks, askedLabel, updatedLabel } from '../src/tasks.js';
import { mergeSnapshot } from '../src/snapshot.js';

const NOW = Date.parse('2026-10-22T23:30:00Z');
const payload = {
  updated: '2026-10-22T16:24:57-07:00',
  tasks: [
    { id: 'T1', asked: '2026-10-22 06:48', task: 'Done thing', owner: 'Ana', status: 'done', note: 'Shipped', link: '' },
    { id: 'T2', asked: '2026-10-22 15:25', task: 'Needs Jon', owner: 'Paul', status: 'waiting_on_jon', note: 'Needs yes', link: 'https://jonmac.ai/x' },
    { id: 'T3', asked: '2026-10-21 23:10', task: 'Blocked thing', owner: 'Joel', status: 'blocked', note: '', link: 'javascript:alert(1)' },
    { id: 'T4', asked: 'bogus', task: 'Queued thing', owner: '', status: 'oops', note: '', link: '' },
  ],
};

test('groups follow the dashboard order', () => {
  const t = buildTasks(payload, NOW);
  assert.deepEqual(t.groups.map((g) => g.label), ['Needs you', 'Blocked', 'To do', 'Done today']);
  assert.equal(t.total, 4);
  assert.equal(t.done, 1);
  assert.equal(t.groups[2].tasks[0].status, 'todo');
});

test('asked times are clock times today, dated when older', () => {
  assert.equal(askedLabel('2026-10-22 06:48', '2026-10-22'), '6:48 AM');
  assert.equal(askedLabel('2026-10-22 15:25', '2026-10-22'), '3:25 PM');
  assert.equal(askedLabel('2026-10-21 23:10', '2026-10-22'), 'Oct 21 · 11:10 PM');
  assert.equal(askedLabel('bogus', '2026-10-22'), 'bogus');
});

test('updated stamp is Vancouver time and links are http only', () => {
  assert.equal(updatedLabel('2026-10-22T16:24:57-07:00'), '4:24 PM');
  const t = buildTasks(payload, NOW);
  assert.equal(t.groups[0].tasks[0].link, 'https://jonmac.ai/x');
  assert.equal(t.groups[1].tasks[0].link, '');
});

test('empty or missing payload renders an empty board', () => {
  for (const p of [null, undefined, {}, { tasks: [] }]) {
    const t = buildTasks(p, NOW);
    assert.equal(t.available, false);
    assert.deepEqual(t.groups, []);
  }
  assert.equal(buildTasks({ tasks: [{ task: '   ' }] }, NOW).total, 0);
});

test('mergeSnapshot puts the checklist on the home page', () => {
  const rows = [{ source: 'jon_tasks', data: JSON.stringify(payload), collected_at: '2026-10-22T23:24:57Z' }];
  const out = mergeSnapshot(snapshot, rows, NOW, {}, [], [], [], {});
  assert.equal(out.pages.home.tasks.total, 4);
  assert.equal(out.pages.home.tasks.updatedLabel, '4:24 PM');
  assert.equal(out.pages.home.tasks.groups[0].tasks[0].task, 'Needs Jon');
});
