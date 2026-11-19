// Review gate (CORE "Done means proof", card t_7faa27c7620e4c4c): a card goes to Review only when its NEWEST proof
// passed QC (since Jon last sent it back), passed by QC (or Ana), not by its poster or the card's owner, with an
// https link Jon can open. Internal coding cards skip only the https part (they close by themselves).
// Planted faults: the two real past false dones replay here, with the old rule letting each through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { sqliteD1 } from './sqlited1.mjs';

const BOTS = ['ana', 'qc', 'developer', 'video-editor', 'viral-view', 'sponsors'];
const TOKENS = Object.fromEntries(BOTS.map((b, i) => [b, `ccb_${String.fromCharCode(97 + i).repeat(43)}`]));

function call(env, method, path, { bot, body } = {}) {
  const headers = new Headers();
  if (bot) headers.set('Authorization', `Bearer ${TOKENS[bot]}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const init = { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
  return handleApi(new Request(`https://jonmac.ai/dashboard/api/v1${path}`, init), env).then(async (r) => ({ status: r.status, body: await r.json() }));
}

// One card as it stood at a moment: proofs {id, status, by, at, checkedBy, checkedAt, link}, events {at, by, detail}.
async function seed({ id = 't_0123456789abcdef', title = 'Card', owner = 'developer', status = 'qc', project = null, stage = null, proofs = [], events = [] }) {
  const db = sqliteD1();
  for (const [bot, token] of Object.entries(TOKENS)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), bot, '2026-11-01T00:00:00.000Z').run();
  }
  await db.prepare(`INSERT INTO bot_tasks (id, title, owner, status, project, stage, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'ana', 'ana', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`).bind(id, title, owner, status, project, stage).run();
  for (const p of proofs) {
    await db.prepare(`INSERT INTO bot_proofs (id, task_id, kind, link, status, created_by, created_at, checked_by, checked_at)
      VALUES (?, ?, 'url', ?, ?, ?, ?, ?, ?)`).bind(p.id, id, p.link, p.status, p.by, p.at, p.checkedBy ?? null, p.checkedAt ?? null).run();
  }
  let n = 0;
  for (const e of events) {
    await db.prepare('INSERT INTO bot_task_events (id, task_id, at, "by", kind, detail) VALUES (?, ?, ?, ?, \'status\', ?)')
      .bind(`e_${n++}`, id, e.at, e.by, e.detail).run();
  }
  return { db, id, env: { DB: db, SESSION_SECRET: 'test-session-secret-32-bytes-ok!' } };
}

// The rule on origin/main before this change: any proof QC passed since Jon's last send-back allowed a manual move,
// and any QC pass moved a qc card to review with no condition at all.
const OLD_MANUAL = "SELECT 1 AS ok FROM bot_tasks WHERE id = ? AND EXISTS (SELECT 1 FROM bot_proofs p WHERE p.task_id = bot_tasks.id AND p.status = 'passed' AND p.checked_at > "
  + "COALESCE((SELECT MAX(e.at) FROM bot_task_events e WHERE e.task_id = bot_tasks.id AND e.detail LIKE '%(sent back by Jon)'), ''))";
const oldManualAllows = async (db, id) => !!(await db.prepare(OLD_MANUAL).bind(id).first());

const card = async (env, id) => (await call(env, 'GET', `/tasks/${id}`, { bot: 'ana' })).body.task;
const toReview = (env, id, bot, extra = {}) => call(env, 'PATCH', `/tasks/${id}`, { bot, body: { status: 'review', ...extra } });
const pass = (env, pid, bot = 'qc') => call(env, 'POST', `/proofs/${pid}/check`, { bot, body: { result: 'passed' } });

