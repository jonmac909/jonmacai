import { platformOf, PLATFORMS } from './content.js';
import { topOutliers } from './youtube.js';
import { ensureDrafts, listDrafts } from './drafts.js';
import { listSnapshots } from './db.js';

const TZ = 'America/Vancouver';
const SLOTS = 3;
const ANGLES = ['hook', 'how-to', 'cta'];

export function vancouverDay(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

export function configuredPlatforms(env) {
  const raw = env?.CONTENT_PLATFORMS;
  if (raw != null && String(raw).trim()) {
    return [...new Set(String(raw).split(',').map((s) => platformOf(s.trim())).filter(Boolean))];
  }
  return [...PLATFORMS];
}

export function draftId(day, platform, slot) {
  return `d:${day}:${String(platform).toLowerCase().replace(/\s+/g, '')}:${slot}`;
}

function parseJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export function topicsFrom(sources = {}) {
  const topics = [];
  for (const r of topOutliers(sources.outliers || sources.youtube?.outliers || [], 8)) {
    topics.push({ title: String(r.title).trim(), channel: r.channel || '', origin: 'youtube' });
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
  if (!topics.length) {
    topics.push({ title: 'AI UGC and AI video generation', channel: '', origin: 'operator-focus' });
  }
  return topics;
}

function cite(topic) {
  if (topic.origin === 'operator-focus') {
    return `Source: operator focus (${topic.title}). No connected topic row for this slot.`;
  }
  return `Source: ${topic.origin}${topic.channel ? ` · ${topic.channel}` : ''} · ${topic.title}`;
}

function bodyFor(platform, slot, topic, day) {
  const head = `${platform} · ${ANGLES[slot - 1]}`;
  const src = cite(topic);
  const foot = `Vancouver day ${day}. Draft only — edit or approve in the dashboard. Not a quote, personal result, or sales figure. Nothing publishes from here.`;
  if (slot === 1) {
    return `${head}\n${topic.title}\nRemake the FORMAT as AI UGC / AI video, not the claims.\n${src}\n${foot}`;
  }
  if (slot === 2) {
    return `${head}\n1. Film or pull a talking-head take\n2. Generate B-roll with your AI video tools\n3. Cut three beats and caption on-screen\nTopic: ${topic.title}\n${src}\n${foot}`;
  }
  return `${head}\nNext step: build this as an AI UGC cut, then edit here before any approve.\nDo not post from this draft.\nTopic: ${topic.title}\n${src}\n${foot}`;
}

function firstLine(body) {
  return String(body).split('\n').map((s) => s.trim()).find(Boolean)?.slice(0, 80) || 'Draft';
}

export async function fillDailyDrafts(db, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const day = vancouverDay(nowMs);
  const platforms = [...new Set((opts.platforms || []).map((p) => platformOf(p)).filter(Boolean))];
  if (!db || !platforms.length) return { day, inserted: 0, platforms };
  await ensureDrafts(db);
  const existing = await listDrafts(db);
  const occupied = new Set(
    existing.filter((r) => r.day === day).map((r) => `${platformOf(r.platform)}|${Number(r.slot) || 0}`),
  );
  const lead = topicsFrom(opts.sources || {})[0];
  let inserted = 0;
  for (const platform of platforms) {
    for (let slot = 1; slot <= SLOTS; slot++) {
      const key = `${platform}|${slot}`;
      if (occupied.has(key)) continue;
      const id = draftId(day, platform, slot);
      if (existing.some((r) => r.id === id)) continue;
      const body = bodyFor(platform, slot, lead, day);
      await db.prepare(
        `INSERT OR IGNORE INTO content_drafts (id, day, platform, slot, body, subject, first_line, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, day, platform, slot, body, `${platform} · slot ${slot}`, firstLine(body), 'draft',
        new Date(nowMs).toISOString(),
      ).run();
      occupied.add(key);
      inserted += 1;
    }
  }
  return { day, inserted, platforms };
}

export async function fillFromEnv(env, nowMs = Date.now()) {
  if (!env?.DB) return { day: vancouverDay(nowMs), inserted: 0, platforms: [] };
  const rows = await listSnapshots(env.DB);
  const by = {};
  for (const row of rows || []) by[row.source] = parseJson(row.data);
  return fillDailyDrafts(env.DB, {
    nowMs,
    platforms: configuredPlatforms(env),
    sources: {
      outliers: by.youtube?.outliers || [],
      picks: by.mastermind?.picks || [],
      queued: by.content_queue?.queued || [],
      video: by.video || {},
    },
  });
}
