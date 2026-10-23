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

export async function latestAction(db, kind) {
  const { results } = await db.prepare(
    'SELECT id, kind, status, result, created_at, finished_at FROM actions WHERE kind = ? ORDER BY created_at DESC LIMIT 1',
  ).bind(kind).all();
  return results?.[0] || null;
}

export async function claimQueued(db, machine, now) {
  const { results } = await db.prepare(
    `SELECT * FROM actions WHERE target = ? AND status = 'queued' ORDER BY created_at LIMIT 10`,
  ).bind(machine).all();
  const claimed = [];
  for (const row of results || []) {
    const info = await db.prepare(
      `UPDATE actions SET status = 'claimed', claimed_at = ? WHERE id = ? AND status = 'queued'`,
    ).bind(now, row.id).run();
    if (!info?.meta?.changes) continue;
    row.status = 'claimed';
    row.claimed_at = now;
    if (row.kind === 'bank.submit_code') {
      await db.prepare(`UPDATE actions SET payload = ? WHERE id = ?`).bind('{}', row.id).run();
    }
    claimed.push(row);
  }
  return claimed;
}
export async function claimedVideo(db, machine) {
  if (machine !== 'gpu1') return [];
  const { results } = await db.prepare(
    `SELECT * FROM actions WHERE target = ? AND kind = 'video.start_edit' AND status = 'claimed' ORDER BY created_at LIMIT 5`,
  ).bind(machine).all();
  return results || [];
}

export async function completeAction(db, id, status, result, now) {
  await db.prepare(`UPDATE actions SET status = ?, result = ?, finished_at = ? WHERE id = ?`)
    .bind(status, result, now, id).run();
}

export async function reportAction(db, id, status, result) {
  await db.prepare(`UPDATE actions SET status = ?, result = ?, finished_at = NULL WHERE id = ?`)
    .bind(status, result, id).run();
}

export async function requeueAction(db, id, payload, result) {
  await db.prepare(`UPDATE actions SET status = 'queued', payload = ?, result = ?, finished_at = NULL WHERE id = ?`)
    .bind(payload, result, id).run();
}

export async function listVideoJobs(db) {
  const { results } = await db.prepare(
    `SELECT id, payload, status, result FROM actions WHERE kind = ? AND target = ? ORDER BY created_at`,
  ).bind('video.start_edit', 'gpu1').all();
  return results || [];
}

export async function upsertChecklist(db, day, item, doneAt, how) {
  await db.prepare(
    'INSERT OR REPLACE INTO checklist (day, item, done_at, how) VALUES (?, ?, ?, ?)',
  ).bind(day, item, doneAt, how).run();
}

export async function deleteChecklist(db, day, item) {
  await db.prepare('DELETE FROM checklist WHERE day = ? AND item = ?').bind(day, item).run();
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

export async function listVideoProjects(db) {
  if (!db) return [];
  try {
    const { results } = await db.prepare('SELECT id, data, updated_at FROM video_projects').all();
    return (results || []).map((r) => {
      try { return JSON.parse(r.data); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export async function replaceVideoProjects(db, list, now) {
  await db.prepare('DELETE FROM video_projects').run();
  for (const p of list || []) {
    if (!p || !p.id) continue;
    await db.prepare('INSERT INTO video_projects (id, data, updated_at) VALUES (?, ?, ?)')
      .bind(String(p.id), JSON.stringify(p), now).run();
  }
}

export async function upsertPost(db, row) {
  await db.prepare(
    'INSERT OR REPLACE INTO posts (id, platform, posted_at, url, first_line, source) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(row.id, row.platform, row.posted_at, row.url || '', row.first_line || '', row.source || 'agent').run();
}

export async function listPosts(db) {
  if (!db) return [];
  const { results } = await db.prepare('SELECT id, platform, posted_at, url, first_line, source FROM posts ORDER BY posted_at').all();
  return results || [];
}

export async function listChecklist(db, day) {
  if (!db) return [];
  const { results } = await db.prepare('SELECT day, item, done_at, how FROM checklist WHERE day = ?').bind(day).all();
  return results || [];
}

export async function listHabits(db) {
  if (!db) return [];
  const { results } = await db.prepare('SELECT day, kind, done, note FROM habits').all();
  return results || [];
}

// Team roster and deliverables pushed by Ana (2026-10-23). Display only.
export async function replaceTeamBots(db, rows) {
  await db.prepare('DELETE FROM team_bots').run();
  for (const row of rows) {
    await db.prepare(
      `INSERT OR REPLACE INTO team_bots (id, name, role, team, task, status, updated_at, source, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(row.id, row.name, row.role || '', row.team || '', row.task || '', row.status || '', row.updated_at || '', row.source || '', row.received_at).run();
  }
}

export async function listTeamBots(db) {
  if (!db) return [];
  const { results } = await db.prepare(
    'SELECT id, name, role, team, task, status, updated_at, received_at FROM team_bots ORDER BY team, name',
  ).all();
  return results || [];
}

export async function upsertDeliverables(db, rows) {
  for (const row of rows) {
    await db.prepare(
      `INSERT INTO deliverables (id, title, owner, kind, url, finished_at, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, owner = excluded.owner,
         kind = excluded.kind, url = excluded.url, finished_at = excluded.finished_at,
         source = excluded.source, updated_at = excluded.updated_at`,
    ).bind(row.id, row.title, row.owner || '', row.kind || '', row.url || '', row.finished_at || '', row.source || '', row.updated_at).run();
  }
}

export async function listDeliverables(db, sinceIso) {
  if (!db) return [];
  const { results } = await db.prepare(
    `SELECT d.id, d.title, d.owner, d.kind, d.url, d.finished_at, d.updated_at,
            a.approved_at, a.approved_by
       FROM deliverables d LEFT JOIN approvals a ON a.deliverable_id = d.id
      WHERE (d.finished_at IS NOT NULL AND d.finished_at >= ?) OR a.approved_at IS NOT NULL
      ORDER BY d.finished_at DESC LIMIT 200`,
  ).bind(sinceIso).all();
  return results || [];
}

// Records Jon's approval once; a second press keeps the first record.
export async function approveDeliverable(db, id, by, now) {
  const row = await db.prepare('SELECT id FROM deliverables WHERE id = ?').bind(id).first();
  if (!row) return null;
  const prev = await db.prepare('SELECT approved_at, approved_by FROM approvals WHERE deliverable_id = ?').bind(id).first();
  if (prev) return { approved_at: prev.approved_at, approved_by: prev.approved_by, duplicate: true };
  await db.prepare('INSERT INTO approvals (deliverable_id, approved_at, approved_by) VALUES (?, ?, ?)').bind(id, now, by).run();
  return { approved_at: now, approved_by: by, duplicate: false };
}

export async function listApprovals(db) {
  if (!db) return [];
  const { results } = await db.prepare(
    `SELECT a.deliverable_id AS id, d.title, d.owner, d.kind, d.url, d.finished_at,
            a.approved_at, a.approved_by
       FROM approvals a LEFT JOIN deliverables d ON d.id = a.deliverable_id
      ORDER BY a.approved_at DESC LIMIT 500`,
  ).all();
  return results || [];
}