test('false done t_fe8d0fa2d0584a9a (Theo Creates video): manual qc -> review while the newest proof was pending', async () => {
  // As it stood at 2026-11-04T04:18:24, when QC moved it to Review by hand: the older pass was a local pack.md.
  const { db, env, id } = await seed({
    id: 't_fe8d0fa2d0584a9a', title: 'Your AI UGC Looks Fake Because of the Reference Image, Not the Prompt - Theo Creates',
    owner: 'video-editor', project: 'viral-view', status: 'qc',
    proofs: [
      { id: 'p_3d518cd72e2c4b22', status: 'passed', by: 'viral-view', at: '2026-11-03T10:04:29.635Z', checkedBy: 'qc', checkedAt: '2026-11-03T10:06:37.711Z', link: 'D:/AgentTeam/viral-view/theo-2/pack.md' },
      { id: 'p_c10807e60b474093', status: 'failed', by: 'video-editor', at: '2026-11-03T11:48:06.036Z', checkedBy: 'qc', checkedAt: '2026-11-03T11:54:41.016Z', link: 'https://jonmac.ai/review/theo-2-v1' },
      { id: 'p_3df8ed027bea434b', status: 'failed', by: 'video-editor', at: '2026-11-03T12:25:58.927Z', checkedBy: 'qc', checkedAt: '2026-11-03T12:32:52.220Z', link: 'https://jonmac.ai/review/theo-2-v2' },
      { id: 'p_61a4f964ac014bbc', status: 'pending', by: 'video-editor', at: '2026-11-04T04:11:17.382Z', link: 'https://jonmac.ai/review/theo-2-v3' },
    ],
  });
  assert.equal(await oldManualAllows(db, id), true, 'the old rule let it through');
  const r = await toReview(env, id, 'qc');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /newest proof is pending, not passed/);
  assert.equal((await card(env, id)).status, 'qc');
  // QC's own pass of the newest (https) proof then moves it on.
  const ok = await pass(env, 'p_61a4f964ac014bbc');
  assert.equal(ok.body.task.status, 'review');
});

test('false done t_cade0b58b9b445e8 (side-by-side review pages): auto qc -> review on a pass of the older proof', async () => {
  const { db, env, id } = await seed({
    id: 't_cade0b58b9b445e8', title: 'Review pages: original video side by side with our edit', owner: 'developer', project: 'coding', status: 'qc',
    proofs: [
      { id: 'p_c4a1a9889c154cf3', status: 'pending', by: 'developer', at: '2026-11-01T20:29:28.067Z', link: 'https://jonmac.ai/dashboard/review/zane-1-v1' },
      { id: 'p_fd7615468d744007', status: 'pending', by: 'developer', at: '2026-11-01T20:29:29.922Z', link: 'D:\\AgentTeam\\proof\\2026-11-01-sidebyside\\README.md' },
    ],
  });
  const first = await pass(env, 'p_c4a1a9889c154cf3');
  assert.equal(first.status, 200);
  assert.equal(await oldManualAllows(db, id), true, 'the old rule (any pass, and the unconditional auto move) let it through');
  assert.equal(first.body.task.status, 'qc', 'held: the newest proof still waits for QC');
  assert.equal((await toReview(env, id, 'developer')).status, 409, 'and the owner cannot move it by hand either');
  // Passing the newest proof moves it: an internal coding card may have a local path (it closes by itself).
  const second = await pass(env, 'p_fd7615468d744007');
  assert.equal(second.body.task.status, 'review');
  assert.ok((await card(env, id)).history.some((h) => h.detail === 'status qc → review (QC passed)'));
});

test('clean case: newest proof QC passed with an https link goes to Review', async () => {
  const { env, id } = await seed({
    owner: 'sponsors', project: 'sponsors', status: 'doing',
    proofs: [{ id: 'p_0000000000000001', status: 'passed', by: 'sponsors', at: '2026-11-18T10:00:00.000Z', checkedBy: 'qc', checkedAt: '2026-11-18T10:05:00.000Z', link: 'https://jonmac.ai/review/deal-1' }],
  });
  const r = await toReview(env, id, 'sponsors');
  assert.deepEqual([r.status, r.body.task?.status], [200, 'review'], JSON.stringify(r.body));
});

test('internal coding card: a local-path newest proof QC passed is allowed; a video card with one is refused', async () => {
  const proofs = [{ id: 'p_0000000000000001', status: 'passed', by: 'developer', at: '2026-11-18T10:00:00.000Z', checkedBy: 'qc', checkedAt: '2026-11-18T10:05:00.000Z', link: 'D:\\AgentTeam\\proof\\x.md' }];
  const internal = await seed({ project: 'coding', status: 'doing', proofs });
  assert.equal((await toReview(internal.env, internal.id, 'developer')).status, 200);
  const video = await seed({ owner: 'video-editor', project: 'home-guide-press', status: 'doing', proofs });
  const r = await toReview(video.env, video.id, 'video-editor');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /no https link/);
  const staged = await seed({ project: 'coding', stage: 'edit', status: 'doing', proofs });
  assert.equal((await toReview(staged.env, staged.id, 'developer')).status, 409, 'a video stage is never internal');
});

