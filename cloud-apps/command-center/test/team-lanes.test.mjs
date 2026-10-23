import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLanes, normalizeTeam } from '../src/team.js';

const NOW = Date.parse('2026-10-23T18:20:00Z'); // 11:20 PT

const roster = normalizeTeam([
  { name: 'Paul Bocuse', role: 'Long-form video', team: 'Content', task: 'Editing video 2', status: 'working', updated: '2026-10-23T18:00:00Z' },
  { name: 'Ana', role: 'Chief of staff', team: 'General', task: 'Coordinating', status: 'working', updated: '2026-10-23T17:00:00Z' },
  { name: 'Alice Waters', role: 'Uploads', team: 'Content', task: 'Waiting on Paul', status: 'idle', updated: '2026-10-23T16:00:00Z' },
  { name: 'René Redzepi', role: 'Funnels', team: 'Business', task: 'Checking pages', status: 'waiting', updated: '2026-10-23T15:00:00Z' },
], 'jon_tasks', '2026-10-23T18:10:00Z');

const tasks = {
  updated: '2026-10-23T11:15:00-07:00',
  tasks: [
    { id: 'T1', asked: '2026-10-23 11:12', task: 'HeyGen sign-in', owner: 'Paul', status: 'waiting_on_jon', note: 'Sign in to HeyGen', link: '' },
    { id: 'T2', asked: '2026-10-22 10:00', task: 'Old blocked job', owner: 'Joel', status: 'blocked', note: '', link: '' },
    { id: 'T3', asked: '2026-10-23 09:00', task: 'Shipped thing', owner: 'Ana', status: 'done', note: '', link: '' },
    { id: 'T4', asked: '2026-10-22 09:00', task: 'Yesterday done', owner: 'Ana', status: 'done', note: '', link: '' },
    { id: 'T5', asked: '2026-10-23 08:00', task: 'Naming the source pages', owner: 'René', status: 'waiting_on_jon', note: '', link: 'https://gpu2.tail01c962.ts.net/ad-review/x/compare.html' },
  ],
};

const deliverables = [
  { id: 'd1', title: 'Dashboard page', owner: 'Joel', kind: 'page', url: 'https://jonmac.ai/dashboard', finished_at: '2026-10-23T16:00:00Z' },
];

test('five lanes in order, from live data only', () => {
  const lanes = buildLanes(roster, tasks, deliverables, NOW);
  assert.deepEqual(lanes.map((l) => l.title), ['Active Agents', 'Waiting', 'Stuck', 'Review', 'Done']);
  assert.deepEqual(lanes.map((l) => l.count), [2, 2, 1, 1, 1]);
  assert.deepEqual(lanes[0].items.map((b) => b.name), ['Ana', 'Paul Bocuse']);
  assert.equal(lanes[0].items[1].title, 'Editing video 2');
});

test('waiting shows the task and what it needs; a named bot is not listed twice', () => {
  const waiting = buildLanes(roster, tasks, deliverables, NOW)[1];
  assert.deepEqual(waiting.items.map((i) => i.kind), ['task', 'task']);
  const hey = waiting.items.find((i) => i.id === 'T1');
  assert.equal(hey.owner, 'Paul');
  assert.equal(hey.note, 'Sign in to HeyGen');
  // René is a waiting bot in the roster, but T5 already names him.
  assert.ok(!waiting.items.some((i) => i.kind === 'bot'));
});

test('a roster waiting bot appears when no task names it', () => {
  const waiting = buildLanes(roster, { tasks: [] }, deliverables, NOW)[1];
  assert.deepEqual(waiting.items.map((i) => i.name), ['René Redzepi']);
  assert.equal(waiting.items[0].title, 'Checking pages');
});

test('review carries the link; done is today only with idle bots folded', () => {
  const lanes = buildLanes(roster, tasks, deliverables, NOW);
  const review = lanes[3].items[0];
  assert.equal(review.title, 'Dashboard page');
  assert.equal(review.href, 'https://jonmac.ai/dashboard');
  const done = lanes[4];
  assert.deepEqual(done.items.map((i) => i.id), ['T3']);
  assert.equal(done.idleCount, 1);
  assert.equal(done.idle[0].name, 'Alice Waters');
});

test('links are http only and a missing one falls back to the Tasks tab', () => {
  const lanes = buildLanes(roster, tasks, deliverables, NOW);
  assert.equal(lanes[1].items.find((i) => i.id === 'T5').link, 'https://gpu2.tail01c962.ts.net/ad-review/x/compare.html');
  const noUrl = buildLanes(roster, tasks, [{ id: 'd2', title: 'No link', owner: 'Ana', finished_at: '2026-10-23T16:00:00Z' }], NOW)[3].items[0];
  assert.equal(noUrl.href, '/dashboard/#tasks');
});

test('a shared first name never hides a bot from Waiting', () => {
  const twoPauls = normalizeTeam([
    { name: 'Paul Bocuse', role: 'Video', team: 'Content', task: 'A', status: 'waiting', updated: '2026-10-23T17:00:00Z' },
    { name: 'Paul Graham (AI)', role: 'Board', team: 'General', task: 'B', status: 'waiting', updated: '2026-10-23T17:00:00Z' },
  ], 'jon_tasks', '2026-10-23T18:10:00Z');
  const lanes = buildLanes(twoPauls, {
    tasks: [{ id: 'X', asked: '2026-10-23 09:00', task: 'Owned by Paul', owner: 'Paul', status: 'waiting_on_jon' }],
  }, [], NOW);
  assert.deepEqual(lanes[1].items.map((i) => i.name || i.id), ['X', 'Paul Bocuse', 'Paul Graham (AI)']);
});

test('a bot with an unknown status still shows in the idle fold', () => {
  const lanes = buildLanes([
    { id: 'ghost', name: 'Ghost Bot', role: '', section: 'General', task: 'No heartbeat', status: 'nodata', taskAt: null },
  ], {}, [], NOW);
  assert.equal(lanes[4].idleCount, 1);
  assert.equal(lanes[4].idle[0].name, 'Ghost Bot');
});

test('empty lanes still come back with a zero count', () => {
  const lanes = buildLanes([], {}, [], NOW);
  assert.equal(lanes.length, 5);
  assert.ok(lanes.every((l) => l.count === 0 && Array.isArray(l.items)));
});
