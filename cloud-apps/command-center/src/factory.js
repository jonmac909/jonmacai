// Content Factory (redesign V4): weekly output against each channel's target, the
// views -> clicks -> sign-ups -> trials -> revenue funnel, and the production board.
// The production feed gives work in progress; no source records published videos yet,
// so weekly output says "no data" and names what is missing instead of guessing.
import { STAGES } from './videos.js';

const BUILDING = ['Script', 'HeyGen', 'Pictures', 'Edit', 'Render'];
const TZ = 'America/Vancouver';

function parse(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function usd2(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ago(minutes) {
  if (minutes == null) return '';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} hr`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

function weekLabel(nowMs) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(new Date(nowMs));
}

function oldest(rows) {
  return rows.reduce((n, r) => Math.max(n, Number(r.inStage) || 0), 0);
}

// Targets come from Ana's brief: 14 styles 42 a week, @JonMacAI 3, affiliate 7, Spotify 7.
// Shorts and the main channel have no weekly target set yet, so they say so.
function outputCards(videoRows) {
  const of = (kind) => videoRows.filter((r) => r.kind === kind);
  const make = ({ key, label, owner, target, items }) => ({
    key, label, owner, kinds: [key],
    value: 'no data',
    target: target == null ? 'no target' : String(target),
    pct: null,
    sub: items.length
      ? `${items.length} in production · oldest ${ago(oldest(items))} in stage`
      : 'No rows for this channel in the production feed',
    why: 'Weekly output needs a published-video log',
  });
  return [
    make({ key: 'viralview', label: '14 styles', owner: 'Paul', target: 42, items: of('viralview') }),
    make({ key: 'jonmacai', label: '@JonMacAI', owner: 'Grant', target: 3, items: [] }),
    make({ key: 'affiliate', label: 'Affiliate 7', owner: 'Alice', target: 7, items: of('affiliate') }),
    make({ key: 'shorts', label: 'Shorts', owner: 'Heston', target: null, items: [] }),
    make({ key: 'spotify', label: 'Spotify', owner: 'Ferran', target: 7, items: [] }),
    make({ key: 'main', label: 'Main channel', owner: 'Jon', target: null, items: [] }),
  ];
}

function funnel(by, cash = null) {
  const viral = by.viralview ? parse(by.viralview.data) : null;
  const sub = viral?.subscriptions || null;
  const clicks = (viral?.traffic || []).reduce((n, r) => n + (Number(r.clicks) || 0), 0);
  const trials = sub?.trials?.newTrials ?? sub?.current?.trialSubscriptions;
  const vvCash = Number(viral?.cashThisWeek?.netCents) || 0;
  const weekDays = new Set((viral?.cashThisWeek?.byDay || []).map((d) => d.date));
  const cashRow = by.sponsors_cash ? parse(by.sponsors_cash.data) : null;
  // Same merged deposit list Home uses, so a bank-feed day is never counted twice or missed here.
  const sponsorRows = cash?.available ? cash.recent || [] : cashRow?.rows || [];
  const sponsorWeek = sponsorRows.filter((r) => weekDays.has(r.date)).reduce((n, r) => n + (Number(r.usd) || 0), 0);
  const hasCash = !!(viral || cash?.available || cashRow);
  return {
    title: 'Views → clicks → sign-ups → trials → revenue',
    note: 'Each step keeps its own clock; a step with no feed says so.',
    steps: [
      { label: 'Views this week', value: 'no data', sub: 'No per-week view feed · YouTube sync last ran Sep 22' },
      { label: 'Link clicks', value: viral ? clicks.toLocaleString('en-US') : 'no data', sub: viral ? 'Viral View traffic · last 30 days' : 'Viral View feed unavailable' },
      { label: 'Webinar sign-ups', value: 'no data', sub: 'Zoom Meeting has no registration list' },
      { label: 'Viral View trials', value: trials == null ? 'no data' : String(trials), sub: sub ? 'This month' : 'Viral View feed unavailable' },
      {
        label: 'New revenue this week',
        value: hasCash ? usd2(vvCash / 100 + sponsorWeek) : 'no data',
        sub: hasCash ? `Viral View ${usd2(vvCash / 100)} + sponsors ${usd2(sponsorWeek)}` : 'No cash feed',
      },
    ],
  };
}

function cardOf(r) {
  return {
    id: `${r.kind}-${r.name}-${r.video}`,
    kind: r.kind,
    chip: r.name,
    title: r.video,
    host: r.host,
    stage: r.stage || 'No stage',
    meta: r.inStage == null ? '' : `${ago(r.inStage)} in stage`,
    blocked: r.blocked || '',
    overCap: !!r.overCap,
    slug: r.review?.slug || '',
    review: r.review?.text || '',
  };
}

function board(out) {
  const rows = out.pages?.videos?.rows || [];
  const social = (out.pages?.content?.queue?.rows || []).map((q) => ({
    id: `social-${q.title}`,
    kind: 'social',
    chip: 'Social queue',
    title: q.title || 'Queued post',
    meta: q.quote || '',
  }));
  const at = (names) => rows.filter((r) => names.includes(STAGES[r.stageIdx])).map(cardOf);
  return [
    { id: 'ideas', title: 'Ideas', note: 'From the Content queue', items: social, empty: 'No posts queued' },
    { id: 'building', title: 'Building', note: '', items: at(BUILDING), empty: 'Nothing building' },
    { id: 'qc', title: 'QC', note: 'Ana check', items: at(['Ana check']), empty: 'Nothing in review' },
    { id: 'ready', title: 'Ready for Jon', note: '', items: at(['Ready for Jon']), empty: 'Nothing waiting on you' },
    { id: 'published', title: 'Published', note: 'No published-video log yet', items: at(['Approved', 'Posted']), empty: 'No record yet' },
  ];
}

export function overlayFactory(page, out, by, nowMs = Date.now(), cash = null) {
  const rows = out.pages?.videos?.rows || [];
  page.factory = {
    title: 'Content Factory',
    sub: `Every video, short and long, from idea to published · Week of ${weekLabel(nowMs)}`,
    note: rows.length || out.pages?.content?.queue?.rows?.length
      ? 'Weekly output needs a published-video log; until it reports, each card shows what the production feed knows.'
      : 'Production feed unavailable, so output and the board say no data.',
    chips: [
      { id: 'all', label: 'All channels' },
      { id: 'viralview', label: 'Viral View 7' },
      { id: 'affiliate', label: 'Affiliate 7' },
      { id: 'social', label: 'Social queue' },
    ],
    outputs: outputCards(rows),
    funnel: funnel(by, cash),
    board: board(out),
  };
  return page;
}
