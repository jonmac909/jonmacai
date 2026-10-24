import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { buildDeliverables, normalizeDeliverables } from '../src/tasks.js';
import { buildLanes, normalizeTeam } from '../src/team.js';
import { listDeliverables } from '../src/db.js';
import { mergeSnapshot } from '../src/snapshot.js';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-10-23T16:20:00Z');

function memDb() {
  const team = new Map();
  const deliverables = new Map();
  const approvals = new Map();
  return {
    team, deliverables, approvals,
    prepare(sql) {
      const stmt = {
        args: [],
        bind(...args) { stmt.args = args; return stmt; },
        async run() {
          const a = stmt.args;
          if (sql.includes('DELETE FROM team_bots')) team.clear();
          else if (sql.includes('DELETE FROM approvals')) approvals.delete(a[0]);
          else if (sql.includes('DELETE FROM deliverables')) deliverables.delete(a[0]);
          else if (sql.includes('INSERT OR REPLACE INTO team_bots')) team.set(a[0], { id: a[0], name: a[1], role: a[2], team: a[3], task: a[4], status: a[5], updated_at: a[6], source: a[7], received_at: a[8] });
          else if (sql.includes('INSERT INTO deliverables')) deliverables.set(a[0], { id: a[0], title: a[1], owner: a[2], kind: a[3], url: a[4], finished_at: a[5], source: a[6], updated_at: a[7] });
          else if (sql.includes('INSERT INTO approvals')) approvals.set(a[0], { approved_at: a[1], approved_by: a[2] });
          return { success: true, meta: { changes: 1 } };
        },
        async all() {
          const a = stmt.args;
          if (sql.includes('FROM team_bots')) return { results: [...team.values()] };
          if (sql.includes('SELECT id FROM deliverables WHERE source')) return { results: [...deliverables.values()].filter((d) => d.source === a[0]).map((d) => ({ id: d.id })) };
          if (sql.includes('FROM approvals a')) return { results: [...approvals.entries()].map(([id, ap]) => ({ id, ...(deliverables.get(id) || {}), ...ap })) };
          // Pending read: unapproved rows, any age (listPendingDeliverables).
          if (sql.includes('FROM deliverables d') && !sql.includes('a.approved_by')) {
            return { results: [...deliverables.values()].filter((d) => d.finished_at && !approvals.has(d.id)) };
          }
          // Snapshot read: unapproved rows any age, approved rows in the window.
          if (sql.includes('FROM deliverables d')) {
            const cutoff = a[0];
            return {
              results: [...deliverables.values()]
                .filter((d) => d.finished_at && (!approvals.has(d.id) || approvals.get(d.id).approved_at >= cutoff))
                .map((d) => ({ ...d, ...(approvals.get(d.id) || {}) })),
            };
          }
          return { results: [] };
        },
        async first() {
          const a = stmt.args;
          if (sql.includes('FROM deliverables WHERE id')) return deliverables.get(a[0]) || null;
          if (sql.includes('FROM approvals WHERE deliverable_id')) return approvals.get(a[0]) || null;
          return null;
        },
      };
      return stmt;
    },
  };
}

function req(path, { method = 'GET', cookie, headers = {}, body } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  return new Request(`https://jonmac.ai${path}`, { method, headers: h, body });
}

