import { keepCard, matchItem } from './sponsors.js';

const TZ = 'America/Vancouver';
const WEEK_GOAL = 3;

const CHANNEL_STEP = {
  plan: { pct: 17, pill: 'Step 1 · idea', next: 'Pick the angle', pillCls: 'blue' },
  script: { pct: 33, pill: 'Step 2 · script', next: 'Record it', pillCls: 'blue', btn: 'Open script', href: 'https://jonmac.ai/yt2', primary: true },
  record: { pct: 50, pill: 'Step 3 · record', next: 'Record it', pillCls: 'blue' },
  edit: { pct: 67, pill: 'Step 4 · edit', next: 'Auto editor finishing', pillCls: 'blue', btn: 'See edit', page: 'video' },
  review: { pct: 83, pill: 'Step 5 · your review', next: 'Watch the cut', pillCls: 'blue', btn: 'See edit', page: 'video' },
  publish: { pct: 100, pill: 'Live', next: 'Done', pg: 'ok', pillCls: 'ok' },
};

const SPONSOR_STEP = {
  'invoice-sent': { pct: 17, pill: 'Step 1 · waiting on deposit', next: "Don't start until payment lands", pg: 'risk', pillCls: 'risk' },
  'deposit-paid': { pct: 33, pill: 'Step 2 · script with sponsor', next: 'Script with sponsor', pg: 'risk', pillCls: 'risk' },
  'script-approval': { pct: 33, pill: 'Step 2 · script with sponsor', next: 'Sponsor to approve script', pg: 'risk', pillCls: 'risk' },
  production: { pct: 62, pill: 'Step 4 · edit', next: 'In the editor', pillCls: 'blue', btn: 'See edit', page: 'video' },
  'video-approval': { pct: 75, pill: 'Step 5 · your review', next: 'Sponsor watching', pillCls: 'blue' },
  publishing: { pct: 87, pill: 'Live · send invoice', next: 'Send invoice', pg: 'ok', pillCls: 'ok' },
};

export function topOutliers(rows, n = 3) {
  return [...(rows || [])]
    .filter((r) => r && r.title)
    .sort((a, b) => Number(b.outlier_score || 0) - Number(a.outlier_score || 0))
    .slice(0, n);
}

export function compact(n) {
  n = Number(n) || 0;
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) {
    const k = n / 1000;
    return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(Math.round(n));
}

export function bestFit(title) {
  const t = ` ${String(title || '').toLowerCase()} `;
  if (/ ad |ads|ugc|facebook|campaign|agent/.test(t)) return 'Brand Build format';
  if (/ vs |compare|tested/.test(t)) return 'Comparison format';
  return 'AI News format';
}

function ymd(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function weekStartYmd(nowMs) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(nowMs));
  const back = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[wd] || 0;
  return ymd(nowMs - back * 86400000);
}

function publishedThisWeek(p, nowMs) {
  if (p.publish?.status !== 'published') return false;
  const t = Date.parse(p.publish.publishedAt || p.createdAt || '');
  if (!t) return false;
  return ymd(t) >= weekStartYmd(nowMs);
}

function dueOf(s) {
  const t = Date.parse(s);
  if (!t) return '—';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function channelStep(p) {
  if (p.publish?.status === 'published') return 'publish';
  if (p.edit?.status === 'review') return 'review';
  return CHANNEL_STEP[p.stage] ? p.stage : 'plan';
}

function channelRow(p) {
  const step = channelStep(p);
  const m = CHANNEL_STEP[step];
  const rendering = p.edit?.status === 'rendering';
  return {
    video: p.titleOptions?.[p.selectedTitleIndex] || p.source?.title || 'Untitled',
    type: 'Your channel',
    pct: rendering ? Number(p.edit?.progress) || m.pct : m.pct,
    pg: m.pg,
    pill: m.pill,
    pillCls: m.pillCls,
    due: '—',
    next: m.next,
    btn: m.btn,
    page: m.page,
    href: m.href,
    msg: m.btn === 'Open script' ? `Opened the script for ${p.titleOptions?.[p.selectedTitleIndex] || 'this video'}` : undefined,
    primary: m.primary,
  };
}

function sponsorRow(c) {
  const m = SPONSOR_STEP[c.stage];
  if (!m) return null;
  const ad = /90|ad/i.test(c.subject || '');
  return {
    video: c.subject ? `${c.sponsor} · ${c.subject}` : c.sponsor,
    type: ad ? 'Sponsor · ad' : 'Sponsor · dedicated',
    pct: m.pct,
    pg: m.pg,
    pill: m.pill,
    pillCls: m.pillCls,
    due: dueOf(c.latestDate),
    next: m.next,
    btn: m.btn || 'See deal',
    page: m.page || 'sponsors',
  };
}

export function overlayYoutube(page, {
  projects = [], outliers, sponsors, channels, ranked, nowMs = Date.now(),
} = {}) {
  if (page.actions?.[0]) page.actions[0].href = 'https://jonmac.ai/yt2';
  const channelRows = (projects || []).map(channelRow);
  const items = sponsors?.collections?.items;
  const rawCards = sponsors?.cards || [];
  const cards = items?.length
    ? rawCards.filter((c) => matchItem(c, items))
    : items ? rawCards.filter((c) => keepCard(c, nowMs, items)) : rawCards;
  const sponsorRows = cards.map(sponsorRow).filter(Boolean);
  if (channelRows.length || sponsorRows.length) {
    const prev = page.pipeline?.rows || [];
    const channel = channelRows.length ? channelRows : prev.filter((r) => r.type === 'Your channel');
    const sponsor = sponsorRows.length ? sponsorRows : prev.filter((r) => String(r.type || '').startsWith('Sponsor'));
    page.pipeline = { ...page.pipeline, rows: [...channel, ...sponsor] };
  }
  const live = (projects || []).filter((p) => publishedThisWeek(p, nowMs)).length;
  const prod = (projects || []).filter((p) => p.publish?.status !== 'published').length;
  const editing = (projects || []).filter((p) => p.stage === 'edit' || p.edit?.status === 'rendering').length;
  const scripts = (projects || []).filter((p) => p.stage === 'script' || p.stage === 'plan').length;
  if (page.tiles?.[0]) {
    page.tiles[0].value = String(live);
    page.tiles[0].pct = Math.round(live / WEEK_GOAL * 100);
  }
  if (page.tiles?.[1]) {
    page.tiles[1].value = String(prod);
    page.tiles[1].sub = [editing && `${editing} editing`, scripts && `${scripts} script ready`].filter(Boolean).join(' · ') || 'None in production';
  }

  if (sponsorRows.length && page.tiles[3]) {
    page.tiles[3].value = String(sponsorRows.length);
    page.tiles[3].sub = [...new Set(sponsorRows.map((r) => String(r.video).split(' · ')[0]))].join(' · ');
  }
  if (outliers?.length) {
    page.remake = {
      ...page.remake,
      seeAll: ranked != null ? `See all ${ranked}` : page.remake.seeAll,
      jobs: outliers.map((r) => ({
        area: r.channel,
        pill: `${Math.round(Number(r.outlier_score) || 0)}× their normal`,
        title: r.title,
        lines: [
          `${compact(r.views)} views · ${Math.round(Number(r.views_per_day) || 0).toLocaleString('en-US')} a day`,
          `Best fit: ${bestFit(r.title)}`,
        ],
      })),
    };
    page.tiles[2].value = `${Math.round(Number(outliers[0].outlier_score) || 0)}×`;
    if (ranked != null) {
      page.sub = `From YouTube Gen · ${channels || 0} channels watched · ${ranked} videos ranked`;
    }
  }
}
