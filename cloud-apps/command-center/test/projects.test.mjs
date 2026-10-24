import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjects, buildChecklist, columnOf, ageLabel } from '../src/projects.js';
import { buildDaily } from '../src/tasks.js';

const NOW = Date.parse('2026-10-24T17:30:00Z'); // 10:30 AM Vancouver
const payload = {
  updated: '2026-10-24T10:00:00-07:00',
  tasks: [
    { id: 'T1', asked: '2026-10-24 08:30', task: 'Doing it', owner: 'Ana / Paul', status: 'doing', project: 'Sponsors', link: '', note: 'half' },
    { id: 'T2', asked: '2026-10-21 10:30', task: 'Needs a look', owner: 'Heston', status: 'waiting_on_jon', project: 'Sponsors', link: 'https://jonmac.ai/r', note: '' },
    { id: 'T3', asked: '2026-10-22 10:30', task: 'Needs an answer', owner: 'Jon', status: 'waiting_on_jon', project: 'Sponsors', link: '', note: '' },
    { id: 'T4', asked: '2026-10-24 10:00', task: 'Stuck', owner: 'Joel', status: 'blocked', project: 'Sponsors', link: 'javascript:alert(1)', note: '' },
    { id: 'T5', asked: 'bogus', task: 'Queued', owner: '', status: 'todo', project: 'Sponsors', link: '', note: '' },
    { id: 'T6', asked: '2026-10-20 10:30', task: 'Shipped', owner: 'Ana', status: 'done', project: 'Sponsors', link: 'https://x.test/p', note: '' },
    { id: 'T7', asked: '2026-10-20 10:30', task: 'Other project', owner: 'Ana', status: 'done', project: 'Brand new', link: '', note: '' },
  ],
};

test('statuses map onto the five columns', () => {
  assert.equal(columnOf('todo', ''), 'upnext');
  assert.equal(columnOf('doing', ''), 'doing');
  assert.equal(columnOf('blocked', ''), 'waiting');
  assert.equal(columnOf('waiting_on_jon', ''), 'waiting');
  assert.equal(columnOf('waiting_on_jon', 'https://a.test'), 'review');
  assert.equal(columnOf('done', ''), 'done');
});

test('a board per project with counts, progress, owner, age and safe links', () => {
  const b = buildProjects(payload, NOW);
  assert.deepEqual(b.projects.map((p) => p.name), ['Sponsors', 'Brand new']);
  const s = b.projects[0];
  assert.deepEqual(s.columns.map((c) => [c.key, c.count]), [['upnext', 1], ['doing', 1], ['waiting', 2], ['review', 1], ['done', 1]]);
  assert.deepEqual([s.done, s.total, s.pct], [1, 6, 17]);
  const doing = s.columns[1].cards[0];
  assert.deepEqual([doing.owner, doing.age, doing.note], ['#ana / #paul', '2h', 'half']);
  assert.equal(s.columns[3].cards[0].link, 'https://jonmac.ai/r');
  assert.equal(s.columns[3].cards[0].age, '3d');
  assert.equal(s.columns[2].cards.find((c) => c.id === 'T4').link, '');
  assert.equal(s.columns[4].cards[0].link, 'https://x.test/p');
  assert.equal(s.needsYou, 2);
  assert.equal(b.total, 7);
});

test('age reads as minutes, hours or days since asked', () => {
  assert.equal(ageLabel('2026-10-24 10:20', NOW), '10m');
  assert.equal(ageLabel('2026-10-24 10:30', NOW), '1m');
  assert.equal(ageLabel('2026-10-23 12:30', NOW), '22h');
  assert.equal(ageLabel('2026-10-19 10:30', NOW), '5d');
  assert.equal(ageLabel('bogus', NOW), '');
});

test('empty or missing tasks.json gives an empty board', () => {
  assert.equal(buildProjects(null, NOW).available, false);
  assert.deepEqual(buildProjects({ tasks: [] }, NOW).projects, []);
});

