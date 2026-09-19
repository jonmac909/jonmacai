export function loginStore(db) {
  return {
    async get(ip) {
      if (!db) return null;
      return db.prepare('SELECT ip, count, window_start FROM login_failures WHERE ip = ?').bind(ip).first();
    },
    async put(ip, row) {
      if (!db) return;
      await db.prepare(
        'INSERT OR REPLACE INTO login_failures (ip, count, window_start) VALUES (?, ?, ?)',
      ).bind(ip, row.count, String(row.window_start)).run();
    },
  };
}

export async function insertAction(db, row) {
  await db.prepare(
    `INSERT INTO actions (id, kind, target, payload, status, result, idem_key, created_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, row.kind, row.target, row.payload, row.status, row.result, row.idem_key, row.created_at, row.finished_at).run();
}

export async function actionByIdem(db, key) {
  return db.prepare('SELECT * FROM actions WHERE idem_key = ?').bind(key).first();
}

export async function actionById(db, id) {
  return db.prepare('SELECT * FROM actions WHERE id = ?').bind(id).first();
}

export async function claimQueued(db, machine, now, opts = {}) {
  const sql = opts.codes
    ? `SELECT * FROM actions WHERE target = ? AND status = 'queued' AND kind = 'bank.submit_code' ORDER BY created_at LIMIT 10`
    : `SELECT * FROM actions WHERE target = ? AND status = 'queued' AND kind != 'bank.submit_code' ORDER BY created_at LIMIT 10`;
  const { results } = await db.prepare(sql).bind(machine).all();
  for (const row of results || []) {
    await db.prepare(`UPDATE actions SET status = 'claimed', claimed_at = ? WHERE id = ? AND status = 'queued'`)
      .bind(now, row.id).run();
    row.status = 'claimed';
    row.claimed_at = now;
    if (row.kind === 'bank.submit_code') {
      await db.prepare(`UPDATE actions SET payload = ? WHERE id = ?`).bind('{}', row.id).run();
    }
  }
  return results || [];
}

export async function completeAction(db, id, status, result, now) {
  await db.prepare(`UPDATE actions SET status = ?, result = ?, finished_at = ? WHERE id = ?`)
    .bind(status, result, now, id).run();
}

export async function upsertChecklist(db, day, item, doneAt, how) {
  await db.prepare(
    'INSERT OR REPLACE INTO checklist (day, item, done_at, how) VALUES (?, ?, ?, ?)',
  ).bind(day, item, doneAt, how).run();
}

export async function upsertHabit(db, day, kind, done, note) {
  await db.prepare(
    'INSERT OR REPLACE INTO habits (day, kind, done, note) VALUES (?, ?, ?, ?)',
  ).bind(day, kind, done, note).run();
}

export async function upsertSnapshot(db, source, data, collectedAt, receivedAt) {
  await db.prepare(
    'INSERT OR REPLACE INTO snapshots (source, data, collected_at, received_at) VALUES (?, ?, ?, ?)',
  ).bind(source, data, collectedAt, receivedAt).run();
}

export async function listSnapshots(db) {
  const { results } = await db.prepare('SELECT source, data, collected_at, received_at FROM snapshots').all();
  return results || [];
}

export async function upsertDealStage(db, dealId, stage, now) {
  await db.prepare(
    'INSERT OR REPLACE INTO deal_stage_overrides (deal_id, stage, updated_at) VALUES (?, ?, ?)',
  ).bind(dealId, stage, now).run();
}

export async function listDealStages(db) {
  const { results } = await db.prepare('SELECT deal_id, stage FROM deal_stage_overrides').all();
  const out = {};
  for (const row of results || []) out[row.deal_id] = row.stage;
  return out;
}

export async function listIdeas(db) {
  if (!db) return [];
  const { results } = await db.prepare('SELECT id, title, body, area, verdict, status, created_at, updated_at FROM ideas').all();
  return results || [];
}

export async function upsertIdea(db, row) {
  const now = row.updated_at || new Date().toISOString();
  const existing = await db.prepare('SELECT * FROM ideas WHERE id = ?').bind(row.id).first();
  const created = existing?.created_at || row.created_at || now;
  await db.prepare(
    'INSERT OR REPLACE INTO ideas (id, title, body, area, verdict, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    row.id,
    row.title ?? existing?.title ?? '',
    row.body ?? existing?.body ?? '',
    row.area ?? existing?.area ?? '',
    row.verdict ?? existing?.verdict ?? '',
    row.status ?? existing?.status ?? 'new',
    created,
    now,
  ).run();
}
