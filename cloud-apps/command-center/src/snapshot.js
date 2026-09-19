import { applyHomeSponsors, overlaySponsors } from './sponsors.js';
import { overlaySupport } from './support.js';
import { overlayYoutube } from './youtube.js';
import { overlayVideo } from './video.js';
import { overlayContent } from './content.js';
import { overlayMoney, overlayMarkets } from './money.js';
import { overlayViral, applyHomeViral } from './viral.js';
import { overlayOutreach } from './outreach.js';
import { overlayLife } from './life.js';
import { applyHome } from './home.js';
import { parseStamp } from './time.js';

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
  const t = parseStamp(collectedAt);
  if (!Number.isFinite(t)) return { ageMs: Infinity, stale: true, label: 'updated unknown' };
  const ageMs = Math.max(0, nowMs - t);
  return { ageMs, stale: ageMs > 3 * intervalMs, label: ageLabel(ageMs) };
}

const SKIP_SOURCES = new Set(['google_oauth', 'telegram_sent', 'health']);
const IMPORTANT = ['viralview', 'moneyclaw', 'sponsors', 'support', 'youtube', 'instantly', 'calendar', 'mastermind', 'content_queue'];

export function honestyChip(by, nowMs, fixtureChip = 'Mockup · numbers are examples') {
  const present = Object.keys(by || {}).filter((k) => !SKIP_SOURCES.has(k));
  if (!present.length) return fixtureChip;
  const stale = present.filter((k) => freshness(by[k].collected_at, nowMs, INTERVALS[k] ?? DEFAULT_INTERVAL_MS).stale);
  const missing = IMPORTANT.filter((k) => !by[k]);
  if (stale.length || missing.length) return 'Partial · some sources missing or stale';
  return 'Live · numbers from your pages';
}

function markUnverified(page, reason) {
  if (!page) return;
  page.unverified = true;
  page.sourceNote = reason;
  page.sub = page.sub ? `${reason} · ${page.sub}` : reason;
}

function applyHonesty(out, by, health, nowMs) {
  const need = {
    sponsors: 'sponsors', viral: 'viralview', youtube: 'youtube', content: 'content_queue',
    outreach: 'instantly', support: 'support', video: 'video', money: 'moneyclaw',
    markets: 'moneyclaw', life: 'calendar', mastermind: 'mastermind',
  };
  for (const [pageId, source] of Object.entries(need)) {
    if (!out.pages?.[pageId]) continue;
    const err = health?.errors?.[source];
    if (err) markUnverified(out.pages[pageId], `Source error · ${err}`);
    else if (!by[source]) markUnverified(out.pages[pageId], 'Not connected · not live numbers');
    else if (freshness(by[source].collected_at, nowMs, INTERVALS[source] ?? DEFAULT_INTERVAL_MS).stale) {
      markUnverified(out.pages[pageId], 'Stale · not live numbers');
    }
  }
  if (out.pages?.agents && !by.agents_mac && !by.agents_gpu2) {
    markUnverified(out.pages.agents, 'Not connected · not live numbers');
  }
}

function parseData(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function names(list) {
  return list.filter(Boolean).join(' · ');
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
  const need = agents.filter((a) => a.status === 'needs_you');
  const work = agents.filter((a) => a.status === 'working');
  const quiet = agents.filter((a) => a.status === 'quiet');
  const daily = agents.filter((a) => a.job === 'Done');
  const notRun = agents.filter((a) => a.status === 'not_running');
  const dailyN = agents.filter((a) => a.restart || a.job === 'Done' || a.status === 'quiet').length || daily.length;
  page.sub = `${agents.length} agents · ${work.length + need.length} running · ${notRun.length} not running`;
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
      name: a.name,
      status: a.status === 'not_running' ? 'Not running' : a.status,
      agent: a.name,
      runs: a.runs,
      now: a.now,
      job: a.job,
      pct: a.pct,
      pg: a.pg || '',
      pill: a.pill || (a.status === 'not_running' ? 'Not running' : a.status === 'working' ? 'Working' : ''),
      pillCls: a.pillCls || (a.status === 'not_running' ? 'risk' : ''),
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

function unmangleCopy(s) {
  return String(s ?? '').replace(/'anonymous/g, "'t");
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
  page.sub = `BuiltWithAI digest · last 24 hours${data.scannedAt ? ` · scanned ${data.scannedAt.slice(11, 16)}` : ''}`;
  page.actions = [{ label: 'Scan now', kind: 'mastermind.scan', msg: 'Scanning the digest now' }];
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
      title: unmangleCopy(p.title),
      href: p.href || p.url || '',
      lines: [p.ts, p.href || p.url, p.why, p.fit, p.text].filter(Boolean).slice(0, 3).map(unmangleCopy),
      lineBtn: 'Park',
      lineKind: 'mastermind.park',
      linePayload: { id: p.id, title: unmangleCopy(p.title), body: unmangleCopy(p.text), area: p.area, msg: 'Parked for later' },
      btn: 'Send to Planner',
      kind: 'mastermind.send_to_planner',
      payload: { id: p.id, title: unmangleCopy(p.title), body: unmangleCopy(p.text), area: p.area, verdict: p.verdict, msg: 'Sent to Planner as a task' },
      done: true,
    })),
  };
  page.building = {
    title: 'Being built',
    meta: 'Ideas you sent to Planner',
    rows: building.map((i) => ({
      title: unmangleCopy(i.title),
      sub: i.area || '',
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
      title: unmangleCopy(i.title),
      sub: i.area || '',
      id: i.id,
      body: unmangleCopy(i.body),
      area: i.area,
    })),
    more: { title: '', sub: '', btn: '', msg: '' },
  };
}

