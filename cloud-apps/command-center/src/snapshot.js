import { buildSponsorsPage, applyHomeSponsors } from './sponsors.js';
import { overlaySupport } from './support.js';
import { applyReviewDrafts, plannerDestination } from './review.js';
import { overlayYoutube } from './youtube.js';
import { overlayVideo } from './video.js';
import { overlayContent } from './content.js';
import { overlayMoney, overlayMarkets, monthVerified, quoteStamp } from './money.js';
import { overlayViral, applyHomeViral } from './viral.js';
import { overlayOutreach } from './outreach.js';
import { overlayLife } from './life.js';
import { applyHome } from './home.js';

export const COLLECTOR_INTERVAL_MS = 5 * 60 * 1000;

export const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

export const INTERVALS = {
  agents_mac: COLLECTOR_INTERVAL_MS,
  agents_gpu2: COLLECTOR_INTERVAL_MS,
  sponsors: COLLECTOR_INTERVAL_MS,
  mastermind: COLLECTOR_INTERVAL_MS,
  support: COLLECTOR_INTERVAL_MS,
  video: COLLECTOR_INTERVAL_MS,
  youtube: DEFAULT_INTERVAL_MS,
  content_queue: COLLECTOR_INTERVAL_MS,
  viralview: DEFAULT_INTERVAL_MS,
  moneyclaw: DEFAULT_INTERVAL_MS,
  instantly: DEFAULT_INTERVAL_MS,
  calendar: DEFAULT_INTERVAL_MS,
  bank_scan: COLLECTOR_INTERVAL_MS,
};

const MACHINES = [
  { id: 'mac', label: 'Mac mini', source: 'agents_mac' },
  { id: 'gpu2', label: 'GPU2', source: 'agents_gpu2' },
];