test('dispatcher close path: --status review --project coding in one call judges the card as coding', async () => {
  const proofs = [{ id: 'p_0000000000000001', status: 'passed', by: 'developer', at: '2026-11-18T10:00:00.000Z', checkedBy: 'qc', checkedAt: '2026-11-18T10:05:00.000Z', link: 'D:\\AgentTeam\\proof\\x.md' }];
  const bare = await seed({ project: null, status: 'doing', proofs });
  const r = await toReview(bare.env, bare.id, 'developer', { project: 'coding' });
  assert.deepEqual([r.status, r.body.task?.status, r.body.task?.project], [200, 'review', 'coding'], JSON.stringify(r.body));
  const close = await call(bare.env, 'POST', `/tasks/${bare.id}/close`, { bot: 'ana', body: {} });
  assert.equal(close.body.task?.status, 'done', JSON.stringify(close.body));
  // A Jon's ask card with no project (status only) and a local path still needs https.
  const jons = await seed({ project: null, status: 'doing', proofs });
  assert.equal((await toReview(jons.env, jons.id, 'developer')).status, 409);
});

test('planted faults: a pass by the poster, the card owner or a bot other than QC/Ana is refused', async () => {
  const at = '2026-11-18T10:00:00.000Z';
  const checkedAt = '2026-11-18T10:05:00.000Z';
  const link = 'https://jonmac.ai/review/x';
  const cases = [
    { name: 'self pass', owner: 'qc', proof: { by: 'qc', checkedBy: 'qc' } },
    { name: 'owner pass', owner: 'qc', proof: { by: 'developer', checkedBy: 'qc' } },
    { name: 'other bot', owner: 'developer', proof: { by: 'developer', checkedBy: 'sponsors' } },
    { name: 'Ana self', owner: 'developer', proof: { by: 'ana', checkedBy: 'ana' } },
  ];
  for (const c of cases) {
    const { env, id } = await seed({ owner: c.owner, project: 'jonmacai', status: 'doing', proofs: [{ id: 'p_0000000000000001', status: 'passed', at, checkedAt, link, ...c.proof }] });
    const r = await toReview(env, id, 'ana');
    assert.equal(r.status, 409, c.name);
    assert.match(r.body.error, /not by QC/, c.name);
  }
  // Ana passing a proof QC posted on someone else's card is allowed.
  const { env, id } = await seed({ owner: 'developer', project: 'jonmacai', status: 'doing', proofs: [{ id: 'p_0000000000000001', status: 'passed', at, checkedAt, link, by: 'qc', checkedBy: 'ana' }] });
  assert.equal((await toReview(env, id, 'developer')).status, 200);
});

test('planted faults: a pass from before Jon sent the card back, or no proof at all, is refused', async () => {
  const { env, id } = await seed({
    owner: 'sponsors', project: 'sponsors', status: 'doing',
    proofs: [{ id: 'p_0000000000000001', status: 'passed', by: 'sponsors', at: '2026-11-18T10:00:00.000Z', checkedBy: 'qc', checkedAt: '2026-11-18T10:05:00.000Z', link: 'https://jonmac.ai/review/x' }],
    events: [{ at: '2026-11-18T11:00:00.000Z', by: 'jon', detail: 'status review → doing (sent back by Jon)' }],
  });
  const r = await toReview(env, id, 'sponsors');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /passed before Jon last sent the card back/);
  const none = await seed({ status: 'doing' });
  assert.match((await toReview(none.env, none.id, 'developer')).body.error, /no proof yet/);
});

const localPending = [{ id: 'p_0000000000000001', status: 'pending', by: 'video-editor', at: '2026-11-18T10:00:00.000Z', link: 'D:\\HGP-work\\final.mp4' }];
const proofStatus = async (db, pid) => (await db.prepare('SELECT status FROM bot_proofs WHERE id = ?').bind(pid).first()).status;

test('planted fault: QC passing the newest proof of a non-internal card with no https link is refused (409); a fail sends it back', async () => {
  const { db, env, id } = await seed({ owner: 'video-editor', project: 'home-guide-press', status: 'qc', proofs: localPending });
  const r = await pass(env, 'p_0000000000000001');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /https link Jon can open/);
  assert.equal(await proofStatus(db, 'p_0000000000000001'), 'pending');
  assert.equal((await card(env, id)).status, 'qc');
  const f = await call(env, 'POST', '/proofs/p_0000000000000001/check', { bot: 'qc', body: { result: 'failed', note: 'Review needs an https link' } });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal((await card(env, id)).status, 'doing');
});