export function mergeSnapshot(fixture, rows, opts = {}, ideasArg, postsArg, projectsArg, extraArg, extraPos) {
  let nowMs; let overrides; let ideas; let posts; let projects; let extra;
  if (typeof opts === 'number') {
    nowMs = opts;
    if (Array.isArray(ideasArg)) {
      overrides = {};
      ideas = ideasArg;
      posts = postsArg || [];
      projects = projectsArg || [];
      extra = extraArg || {};
    } else {
      overrides = ideasArg || {};
      ideas = postsArg || [];
      posts = projectsArg || [];
      projects = extraArg || [];
      extra = extraPos || {};
    }
  } else if (Array.isArray(opts)) {
    nowMs = Date.now();
    overrides = {};
    ideas = opts;
    posts = ideasArg || [];
    projects = postsArg || [];
    extra = {};
  } else {
    nowMs = opts.nowMs ?? Date.now();
    overrides = opts.overrides || {};
    ideas = opts.ideas || [];
    posts = opts.posts || [];
    projects = opts.projects || [];
    extra = opts.extra || {};
  }
  extra = extra || {};
  const out = JSON.parse(JSON.stringify(fixture));
  const by = {};
  const staleSources = [];
  for (const row of rows || []) {
    by[row.source] = row;
    if (SKIP_SOURCES.has(row.source)) continue;
    const interval = INTERVALS[row.source] ?? DEFAULT_INTERVAL_MS;
    const f = freshness(row.collected_at, nowMs, interval);
    out.sources[row.source] = { updatedAt: row.collected_at, stale: f.stale, ageLabel: f.label };
    if (f.stale) {
      const m = MACHINES.find((x) => x.source === row.source);
      staleSources.push({ source: row.source, label: m ? m.label : row.source, ageLabel: f.label });
    }
  }
  const health = parseData(by.health?.data);
  if (out.pages.agents) {
    out.pages.agents.machines = MACHINES.map((m) => {
      const row = by[m.source];
      if (!row) return { ...m, hostname: '', ageLabel: 'No heartbeat yet', stale: false };
      const data = parseData(row.data);
      const f = freshness(row.collected_at, nowMs, INTERVALS[m.source]);
      return { ...m, hostname: data.hostname || m.label, ageLabel: f.label, stale: f.stale, updatedAt: row.collected_at };
    });
    out.pages.agents.staleSources = staleSources;
    overlayAgents(out.pages.agents, by);
    if (out.nav?.badges) out.nav.badges.agents = (out.pages.agents.waiting?.jobs || []).length;
  }
  if (out.pages.mastermind) {
    overlayMastermind(out.pages.mastermind, by.mastermind ? parseData(by.mastermind.data) : { picks: [], scanned: 0 }, ideas, nowMs);
    if (out.nav?.badges) out.nav.badges.mastermind = (out.pages.mastermind.picks?.jobs || []).length;
  }
  if (out.pages.support && by.support) {
    const f = freshness(by.support.collected_at, nowMs, INTERVALS.support);
    overlaySupport(out.pages.support, parseData(by.support.data), nowMs, f.label);
    if (out.nav?.badges) out.nav.badges.support = Number(out.pages.support.tiles?.[0]?.value || 0);
  }
  if (out.pages.sponsors) {
    overlaySponsors(out.pages.sponsors, by.sponsors ? parseData(by.sponsors.data) : {}, nowMs, overrides);
    if (by.sponsors && parseData(by.sponsors.data).collections) {
      const f = freshness(by.sponsors.collected_at, nowMs, INTERVALS.sponsors);
      out.pages.sponsors.sub = `From your collections tracker · ${f.label}`;
      applyHomeSponsors(out, out.pages.sponsors);
    }
  }
  if (out.pages.youtube) {
    const yt = by.youtube ? parseData(by.youtube.data) : {};
    overlayYoutube(out.pages.youtube, {
      projects, outliers: yt.outliers, channels: yt.channels, ranked: yt.ranked,
      sponsors: by.sponsors ? parseData(by.sponsors.data) : undefined, nowMs,
    });
  }
  if (out.pages.video) {
    overlayVideo(out.pages.video, { ...(by.video ? parseData(by.video.data) : {}), live: Number(out.pages.youtube?.tiles?.[0]?.value) || 0 });
  }
  if (out.pages.content) {
    overlayContent(out.pages.content, {
      posts,
      queue: by.content_queue ? parseData(by.content_queue.data) : null,
      viral: by.viralview ? parseData(by.viralview.data) : null,
      video: by.video ? parseData(by.video.data) : null,
      drafts: extra.drafts || [],
      draftsError: extra.draftsError || '',
      platforms: extra.platforms,
      nowMs,
    });
    if (out.nav?.badges && out.pages.content.queueCount != null) out.nav.badges.content = out.pages.content.queueCount;
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
  if (out.pages.outreach) {
    if (by.instantly) overlayOutreach(out.pages.outreach, parseData(by.instantly.data));
    else overlayOutreach(out.pages.outreach, null, { missing: true });
  }
  if (out.pages.life) {
    overlayLife(out.pages.life, {
      ...(by.calendar ? parseData(by.calendar.data) : { connected: false, events: [] }),
      habits: extra.habits || [],
      nowMs,
    });
  }
  applyHome(out, by, extra, nowMs);
  applyHonesty(out, by, health, nowMs);
  if (out.pages.home) out.pages.home.chip = honestyChip(by, nowMs, fixture.pages?.home?.chip || 'Mockup · numbers are examples');
  return out;
}