export function ageLabel(ageMs) {
  const m = Math.floor(ageMs / 60000);
  if (m < 1) return 'updated just now';
  if (m === 1) return 'updated 1 min ago';
  if (m < 60) return `updated ${m} min ago`;
  const h = Math.floor(m / 60);
  if (h === 1) return 'updated 1 hr ago';
  if (h < 48) return `updated ${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'updated 1 day ago' : `updated ${d} days ago`;
}

export function freshness(collectedAt, nowMs, intervalMs) {
  const t = Date.parse(collectedAt);
  if (!Number.isFinite(t)) return { ageMs: Infinity, stale: true, label: 'updated unknown' };
  const ageMs = Math.max(0, nowMs - t);
  return { ageMs, stale: ageMs > 3 * intervalMs, label: ageLabel(ageMs) };
}

function parseData(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function names(list) {
  return list.filter(Boolean).join(' · ');
}

function vanDate(nowMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}

function dayBefore(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

function stampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function homeChip(by, nowMs) {
  const tracked = ['sponsors', 'moneyclaw', 'viralview'];
  if (!tracked.some((name) => by[name])) return null;
  const issues = [];
  const sponsors = by.sponsors ? parseData(by.sponsors.data) : null;
  if (!sponsors) issues.push('sponsors missing');
  else {
    const ms = stampMs(sponsors.updatedAt || sponsors.asOf || sponsors.generatedAt);
    if (!Number.isFinite(ms)) issues.push('sponsors source time unavailable');
    else if (nowMs - ms > 3 * INTERVALS.sponsors) issues.push('sponsors source stale');
  }
  const money = by.moneyclaw ? parseData(by.moneyclaw.data) : null;
  if (!money) issues.push('MoneyClaw missing');
  else {
    const asOf = String(money.asOf || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) issues.push('expense as-of unavailable');
    else if (asOf < dayBefore(vanDate(nowMs))) issues.push('expenses stale');
    if (!quoteStamp(money)) issues.push('markets quote time unavailable');
    if (!monthVerified(money.expenses?.business?.month)) issues.push('month totals unverified');
  }
  const viral = by.viralview ? parseData(by.viralview.data) : null;
  if (!viral) issues.push('Viral View missing');
  else {
    const ms = stampMs(viral.lastSyncAt);
    if (!Number.isFinite(ms)) issues.push('Viral View sync time unavailable');
    else if (nowMs - ms > 3 * INTERVALS.viralview) issues.push('Viral View sync stale');
  }
  if (!issues.length) return 'Live · numbers from your pages';
  const stale = issues.some((issue) => /stale/i.test(issue));
  const other = issues.some((issue) => !/stale/i.test(issue));
  const head = stale && other ? 'Partial' : stale ? 'Stale' : 'Unavailable';
  return `${head} · ${issues.join(' · ')}`;
}

function overlayAgents(page, by) {
  const agents = [];
  for (const m of MACHINES) {
    const row = by[m.source];
    if (!row) continue;
    for (const a of parseData(row.data).agents || []) {
      agents.push({ ...a, runs: a.runs || m.label, machine: a.machine || m.id });
    }
  }
  if (!agents.length) return;
  const need = agents.filter((a) => a.status === 'needs_you');
  const work = agents.filter((a) => a.status === 'working');
  const quiet = agents.filter((a) => a.status === 'quiet');
  const daily = agents.filter((a) => a.job === 'Done');
  const dailyN = agents.filter((a) => a.restart || a.job === 'Done' || a.status === 'quiet').length || daily.length;
  page.sub = `${agents.length} pinned in Orca · across the Mac mini and GPU2`;
  page.tiles = [
    { icon: 'clock', label: 'Need you', value: String(need.length), sub: names(need.map((a) => a.name)) || 'None' },
    { icon: 'bot', label: 'Working now', value: String(work.length), sub: names(work.map((a) => a.name)) || 'None' },
    { icon: 'check', label: 'Daily jobs done today', value: String(daily.length), goal: dailyN ? `/ ${dailyN}` : '', pct: dailyN ? Math.round(daily.length / dailyN * 100) : 0, pg: 'ok', sub: '' },
    { icon: 'fire', label: 'Gone quiet', value: String(quiet.length), sub: quiet[0] ? `${quiet[0].name}` : 'None' },
  ];
  page.waiting = {
    title: 'Waiting on you',
    jobs: need.map((a) => ({
      area: a.name,
      pill: (a.waiting && a.waiting.waitLabel) || 'Needs you',
      pillCls: 'risk',
      title: (a.waiting && a.waiting.title) || a.now,
      lines: (a.waiting && a.waiting.lines) || [a.now],
      page: a.page || undefined,
      btn: a.page ? 'Open' : '',
    })),
  };
  page.all = {
    title: 'All agents',
    rows: agents.map((a) => ({
      agent: a.name,
      runs: a.runs,
      now: a.now,
      job: a.job,
      pct: a.pct,
      pg: a.pg || '',
      pill: a.pill,
      pillCls: a.pillCls || '',
      page: a.page || undefined,
      machine: a.machine,
      restart: a.restart || '',
      restartMsg: a.restartMsg || '',
    })),
  };
}

function monthOf(iso, nowMs) {
  const tz = 'America/Vancouver';
  const d = new Date(Number.isFinite(Date.parse(iso)) ? iso : nowMs);
  const n = new Date(nowMs);
  return d.toLocaleString('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' })
    === n.toLocaleString('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' });
}

function overlayMastermind(page, data, ideas, nowMs) {
  const decided = new Set((ideas || []).filter((i) => i.status && i.status !== 'new').map((i) => i.id));
  const picks = (data.picks || []).filter((p) => !decided.has(p.id));
  const scanned = Number(data.scanned || 0);
  const kept = picks.length;
  const parked = (ideas || []).filter((i) => i.status === 'parked');
  const building = (ideas || []).filter((i) => i.status === 'sent' || i.status === 'building' || i.status === 'built');
  const sentMonth = (ideas || []).filter((i) => ['sent', 'building', 'built'].includes(i.status) && monthOf(i.created_at, nowMs));
  const builtMonth = (ideas || []).filter((i) => i.status === 'built' && monthOf(i.created_at, nowMs));
  page.sub = `AI Advanced group on Telegram · last 24 hours${data.scannedAt ? ` · scanned ${data.scannedAt.slice(11, 16)}` : ''}`;
  page.actions = [{ label: 'Scan now', kind: 'mastermind.scan', msg: 'Scanning the group now' }];
  page.tiles = [
    { icon: 'chat', label: 'Messages read for you', value: String(scanned), sub: `${kept} kept · ${Math.max(0, scanned - kept)} skipped` },
    { icon: 'bulb', label: 'Picks waiting on you', value: String(kept), sub: `${picks.filter((p) => p.verdict === 'implement').length} worth doing · ${picks.filter((p) => p.verdict !== 'implement').length} maybe` },
    { icon: 'send', label: 'Sent to Planner this month', value: String(sentMonth.length), sub: `${builtMonth.length} already built` },
    { icon: 'check', label: 'Ideas built · September', value: String(builtMonth.length), goal: '/ 5', pct: Math.round(builtMonth.length / 5 * 100), sub: `${building.filter((i) => i.status !== 'built').length} in progress` },
  ];
  page.picks = {
    title: "Today's picks",
    jobs: picks.map((p) => ({
      id: p.id,
      area: p.area || 'Mastermind',
      pill: p.verdict === 'implement' ? 'Worth doing' : 'Maybe',
      pillCls: p.verdict === 'implement' ? 'ok' : 'risk',
      title: p.title,
      lines: p.lines || [p.text].filter(Boolean),
      lineBtn: 'Park',
      lineKind: 'mastermind.park',
      linePayload: { id: p.id, title: p.title, body: p.text, area: p.area, msg: 'Parked for later' },
      btn: 'Send to Planner',
      kind: 'mastermind.send_to_planner',
      payload: { id: p.id, title: p.title, body: p.text, area: p.area, verdict: p.verdict, msg: plannerDestination(p.title) },
      done: true,
    })),
  };
  page.building = {
    title: 'Being built',
    meta: 'Ideas you sent to Planner',
    rows: building.map((i) => ({
      title: i.title,
      sub: `${i.area || 'Planner'} · Orca worktree under Planner`,
      pct: i.status === 'built' ? 100 : i.status === 'building' ? 75 : 25,
      pg: i.status === 'built' ? 'ok' : '',
      pill: i.status === 'built' ? 'Built' : 'Building',
      pillCls: i.status === 'built' ? 'ok' : 'blue',
    })),
  };
  page.parked = {
    title: 'Parked',
    meta: parked.length ? `${parked.length} saved for later` : 'None saved',
    rows: parked.map((i) => ({
      title: i.title,
      sub: i.area || '',
      id: i.id,
      body: i.body,
      area: i.area,
    })),
    more: { title: '', sub: '', btn: '', msg: '' },
  };
}

export function mergeSnapshot(fixture, rows, nowMs = Date.now(), overrides = {}, ideas = [], posts = [], projects = [], extra = {}) {
  if (Array.isArray(overrides)) {
    ideas = overrides;
    overrides = {};
  }
  extra = extra || {};
  const out = JSON.parse(JSON.stringify(fixture));
  const by = {};
  const staleSources = [];
  for (const row of rows || []) {
    by[row.source] = row;
    if (row.source === 'google_oauth' || row.source === 'telegram_sent') continue;
    const interval = INTERVALS[row.source] ?? DEFAULT_INTERVAL_MS;
    const f = freshness(row.collected_at, nowMs, interval);
    out.sources[row.source] = { updatedAt: row.collected_at, stale: f.stale, ageLabel: f.label };
    if (f.stale) {
      const m = MACHINES.find((x) => x.source === row.source);
      staleSources.push({ source: row.source, label: m ? m.label : row.source, ageLabel: f.label });
    }
  }
  if (out.pages.agents) {
    out.pages.agents.machines = MACHINES.map((m) => {
      const row = by[m.source];
      if (!row) return { ...m, hostname: '', ageLabel: 'No heartbeat yet', stale: false };
      const data = parseData(row.data);
      const f = freshness(row.collected_at, nowMs, INTERVALS[m.source]);
      return {
        ...m,
        hostname: data.hostname || m.label,
        ageLabel: f.label,
        stale: f.stale,
        updatedAt: row.collected_at,
      };
    });
    out.pages.agents.staleSources = staleSources;
    overlayAgents(out.pages.agents, by);
    if (out.nav?.badges) {
      const need = (out.pages.agents.waiting?.jobs || []).length;
      out.nav.badges.agents = need;
    }
  }
  if (out.pages.mastermind && by.mastermind) {
    overlayMastermind(out.pages.mastermind, parseData(by.mastermind.data), ideas, nowMs);
    if (out.nav?.badges) out.nav.badges.mastermind = (out.pages.mastermind.picks?.jobs || []).length;
  }
  if (out.pages.support && by.support) {
    const f = freshness(by.support.collected_at, nowMs, INTERVALS.support);
    overlaySupport(out.pages.support, parseData(by.support.data), nowMs, f.label);
    if (out.nav?.badges) out.nav.badges.support = Number(out.pages.support.tiles?.[0]?.value || 0);
  }
  const sponsors = by.sponsors;
  if (sponsors) {
    const data = parseData(sponsors.data);
    if (data.collections) {
      const page = buildSponsorsPage(data, nowMs, overrides);
      const f = freshness(sponsors.collected_at, nowMs, INTERVALS.sponsors);
      page.sub = `From your collections tracker · ${f.label}`;
      if (out.pages.sponsors) out.pages.sponsors = page;
      applyHomeSponsors(out, page);
    }
  }
  if (out.pages.youtube) {
    const yt = by.youtube ? parseData(by.youtube.data) : {};
    overlayYoutube(out.pages.youtube, {
      projects,
      outliers: yt.outliers,
      channels: yt.channels,
      ranked: yt.ranked,
      sponsors: by.sponsors ? parseData(by.sponsors.data) : undefined,
      nowMs,
    });
  }
  if (out.pages.video && by.video) {
    overlayVideo(out.pages.video, {
      ...parseData(by.video.data),
      live: Number(out.pages.youtube?.tiles?.[0]?.value) || 0,
    });
  }

  if (out.pages.content) {
    const qRow = by.content_queue;
    const vRow = by.viralview;
    overlayContent(out.pages.content, {
      posts,
      queue: qRow ? parseData(qRow.data) : null,
      viral: vRow ? parseData(vRow.data) : null,
      video: by.video ? parseData(by.video.data) : null,
      nowMs,
      drafts: extra.drafts || [],
      draftsError: extra.draftsError || '',
      unavailable: extra.unavailable || [],
    });
    if (out.nav?.badges && out.pages.content.queueCount != null) {
      out.nav.badges.content = out.pages.content.queueCount;
    }
  }
  if (by.moneyclaw) {
    const data = parseData(by.moneyclaw.data);
    const f = freshness(by.moneyclaw.collected_at, nowMs, INTERVALS.moneyclaw);
    if (out.pages.money) overlayMoney(out.pages.money, data, nowMs, f.label);
    if (out.pages.markets) overlayMarkets(out.pages.markets, data, nowMs, f.label);
  }
  if (by.viralview) {
    const data = parseData(by.viralview.data);
    const f = freshness(by.viralview.collected_at, nowMs, INTERVALS.viralview);
    const page = out.pages.viral || { tiles: [], ads: { rows: [] } };
    overlayViral(page, data, nowMs, f.label);
    if (out.pages.viral) out.pages.viral = page;
    applyHomeViral(out, page);
  }
  if (out.pages.outreach && by.instantly) {
    overlayOutreach(out.pages.outreach, parseData(by.instantly.data));
  }
  if (out.pages.life) {
    if (by.calendar) {
      overlayLife(out.pages.life, { ...parseData(by.calendar.data), habits: extra.habits || [], nowMs });
    } else {
      out.pages.life.actions = [{ label: 'Connect calendar', href: '/dashboard/api/google/start' }, ...(out.pages.life.actions || [])];
    }
  }
  applyHome(out, by, extra, nowMs);
  const chip = homeChip(by, nowMs);
  if (chip && out.pages?.home) out.pages.home.chip = chip;
  const review = by.cc_review_drafts ? parseData(by.cc_review_drafts.data) : [];
  applyReviewDrafts(out, review);
  return out;
}
