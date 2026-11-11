// Track page (2026-11-02): every Calendar video with its status, YouTube stats and a tracked link.
// /v/<code> counts the click and forwards to the landing page stored in D1, never to anything in the request.
import { YOUTUBE_CHANNELS, pacific, stamp, withYoutube } from './channels.js';
import { trackChannels } from './youtube.js';

// The switch for tracked links: groups whose videos carry none in their descriptions yet. Their link and clicks
// columns stay blank and the link list skips them; put a group in to switch it off. Home Guide Press is on (2026-11-05).
const NO_LINKS_GROUPS = [];
const LINKED = new Set(YOUTUBE_CHANNELS.filter((c) => !NO_LINKS_GROUPS.includes(c.group)).map((c) => c.slug));
const ON_YOUTUBE = new Set(YOUTUBE_CHANNELS.map((c) => c.slug));

const CODE_RE = /^[0-9a-f]{10}$/;
const YOUTUBE_RE = /^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be)\//i;

// Calendar or YouTube status to Jon's stages; null = not made yet. Only finished videos read their link or ID as
// the upload: idea rows hold their source video's YouTube link.
export function stageOf(status, link, youtubeId) {
  if (status === 'published') return 'live';
  if (status === 'scheduled') return 'scheduled';
  if (status === 'private' || status === 'unlisted') return 'posted';
  if (status !== 'qc' && status !== 'review') return null;
  return youtubeId || YOUTUBE_RE.test(link || '') ? 'posted' : 'created';
}