async function cookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${COOKIE}=${await signSession(SECRET, exp)}`;
}

const envWith = (db) => ({
  SESSION_SECRET: SECRET,
  MACHINE_TOKEN_GPU1: 'gpu1-token-value',
  DB: db,
});

const deliverables = [
  { id: 'd-new', title: 'Affiliate style 3 video', owner: 'Paul', type: 'video', url: 'https://gpu2.tail01c962.ts.net/ad-review/style3/compare.html', finished: '2026-10-23T15:40:00Z' },
  { id: 'd-old', title: 'Old landing page', owner: 'Rene', type: 'page', url: 'https://jonmac.ai/webinar', finished: '2026-10-20T10:00:00Z' },
  { id: 'd-bad', title: 'Bad link', owner: 'Ana', type: 'page', url: 'javascript:alert(1)', finished: '2026-10-23T16:00:00Z' },
];

test('deliverables: unapproved stay however old, approved kept in their own list', () => {
  const rows = normalizeDeliverables(deliverables, 'jon_tasks', '2026-10-23T16:10:00Z');
  const d = buildDeliverables(rows, NOW);
  assert.deepEqual(d.pending.map((r) => r.id).sort(), ['d-bad', 'd-new', 'd-old']);
  assert.equal(d.approvedCount, 0);
  const bad = d.pending.find((r) => r.id === 'd-bad');
  assert.equal(bad.url, '', 'javascript links are dropped');
  assert.equal(bad.typeLabel, 'Landing page');
  assert.equal(bad.owner, 'Ana');
  assert.ok(bad.finished.length > 0, 'finished time has a label');
});

test('the Review lane keeps an old unapproved deliverable until Jon approves it', async () => {
  const lanes = buildLanes(
    [],
    { tasks: [] },
    [{ id: 'd-old', title: 'Old landing page', owner: 'Rene', finished_at: '2026-10-10T10:00:00Z' }],
    NOW,
  );
  assert.deepEqual(lanes[3].items.map((i) => i.id), ['d-old']);
  const db = memDb();
  db.deliverables.set('d-old', { id: 'd-old', title: 'Old landing page', finished_at: '2026-10-10T10:00:00Z' });
  const since = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
  const ids = async () => (await listDeliverables(db, since)).map((r) => r.id);
  assert.deepEqual(await ids(), ['d-old'], 'unapproved stays whatever its age');
  // Approved just now: still returned, measured from the approval, not the finish.
  db.approvals.set('d-old', { approved_at: '2026-10-23T16:00:00Z', approved_by: 'Jon' });
  assert.deepEqual(await ids(), ['d-old'], 'a just-approved old item does not vanish');
  // Approved more than 24 h ago: past the window, so the snapshot no longer returns it.
  db.approvals.set('d-old', { approved_at: '2026-10-20T16:00:00Z', approved_by: 'Jon' });
  assert.deepEqual(await ids(), []);
});

test('deliverables: approved rows leave pending and show who and when', () => {
  const rows = normalizeDeliverables(deliverables, 'jon_tasks', '2026-10-23T16:10:00Z')
    .map((r) => (r.id === 'd-new' ? { ...r, approved_at: '2026-10-23T16:12:00Z', approved_by: 'Jon' } : r));
  const d = buildDeliverables(rows, NOW);
  assert.deepEqual(d.pending.map((r) => r.id).sort(), ['d-bad', 'd-old']);
  assert.deepEqual(d.approved.map((r) => r.id), ['d-new']);
  assert.equal(d.approved[0].approvedBy, 'Jon');
  assert.ok(d.approved[0].approvedWhen.length > 0);
});

test('team roster keeps name, role, team, task, status and updated time', () => {
  const rows = normalizeTeam([
    { name: 'Paul Bocuse', role: 'Long-form video', team: 'Content', task: 'Editing affiliate style 3', status: 'working', updated: '2026-10-23T16:05:00Z' },
    { name: 'Ana', role: 'Chief of staff', team: 'General', task: '', status: 'idle', updated: '2026-10-23T15:00:00Z' },
    { name: '' },
  ], 'jon_tasks', '2026-10-23T16:10:00Z');
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].id, rows[0].team, rows[0].status], ['paul-bocuse', 'Content', 'working']);
  const page = mergeSnapshot(snapshot, [], NOW, {}, [], [], [], { teamRoster: rows });
  const bots = page.pages.team.sections.flatMap((s) => s.bots);
  assert.equal(bots.length, 2);
  const paul = bots.find((b) => b.name === 'Paul Bocuse');
  assert.equal(paul.task, 'Editing affiliate style 3');
  assert.equal(paul.statusLabel, 'Working');
  assert.equal(paul.role, 'Long-form video');
  assert.ok(paul.taskAgo.includes('min ago'));
});

test('snapshot carries the deliverables tab', () => {
  const rows = normalizeDeliverables(deliverables, 'jon_tasks', '2026-10-23T16:10:00Z');
  const page = mergeSnapshot(snapshot, [], NOW, {}, [], [], [], { deliverables: rows });
  assert.equal(page.pages.tasks.deliverables.pendingCount, 3);
  assert.equal(page.pages.tasks.deliverables.available, true);
});

test('ingest accepts team and deliverables, approvals need the machine token', async () => {
  const db = memDb();
  const env = envWith(db);
  const body = JSON.stringify({
    source: 'jon_tasks',
    collectedAt: '2026-10-23T16:10:00Z',
    data: { team: [{ name: 'Paul Bocuse', role: 'Long-form video', team: 'Content', task: 'Editing', status: 'working', updated: '2026-10-23T16:05:00Z' }], deliverables },
  });
  const ing = await handleApi(req('/dashboard/api/ingest', {
    method: 'POST', headers: { Authorization: 'Bearer gpu1-token-value', 'Content-Type': 'application/json' }, body,
  }), env);
  assert.equal(ing.status, 200);
  assert.equal(db.team.size, 1);
  assert.equal(db.deliverables.size, 3);

  const denied = await handleApi(req('/dashboard/api/approvals'), env);
  assert.equal(denied.status, 401);
  const listed = await handleApi(req('/dashboard/api/approvals', { headers: { Authorization: 'Bearer gpu1-token-value' } }), env);
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).approvals, []);
});

test('a push removes rows of its own source that are missing, with their approvals', async () => {
  const db = memDb();
  const env = envWith(db);
  const push = (source, rows) => handleApi(req('/dashboard/api/ingest', {
    method: 'POST', headers: { Authorization: 'Bearer gpu1-token-value', 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, collectedAt: '2026-10-24T16:10:00Z', data: { deliverables: rows } }),
  }), env);
  const row = (id) => ({ id, title: `Item ${id}`, owner: 'Heston', type: 'video', finished: '2026-10-24T08:00:00-07:00' });
  await push('jon_tasks', [row('a'), row('b')]);
  db.deliverables.set('other', { id: 'other', title: 'Other', source: 'review_link', finished_at: '2026-10-24T08:00:00-07:00', updated_at: 'x' });
  db.approvals.set('b', { approved_at: '2026-10-24T09:00:00Z', approved_by: 'jon' });
  db.approvals.set('daily:2026-10-24:paul1', { approved_at: '2026-10-24T09:00:00Z', approved_by: 'jon' });
  await push('jon_tasks', [row('a')]);
  assert.deepEqual([...db.deliverables.keys()].sort(), ['a', 'other']);
  assert.equal(db.approvals.has('b'), false);
  assert.equal(db.approvals.has('daily:2026-10-24:paul1'), true);
});

test('machine read returns the team roster and the pending deliverables', async () => {
  const db = memDb();
  const env = envWith(db);
  const fresh = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  // Deliverables sent at the top level only must still be stored.
  const body = JSON.stringify({
    source: 'jon_tasks',
    collectedAt: '2026-10-23T16:10:00Z',
    data: { team: [{ name: 'Paul Bocuse', role: 'Long-form video', team: 'Content', task: 'Editing', status: 'working', updated: '2026-10-23T16:05:00Z' }] },
    deliverables: [{ id: 'd-top', title: 'Top level page', owner: 'Rene', type: 'page', url: 'https://homeguidepress.com', finished: fresh }],
  });
  const ing = await handleApi(req('/dashboard/api/ingest', {
    method: 'POST', headers: { Authorization: 'Bearer gpu1-token-value', 'Content-Type': 'application/json' }, body,
  }), env);
  assert.equal(ing.status, 200);
  assert.equal(db.deliverables.size, 1, 'top-level deliverables are stored');

  const denied = await handleApi(req('/dashboard/api/pending'), env);
  assert.equal(denied.status, 401);
  const res = await handleApi(req('/dashboard/api/pending', { headers: { Authorization: 'Bearer gpu1-token-value' } }), env);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.team.length, 1);
  assert.equal(out.team[0].name, 'Paul Bocuse');
  assert.deepEqual(out.deliverables.map((d) => d.id), ['d-top']);
  assert.equal(out.deliverables[0].url, 'https://homeguidepress.com');
});

test('Approve records once for a signed-in session and never for a logged-out one', async () => {
  const db = memDb();
  const env = envWith(db);
  await handleApi(req('/dashboard/api/ingest', {
    method: 'POST',
    headers: { Authorization: 'Bearer gpu1-token-value', 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'jon_tasks', collectedAt: '2026-10-23T16:10:00Z', data: { deliverables } }),
  }), env);

  const out = await handleApi(req('/dashboard/api/approvals/d-new', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: '{}',
  }), env);
  assert.equal(out.status, 401);
  assert.equal(db.approvals.size, 0);

  const ck = await cookie();
  const ok = await handleApi(req('/dashboard/api/approvals/d-new', {
    method: 'POST', cookie: ck, headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: '{}',
  }), env);
  assert.equal(ok.status, 200);
  const good = await ok.json();
  assert.equal(good.ok, true);
  assert.equal(good.approvedBy, 'Jon');
  assert.equal(db.approvals.size, 1);

  const again = await handleApi(req('/dashboard/api/approvals/d-new', {
    method: 'POST', cookie: ck, headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: '{}',
  }), env);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true, 'a second press keeps the first record');
  assert.equal(db.approvals.size, 1);

  const missing = await handleApi(req('/dashboard/api/approvals/nope', {
    method: 'POST', cookie: ck, headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: '{}',
  }), env);
  assert.equal(missing.status, 404);

  const listed = await handleApi(req('/dashboard/api/approvals', { headers: { Authorization: 'Bearer gpu1-token-value' } }), env);
  const rows = (await listed.json()).approvals;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'd-new');
  assert.equal(rows[0].title, 'Affiliate style 3 video');
  assert.equal(rows[0].approvedBy, 'Jon');
});