test('daily checklist: 10 slots, delivered ones done with their review link', () => {
  const daily = buildDaily({
    day: '2026-10-24',
    paul: [{ title: 'Peter video', url: 'https://gpu2.test/p1' }],
    heston: [{ title: 'Clip b04', url: 'https://gpu2.test/c1' }, { title: 'Clip b11', url: 'https://gpu2.test/c2' }],
    inbox: [],
  }, [], NOW);
  const c = buildChecklist(daily);
  assert.deepEqual([c.done, c.total, c.stale], [3, 10, false]);
  assert.deepEqual(c.groups.map((g) => [g.key, g.done, g.target]), [['paul', 1, 6], ['heston', 2, 3], ['inbox', 0, 1]]);
  assert.deepEqual(c.groups[0].items[0], { done: true, title: 'Peter video', url: 'https://gpu2.test/p1' });
  assert.deepEqual(c.groups[0].items[1], { done: false, title: 'Paul video 2', url: '' });
  assert.equal(c.groups[2].items[0].title, 'partners@ report');
});

test('a checklist file dated for another day counts as nothing done', () => {
  const c = buildChecklist(buildDaily({ day: '2026-10-23', paul: [{ title: 'x' }] }, [], NOW));
  assert.deepEqual([c.done, c.total, c.stale], [0, 10, true]);
});

test('mergeSnapshot puts the board and checklist on the projects page', async () => {
  const { mergeSnapshot } = await import('../src/snapshot.js');
  const snapshot = (await import('../fixtures/snapshot.json', { with: { type: 'json' } })).default;
  const data = { ...payload, daily: { day: '2026-10-24', paul: [], heston: [{ title: 'c', url: 'https://g.test/c' }], inbox: [] } };
  const rows = [{ source: 'jon_tasks', data: JSON.stringify(data), collected_at: '2026-10-24T17:00:00Z' }];
  const out = mergeSnapshot(snapshot, rows, NOW, {}, [], [], [], {});
  assert.equal(out.pages.projects.title, 'Projects');
  assert.equal(out.pages.projects.board.projects[0].name, 'Sponsors');
  assert.equal(out.pages.projects.checklist, undefined);
});

test('each project gets its own sidebar: claimed daily slots, deliveries by task id, open tasks', () => {
  const daily = buildDaily({
    day: '2026-10-24',
    paul: [], heston: [{ title: 'Clip b04', url: 'https://gpu2.test/c1' }], inbox: [{ title: 'Report', url: 'https://gpu2.test/r' }],
  }, [], NOW);
  const dels = [
    { task_id: 'T1', title: 'Sponsor page', url: 'https://x.test/sp', finished_at: '2026-10-24T08:00:00-07:00' },
    { task_id: 'T1', title: 'Yesterday', url: 'https://x.test/y', finished_at: '2026-10-23T08:00:00-07:00' },
    { task_id: 'T7', title: 'Other', url: 'https://x.test/o', finished_at: '2026-10-24T08:00:00-07:00' },
  ];
  const b = buildProjects({ ...payload, tasks: [...payload.tasks, { id: 'T8', asked: '2026-10-24 09:00', task: 'Video job', owner: 'Paul', status: 'doing', project: 'YouTube & Video' }] }, NOW, '', daily, dels);
  const sp = b.projects.find((p) => p.name === 'Sponsors').checklist;
  assert.deepEqual(sp.groups.map((g) => g.key), ['inbox', 'delivered']);
  assert.deepEqual([sp.done, sp.total], [2, 2]);
  assert.equal(sp.open.count, 5);
  assert.equal(sp.open.items.some((i) => i.title === 'Shipped'), false);
  const yt = b.projects.find((p) => p.name === 'YouTube & Video').checklist;
  assert.deepEqual(yt.groups.map((g) => g.key), ['paul', 'heston']);
  assert.deepEqual([yt.done, yt.total], [1, 9]);
  const other = b.projects.find((p) => p.name === 'Brand new').checklist;
  assert.deepEqual([other.groups.length, other.total, other.open.count], [1, 1, 0]);
});
