import { platformOf, PLATFORMS } from './content.js';
import { ymd } from './life.js';
import { listSnapshots } from './db.js';

const SLOTS = 3;
const ANGLES = ['hook', 'how-to', 'cta'];
const DDL = `CREATE TABLE IF NOT EXISTS content_drafts (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  day TEXT NOT NULL,
  platform TEXT NOT NULL,
  slot INTEGER NOT NULL,
  body TEXT,
  subject TEXT,
  first_line TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  source TEXT,
  error TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant, day, platform, slot)
)`;

export function vancouverDay(ms) {
  return ymd(ms);
}

export function tenantOf(env) {
  const raw = String(env?.CONTENT_TENANT || 'jon').trim();
  return raw || 'jon';
}

export function configuredPlatforms(env) {
  const raw = env?.CONTENT_PLATFORMS;
  if (raw != null && String(raw).trim()) {
    return [...new Set(String(raw).split(',').map((s) => s.trim()).filter(Boolean).map((s) => platformOf(s)))];
  }
  return [...PLATFORMS];
}

export function unavailablePlatforms(env) {
  const on = new Set(configuredPlatforms(env));
  return PLATFORMS.filter((p) => !on.has(p));
}

export function draftId(tenant, day, platform, slot) {
  const slug = String(platform).toLowerCase().replace(/\s+/g, '');
  return `d:${tenant}:${day}:${slug}:${slot}`;
}

function parseJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export function topicsFrom(sources = {}) {
  const topics = [];
  const outliers = sources.outliers || sources.youtube?.outliers || [];
  for (const r of outliers) {
    const title = String(r?.title || '').trim();
    if (title) topics.push({ title, channel: r.channel || '', origin: 'youtube' });
  }
  for (const p of sources.picks || sources.mastermind?.picks || []) {
    const title = String(p?.title || '').trim();
    if (title) topics.push({ title, channel: '', origin: 'mastermind' });
  }
  for (const q of sources.queued || sources.queue?.queued || []) {
    const title = String(q.firstLine || q.first_line || q.body || '').trim();
    if (title) topics.push({ title, channel: '', origin: 'queue' });
  }
  for (const v of sources.video?.queue || []) {
    const title = String(v?.title || '').trim();
    if (title) topics.push({ title, channel: '', origin: 'video' });
  }
  const viral = sources.viralview;
  if (viral && (viral.success || viral.current || viral.subscriptions)) {
    topics.push({ title: 'Viral View', channel: '', origin: 'viralview' });
  }
  return topics;
}

function cite(topic) {
  return `Source: ${topic.origin}${topic.channel ? ` · ${topic.channel}` : ''} · ${topic.title}`;
}

function bodyFor(platform, slot, topic, day) {
  const head = `${platform} · ${ANGLES[slot - 1]}`;
  const foot = `Vancouver day ${day}. Draft only. Not a quote, personal result, or sales figure. Nothing publishes from here.`;
  if (slot === 1) {
    return `${head}\n${topic.title}\nRemake the format, not the claims.\n${cite(topic)}\n${foot}`;
  }
  if (slot === 2) {
    return `${head}\n1. Film or pull a talking-head take\n2. Generate B-roll with the connected AI video tools\n3. Cut three beats and caption on-screen\nTopic: ${topic.title}\n${cite(topic)}\n${foot}`;
  }
  return `${head}\nNext step: edit this before any approve.\nDo not post from this draft.\nTopic: ${topic.title}\n${cite(topic)}\n${foot}`;
}

function firstLine(body) {
  return String(body).split('\n').map((s) => s.trim()).find(Boolean)?.slice(0, 80) || '';
}

export async function ensureDrafts(db) {
  if (!db) return;
  await db.prepare(DDL).run();
}

export async function listDrafts(db, tenant, day) {
  if (!db) return [];
  await ensureDrafts(db);
  const { results } = await db.prepare(
    'SELECT id, tenant, day, platform, slot, body, subject, first_line, status, source, error, updated_at FROM content_drafts WHERE tenant = ?',
  ).bind(tenant).all();
  const rows = results || [];
  return day ? rows.filter((r) => r.day === day) : rows;
}

async function insertIgnore(db, row) {
  const res = await db.prepare(
    `INSERT OR IGNORE INTO content_drafts
     (id, tenant, day, platform, slot, body, subject, first_line, status, source, error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    row.id, row.tenant, row.day, row.platform, row.slot, row.body, row.subject,
    row.first_line, row.status, row.source || '', row.error || '', row.updated_at,
  ).run();
  return Number(res?.meta?.changes) || 0;
}

export async function saveDraft(db, tenant, payload = {}) {
  if (!db || !payload.id) return null;
  if (payload.tenant && payload.tenant !== tenant) return false;
  await ensureDrafts(db);
  const body = String(payload.body ?? '');
  const res = await db.prepare(
    `UPDATE content_drafts SET body = ?, first_line = ?, status = 'edited', updated_at = ?, error = ''
     WHERE id = ? AND tenant = ?`,
  ).bind(body, firstLine(body), new Date().toISOString(), payload.id, tenant).run();
  return Number(res?.meta?.changes) > 0;
}

export async function approveDraft(db, tenant, id) {
  if (!db || !id) return null;
  await ensureDrafts(db);
  const res = await db.prepare(
    `UPDATE content_drafts SET status = 'approved', updated_at = ?
     WHERE id = ? AND tenant = ?`,
  ).bind(new Date().toISOString(), id, tenant).run();
  return Number(res?.meta?.changes) > 0;
}

export async function fillDailyDrafts(db, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const day = vancouverDay(nowMs);
  const tenant = String(opts.tenant || 'jon');
  const platforms = [...new Set((opts.platforms || []).map((p) => platformOf(p)).filter(Boolean))];
  if (!db || !platforms.length) return { day, tenant, inserted: 0, failed: 0, platforms };
  await ensureDrafts(db);
  const topics = topicsFrom(opts.sources || {});
  let inserted = 0;
  let failed = 0;
  for (const platform of platforms) {
    for (let slot = 1; slot <= SLOTS; slot++) {
      const topic = topics[(slot - 1) % topics.length] || null;
      const body = topic ? bodyFor(platform, slot, topic, day) : '';
      const status = topic ? 'draft' : 'failed';
      const changes = await insertIgnore(db, {
        id: draftId(tenant, day, platform, slot),
        tenant,
        day,
        platform,
        slot,
        body,
        subject: `${platform} · slot ${slot}`,
        first_line: firstLine(body),
        status,
        source: topic?.origin || '',
        error: topic ? '' : 'No connected product facts',
        updated_at: new Date(nowMs).toISOString(),
      });
      if (changes) {
        inserted += 1;
        if (!topic) failed += 1;
      }
    }
  }
  return { day, tenant, inserted, failed, platforms };
}

export async function fillFromEnv(env, nowMs = Date.now()) {
  const day = vancouverDay(nowMs);
  const platforms = configuredPlatforms(env);
  if (!env?.DB) return { day, inserted: 0, failed: 0, platforms };
  const rows = await listSnapshots(env.DB);
  const by = {};
  for (const row of rows || []) by[row.source] = parseJson(row.data);
  return fillDailyDrafts(env.DB, {
    nowMs,
    tenant: tenantOf(env),
    platforms,
    sources: {
      outliers: by.youtube?.outliers || [],
      picks: by.mastermind?.picks || [],
      queued: by.content_queue?.queued || [],
      video: by.video || {},
      viralview: by.viralview || null,
    },
  });
}
