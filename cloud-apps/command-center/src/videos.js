// Videos page: one row per channel from the single production feed
// (my-agent/state/production/status.json, owned by the avatar-studio production-tab worker),
// relayed by the GPU2 60 s beat as source `videos`. Review page status is read-only from the
// review portal's D1. Unknown values show "unknown" or "no data", never a guess.
export const STAGES = ['Script', 'HeyGen', 'Pictures', 'Edit', 'Render', 'Ana check', 'Ready for Jon', 'Approved', 'Posted'];
export const HEYGEN_AMBER = 80;
export const HEYGEN_RED = 100;
export const FEED_STALE_MS = 3 * 60 * 1000;

function parse(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export function stageIndex(stage) {
  const s = String(stage || '').toLowerCase();
  return STAGES.findIndex((x) => s.startsWith(x.toLowerCase()));
}

function reviewSlug(url) {
  const m = /jonmac\.ai\/review\/([a-z0-9-]+)/.exec(String(url || ''));
  return m ? m[1] : '';
}

function reviewLabel(row, reviews) {
  const slug = reviewSlug(row.review_url);
  if (!slug) return { text: row.review_url ? 'Review link (not on jonmac.ai)' : 'Not cleared yet', cls: '', slug: '' };
  const r = (reviews || []).find((x) => x.slug === slug);
  if (!r) return { text: 'Page cleared · status unknown', cls: '', slug };
  const open = Number(r.open_comments) || 0;
  const status = r.status === 'approved' ? 'Approved' : r.status === 'changes_requested' ? 'Changes asked' : 'Waiting on Jon';
  return {
    text: `${status} · ${r.version}${open ? ` · ${open} open comment${open === 1 ? '' : 's'}` : ''}`,
    cls: r.status === 'approved' ? 'ok' : r.status === 'changes_requested' ? 'crit' : 'risk',
    slug,
  };
}

function minutesSince(iso, nowMs) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.max(0, Math.round((nowMs - t) / 60000)) : null;
}

export function heygenTile(h) {
  const used = h?.heygenUsed;
  if (used == null || !Number.isFinite(Number(used))) {
    return { icon: 'film', label: 'HeyGen today', value: 'no data', sub: 'Production feed has no HeyGen count', pct: 0 };
  }
  const cap = Number(h.heygenCap) || 130;
  const cls = used >= HEYGEN_RED ? 'crit' : used >= HEYGEN_AMBER ? 'risk' : 'ok';
  return { icon: 'film', label: 'HeyGen generations today', value: String(used), goal: `/ ${cap}`, pct: Math.round(used / cap * 100), pg: cls, level: cls, sub: 'From the production feed' };
}

export function overlayVideos(page, row, reviews, nowMs = Date.now()) {
  const d = row ? parse(row.data) : null;
  const feedAt = Date.parse(d?.updated || '');
  const feedAge = Number.isFinite(feedAt) ? nowMs - feedAt : Infinity;
  page.title = 'Videos';
  page.stale = !d?.ok || feedAge > FEED_STALE_MS;
  page.sub = !d
    ? 'No data · GPU2 has not relayed the production feed yet'
    : !d.ok
      ? `No data · ${d.error || 'production feed unavailable'}`
      : `Production feed (avatar-studio) · updated ${Number.isFinite(feedAge) ? `${Math.round(feedAge / 60000)} min ago` : 'unknown'}${reviews ? ' · review pages live' : ' · review pages unavailable'}`;
  const rows = Array.isArray(d?.rows) ? d.rows : [];
  // Why there is nothing to show, in words that name the real source (the production feed).
  page.reason = !d
    ? 'GPU2 has not relayed the production feed yet'
    : !d.ok
      ? `Production feed: ${d.error || 'unavailable'}`
      : page.stale
        ? `Production feed is stale (last updated ${Number.isFinite(feedAge) ? `${Math.round(feedAge / 60000)} min ago` : 'unknown'})`
        : rows.length ? '' : 'Production feed has no rows';
  page.rows = rows.map((r) => {
    const idx = stageIndex(r.stage);
    const inStage = minutesSince(r.stage_started, nowMs);
    return {
      name: r.channel || 'unknown',
      host: r.host || '',
      kind: r.program === 'affiliate' ? 'affiliate' : 'viralview',
      video: [r.video_no != null ? `#${r.video_no}` : '', r.title || ''].filter(Boolean).join(' ') || 'unknown',
      sourceUrl: r.source_url || '',
      stage: r.stage || '',
      stageIdx: idx,
      stagePct: r.stage_pct,
      inStage,
      capMin: r.cap_min,
      overCap: inStage != null && r.cap_min != null && inStage > r.cap_min,
      eta: r.eta || '',
      lastLine: r.last_line || '',
      blocked: r.blocked_reason || '',
      review: reviewLabel(r, reviews),
      posts: null,
      target: r.program === 'affiliate' ? 7 : 3,
    };
  });
  page.heygen = heygenTile(d?.header);
  const ready = page.rows.filter((r) => r.stageIdx === STAGES.indexOf('Ready for Jon'));
  page.ready = ready.map((r) => ({ channel: r.name, video: r.video, slug: r.review.slug }));
  const blocked = page.rows.filter((r) => r.blocked || r.overCap);
  page.tiles = [
    page.heygen,
    { icon: 'check', label: 'Ready for Jon', value: rows.length ? String(ready.length) : 'no data', sub: ready.map((r) => r.name).join(' · ') || (rows.length ? 'None' : 'No feed') },
    { icon: 'fire', label: 'Blocked or over the 4 h cap', value: rows.length ? String(blocked.length) : 'no data', sub: blocked.map((r) => r.name).join(' · ') || (rows.length ? 'None' : 'No feed') },
    { icon: 'up', label: 'Posted this week', value: 'no data', sub: 'No record of published videos yet' },
  ];
  return page;
}