const plain = (status) => new Response(status === 404 ? 'Not found' : 'Try again', { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

export async function trackRedirect(request, env, ctx) {
  const code = new URL(request.url).pathname.slice('/v/'.length);
  if (!CODE_RE.test(code) || !['GET', 'HEAD'].includes(request.method) || !env.DB) return plain(404);
  let to;
  try {
    const row = await env.DB.prepare(`SELECT l.channel, COALESCE(l.landing, c.landing) AS landing FROM yt_links l
      LEFT JOIN yt_channels c ON c.slug = l.channel WHERE l.code = ?`).bind(code).first();
    if (!row?.landing) return plain(404);
    to = new URL(row.landing); // throws on a bad stored landing: answered below, and no click counted
    to.searchParams.set('utm_source', 'youtube');
    to.searchParams.set('utm_campaign', row.channel);
    to.searchParams.set('utm_content', code);
  } catch (err) {
    console.error('trackRedirect', err);
    return plain(503);
  }
  // /v/<code>?qc=1 is our own check: it forwards but isn't a viewer's click.
  if (request.method === 'GET' && !new URL(request.url).searchParams.has('qc')) {
    ctx.waitUntil(env.DB.prepare('UPDATE yt_links SET clicks = clicks + 1 WHERE code = ?').bind(code).run().catch((err) => console.error('track click', err)));
  }
  return new Response(null, { status: 302, headers: { Location: to.href, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

// Every Calendar video (the Calendar page stops at 60 days back), newest first. A link with no landing page
// has no url, so nobody pastes a link that can't redirect yet.
export async function trackVideos(db, origin, channel = null, nowMs = Date.now(), extra = null) {
  const today = pacific(nowMs).day;
  const { results } = await db.prepare(`SELECT v.channel, v.title, v.day, v.time_pt, v.status, v.link, v.youtube_id, l.code, l.clicks, s.impressions, s.ctr, s.views, s.subs, s.avd,
    s.scheduled_at AS yt_scheduled_at, s.scheduled_date AS yt_scheduled_date, s.status AS yt_status, s.updated_at, s.reach_as_of, COALESCE(l.landing, c.landing) AS landing
    FROM yt_calendar v LEFT JOIN yt_links l ON l.video_id = v.id LEFT JOIN yt_stats s ON s.youtube_id = v.youtube_id
    LEFT JOIN yt_channels c ON c.slug = v.channel
    ${channel ? 'WHERE v.channel = ?' : ''} ORDER BY v.day DESC, v.created_at LIMIT 5000`).bind(...(channel ? [channel] : [])).all();
  return (results || []).filter((r) => ON_YOUTUBE.has(r.channel) || extra?.has(r.channel)).map((row) => {
    const r = withYoutube(row, today);
    const linked = LINKED.has(r.channel) || !!extra?.has(r.channel);
    return {
      linked, code: linked ? r.code ?? null : null, url: linked && r.code && r.landing ? `${origin}/v/${r.code}` : null,
      channel: r.channel, title: r.title, date: r.day, status: stageOf(r.status, r.link, r.youtube_id), calendarStatus: r.status,
      landing: linked ? r.landing ?? null : null, clicks: linked ? r.clicks ?? 0 : null,
      impressions: r.impressions ?? null, ctr: r.ctr ?? null, views: r.views ?? null, subs: r.subs ?? null, avd: r.avd ?? null, differs: r.differs ?? null, planned: r.planned ?? null,
      updatedAt: r.updated_at ?? null, updated: r.updated_at ? stamp(r.updated_at, today) : '',
      reachAsOf: r.reach_as_of ?? null, // the newest reach report day behind impressions and CTR (src/youtube.js)
    };
  });
}

// Each connected channel's numbers since launch from Analytics (src/youtube.js), null while Analytics lags: Track then
// adds up its calendar videos' Studio numbers. Subs fall back to the public subscriber count.
async function channelTotals(db) {
  const { results } = await db.prepare('SELECT channel, channel_id, subscribers, views, studio_views, studio_subs, studio_avd, sync_error FROM yt_api').all();
  // Views are the larger of Analytics and public (Jon, 2026-11-04), so a lagging Analytics never shows less than YouTube's public count.
  const larger = (a, b) => (a == null && b == null ? null : Math.max(a ?? 0, b ?? 0));
  return Object.fromEntries((results || []).map((r) => [r.channel, { views: larger(r.studio_views, r.views), avd: r.studio_avd, subs: r.studio_subs ?? r.subscribers, error: r.sync_error || null, connected: true }]));
}

// The book page key each Home Guide Press channel sells (facts/channels.md). Other channels sell no book here.
export const BOOKS = { 'peter-collins': 'gary', 'jack-mercer': 'prepared', 'rosa-cooks': 'rosa-cooks', 'rosas-clean-home': 'rosa-clean',
  'rosas-house-hacks': 'rosa-hacks', 'giovanni-moretti': 'angelo', 'frank-bennett-dogs': 'steve', 'ruth-calder': 'ruth',
  'dale-whitaker-pitbulls': 'dale', 'nora-fairweather-cats': 'nora', 'gail-merriman-golf': 'gail', 'naomi-takeda-japan': 'naomi',
  'walter-brandt-dogs': 'walter', 'eleanor-whitfield': 'eleanor', 'diane-kowalski': 'diane', 'claudine-marchand': 'paris',
  'takeshi-morimoto': 'takeshi', 'kenzo-arai': 'kenzo', 'jiyoung-han': 'jiyoung', 'peggy-donovan': 'peggy', 'edna-haynes': 'edna' };

// Since launch, per channel: clicks are the channel's /v/ link clicks (YouTube viewers only, our ?qc=1 checks out), sales and
// revenue are paid Commas orders from the homeguidepress D1 (HGP_DB, read only) with tests and refunds out. Null when that D1
// isn't there or can't be read: Track then shows a dash, never a guess.
async function bookStats(db, hgp) {
  if (!hgp) return null;
  try {
    const [views, orders] = await Promise.all([
      db.prepare('SELECT channel, SUM(clicks) AS n FROM yt_links GROUP BY channel').all(),
      hgp.prepare('SELECT slug, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM orders WHERE is_test = 0 AND revoked_at IS NULL GROUP BY slug').all(),
    ]);
    const v = new Map((views.results || []).map((x) => [x.channel, x.n]));
    const o = new Map((orders.results || []).map((x) => [x.slug, x]));
    return Object.fromEntries(Object.entries(BOOKS).map(([channel, key]) => [channel,
      { clicks: v.get(channel) ?? 0, sales: o.get(key)?.n ?? 0, revenue: (o.get(key)?.cents ?? 0) / 100 }]));
  } catch (err) {
    console.error('bookStats', err);
    return null;
  }
}

// Null when the tables can't be read (migration 0017 or 0021 not applied), so the page says so instead of failing.
export async function trackData(db, origin, nowMs, hgp = null) {
  try {
    const channels = await trackChannels(db);
    const extra = new Set(channels.map((c) => c.slug).filter((s) => !ON_YOUTUBE.has(s))); // registered by a bot, not in the fixed list
    return { videos: await trackVideos(db, origin, null, nowMs, extra), totals: await channelTotals(db), books: await bookStats(db, hgp), channels };
  } catch (err) {
    console.error('trackData', err);
    return null;
  }
}

// Created is everything at QC or later, posted everything on YouTube; scheduled and live are as they stand now.
function countsOf(videos) {
  const of = (...stages) => videos.filter((v) => stages.includes(v.status)).length;
  return { created: of('created', 'posted', 'scheduled', 'live'), posted: of('posted', 'scheduled', 'live'), scheduled: of('scheduled'), live: of('live') };
}

// No data given means this snapshot didn't ask for Track: it stays empty until the page is opened.
export function buildTrackPage(out, data) {
  if (!out.pages?.track || data === undefined) return;
  const list = data?.videos || [];
  const known = data?.channels || YOUTUBE_CHANNELS;
  const label = new Map(known.map((c) => [c.slug, c.label]));
  out.pages.track = {
    title: 'Track',
    available: !!data,
    channels: [{ slug: 'all', label: 'All channels', group: 'All', all: true, count: list.length }, ...known.map((c) => {
      const mine = list.filter((v) => v.channel === c.slug);
      // Connect (Jon, 2026-11-11): a channel with no Google login yet gets the link that starts it; Jon does the consent himself.
      const t = data?.totals?.[c.slug];
      const state = !t ? 'none' : /connect (this channel|it) again/i.test(t.error || '') ? 'reconnect' : 'connected';
      return { ...c, connect: { state, url: `/dashboard/api/youtube/connect?channel=${c.slug}` }, count: mine.length, counts: countsOf(mine), totals: data?.totals?.[c.slug] || null, book: data?.books?.[c.slug] || null };
    })],
    videos: list.map((v) => ({ ...v, channelLabel: label.get(v.channel) })),
  };
}
