// POST /v1/tasks/:id/close (Jon, 2026-11-11): Ana (and the dispatcher, as ana) closes an internal card in review
// whose newest proof QC passed. Video, sponsor and money cards, and every other bot, are refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { sqliteD1 } from './sqlited1.mjs';

const TOKENS = { ana: `ccb_${'a'.repeat(43)}`, developer: `ccb_${'d'.repeat(43)}`, qc: `ccb_${'q'.repeat(43)}` };
const ID = 't_0123456789abcdef';

function call(env, method, path, { bot, body } = {}) {
  const headers = new Headers();
  if (bot) headers.set('Authorization', `Bearer ${TOKENS[bot]}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const init = { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
  return handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, init), env).then(async (r) => ({ status: r.status, body: await r.json() }));
}

// One card plus its proofs ([status, created_at] oldest first) and an optional "sent back by Jon" event.
async function setup({ status = 'review', owner = 'developer', project = 'coding', stage = null, proofs = [['passed', '2026-11-11T10:00:00Z']], sentBack } = {}) {
  const db = sqliteD1();
  for (const [bot, token] of Object.entries(TOKENS)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), bot, '2026-11-01T00:00:00.000Z').run();
  }
  await db.prepare(`INSERT INTO bot_tasks (id, title, owner, status, project, stage, created_by, updated_by, created_at, updated_at)
    VALUES (?, 'Dashboard tool fix', ?, ?, ?, ?, 'ana', 'ana', '2026-11-11T09:00:00Z', '2026-11-11T09:00:00Z')`).bind(ID, owner, status, project, stage).run();
  let n = 0;
  for (const [s, at] of proofs) {
    await db.prepare(`INSERT INTO bot_proofs (id, task_id, kind, link, status, created_by, created_at, checked_by, checked_at)
      VALUES (?, ?, 'test', 'https://example.com/p', ?, 'developer', ?, ?, ?)`)
      .bind(`p_${String(n++).padStart(16, '0')}`, ID, s, at, s === 'pending' ? null : 'qc', s === 'pending' ? null : at.replace('T10', 'T10').replace(/:00Z$/, ':30Z')).run();
  }
  if (sentBack) {
    await db.prepare(`INSERT INTO bot_task_events (id, task_id, at, "by", kind, detail) VALUES ('e_1', ?, ?, 'jon', 'status', 'status review → doing (sent back by Jon)')`).bind(ID, sentBack).run();
  }
  return { db, env: { DB: db, SESSION_SECRET: 'test-session-secret-32-bytes-ok!' } };
}

const close = (env, bot = 'ana', body = {}) => call(env, 'POST', `/tasks/${ID}/close`, { bot, body });
const statusOf = async (env) => (await call(env, 'GET', `/tasks/${ID}`, { bot: 'ana' })).body.task;

test('an internal card in review with a QC-passed newest proof closes, with the note in its history', async () => {
  const { env } = await setup();
  const r = await close(env, 'ana', { note: 'PR merged and deployed' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.task.status, r.body.task.updatedBy, typeof r.body.task.doneAt], ['done', 'ana', 'string']);
  const card = await statusOf(env);
  assert.ok(card.history.some((h) => h.by === 'ana' && h.detail === 'status review → done (auto-closed: QC passed and live. PR merged and deployed)'));
});

test('planted faults: video, sponsor and money cards are refused and stay in review', async () => {
  const cases = [
    { owner: 'video-editor', project: 'home-guide-press' }, { owner: 'jon-mac-youtube', project: 'jon-mac' },
    { owner: 'hgp-scripts' }, { owner: 'home-guide-press' }, { stage: 'edit' }, { stage: 'publish' }, { stage: 'sponsor review' },
    { owner: 'sponsors', project: 'sponsors' }, { project: 'sponsors' }, { owner: 'accounting', project: 'accounting' }, { project: 'accounting' },
  ];
  for (const c of cases) {
    const { env } = await setup(c);
    const r = await close(env);
    assert.equal(r.status, 403, JSON.stringify(c));
    assert.equal((await statusOf(env)).status, 'review', JSON.stringify(c));
  }
});

test('planted faults: allowlist and case/whitespace: unlisted owner plus non-internal project is refused', async () => {
  const cases = [
    { owner: 'new-video-bot', project: 'home-guide-press' }, { owner: 'cash-bot', project: 'money' },
    { owner: 'developer', project: 'viral-view' }, { owner: 'developer', project: null }, { owner: 'developer', project: 'unsorted' },
    { owner: 'Video-Editor', project: 'coding' }, { owner: ' JON ', project: 'coding' }, { owner: 'developer', project: ' Sponsors ' },
    { stage: 'EDIT' }, { stage: ' Sponsor Review ' }, { owner: 'developer', project: 'Accounting' },
  ];
  for (const c of cases) {
    const { env } = await setup(c);
    const r = await close(env);
    assert.equal(r.status, 403, JSON.stringify(c));
    assert.equal((await statusOf(env)).status, 'review', JSON.stringify(c));
  }
  const { env } = await setup({ project: ' Coding ', owner: 'Developer' });
  assert.equal((await close(env)).status, 200);
});

test('ms vs no-ms timestamps in the same second cannot flip the order', async () => {
  // checked at 10:00:01Z, sent back at 10:00:01.500Z: same second, refused (raw string compare would have closed it)
  let { env, db } = await setup({ proofs: [['passed', '2026-11-11T10:00:00Z']], sentBack: '2026-11-11T10:00:30.500Z' });
  assert.equal((await close(env)).status, 409);
  // checked 10:00:30Z vs sent back 10:00:30.500Z
  ({ env } = await setup({ proofs: [['passed', '2026-11-11T10:00:00Z']], sentBack: '2026-11-11T10:00:30.000Z' }));
  assert.equal((await close(env)).status, 409);
  // genuinely later with ms: closes
  ({ env } = await setup({ proofs: [['passed', '2026-11-11T10:01:00.250Z']], sentBack: '2026-11-11T10:00:00Z' }));
  assert.equal((await close(env)).status, 200);
});

test('planted faults: no passed proof, or a newer proof pending or failed, is refused', async () => {
  const cases = [
    { proofs: [] },
    { proofs: [['pending', '2026-11-11T10:00:00Z']] },
    { proofs: [['failed', '2026-11-11T10:00:00Z']] },
    { proofs: [['passed', '2026-11-11T10:00:00Z'], ['pending', '2026-11-11T11:00:00Z']] },
    { proofs: [['passed', '2026-11-11T10:00:00Z'], ['failed', '2026-11-11T11:00:00Z']] },
    { proofs: [['passed', '2026-11-11T10:00:00Z']], sentBack: '2026-11-11T12:00:00Z' }, // passed before Jon sent it back
  ];
  for (const c of cases) {
    const { env } = await setup(c);
    const r = await close(env);
    assert.equal(r.status, 409, JSON.stringify(c));
    assert.equal((await statusOf(env)).status, 'review', JSON.stringify(c));
  }
});

test('planted faults: a card not in review is refused', async () => {
  for (const status of ['todo', 'doing', 'waiting_on_jon', 'qc', 'done', 'cancelled']) {
    const { env } = await setup({ status });
    assert.equal((await close(env)).status, 409, status);
    assert.equal((await statusOf(env)).status, status);
  }
});

test('planted faults: developer, qc and no token are refused; PATCH done stays refused for ana', async () => {
  const { env } = await setup();
  assert.equal((await close(env, 'developer')).status, 403);
  assert.equal((await close(env, 'qc')).status, 403);
  assert.equal((await call(env, 'POST', `/tasks/${ID}/close`, { body: {} })).status, 401);
  assert.equal((await call(env, 'PATCH', `/tasks/${ID}`, { bot: 'ana', body: { status: 'done' } })).status, 403);
  assert.equal((await statusOf(env)).status, 'review');
});
