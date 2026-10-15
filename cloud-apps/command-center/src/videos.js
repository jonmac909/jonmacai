// Videos page: one row per channel (7 ViralView + 7 affiliate) from the GPU2 `videos` source
// plus the review portal's D1 (read-only). Missing data shows "no data", never a guess.
export const STAGES = ['script', 'HeyGen', 'build', 'render', 'Ana check', 'ready for Jon', 'approved', 'posted'];
export const HEYGEN_AMBER = 80;
export const HEYGEN_RED = 100;

const HEYGEN_BUSY = new Set(['creating', 'draft', 'submitted', 'rendering', 'processing']);

function parse(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function latestReview(reviews, ch) {
  const rows = (reviews || []).filter((r) => (ch.key && r.video === ch.key) || (ch.reviewSlug && (r.slug === ch.reviewSlug || r.video === ch.reviewSlug)));
  rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return rows[0] || null;
}

export function stageOf(ch, review) {
  if (ch.posted) return 'posted';
  if (review?.status === 'approved' || ch.uploadApproved) return 'approved';
  if (review?.status === 'needs_review') return 'ready for Jon';
  const led = ch.ledger?.status || '';
  if (review?.status === 'changes_requested') return 'build';
  if (ch.queueStatus === 'review') return 'Ana check';
  if (HEYGEN_BUSY.has(led)) return 'HeyGen';
  if (led === 'done') return 'build';
  if (led === 'failed') return 'HeyGen';
  if (ch.queueStatus === 'producing') return 'build';
  if (ch.queueStatus === 'brief') return 'script';
  return '';
}

function reviewLabel(review) {
  if (!review) return { text: 'No page', cls: '' };
  const open = Number(review.open_comments) || 0;
  const status = review.status === 'approved' ? 'Approved' : review.status === 'changes_requested' ? 'Changes asked' : 'Waiting on Jon';
  return {
    text: `${status} · ${review.version}${open ? ` · ${open} open comment${open === 1 ? '' : 's'}` : ''}`,
    cls: review.status === 'approved' ? 'ok' : review.status === 'changes_requested' ? 'crit' : 'risk',
    slug: review.slug,
  };
}

export function heygenTile(h) {
  if (!h || !Number.isFinite(Number(h.used))) {
    return { icon: 'film', label: 'HeyGen today', value: 'no data', sub: 'heygen_submits.csv not found', pct: 0 };
  }
  const used = Number(h.used);
  const cap = Number(h.cap) || 130;
  const cls = used >= HEYGEN_RED ? 'crit' : used >= HEYGEN_AMBER ? 'risk' : 'ok';
  return {
    icon: 'film',
    label: 'HeyGen generations today',
    value: String(used),
    goal: `/ ${cap}`,
    pct: Math.round(used / cap * 100),
    pg: cls,
    level: cls,
    sub: `${h.pressed ?? used} Generate presses logged on ${h.date} PT · sponsor videos not logged`,
  };
}

export function overlayVideos(page, row, reviews, label) {
  const d = row ? parse(row.data) : null;
  const channels = Array.isArray(d?.channels) ? d.channels : [];
  page.title = 'Videos';
  page.sub = d ? `Remake queue + HeyGen ledger from GPU2 · ${label}${reviews ? ' · review pages live' : ' · review pages unavailable'}` : 'No data from GPU2 yet';
  page.stale = !d;
  page.rows = channels.map((ch) => {
    const review = latestReview(reviews, ch);
    const stage = stageOf(ch, review);
    const posts = d.posts && d.posts[ch.id] != null ? d.posts[ch.id] : null;
    return {
      id: ch.id,
      name: ch.name,
      kind: ch.kind,
      video: ch.title || ch.key || '',
      key: ch.key || '',
      more: ch.alsoActive ? `+${ch.alsoActive} more in progress` : '',
      stage,
      stageIdx: STAGES.indexOf(stage),
      heygen: ch.ledger?.status || '',
      review: reviewLabel(review),
      posts: posts != null && Number.isFinite(Number(posts)) ? Number(posts) : null,
      target: ch.target,
    };
  });
  page.heygen = heygenTile(d?.heygen);
  const ready = page.rows.filter((r) => r.stage === 'ready for Jon');
  page.ready = ready.map((r) => ({ channel: r.name, video: r.video || r.key, slug: r.review.slug || '' }));
  page.tiles = [
    page.heygen,
    { icon: 'check', label: 'Ready for Jon', value: String(ready.length), sub: ready.map((r) => r.name).join(' · ') || 'None' },
    { icon: 'film', label: 'In HeyGen now', value: String(page.rows.filter((r) => r.stage === 'HeyGen').length), sub: 'Videos waiting on a HeyGen render' },
    { icon: 'up', label: 'Posted this week', value: 'no data', sub: 'No record of published videos yet' },
  ];
  return page;
}