test('stage hand-offs: a local-path pass on a pack stage, or a bare-project deploy stage, is allowed and the card stays in qc', async () => {
  const pack = await seed({ owner: 'video-editor', project: 'home-guide-press', stage: 'pack', status: 'qc', proofs: localPending });
  const a = await pass(pack.env, 'p_0000000000000001');
  assert.deepEqual([a.status, a.body.task?.status], [200, 'qc'], JSON.stringify(a.body));
  const deploy = await seed({ owner: 'developer', project: null, stage: 'deploy', status: 'qc', proofs: localPending });
  const b = await pass(deploy.env, 'p_0000000000000001');
  assert.deepEqual([b.status, b.body.task?.status], [200, 'qc'], JSON.stringify(b.body));
});

test("planted fault (Ana): a Jon's ask card with no project in deploy, newest proof local-only, goes back to its owner for https", async () => {
  for (const title of ["Jon's ask: live GPU Monitor", 'Jon’s ask: curly apostrophe']) {
    const { db, env, id } = await seed({ title, owner: 'developer', project: null, stage: 'deploy', status: 'qc', proofs: localPending });
    const r = await pass(env, 'p_0000000000000001');
    assert.equal(r.status, 409, `${title}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.error, /https link Jon can open/);
    assert.equal(await proofStatus(db, 'p_0000000000000001'), 'pending', 'the local-only proof is not passed');
    assert.equal((await card(env, id)).status, 'qc', 'never moved to Review');
    const f = await call(env, 'POST', '/proofs/p_0000000000000001/check', { bot: 'qc', body: { result: 'failed', note: 'Review needs an https link' } });
    assert.equal(f.status, 200, JSON.stringify(f.body));
    const back = await card(env, id);
    assert.deepEqual([back.status, back.owner], ['doing', 'developer'], 'back with its owner for an https proof');
  }
  // Clean case: the same card with an https proof passes and the dispatcher's --status review move goes through.
  const ok = await seed({ title: "Jon's ask: live GPU Monitor", owner: 'developer', project: null, stage: 'deploy', status: 'qc',
    proofs: [{ id: 'p_0000000000000003', status: 'pending', by: 'developer', at: '2026-11-18T10:00:00.000Z', link: 'https://jonmac.ai/monitor' }] });
  const p = await pass(ok.env, 'p_0000000000000003');
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal((await card(ok.env, ok.id)).status, 'review');
});

test('a pass on an older local-path proof is allowed (it never sends the card to Review)', async () => {
  const { env } = await seed({
    owner: 'video-editor', project: 'home-guide-press', status: 'qc',
    proofs: [...localPending, { id: 'p_0000000000000002', status: 'pending', by: 'video-editor', at: '2026-11-18T11:00:00.000Z', link: 'https://jonmac.ai/review/x' }],
  });
  const r = await pass(env, 'p_0000000000000001');
  assert.deepEqual([r.status, r.body.task?.status], [200, 'qc'], JSON.stringify(r.body));
});

test('race: a QC fail landing between the Review check and the UPDATE is caught by the UPDATE guard', async () => {
  const { db, env, id } = await seed({
    owner: 'sponsors', project: 'sponsors', status: 'doing',
    proofs: [{ id: 'p_0000000000000001', status: 'passed', by: 'sponsors', at: '2026-11-18T10:00:00.000Z', checkedBy: 'qc', checkedAt: '2026-11-18T10:05:00.000Z', link: 'https://jonmac.ai/review/deal-1' }],
  });
  const prepare = db.prepare;
  let fired = false;
  db.prepare = (sql) => {
    if (!fired && sql.startsWith('UPDATE bot_tasks SET') && sql.includes('status = ?')) {
      fired = true;
      db.sqlite.exec("UPDATE bot_proofs SET status = 'failed' WHERE id = 'p_0000000000000001'");
    }
    return prepare(sql);
  };
  const r = await toReview(env, id, 'sponsors');
  assert.ok(fired, 'the UPDATE ran');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  db.prepare = prepare;
  assert.equal((await card(env, id)).status, 'doing');
});

test('a passed newest proof with no checked_at is refused as not checked by QC', async () => {
  const { env, id } = await seed({
    owner: 'sponsors', project: 'sponsors', status: 'doing',
    proofs: [{ id: 'p_0000000000000001', status: 'passed', by: 'sponsors', at: '2026-11-18T10:00:00.000Z', checkedBy: 'qc', link: 'https://jonmac.ai/review/deal-1' }],
  });
  const r = await toReview(env, id, 'sponsors');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /not checked by QC/);
});
