function platformOf(p) {
  const s = String(p || '').toLowerCase();
  if (s.includes('linkedin')) return 'LinkedIn';
  if (s.includes('insta')) return 'Instagram';
  if (s.includes('face') || s === 'fb') return 'Facebook';
  return s.includes('you') ? 'YouTube' : 'X';
}

const DDL = `CREATE TABLE IF NOT EXISTS content_drafts (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  platform TEXT NOT NULL,
  slot INTEGER NOT NULL,
  body TEXT,
  subject TEXT,
  first_line TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  updated_at TEXT NOT NULL
)`;

export async function ensureDrafts(db) {
  if (!db) return;
  await db.prepare(DDL).run();
}

export async function listDrafts(db, day) {
  if (!db) return [];
  await ensureDrafts(db);
  const { results } = await db.prepare(
    'SELECT id, day, platform, slot, body, subject, first_line, status, updated_at FROM content_drafts',
  ).all();
  const rows = results || [];
  return day ? rows.filter((r) => r.day === day && r.status !== 'discarded') : rows;
}

export async function upsertDraft(db, row) {
  if (!db || !row?.id) return;
  await ensureDrafts(db);
  const now = row.updated_at || new Date().toISOString();
  await db.prepare(
    `INSERT OR REPLACE INTO content_drafts (id, day, platform, slot, body, subject, first_line, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    row.id,
    row.day,
    row.platform,
    Number(row.slot) || 1,
    row.body || '',
    row.subject || '',
    row.first_line || '',
    row.status || 'draft',
    now,
  ).run();
}

export async function persistQueueDrafts(db, data, collectedAt, nowMs = Date.now()) {
  if (!db) return;
  const queued = Array.isArray(data?.queued) ? data.queued : [];
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.parse(collectedAt) || nowMs));
  const existing = await listDrafts(db, day);
  const used = new Set(existing.map((r) => `${r.platform}|${r.first_line}`));
  const ids = new Set(existing.map((r) => r.id));
  const slots = {};
  for (const r of existing) slots[r.platform] = Math.max(slots[r.platform] || 0, Number(r.slot) || 0);
  for (const item of queued) {
    const platform = platformOf(item.platform);
    const first = String(item.firstLine || item.first_line || item.body || '').trim();
    if (!first) continue;
    const id = String(item.id || '');
    if (id && ids.has(id)) continue;
    const key = `${platform}|${first}`;
    if (used.has(key)) continue;
    const slot = (slots[platform] || 0) + 1;
    if (slot > 3) continue;
    slots[platform] = slot;
    used.add(key);
    const rowId = id || crypto.randomUUID();
    ids.add(rowId);
    await upsertDraft(db, {
      id: rowId,
      day,
      platform,
      slot,
      body: first,
      first_line: first,
      status: 'draft',
    });
  }
}
