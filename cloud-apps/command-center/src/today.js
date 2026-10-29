// Today page (dashboard plan step 2, 2026-10-29): the four $10k/month goals, one "Needs you"
// list Jon can act on in place, Ana's morning summary and this week's Claude usage. Every card
// names its source and when it last changed; anything older than 24 hours is marked stale.
import { criticalAlerts } from './alerts.js';

const TZ = 'America/Vancouver';
const DAY_MS = 86400000;
const GOAL_USD = 10000;

function parse(raw, fallback = {}) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || ''); } catch { return fallback; }
}

function agoLabel(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.floor(h / 24)} days ago`;
}

// { label, at, ageLabel, stale }: stale when older than 24 hours or never reported.
export function sourceOf(label, at, nowMs) {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return { label, at: null, ageLabel: 'never reported', stale: true };
  const age = Math.max(0, nowMs - t);
  return { label, at, ageLabel: `updated ${agoLabel(age)}`, stale: age > DAY_MS };
}

const UNREADABLE = 'The feeds table could not be read.';

function vanParts(ms) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  return Object.fromEntries(p.filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
}

// Midnight in Vancouver on the given calendar day, as epoch ms.
export function vanMidnight(y, m, d) {
  const t = Date.UTC(y, m - 1, d, 8);
  return t - vanParts(t).hour * 3600000;
}

export function monthWindow(nowMs) {
  const p = vanParts(nowMs);
  const start = vanMidnight(p.year, p.month, 1);
  const end = p.month === 12 ? vanMidnight(p.year + 1, 1, 1) : vanMidnight(p.year, p.month + 1, 1);
  return {
    start, end,
    key: `${p.year}-${String(p.month).padStart(2, '0')}`,
    label: new Date(Date.UTC(p.year, p.month - 1, 15)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }),
    elapsed: Math.min(1, Math.max(0, (nowMs - start) / (end - start))),
    daysLeft: Math.max(0, Math.ceil((end - nowMs) / DAY_MS)),
  };
}

function money(n) {
  const x = Number(n) || 0;
  const digits = Math.abs(x - Math.round(x)) < 1e-9 ? 0 : 2;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);
}

function paceStatus(pct, elapsed) {
  if (elapsed < 0.03) return { text: 'Month just started', cls: 'idle' };
  const ratio = pct / (elapsed * 100);
  if (ratio >= 0.95) return { text: 'On pace', cls: 'ok' };
  if (ratio >= 0.65) return { text: 'Behind', cls: 'risk' };
  return { text: 'Off pace', cls: 'crit' };
}

function noData(key, label, why, source) {
  return { key, label, value: 'no data', goal: `/ ${money(GOAL_USD)}`, usd: null, pct: 0, pacePct: null, status: { text: 'No data', cls: 'idle' }, why, drivers: [], source };
}

function monthlyCard(key, label, usd, win, drivers, source, warn = '') {
  const pct = Math.min(100, Math.round((usd / GOAL_USD) * 100));
  return {
    key, label, value: money(usd), goal: `/ ${money(GOAL_USD)}`, usd, pct,
    pacePct: Math.round(win.elapsed * 100), status: paceStatus(pct, win.elapsed),
    meta: `Pace says ${money(GOAL_USD * win.elapsed)} by today · ${win.daysLeft} days left`,
    drivers, source, warn,
  };
}

function sponsorsCard(cash, by, win, nowMs) {
  const label = `Sponsors · ${win.label}`;
  if (!cash?.available) return noData('sponsors', label, 'The sponsor cash ledger has not reported.', sourceOf('Sponsor cash ledger', null, nowMs));
  const row = cash.source?.kind === 'bank' ? by.moneyclaw : by.sponsors_cash;
  const owed = cash.unpaidAvailable && cash.owed ? ` · ${money(cash.owed)} owed` : '';
  const unknown = Number(cash.month?.unknown) || 0;
  const src = sourceOf(`Sponsor cash · ${cash.source?.label || 'ledger'}`, row?.collected_at, nowMs);
  // The collector re-sends the same ledger every few minutes; the ledger's own age decides staleness.
  if (cash.source?.stale) src.stale = true;
  const warn = [cash.source?.stale ? cash.source.note : '', unknown ? `${unknown} deposit${unknown === 1 ? ' has no amount yet and counts' : 's have no amount yet and count'} as $0.` : '']
    .filter(Boolean).join(' ');
  return monthlyCard('sponsors', label, Number(cash.month?.usd) || 0, win, [
    { label: 'Deposits this month', value: `${cash.month?.payments || 0}${owed}` },
    { label: 'Counted from', value: cash.source?.label || 'ledger' },
  ], src, warn);
}

function viralCard(by, nowMs) {
  const src = sourceOf('Viral View subscriptions feed', by.viralview?.collected_at, nowMs);
  const sub = by.viralview ? parse(by.viralview.data).subscriptions : null;
  const cur = sub?.current;
  if (!cur || cur.mrrCents == null) return noData('viral', 'Viral View recurring revenue', 'The Viral View subscription feed has not reported MRR.', src);
  const usd = (Number(cur.mrrCents) || 0) / 100;
  const pct = Math.min(100, Math.round((usd / GOAL_USD) * 100));
  return {
    key: 'viral', label: 'Viral View recurring revenue', value: money(usd), goal: `/ ${money(GOAL_USD)} MRR`, usd, pct, pacePct: null,
    status: pct >= 100 ? { text: 'Reached', cls: 'ok' } : { text: `${pct}% of goal`, cls: pct >= 80 ? 'ok' : pct >= 50 ? 'risk' : 'crit' },
    meta: `${money(Math.max(0, GOAL_USD - usd))} MRR to go`,
    drivers: [
      { label: 'Paying customers', value: String(cur.activeCustomers ?? 'no data') },
      { label: 'New customers this month', value: String(sub.customers?.newThisMonth ?? 'no data') },
      { label: 'Trials this month', value: String(sub.trials?.newTrials ?? 'no data') },
    ],
    source: src,
  };
}

// From the cron's `webinar_funnel` snapshot (clone D1, read every 10 minutes).
function webinarCard(row, win, nowMs) {
  const label = `Webinar funnel · ${win.label}`;
  const src = sourceOf('Clone funnel database (verified payments minus refunds, every 10 min)', row?.collected_at, nowMs);
  const f = row ? parse(row.data) : null;
  if (!f || f.month !== win.key) return noData('webinar', label, `The funnel figure for ${win.label} has not been read yet.`, src);
  const last = Date.parse(f.lastEventAt);
  return monthlyCard('webinar', label, (Number(f.netCents) || 0) / 100, win, [
    { label: 'Payments this month', value: String(f.payments ?? 0) },
    { label: 'Lander visits this month', value: String(f.visits ?? 0) },
    { label: 'Last funnel activity', value: Number.isFinite(last) ? agoLabel(Math.max(0, nowMs - last)) : 'none this month' },
  ], src);
}

function ebooksCard(feed, win, nowMs) {
  const label = `Home Guide Press ebooks · ${win.label}`;
  const src = sourceOf('Home Guide Press · ebook_sales feed', feed?.createdAt, nowMs);
  if (feed === null) return noData('ebooks', label, UNREADABLE, src);
  if (!feed) return noData('ebooks', label, `No ebook sales posted for ${win.label} yet. Home Guide Press posts them with dash.py feed-put ebook_sales.`, src);
  const d = feed.data || {};
  const drivers = [{ label: 'Orders this month', value: d.orders == null ? 'not posted' : String(d.orders) }, { label: 'Posted by', value: feed.bot }];
  if (d.note) drivers.push({ label: 'Note', value: d.note });
  return monthlyCard('ebooks', label, Number(d.usd) || 0, win, drivers, src);
}

function itemAt(at) {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : Infinity;
}

function needsList(out, extra, nowMs) {
  const t = extra.today;
  const items = [];
  for (const a of criticalAlerts(out)) {
    items.push({
      id: `alert:${a.key}`, kind: 'alert', rank: 0, cls: 'crit', title: a.text, from: 'Dashboard',
      page: a.key.startsWith('bank') ? 'money' : 'sponsors', btn: a.key.startsWith('bank') ? 'Open Money' : 'Open Sponsors',
    });
  }
  for (const a of t?.approvals || []) {
    // Jon must see exactly what the bot will run, not just its own title for it (payloads are
    // capped at 4000 formatted characters when requested, so this is always the whole thing).
    items.push({
      id: a.id, kind: 'approval', rank: 1, cls: 'risk', title: a.title, from: a.requestedBy, at: a.createdAt,
      detail: `Runs ${a.action}`, action: a.action,
      payloadPreview: JSON.stringify(a.payload || {}, null, 2),
      decideUrl: `/dashboard/api/v1/approvals/${a.id}/decide`,
    });
  }
  for (const q of t?.questions || []) {
    items.push({
      id: q.id, kind: 'question', rank: 2, cls: 'risk', title: q.question, context: q.context || '', options: q.options || [],
      from: q.askedBy, at: q.createdAt, answerUrl: `/dashboard/api/v1/questions/${q.id}/answer`,
    });
  }
  // The old MausBot feeds (Ana's hourly push, Waiting On You, the GPU2 review tracker) left Today on
  // 2026-10-29: their open items were closed or moved into the bot tables, which are the one source.
  for (const it of items) {
    const at = itemAt(it.at);
    it.ageLabel = Number.isFinite(at) ? agoLabel(Math.max(0, nowMs - at)) : '';
  }
  items.sort((a, b) => a.rank - b.rank || itemAt(a.at) - itemAt(b.at));
  const live = t?.questions && t?.approvals;
  const sources = [{ label: 'Bot questions and approvals', at: null, ageLabel: live ? 'live' : 'could not be read', stale: !live }];
  return { count: items.length, items, sources, available: !!live };
}

function summaryCard(feed, nowMs) {
  const source = sourceOf("Ana's morning summary", feed?.createdAt, nowMs);
  if (feed === null) return { source, missing: UNREADABLE };
  if (!feed) return { source, missing: 'No summary yet. Ana posts it each morning at 08:15 PT with dash.py feed-put morning_summary.' };
  return { source, text: feed.data?.text || '', date: feed.data?.date || '', by: feed.bot };
}

export const USAGE_LEVELS = [
  { min: 90, cls: 'crit', short: 'Over 90%', text: 'Only Sponsors and Viral View keep working (plus Ana and QC).' },
  { min: 75, cls: 'risk', short: 'Over 75%', text: 'Only Sponsors, Viral View, Video Editor, Jon Mac YouTube and Home Guide Press keep working.' },
  { min: 0, cls: 'ok', short: 'Normal', text: 'All bots can work.' },
];

function usageCard(feed, runs, nowMs) {
  const source = sourceOf("Ana's Claude usage check", feed?.createdAt, nowMs);
  const bots = runs ? { tokens: runs.tokens, runs: runs.runs } : null;
  if (feed === null) return { source, bots, missing: UNREADABLE };
  if (!feed) return { source, bots, missing: 'No usage posted yet. Ana posts the weekly figure with dash.py feed-put claude_usage.' };
  const pct = Number(feed.data?.weekPct) || 0;
  const level = USAGE_LEVELS.find((l) => pct > l.min || l.min === 0);
  const resets = Date.parse(feed.data?.resetsAt);
  return {
    source, bots, pct, level,
    resets: Number.isFinite(resets) ? new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(resets)) : '',
    note: feed.data?.note || '',
  };
}

export function buildToday(out, by, cash, extra = {}, nowMs = Date.now()) {
  if (!out.pages?.today) return;
  const win = monthWindow(nowMs);
  const feeds = extra.today?.feeds || {};
  const goals = [
    sponsorsCard(cash, by, win, nowMs),
    viralCard(by, nowMs),
    webinarCard(by.webinar_funnel, win, nowMs),
    ebooksCard(feeds.ebook_sales, win, nowMs),
  ];
  const reporting = goals.filter((g) => g.usd != null);
  const total = reporting.reduce((n, g) => n + g.usd, 0);
  out.pages.today = {
    title: 'Today',
    date: new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(nowMs)),
    clock: new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(nowMs)),
    total: {
      value: money(total), goal: money(GOAL_USD * goals.length), pct: Math.min(100, Math.round((total / (GOAL_USD * goals.length)) * 100)),
      reporting: `${reporting.length} of ${goals.length} goals reporting`,
    },
    goals,
    needs: needsList(out, extra, nowMs),
    summary: summaryCard(feeds.morning_summary, nowMs),
    usage: usageCard(feeds.claude_usage, extra.today?.runs7d, nowMs),
  };
}
