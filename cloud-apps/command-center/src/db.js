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

export async function claimQueued(db, machine, now) {
  const { results } = await db.prepare(
    `SELECT * FROM actions WHERE target = ? AND status = 'queued' ORDER BY created_at LIMIT 10`,
  ).bind(machine).all();
  for (const row of results || []) {
    await db.prepare(`UPDATE actions SET status = 'claimed', claimed_at = ? WHERE id = ? AND status = 'queued'`)
      .bind(now, row.id).run();
    row.status = 'claimed';
    row.claimed_at = now;
    if (row.kind === 'bank.submit_code') {
      await db.prepare(`UPDATE actions SET payload = ? WHERE id = ?`).bind('{}', row.id).run();
      row.payload = '{}';
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
