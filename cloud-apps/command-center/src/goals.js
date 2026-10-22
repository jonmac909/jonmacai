// Home (redesign V1): the three money goals, the asks waiting on Jon, what moved this
// week, and the bottom strip. Every number is read from a collector snapshot; where a
// source does not report, the card says "no data" and names what is missing.
import { usd, usdExact } from './cash.js';
import { WEBINAR_AT } from './webinar.js';

const TZ = 'America/Vancouver';
const MRR_TARGET_CENTS = 1000000;
const MRR_DEADLINE = '2026-12-14T23:59:59-08:00';
// The MRR goal has no recorded start date. Quarter-to-date is the pace window: from the
// first day of the current quarter to the Dec 14 deadline, both stated on the card.
const MRR_START = '2026-10-01T00:00:00-07:00';

function parse(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function vanParts(ms) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  return Object.fromEntries(p.filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
}

function vanDate(ms) {
  const p = vanParts(ms);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function money(n, digits) {
  const x = Number(n) || 0;
  const d = digits == null ? (Math.abs(x - Math.round(x)) < 1e-9 ? 0 : 2) : digits;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
}

function daysBetween(aMs, bMs) {
  return Math.max(0, Math.ceil((bMs - aMs) / 86400000));
}

function paceMeta(pct) {
  if (pct >= 95) return { text: 'On pace', cls: 'ok' };
  if (pct >= 65) return { text: 'Behind', cls: 'risk' };
  return { text: 'Off pace', cls: 'crit' };
}

function monthBounds(nowMs) {
  const p = vanParts(nowMs);
  const days = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  const elapsed = (p.day - 1 + (p.hour * 60 + p.minute) / 1440) / days;
  return { days, day: p.day, elapsed, left: days - p.day, label: new Date(Date.UTC(p.year, p.month - 1, 15)).toLocaleString('en-US', { month: 'long' }) };
}

function sponsorCard(cash, by, nowMs) {
  const m = monthBounds(nowMs);
  if (!cash.available) {
    return {
      key: 'sponsors', label: `Sponsors · ${m.label}`, owner: 'Daniel', value: 'no data', goal: '/ $10,000',
      pct: 0, pacePct: Math.round(m.elapsed * 100), status: { text: 'No data', cls: 'idle' },
      metaLeft: 'Sponsor cash ledger has not reported', metaRight: `${m.left} days left`,
      drivers: [{ label: 'Owner', value: 'Daniel' }], noData: true,
    };
  }
  const target = cash.target || 10000;
  const got = Number(cash.month?.usd) || 0;
  const pct = Math.min(100, Math.round((got / target) * 100));
  const paceUsd = target * m.elapsed;
  const status = got === 0 && m.elapsed > 0.05 ? { text: 'No payments', cls: 'crit' } : paceMeta(pct / Math.max(1, m.elapsed * 100) * 100);
  const owed = cash.unpaidAvailable && cash.owed ? ` · ${usd(cash.owed)} owed` : '';
  const src = cash.source || {};
  return {
    key: 'sponsors', label: `Sponsors · ${m.label}`, owner: 'Daniel',
    value: money(got), goal: `/ ${money(target)}`, pct, pacePct: Math.round(m.elapsed * 100),
    status,
    metaLeft: `Pace says ${usd(paceUsd)} by today`, metaRight: `${m.left} days left`,
    drivers: [
      { label: 'Deposits this month', value: `${cash.month?.payments || 0}${owed}` },
      { label: 'Trailing 90-day avg', value: `${usd(cash.trailing?.avg || 0)} / mo` },
      { label: 'Counted from', value: `${src.label || 'no data'}${src.stale ? ' · stale' : ''}` },
      { label: 'Owner', value: 'Daniel' },
    ],
    warn: src.stale ? src.note : '',
  };
}

function viralCard(by, nowMs) {
  const data = by.viralview ? parse(by.viralview.data) : null;
  const sub = data?.subscriptions || null;
  const deadline = Date.parse(MRR_DEADLINE);
  const days = daysBetween(nowMs, deadline);
  if (!sub) {
    return {
      key: 'viral', label: 'Viral View MRR', owner: 'Gordon', value: 'no data', goal: '/ $10,000',
      pct: 0, pacePct: null, status: { text: 'No data', cls: 'idle' },
      metaLeft: 'Viral View subscription feed has not reported', metaRight: `Dec 14 · ${days} days`,
      drivers: [{ label: 'Owner', value: 'Gordon' }], noData: true,
    };
  }
  const cur = sub.current || {};
  const mrr = Number(cur.mrrCents) || 0;
  const pct = Math.min(100, Math.round((mrr / MRR_TARGET_CENTS) * 100));
  const need = Math.max(0, MRR_TARGET_CENTS - mrr) / Math.max(1, days / 7);
  const start = Date.parse(MRR_START);
  const pacePct = Math.min(100, Math.max(0, Math.round(((nowMs - start) / (deadline - start)) * 100)));
  const status = pct >= 80 ? { text: 'On pace', cls: 'ok' } : pct >= 50 ? { text: 'Behind', cls: 'risk' } : { text: 'Off pace', cls: 'crit' };
  return {
    key: 'viral', label: 'Viral View MRR', owner: 'Gordon',
    value: money(mrr / 100), goal: `/ ${money(MRR_TARGET_CENTS / 100)}`, pct, pacePct,
    paceTitle: 'Quarter-to-date pace: Oct 1 to Dec 14',
    status,
    metaLeft: mrr >= MRR_TARGET_CENTS ? 'Target reached' : `Needs +${money(need / 100)} a week`,
    metaRight: `Dec 14 · ${days} days`,
    drivers: [
      { label: 'Paying customers', value: String(cur.activeCustomers ?? 'no data') },
      { label: 'New customers this month', value: String(sub.customers?.newThisMonth ?? 'no data') },
      { label: 'Trials this month', value: String(sub.trials?.newTrials ?? 'no data') },
      { label: 'Owner', value: 'Gordon' },
    ],
  };
}

function webinarCard(by, extra, nowMs) {
  const at = Date.parse(WEBINAR_AT);
  const days = daysBetween(nowMs, at);
  const data = by.webinar ? parse(by.webinar.data) : null;
  const items = data?.items || {};
  const failed = Object.values(items).filter((x) => x?.status === 'fail').length;
  const pending = Object.values(items).filter((x) => x?.status === 'pending').length;
  const onOct29 = (extra.funnel?.sessions || []).filter((s) => /October 29/.test(String(s.session_label))).reduce((n, s) => n + Number(s.n || 0), 0);
  const checkout = !data ? 'No test results' : failed ? `${failed} failed · ${pending} pending` : `${Object.keys(items).length} checked`;
  return {
    key: 'webinar', label: 'Webinar funnel', owner: 'René',
    value: `${onOct29} buyers`, goal: '/ seat target no data',
    pct: 0, pacePct: null,
    status: { text: 'No seat data', cls: 'idle' },
    metaLeft: 'Oct 29 · 4 PM PT · no registration list',
    metaRight: `${days} days`,
    drivers: [
      { label: 'Checkout test', value: checkout },
      { label: 'Buyers assigned to Oct 29', value: String(onOct29) },
      { label: 'Owner', value: 'René' },
    ],
    noData: true,
    noSeatTarget: true,
  };
}

function destination(area, ask) {
  const s = `${area || ''} ${ask || ''}`.toLowerCase();
  if (/namecheap|domain/.test(s)) return { href: 'https://www.namecheap.com/myaccount/login/', btn: 'Open Namecheap' };
  if (/github/.test(s)) return { href: 'https://github.com/settings/billing', btn: 'Open GitHub' };
  if (/webinar|zoom/.test(s)) return { page: 'webinar', btn: 'Open Webinar' };
  if (/sponsor|invoice|contract/.test(s)) return { page: 'sponsors', btn: 'Open Sponsors' };
  if (/bank|rbc|wise|tax|expense|finance/.test(s)) return { page: 'money', btn: 'Open Finances' };
  if (/video|youtube|review/.test(s)) return { page: 'videos', btn: 'Open Videos' };
  if (/content|post/.test(s)) return { page: 'content', btn: 'Open Content' };
  return null;
}

function waitingItems(out, by, extra) {
  const items = [];
  const nj = by.needs_jon ? parse(by.needs_jon.data) : null;
  if (nj?.ok && Array.isArray(nj.items)) {
    for (const it of nj.items) {
      const dest = destination(it.area, it.ask);
      items.push({
        area: it.area || 'Ana',
        title: it.ask || 'Needs you',
        detail: it.area ? `Waiting On You · ${it.area}` : 'Waiting On You',
        pill: 'Needs you', pillCls: 'risk',
        ...(dest || {}),
      });
    }
  }
  const vids = out.pages.videos;
  if (vids?.available !== false && Array.isArray(vids?.ready)) {
    for (const v of vids.ready) {
      items.push({
        area: `${v.channel || 'Video'}`,
        title: `${v.video || 'Video'} · ready for you`,
        detail: v.slug ? 'Review page is open' : 'Production feed says Ready for Jon',
        pill: 'Ready for you', pillCls: 'crit',
        ...(v.slug ? { href: `/review/${v.slug}`, btn: 'Review' } : { page: 'videos', btn: 'Open Videos' }),
      });
    }
  }
  return items;
}

function movedItems(by, cash, extra, nowMs) {
  const weekAgo = vanDate(nowMs - 6 * 86400000);
  const today = vanDate(nowMs);
  const week = (cash.available ? cash.recent : []).filter((r) => r.date >= weekAgo && r.date <= today);
  const weekSum = week.reduce((n, r) => n + (Number(r.usd) || 0), 0);
  const out = [];
  out.push({
    pill: `+${money(weekSum)}`, cls: weekSum ? 'ok' : 'idle',
    text: week.length ? `Sponsor payments this week · ${week.map((r) => r.sponsor).filter(Boolean).slice(0, 3).join(', ')}` : 'No sponsor payments recorded this week',
  });
  const sub = by.viralview ? parse(by.viralview.data).subscriptions : null;
  const newC = Number(sub?.customers?.newThisMonth ?? 0);
  out.push({ pill: `+${sub ? newC : 'no data'}`, cls: newC ? 'ok' : 'idle', text: sub ? `Viral View customers this month · ${newC} new` : 'Viral View customers · no data' });
  const onOct29 = (extra.funnel?.sessions || []).filter((s) => /October 29/.test(String(s.session_label))).reduce((n, s) => n + Number(s.n || 0), 0);
  out.push({ pill: `+${extra.funnel ? onOct29 : 'no data'}`, cls: onOct29 ? 'ok' : 'idle', text: extra.funnel ? `Webinar buyers assigned to Oct 29` : 'Webinar buyers · funnel database unavailable' });
  out.push({ pill: 'no data', cls: 'idle', text: 'Videos published this week · no published-video log yet' });
  return out;
}

export function buildGoalsHome(out, by, cash, extra, nowMs) {
  const home = out.pages?.home;
  if (!home) return;
  const cards = [sponsorCard(cash, by, nowMs), viralCard(by, nowMs), webinarCard(by, extra, nowMs)];
  home.goalTitle = 'Three goals, $30k a month';
  home.clock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(nowMs));
  const behind = cards.filter((c) => c.status.cls === 'risk' || c.status.cls === 'crit').length;
  home.goalPill = { text: `${behind} of 3 behind pace`, cls: behind ? 'risk' : 'ok' };
  home.goalCards = cards;
  const waiting = waitingItems(out, by, extra);
  const njOk = !!by.needs_jon && parse(by.needs_jon.data).ok === true;
  const vidsOk = out.pages.videos?.available !== false && Array.isArray(out.pages.videos?.ready);
  home.waiting = {
    title: 'Waiting on you',
    count: waiting.length,
    items: waiting,
    available: njOk || vidsOk,
    why: njOk || vidsOk ? '' : 'Waiting On You and the production feed have not reported.',
  };
  home.moved = { title: 'What moved the goals this week', items: movedItems(by, cash, extra, nowMs) };
  const team = out.pages.team;
  const next = out.pages.team?.paul?.next || null;
  home.strip = [
    next
      ? { label: "Paul's next video", value: next.time, pill: `in ${next.label}`, cls: 'ok', sub: '4-hour cadence · America/Vancouver' }
      : { label: "Paul's next video", value: 'no data', pill: '', sub: '' },
    { label: 'Videos this week', value: 'no data', pill: 'No published log', cls: 'idle', sub: `${out.pages.videos?.ready?.length || 0} ready for Jon` },
    team?.available
      ? { label: 'Team', value: `${team.counts.working} working`, pill: team.counts.stuck ? `${team.counts.stuck} stuck` : `${team.counts.idle} idle`, cls: team.counts.stuck ? 'crit' : 'ok', sub: `${team.counts.waiting || 0} waiting on you` }
      : { label: 'Team', value: 'no data', pill: '', cls: 'idle', sub: team?.reason || 'Team collector has not reported' },
    cash.available
      ? { label: `Cash in, ${cash.month.label}`, value: usdExact(cash.month.usd), pill: cash.source.stale ? 'Stale' : '', cls: cash.source.stale ? 'risk' : 'idle', sub: `${cash.month.payments} deposits · ${cash.source.label}` }
      : { label: 'Cash in this month', value: 'no data', pill: '', sub: 'Sponsor cash ledger has not reported' },
  ];
  home.waitingCount = waiting.length;
}
