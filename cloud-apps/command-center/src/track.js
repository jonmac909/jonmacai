// Track page (2026-11-02): every Calendar video with its status, YouTube stats and a tracked link.
// /v/<code> counts the click and forwards to the landing page stored in D1, never to anything in the request.
import { CHANNELS, withYoutube } from './channels.js';
import { ymd } from './life.js';

export const STAGES = ['created', 'posted', 'scheduled', 'live'];
const CODE_RE = /^[0-9a-f]{10}$/;
const YOUTUBE_RE = /^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be)\//i;

// Calendar status to Jon's stages; null = not made yet. Only finished videos read their link as the upload:
// idea rows hold their source video's YouTube link.
export function stageOf(status, link) {
  if (status === 'published') return 'live';
  if (status === 'scheduled') return 'scheduled';
  if (status !== 'qc' && status !== 'review') return null;
  return YOUTUBE_RE.test(link || '') ? 'posted' : 'created';
}

const plain = (status) => new Response(status === 404 ? 'Not found' : 'Try again', { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

export async function trackRedirect(request, env, ctx) {
  const code = new URL(request.url).pathname.slice('/v/'.length);
  if (!CODE_RE.test(code) || !['GET', 'HEAD'].includes(request.method) || !env.DB) return plain(404);
  let row;
  try {
    row = await env.DB.prepare(`SELECT l.channel, COALESCE(l.landing, c.landing) AS landing FROM yt_links l
      LEFT JOIN yt_channels c ON c.slug = l.channel WHERE l.code = ?`).bind(code).first();
  } catch (err) {
    console.error('trackRedirect', err);
    return plain(503);
  }
  if (!row?.landing) return plain(404);
  const to = new URL(row.landing);
  to.searchParams.set('utm_source', 'youtube');
  to.searchParams.set('utm_campaign', row.channel);
  to.searchParams.set('utm_content', code);
  if (request.method === 'GET') {
    ctx.waitUntil(env.DB.prepare('UPDATE yt_links SET clicks = clicks + 1 WHERE code = ?').bind(code).run().catch((err) => console.error('track click', err)));
  }
  return new Response(null, { status: 302, headers: { Location: to.href, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

// Every Calendar video (the Calendar page stops at 60 days back), newest first. A link with no landing page
// has no url, so nobody pastes a link that can't redirect yet.
export async function trackVideos(db, origin, channel = null, nowMs = Date.now()) {
  const today = ymd(nowMs);
  const { results } = await db.prepare(`SELECT v.channel, v.title, v.day, v.time_pt, v.status, v.link, l.code, l.clicks, s.impressions, s.ctr, s.views,
    s.scheduled_at AS yt_scheduled_at, s.status AS yt_status, COALESCE(l.landing, c.landing) AS landing
    FROM yt_calendar v LEFT JOIN yt_links l ON l.video_id = v.id LEFT JOIN yt_stats s ON s.youtube_id = v.youtube_id
    LEFT JOIN yt_channels c ON c.slug = v.channel
    ${channel ? 'WHERE v.channel = ?' : ''} ORDER BY v.day DESC, v.created_at LIMIT 5000`).bind(...(channel ? [channel] : [])).all();
  return (results || []).filter((r) => CHANNELS.some((c) => c.slug === r.channel)).map((row) => {
    const r = withYoutube(row, today);
    return {
      code: r.code ?? null, url: r.code && r.landing ? `${origin}/v/${r.code}` : null, channel: r.channel, title: r.title, date: r.day,
      status: stageOf(r.status, r.link), calendarStatus: r.status, landing: r.landing ?? null, clicks: r.clicks ?? 0,
      impressions: r.impressions ?? null, ctr: r.ctr ?? null, views: r.views ?? null, differs: r.differs ?? null, planned: r.planned ?? null,
    };
  });
}

// Null when the tables can't be read (migration 0017 not applied), so the page says so instead of failing.
export async function trackData(db, origin, nowMs) {
  try {
    return await trackVideos(db, origin, null, nowMs);
  } catch (err) {
    console.error('trackData', err);
    return null;
  }
}

export function buildTrackPage(out, videos) {
  if (!out.pages?.track) return;
  const list = videos || [];
  const connected = new Set(list.filter((v) => v.impressions != null || v.ctr != null || v.views != null).map((v) => v.channel));
  const label = new Map(CHANNELS.map((c) => [c.slug, c.label]));
  out.pages.track = {
    title: 'Track',
    available: !!videos,
    channels: [{ slug: 'all', label: 'All channels', group: 'All', all: true, count: list.length }, ...CHANNELS.map((c) => {
      const mine = list.filter((v) => v.channel === c.slug);
      return { ...c, count: mine.length, counts: Object.fromEntries(STAGES.map((s) => [s, mine.filter((v) => v.status === s).length])) };
    })],
    videos: list.map((v) => ({ ...v, channelLabel: label.get(v.channel), connected: connected.has(v.channel) })),
  };
}
