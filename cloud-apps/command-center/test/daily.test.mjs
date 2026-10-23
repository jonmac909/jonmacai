import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDaily, buildDeliverables, isDailyApprovalId, normalizeDeliverables } from '../src/tasks.js';
import { buildLanes } from '../src/team.js';
import { approveDeliverable } from '../src/db.js';

const NOW = Date.parse('2026-10-23T21:20:00Z'); // 14:20 PT, Oct 23

test('daily rows carry targets and count the items pushed for today', () => {
  const d = buildDaily({
    day: '2026-10-23',
    paul: [{ title: 'V1', url: 'https://x.test/1' }, { title: 'V2' }],
    heston: [{ title: 'P1', url: 'https://x.test/p', text: 'post text' }],
    inbox: [],
  }, [], NOW);
  assert.deepEqual(d.rows.map((r) => [r.key, r.count, r.target, r.met]), [['paul', 2, 6, false], ['heston', 1, 3, false], ['inbox', 0, 1, false]]);
  assert.equal(d.rows[0].id, 'daily:2026-10-23:paul');
  assert.equal(d.rows[1].items[0].text, 'post text');
  assert.equal(d.stale, false);
});

test('a file dated for another day counts as nothing delivered today', () => {
  const d = buildDaily({ day: '2026-10-22', paul: [{ title: 'old' }] }, [], NOW);
  assert.equal(d.rows[0].count, 0);
  assert.equal(d.stale, true);
  assert.equal(buildDaily(null, [], NOW).stale, true);
});

test('daily approvals are matched by day and key', () => {
  const d = buildDaily({ day: '2026-10-23', paul: [{ title: 'V1' }] },
    [{ deliverable_id: 'daily:2026-10-23:paul', approved_at: '2026-10-23T21:00:00Z', approved_by: 'Jon' }], NOW);
  assert.equal(d.rows[0].approved, true);
  assert.equal(d.rows[1].approved, false);
  assert.equal(isDailyApprovalId('daily:2026-10-23:paul'), true);
  assert.equal(isDailyApprovalId('daily:2026-10-23:other'), false);
  assert.equal(isDailyApprovalId('dlv-1'), false);
});

test('approving a daily row needs no deliverables row and keeps the first press', async () => {
  const store = new Map();
  const db = { prepare(sql) {
    const s = { a: [], bind(...a) { s.a = a; return s; },
      async first() { return sql.includes('FROM approvals') ? store.get(s.a[0]) || null : null; },
      async run() { store.set(s.a[0], { approved_at: s.a[1], approved_by: s.a[2] }); return {}; } };
    return s; } };
  const one = await approveDeliverable(db, 'daily:2026-10-23:heston', 'Jon', '2026-10-23T21:00:00Z');
  assert.equal(one.duplicate, false);
  const two = await approveDeliverable(db, 'daily:2026-10-23:heston', 'Jon', '2026-10-23T22:00:00Z');
  assert.equal(two.duplicate, true);
  assert.equal(two.approved_at, '2026-10-23T21:00:00Z');
  assert.equal(await approveDeliverable(db, 'not-a-row', 'Jon', 'x'), null);
});

test('a deliverable whose task is still doing is in progress, not in Review', () => {
  const rows = normalizeDeliverables([
    { id: 'hgp', title: 'Home Guide Press', owner: 'Rene', type: 'landing page', finished: '2026-10-22T17:05:00-07:00', task: 'T005' },
    { id: 'dash', title: 'Dashboard', owner: 'Joel', type: 'page', finished: '2026-10-23T09:28:00-07:00' },
  ], 'jon_tasks', '2026-10-23T20:00:00Z');
  assert.equal(rows[0].task_id, 'T005');
  const doing = { tasks: [{ id: 'T005', status: 'doing', task: 'Home Guide Press', owner: 'Rene' }] };
  const dl = buildDeliverables(rows, NOW, doing);
  assert.deepEqual(dl.pending.map((r) => r.id), ['dash']);
  assert.deepEqual(dl.working.map((r) => r.id), ['hgp']);
  const lanes = buildLanes([], doing, rows, NOW);
  assert.deepEqual(lanes.find((l) => l.key === 'review').items.map((i) => i.id), ['dash']);
  assert.deepEqual(lanes.find((l) => l.key === 'active').items.map((i) => i.id), ['hgp']);
  // once Ana marks the task done or waiting on Jon it returns to Review
  const done = buildDeliverables(rows, NOW, { tasks: [{ id: 'T005', status: 'waiting_on_jon' }] });
  assert.deepEqual(done.pending.map((r) => r.id).sort(), ['dash', 'hgp']);
});
