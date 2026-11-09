// Dashboard 2 (docs/dashboard-2.md): month goals, this week's targets and today as one `d2` object, next to the pages
// /dashboard already builds. View only: it reads D1, the snapshot rows and those pages, and writes nothing.
// Targets, labels, owners and the focus list live in d2-goals.json; each `metric` there names a function in METRICS.
import CONFIG from './d2-goals.json' with { type: 'json' };
import { ageLabel as daysAgo, allChannels, dayLabel, timeLabel } from './channels.js';
import { overlayBankScan } from './money.js';
import { vanYmd, weekStart } from './periods.js';
import { agoLabel, monthWindow, sourceOf, vanMidnight } from './today.js';
import { BOOKS } from './track.js';
import { buildSummary, fetchWeather } from './summary.js';
import { funnelMonth } from './webinar.js';

const TZ = 'America/Vancouver';
const DAY = 86400000;
// Bot slugs as first names, as BOT_NAMES in public/js/ui.js (Jon reads names, never slugs).
const NAMES = {
  jon: 'Jon', ana: 'Ana', sponsors: 'Florence', 'video-editor': 'Olivia', 'viral-view': 'Scarlett', 'jon-mac-youtube': 'Sydney',
  'home-guide-press': 'Elle', 'short-form': 'Samantha', accounting: 'Elizabeth', developer: 'Lucy', qc: 'Jessica', inbox: 'Zendaya',
  spotify: 'Daisy', moneyclaw: 'Mila', historient: 'Emma', 'yt-strategy': 'Indy',
};
const nameOf = (slug) => NAMES[slug] || String(slug || '');
const STAGE = { todo: 'Not started', doing: 'In production', waiting_on_jon: 'Waiting on you', qc: 'In QC', review: 'In Review', done: 'Done' };
const SPONSOR_VIDEO = /\bvideo\s+\d+\b/i; // as tools/weekly_counts.py
const ST = {
  done: { text: 'Done', cls: 'ok' }, on: { text: 'On pace', cls: 'ok' }, early: { text: 'On pace', cls: 'idle' },
  behind: { text: 'Behind', cls: 'risk' }, off: { text: 'Off pace', cls: 'crit' },
  none: { text: 'No data', cls: 'idle' }, untracked: { text: 'Not tracked yet', cls: 'idle' }, notDue: { text: 'None due yet', cls: 'idle' },
};

// ---- dates (Vancouver days as YYYY-MM-DD) ----
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dow = (ymd) => (new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
const fmt = (ymd, o) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(new Date(`${ymd}T12:00:00Z`));
const short = (ymd) => fmt(ymd, { month: 'short', day: 'numeric' }); // Nov 2
const dayName = (ymd) => `${fmt(ymd, { weekday: 'short' })} ${Number(ymd.slice(8))}`; // Mon 2
const span = (a, b) => (a.slice(0, 7) === b.slice(0, 7) ? `${short(a)} to ${Number(b.slice(8))}` : `${short(a)} to ${short(b)}`);
const midnight = (ymd) => vanMidnight(...ymd.split('-').map(Number));
const dayOf = (iso) => (Number.isFinite(Date.parse(iso)) ? vanYmd(Date.parse(iso)) : null);
const clockOf = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const clamp = (x) => Math.min(1, Math.max(0, x));

export function periodOf(nowMs) {
  const ymd = vanYmd(nowMs);
  const start = weekStart(nowMs);
  const end = addDays(start, 6);
  const win = monthWindow(nowMs);
  const first = `${win.key}-01`;
  const daysInMonth = Math.round((win.end - win.start) / DAY);
  const last = addDays(first, daysInMonth - 1);
  const weeks = [];
  for (let s = addDays(first, -dow(first)); s <= last; s = addDays(s, 7)) weeks.push({ start: s, end: addDays(s, 6), label: span(s, addDays(s, 6)), current: s === start });
  return {
    tz: TZ,
    today: {
      ymd,
      label: new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(nowMs)),
      clock: new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(nowMs)),
      weekday: dow(ymd),
    },
    week: {
      start, end, label: span(start, end),
      days: [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(start, i)).map((d) => ({ ymd: d, label: dayName(d), isToday: d === ymd, isPast: d < ymd })),
    },
    month: { key: win.key, label: `${win.label} ${win.key.slice(0, 4)}`, daysInMonth, elapsed: win.elapsed, daysLeft: win.daysLeft, weeksInMonth: daysInMonth / 7, weeks },
  };
}

// ---- D1 reads: each part is null on its own when its table or binding can't be read ----
export async function d2Data(env, nowMs) {
  const P = periodOf(nowMs);
  const win = monthWindow(nowMs);
  const from = P.month.weeks[0].start;
  const at = (ymd) => new Date(midnight(ymd)).toISOString();
  const [hist, rbc] = ['histories', 'rbc'].map((k) => CONFIG.checks.find((c) => c.key === k));
  const q = async (db, sql, ...args) => {
    if (!db) return null;
    try { return (await db.prepare(sql).bind(...args).all()).results || []; } catch (err) { console.error('d2', err); return null; }
  };
  const db = env.DB;
  const [calendar, calAt, channels, tasks, qcPassed, keys, ticks, rbcLast, runs, proofs, orders, funnelWeek, weather] = await Promise.all([
    q(db, 'SELECT channel, day, status FROM yt_calendar WHERE day >= ? AND day <= ? LIMIT 5000', from, P.month.weeks.at(-1).end),
    q(db, 'SELECT MAX(updated_at) AS at FROM yt_calendar'), // the calendars' age
    q(db, 'SELECT * FROM yt_channels'),
    // Every sponsor card (a deal's first "video N" card can be old), plus short-form cards done since the month's first week began.
    // Newest first, so the cap drops the oldest.
    q(db, `SELECT id, title, owner, status, project, due, created_at, done_at FROM bot_tasks WHERE status != 'cancelled'
      AND (project = 'sponsors' OR (project = 'short-form' AND status = 'done' AND done_at >= ?)) ORDER BY created_at DESC, id LIMIT 3000`, at(from)),
    // "One video edited and QC-passed": a Home Guide Press card owned by Olivia (she edits every video) with a proof QC passed today.
    q(db, `SELECT DISTINCT p.task_id FROM bot_proofs p JOIN bot_tasks t ON t.id = p.task_id
      WHERE p.status = 'passed' AND p.created_at >= ? AND p.checked_at >= ? AND t.project = 'home-guide-press' AND t.owner = 'video-editor'`,
    new Date(nowMs - 14 * DAY).toISOString(), at(P.today.ymd)),
    q(db, "SELECT id, idem_key FROM bot_questions WHERE status = 'open'"),
    q(db, 'SELECT day, project, item, link, created_at FROM bot_daily_ticks WHERE day >= ?', P.week.start),
    q(db, 'SELECT MAX(day) AS day FROM bot_daily_ticks WHERE project = ? AND item = ?', rbc.project, rbc.items[0]),
    q(db, "SELECT started_at, note FROM bot_runs WHERE bot = ? AND status = 'ok' AND started_at >= ? ORDER BY started_at", hist.bot, at(P.week.start)),
    q(db, 'SELECT p.link, p.note, p.created_at FROM bot_proofs p JOIN bot_tasks t ON t.id = p.task_id WHERE t.owner = ? AND p.created_at >= ?', hist.bot, at(P.week.start)),
    // Paid book orders this month, counted as Track counts Sales (bookStats in src/track.js): tests and refunds out.
    q(env.HGP_DB, 'SELECT slug, created_at FROM orders WHERE is_test = 0 AND revoked_at IS NULL AND created_at >= ? AND created_at < ?',
      new Date(win.start).toISOString(), new Date(win.end).toISOString()),
    funnelMonth(env.CLONE_DB, nowMs - 7 * DAY, nowMs),
    fetchWeather(nowMs), // the one network call: Open-Meteo, kept 10 minutes
  ]);
  return { calendar, calAt: calAt?.[0]?.at ?? null, channels, tasks, qcPassed, keys, ticks, rbcLast: rbcLast?.[0]?.day ?? null, runs, proofs, orders, hgpBound: !!env.HGP_DB, funnelWeek, weather };
}

// ---- metrics ----
const parse = (raw) => {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
};
const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const live = (label, ok, nowMs, why = 'could not be read') => (ok ? { label, at: new Date(nowMs).toISOString(), ageLabel: 'live', stale: false } : { label, at: null, ageLabel: why, stale: true });
// Questions kept out of Jon's Needs you, by idempotency key: bot health goes to Ana, MoneyClaw's known charges to the expenses review.
const hiddenOf = (key) => (/^team-guard/.test(key || '') ? 'health' : /^cw:/.test(key || '') ? 'charge' : null);
const goalOf = (project) => CONFIG.goals.find((g) => g.project === project)?.key ?? null;

// `clear`: a count to bring to zero (open questions, invoices waiting). Early in a period nothing is due yet.
function statusOf(actual, target, pace, unit, clear = false) {
  if (actual == null || target == null) return ST.none;
  if (clear) return actual === 0 ? ST.done : ST.behind;
  if (actual >= target) return ST.done;
  if (unit === 'yesno') return pace / target < 0.5 ? ST.early : ST.behind;
  if (pace == null) return ST.behind;
  if (unit === 'usd' ? pace < target * 0.03 : pace < 1) return ST.early;
  const r = actual / pace;
  return r >= 0.95 ? ST.on : r >= 0.65 ? ST.behind : ST.off;
}

function displayOf(unit, actual, target) {
  if (actual == null) return 'No data';
  if (unit === 'usd') return usd(actual);
  if (unit === 'yesno') return actual ? 'Yes' : 'No';
  return target == null ? String(actual) : `${actual} of ${target}`;
}

function metric(cfg, owner, f) {
  const target = 'target' in f ? f.target : cfg.target ?? null;
  const actual = f.actual ?? null;
  const pace = f.pace == null ? null : cfg.unit === 'usd' ? Math.round(f.pace) : Math.round(f.pace * 10) / 10;
  return {
    key: cfg.key, label: cfg.label, unit: cfg.unit, target, actual,
    display: f.display ?? (f.untracked ? 'Not tracked yet' : displayOf(cfg.unit, actual, target)),
    pace,
    status: f.status || (f.untracked ? ST.untracked : statusOf(actual, target, pace, cfg.unit, cfg.target === 0)),
    owner, source: f.source, note: f.note || '', behind: f.behind || [], rows: f.rows || [], days: f.days || [],
    ...(f.perDay ? { perDay: f.perDay, split: !!f.split } : {}), // trend inputs, removed before the answer
  };
}

const weekDays = (C, fn, target = null) => C.P.week.days.map((d) => ({ ymd: d.ymd, target, actual: d.ymd > C.today ? null : fn(d.ymd) }));
// Oldest first (the query reads newest first, so its cap drops the oldest).
const videoCards = (C) => C.data.tasks && C.data.tasks.filter((c) => c.project === 'sponsors' && SPONSOR_VIDEO.test(c.title || ''))
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
const sponsorOf = (title) => title.split(':')[0].replace(/\s*\bvideo\s+\d+\b.*$/i, '').trim() || title;

const METRICS = {
  sponsorCash(cfg, g, C) { // the Today page's Sponsors card (goalCards in src/today.js): same dollars, source and stale flag
    const card = C.cards.find((c) => c.key === 'sponsors');
    const has = card?.usd != null;
    const perDay = {};
    for (const r of C.cash?.recent || []) if (r.date >= C.first && r.date <= C.today) perDay[r.date] = (perDay[r.date] || 0) + (Number(r.usd) || 0);
    return metric(cfg, g.owner, {
      actual: has ? card.usd : null, display: has ? card.value : 'No data', pace: cfg.target * C.P.month.elapsed,
      status: !has ? ST.none : card.usd >= cfg.target ? ST.done : card.status.text === 'Month just started' ? ST.early : card.status,
      source: card?.source || sourceOf('Sponsor cash ledger', null, C.nowMs), note: has ? card.warn : card?.why,
      perDay: has ? perDay : null, split: true,
    });
  },
  dealsSigned(cfg, g, C) {
    const cards = videoCards(C);
    // The deal board keeps no signed date, so a deal counts as signed the week its sponsor's first "video N" card was made.
    const first = new Map();
    for (const c of cards || []) {
      const name = sponsorOf(c.title);
      if (!first.has(name.toLowerCase())) first.set(name.toLowerCase(), { name, day: dayOf(c.created_at) });
    }
    const signed = [...first.values()].filter((s) => s.day >= C.ws && s.day <= C.we);
    return metric(cfg, g.owner, {
      actual: cards && signed.length, pace: cfg.target * C.weekShare,
      source: { ...C.src.cards, label: 'Sponsor video cards (first card per sponsor; the deal board keeps no signed date)' },
      note: signed.length ? `Signed: ${signed.map((s) => s.name).join(', ')}` : '',
      days: cards ? weekDays(C, (d) => signed.filter((s) => s.day === d).length) : [],
    });
  },
  sponsorVideos(cfg, g, C) {
    const cards = videoCards(C);
    const done = (cards || []).filter((c) => c.status === 'done' && dayOf(c.done_at) >= C.ws && dayOf(c.done_at) <= C.we);
    const open = (cards || []).filter((c) => c.status !== 'done' && (!c.due || c.due <= C.we));
    return metric(cfg, g.owner, {
      actual: cards && done.length, pace: cfg.target * C.weekShare, source: { ...C.src.cards, label: 'Sponsor video cards' },
      behind: open.map((c) => ({ title: c.title.split(':')[0].trim(), owner: nameOf(c.owner), why: `${STAGE[c.status] || c.status}${c.due ? `, due ${short(c.due)}` : ''}`, open: c.id })),
      days: cards ? weekDays(C, (d) => done.filter((c) => dayOf(c.done_at) === d).length) : [],
    });
  },
  invoicesWaiting(cfg, g, C) {
    // Without a sponsors feed, pages.sponsors is still the fixture's mockup: no number from it.
    const real = !!parse(C.by.sponsors?.data).collections;
    const cards = real ? C.out.pages.sponsors?.board?.columns?.find((c) => c.boardStage === 'publishing')?.cards || [] : null;
    return metric(cfg, g.owner, {
      actual: cards && cards.length, display: !cards ? 'No data' : cards.length ? `${cards.length} waiting` : 'None waiting',
      source: sourceOf('Sponsor deal board', C.by.sponsors?.collected_at, C.nowMs),
      note: 'Cards in "Live · send invoice" on the deal board. The day each video went live is not recorded.',
      behind: (cards || []).map((k) => ({ title: k.name, owner: g.owner, why: 'Video is live, invoice not sent' })),
    });
  },
  tick(cfg, g, C) { // the owner's daily checklist item, ticked today (bot_daily_ticks)
    const ticks = C.data.ticks;
    const t = ticks?.find((x) => x.day === C.today && x.project === cfg.project && x.item === cfg.item);
    return metric(cfg, g.owner, {
      actual: ticks && (t ? 1 : 0), display: !ticks ? 'No data' : t ? `Yes, ${clockOf(t.created_at)}` : 'Not yet',
      pace: cfg.target * C.dayShare, source: { ...C.src.ticks, label: `${g.owner}'s daily checklist` }, note: `The "${cfg.item}" checklist tick.`,
    });
  },
  tickDays(cfg, g, C) { // days this week the owner ticked the item
    const ticks = C.data.ticks;
    if (!ticks) return metric(cfg, g.owner, { actual: null, source: { ...C.src.ticks, label: `${g.owner}'s daily checklist` } });
    const days = weekDays(C, (d) => (ticks.some((x) => x.day === d && x.project === cfg.project && x.item === cfg.item) ? 1 : 0), 1);
    const n = days.reduce((s, d) => s + (d.actual || 0), 0);
    const missed = days.filter((d) => d.ymd < C.today && !d.actual);
    return metric(cfg, g.owner, {
      actual: n, display: `${n} of ${cfg.target} days checked`, pace: cfg.target * C.weekShare, days,
      source: { ...C.src.ticks, label: `${g.owner}'s daily checklist` },
      note: `The daily "${cfg.item}" tick. Site check failures go to Ana and are not stored on the dashboard.`,
      behind: missed.length ? [{ title: cfg.item, owner: g.owner, why: `Not ticked ${missed.map((d) => dayName(d.ymd)).join(', ')}` }] : [],
    });
  },
  openQuestions(cfg, g, C) {
    const qs = C.t.questions;
    const n = qs ? qs.filter((q) => q.askedBy === cfg.bot && !hiddenOf(C.keyOf.get(q.id))).length : null;
    return metric(cfg, g.owner, {
      actual: n, display: n == null ? 'No data' : n ? `${n} open` : 'None open', source: C.src.questions, note: `Open questions ${g.owner} asked you.`,
    });
  },
  videos(cfg, g, C, period) { // calendar rows at published, dated in the period (tools/weekly_counts.py)
    const rows = C.data.calendar;
    const month = period === 'month';
    const per = month ? Math.round(cfg.perChannel * C.P.month.weeksInMonth) : cfg.perChannel;
    const share = month ? C.P.month.elapsed : C.weekShare;
    const target = per * C.chans.length;
    if (!rows) return metric(cfg, g.owner, { target, actual: null, source: C.src.calendar, note: 'The channel calendars could not be read.' });
    const [from, to] = month ? [C.first, C.last] : [C.ws, C.we];
    const slugs = new Set(C.chans.map((c) => c.slug));
    const mine = rows.filter((r) => slugs.has(r.channel));
    const count = (slug, status) => mine.filter((r) => r.channel === slug && r.status === status && r.day >= from && r.day <= to).length;
    const list = C.chans.map((c) => ({ c, n: count(c.slug, 'published'), s: count(c.slug, 'scheduled') }));
    const out = list.map(({ c, n, s }) => ({
      c, s, label: c.label, target: per, actual: n, display: `${n} of ${per}`, status: statusOf(n, per, per * share, 'count'), owner: g.owner,
      note: c.noCalendar ? 'No calendar yet' : s ? `${s} scheduled ${month ? 'this month' : 'this week'}` : '',
    }));
    const perDay = {};
    for (const r of mine) if (r.status === 'published') perDay[r.day] = (perDay[r.day] || 0) + 1;
    const scheduled = list.reduce((n, x) => n + x.s, 0);
    return metric(cfg, g.owner, {
      target, actual: list.reduce((n, x) => n + Math.min(x.n, per), 0), pace: target * share, source: C.src.calendar,
      rows: out.map(({ c, s, ...r }) => r),
      note: [C.chans.length > 1 ? `Counts up to ${per} a channel.` : '', scheduled ? `${scheduled} more scheduled.` : ''].filter(Boolean).join(' '),
      behind: out.filter((r) => r.c.noCalendar || ['risk', 'crit'].includes(r.status.cls)).map((r) => ({
        title: r.label, owner: g.owner, why: r.c.noCalendar ? 'No calendar yet' : `${r.actual} of ${per} published${r.s ? `, ${r.s} scheduled` : ''}`,
        page: `pipeline/${g.key}/${r.c.slug}/calendar`, // its Calendar tab in the Pipeline
      })),
      days: month ? [] : weekDays(C, (d) => perDay[d] || 0),
      perDay, split: true,
    });
  },
  shorts(cfg, g, C, period) { // short-form cards moved to Done in the period (done_at); target perDay x the period's days
    const tasks = C.data.tasks;
    const target = cfg.perDay * { month: C.P.month.daysInMonth, week: 7, day: 1 }[period];
    const perDay = {};
    for (const c of tasks || []) {
      const d = c.project === 'short-form' && c.status === 'done' && dayOf(c.done_at);
      if (d) perDay[d] = (perDay[d] || 0) + 1;
    }
    const [from, to, share] = period === 'month' ? [C.first, C.last, C.P.month.elapsed] : period === 'week' ? [C.ws, C.we, C.weekShare] : [C.today, C.today, C.dayShare];
    const sum = Object.entries(perDay).reduce((n, [d, k]) => n + (d >= from && d <= to ? k : 0), 0);
    return metric(cfg, g.owner, {
      target, actual: tasks && sum, pace: target * share, source: { ...C.src.cards, label: 'Short-form cards moved to Done' },
      days: period === 'week' && tasks ? weekDays(C, (d) => perDay[d] || 0, cfg.perDay) : [],
      perDay: tasks ? perDay : null, split: true,
    });
  },
  firstSales(cfg, g, C) {
    const orders = C.data.orders;
    const target = C.chans.length;
    const source = live('Home Guide Press orders', !!orders, C.nowMs, C.data.hgpBound ? 'could not be read' : 'not connected here');
    if (!orders) {
      return metric(cfg, g.owner, { target, actual: null, source, note: C.data.hgpBound ? 'The Home Guide Press orders table could not be read.' : 'The Home Guide Press orders database is not connected here.' });
    }
    const book = new Map(C.chans.filter((c) => BOOKS[c.slug]).map((c) => [BOOKS[c.slug], c.slug]));
    const sales = {};
    const perDay = {};
    for (const o of orders) {
      const slug = book.get(o.slug);
      const d = dayOf(o.created_at);
      if (!slug) continue;
      sales[slug] = (sales[slug] || 0) + 1;
      if (d) perDay[d] = (perDay[d] || 0) + 1;
    }
    const rows = C.chans.map((c) => {
      const n = BOOKS[c.slug] ? sales[c.slug] || 0 : null;
      return {
        label: c.label, target: 1, actual: n, display: n == null ? 'No book page yet' : plural(n, 'sale'),
        status: n == null ? ST.none : statusOf(n ? 1 : 0, 1, C.P.month.elapsed, 'yesno'), owner: g.owner, note: '',
      };
    });
    const actual = rows.filter((r) => r.actual > 0).length;
    return metric(cfg, g.owner, {
      target, actual, display: `${actual} of ${target} channels`, pace: target * C.P.month.elapsed, source, rows,
      note: 'Paid book orders this month, counted the way Track counts Sales (test and refunded orders left out).', perDay,
    });
  },
  qcPassed(cfg, g, C) {
    const n = C.data.qcPassed ? C.data.qcPassed.length : null;
    const target = Math.floor((C.dayShare * 24) / cfg.everyHours);
    const notDue = n != null && target === 0; // 00:00 to 02:59: nothing to judge yet
    return metric(cfg, g.owner, {
      target, actual: n, pace: target, display: n == null ? 'No data' : notDue ? ST.notDue.text : `${n} of ${target} by now`, status: notDue && ST.notDue,
      source: { ...C.src.cards, label: 'QC checks on Olivia\'s Home Guide Press cards' },
      note: `One every ${cfg.everyHours} hours since midnight: Olivia's Home Guide Press cards with a proof QC passed today.`,
    });
  },
  webinarRun(cfg, g, C) {
    const { date, runDate } = CONFIG.webinar;
    const ran = !!runDate && runDate >= C.first && runDate <= C.last;
    return metric(cfg, g.owner, {
      actual: ran ? 1 : 0, display: ran ? `Ran ${short(runDate)}` : date ? `Set for ${short(date)}` : 'Not set', pace: C.P.month.elapsed,
      status: ran ? ST.done : date && date >= C.today ? ST.on : ST.behind, // no date set, or it passed without a run
      source: { label: 'Dashboard 2 settings (webinar date)', at: null, ageLabel: 'set by hand', stale: false },
      note: date ? '' : 'No webinar date is set yet.', perDay: ran ? { [runDate]: 1 } : {},
    });
  },
  funnelLive(cfg, g, C) { // lander activity in the last 7 days: the clone funnel D1, else the cron's webinar_funnel snapshot
    const f = funnelOf(C);
    return metric(cfg, g.owner, {
      actual: f.live == null ? null : f.live ? 1 : 0, status: f.live == null ? ST.none : f.live ? ST.done : ST.off, source: f.source, note: f.note,
    });
  },
  leads(cfg, g, C) {
    const f = funnelOf(C);
    const week = C.data.funnelWeek;
    return metric(cfg, g.owner, {
      untracked: true, source: f.source,
      note: `The clone funnel records lander visits and payments${week ? ` (${week.visits} and ${week.payments} in the last 7 days)` : ''}, but no lead or registration count.`,
    });
  },
  notTracked(cfg, g) {
    return metric(cfg, g.owner, { untracked: true, note: cfg.why, source: { label: 'No source yet', at: null, ageLabel: 'not tracked', stale: false } });
  },
};

function funnelOf(C) {
  const week = C.data.funnelWeek;
  if (week) return { live: week.visits > 0 || week.payments > 0, source: live('Clone funnel database', true, C.nowMs), note: `${plural(week.visits, 'lander visit')} in the last 7 days.` };
  const row = C.by.webinar_funnel;
  if (!row) return { live: null, source: live('Clone funnel database', false, C.nowMs, 'not connected here'), note: 'The clone funnel has not reported.' };
  const last = Date.parse(parse(row.data).lastEventAt);
  return {
    live: Number.isFinite(last) && C.nowMs - last <= 7 * DAY, source: sourceOf('Clone funnel snapshot', row.collected_at, C.nowMs),
    note: Number.isFinite(last) ? `Last funnel activity ${agoLabel(Math.max(0, C.nowMs - last))}.` : 'No funnel activity this month.',
  };
}

// One point per Mon-Sun week touching the month, over that week's days inside the month. A split target is the
// month's target shared by those days; future weeks have no actual.
function trendOf(m, C) {
  return C.P.month.weeks.map((w) => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(w.start, i)).filter((d) => d >= C.first && d <= C.last);
    const target = m.split && m.target != null ? Math.round((m.target * days.length) / C.P.month.daysInMonth) : null;
    const actual = !m.perDay || w.start > C.today ? null
      : Math.round(days.filter((d) => d <= C.today).reduce((n, d) => n + (m.perDay[d] || 0), 0) * 100) / 100;
    return { start: w.start, label: short(w.start), target, actual, current: w.current };
  });
}

const titleCase = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
function channelsOf(g, C) {
  const all = allChannels(C.data.channels);
  const find = (slug) => all.find((c) => c.slug === slug);
  if (!g.group) return { focus: (g.channels || []).map(find).filter(Boolean), parked: [] };
  // Focus: Jon's list (2026-11-08) in its order, a copy of D:\AgentTeam\rules\facts\focus-channels.txt. A slug the
  // dashboard has no channel for yet still counts (noCalendar). Every other channel of the group is parked.
  const focus = g.focus.map((slug) => find(slug) || { slug, label: titleCase(slug), group: g.group, noCalendar: true });
  return { focus, parked: all.filter((c) => c.group === g.group && !g.focus.includes(c.slug)) };
}

const strip = ({ perDay, split, ...m }) => m;
function buildGoal(g, C) {
  const { focus, parked } = channelsOf(g, C);
  const ctx = { ...C, chans: focus };
  const run = (m, period) => METRICS[m.metric](m, g, ctx, period);
  const month = run(g.month, 'month');
  return {
    goal: {
      key: g.key, title: g.title, owner: g.owner, team: g.team, project: g.project,
      channels: focus.map((c) => ({ slug: c.slug, label: c.label, focus: true })),
      ...(g.group ? { parked: parked.map((c) => ({ slug: c.slug, label: c.label })) } : {}),
      month: strip(month),
      week: g.week.map((m) => strip(run(m, 'week'))),
      day: g.day.map((m) => strip(run(m, 'day'))),
      trend: trendOf(month, C),
    },
    // The Pipeline board's channel tabs: parked channels too, greyed.
    tabs: [...focus.map((c) => ({ slug: c.slug, label: c.label, focus: true })), ...parked.map((c) => ({ slug: c.slug, label: c.label, focus: false }))],
  };
}

// ---- daily checks (Complete Histories, RBC expenses) ----
const EPISODE = /\b(episode|spotify)\b([^.]{0,80}?)\b(live|up|confirmed|published)\b/gi;
const POST = /\bcommunity post\b([^.]{0,60}?)\b(live|up|verified|published)\b/gi;
const NEG = /\b(not|no|never|failed|pending)\b|n't/i;
const says = (re, text) => [...String(text || '').matchAll(re)].some((m) => !NEG.test(m[m.length - 2]));
const urlsIn = (s) => (String(s || '').match(/https?:\/\/[^\s<>"')\]]+/g) || []).map((u) => u.replace(/[.,;:]+$/, ''));
const web = (u) => /^https?:\/\//i.test(u || '');

const CHECKS = {
  // Daisy's ok runs that day say the episode and the community post are live (free-text notes), or her proofs carry the links.
  histories(cfg, C) {
    const runs = C.data.runs;
    const proofs = C.data.proofs || [];
    const on = (ymd) => {
      const notes = (runs || []).filter((r) => dayOf(r.started_at) === ymd).map((r) => r.note || '');
      const proofLinks = proofs.filter((p) => dayOf(p.created_at) === ymd).flatMap((p) => urlsIn(`${p.link} ${p.note || ''}`));
      const links = [...notes.flatMap(urlsIn), ...proofLinks];
      const episode = notes.some((n) => says(EPISODE, n)) || proofLinks.some((u) => /open\.spotify\.com/i.test(u));
      const post = notes.some((n) => says(POST, n)) || proofLinks.some((u) => /youtube\.com\/.*(post|community)/i.test(u));
      const note = episode && post ? 'Episode and community post up' : episode ? 'No community post' : post ? 'No Spotify episode' : 'No episode or community post';
      return { ok: episode && post, episode, post, note, spotify: links.find((u) => /open\.spotify\.com/i.test(u)), youtube: links.find((u) => /youtube\.com/i.test(u)) };
    };
    const t = on(C.today);
    const newest = (runs || []).at(-1)?.started_at;
    const label = `${cfg.owner}'s run log`;
    return {
      readable: !!runs, on,
      links: [t.spotify && { label: /\/episode\//.test(t.spotify) ? 'Spotify episode' : 'Spotify show', href: t.spotify }, t.youtube && { label: 'Community post', href: t.youtube }].filter(Boolean),
      facts: [{ label: 'Spotify episode', value: t.episode ? 'Live' : 'Not seen yet' }, { label: 'Community post', value: t.post ? 'Live' : 'Not seen yet' }],
      source: !runs ? live(label, false, C.nowMs) : newest ? sourceOf(label, newest, C.nowMs) : { label, at: null, ageLabel: 'no run this week', stale: true },
    };
  },
  // Elizabeth's two accounting ticks that day; today the bank scan must not have failed either (as Money reads it).
  rbc(cfg, C) {
    const ticks = C.data.ticks;
    const [imp, rec] = cfg.items;
    const tick = (ymd, item) => ticks?.find((x) => x.day === ymd && x.project === cfg.project && x.item === item);
    const scan = bankScanOf(C.by.bank_scan, C.nowMs);
    const on = (ymd) => {
      const missing = [!tick(ymd, imp) && 'import not ticked', !tick(ymd, rec) && 'receipts not matched', ymd === C.today && scan?.failed && 'bank scan failed'].filter(Boolean);
      return { ok: !missing.length, note: missing.length ? missing.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'Import run and receipts matched' };
    };
    const a = tick(C.today, imp);
    const b = tick(C.today, rec);
    const asOf = parse(C.by.moneyclaw?.data).income?.asOf;
    return {
      readable: !!ticks, on,
      links: [a && web(a.link) && { label: 'Import proof', href: a.link }, b && web(b.link) && { label: 'Receipts proof', href: b.link }].filter(Boolean),
      facts: [
        { label: 'Accounts read', value: scan ? `${scan.scanned} of ${scan.total}` : 'No scan yet' },
        { label: 'Last successful import', value: C.data.rbcLast ? dayLabel(C.data.rbcLast, C.today) : 'Never ticked' },
        { label: 'Bank data through', value: /^\d{4}-\d{2}-\d{2}$/.test(asOf || '') ? short(asOf) : 'Unknown' },
        { label: 'Receipts matched', value: b ? `Yes, ${clockOf(b.created_at)}` : 'Not yet' },
      ],
      source: sourceOf('Bank scan', C.by.bank_scan?.collected_at, C.nowMs),
    };
  },
};

// Accounts read today across the bank_scan groups (a group row carries scanned/total). A group counts only when
// Money shows it Scanned today (overlayBankScan), so a failed group reads 0.
function bankScanOf(row, nowMs) {
  if (!row) return null;
  const page = {};
  overlayBankScan(page, row, nowMs);
  let scanned = 0;
  let total = 0;
  (parse(row.data).accounts || []).forEach((a, i) => {
    const n = Number(a.total) > 0 ? Number(a.total) : 1;
    total += n;
    if (page.bankScan.rows[i]?.pill === 'Scanned') scanned += a.scanned != null && Number.isFinite(Number(a.scanned)) ? Math.min(n, Number(a.scanned)) : n;
  });
  return { scanned, total, failed: page.bankScan.rows.some((r) => r.pill === 'Failed') };
}

function checksOf(C) {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(C.nowMs));
  return CONFIG.checks.map((cfg) => {
    const k = CHECKS[cfg.key](cfg, C);
    const late = hm >= cfg.deadline; // today counts as missed only after its deadline
    const days = C.P.week.days.map(({ ymd }) => {
      if (ymd > C.today || !k.readable) return { ymd, ok: null, cls: 'idle', note: k.readable ? '' : 'Could not be read' };
      const r = k.on(ymd);
      const ok = r.ok ? true : ymd < C.today || late ? false : null;
      return { ymd, ok, cls: ok ? 'ok' : ok === false ? 'crit' : 'idle', note: r.note };
    });
    const now = days.find((d) => d.ymd === C.today);
    const status = now.ok ? { text: 'Done', cls: 'ok' } : now.ok === false ? { text: 'Missed', cls: 'crit' }
      : { text: k.readable ? `Not yet (due ${timeLabel(cfg.deadline)})` : 'No data', cls: 'idle' };
    return { key: cfg.key, title: cfg.title, owner: cfg.owner, today: { ok: now.ok, status, links: k.links, facts: k.facts, source: k.source }, days };
  });
}

// ---- Today ----
const LINK_LABEL = { render: 'Watch video', pdf: 'Open PDF', test: 'Test results', url: 'Open link' };
function linkOf(it, row, task) {
  const d = task?.deliverable;
  if (d?.web) return { label: LINK_LABEL[d.kind] || 'Open link', href: d.link };
  if (it.links?.[0]) return it.links[0];
  const url = urlsIn(row?.context)[0];
  return url ? { label: 'Open link', href: url } : null;
}

// A card note in plain words: its "Your move" part when it has one, no paths or links, at most 140 characters.
function plain(note) {
  const s = String(note || '');
  const move = s.match(/your move:?\s*([\s\S]*?)(?:\n\s*next\b|$)/i)?.[1] || s;
  const t = move.replace(/https?:\/\/\S+/g, '').replace(/[A-Za-z]:[\\/][^\s,;)]*/g, (p) => p.split(/[\\/]/).filter(Boolean).pop())
    .replace(/^\s*(what happened|your move|next):?/gim, '').replace(/^\s*[-*•]+\s+|•/gm, ' ').replace(/\s+/g, ' ').trim(); // bullets only, never a word's hyphen
  return t.length > 140 ? `${t.slice(0, 137).trimEnd()}…` : t;
}

function todayOf(C, goals, checks) {
  const t = C.t;
  const rows = new Map([...(t.approvals || []), ...(t.questions || [])].map((r) => [r.id, r]));
  const tasks = new Map((t.tasks || []).map((x) => [x.id, x]));
  const item = (it) => {
    const row = rows.get(it.id);
    return {
      ...it, from: nameOf(it.from), goal: it.kind === 'alert' ? (it.page === 'sponsors' ? 'sponsors' : null) : goalOf(row?.project),
      minutes: row?.minutes ?? (it.kind === 'approval' ? 2 : 5), link: linkOf(it, row, row?.taskId && tasks.get(row.taskId)),
    };
  };
  let health = 0;
  const charges = [];
  const items = [];
  for (const it of C.out.pages.today?.needs?.items || []) {
    const hidden = it.kind === 'question' ? hiddenOf(C.keyOf.get(it.id)) : null;
    if (hidden === 'health') health++;
    else if (hidden === 'charge') charges.push(item(it));
    else items.push(item(it));
  }
  if (charges.length) {
    items.push({
      id: 'expenses', kind: 'expenses', rank: 3, cls: 'idle', title: 'Expenses review (Friday)',
      detail: `${plural(charges.length, 'known charge')} from MoneyClaw to look over`, from: charges[0].from, at: charges[0].at, ageLabel: charges[0].ageLabel,
      page: 'money', btn: 'Open expenses', goal: null, minutes: charges.reduce((n, c) => n + c.minutes, 0), link: null,
    });
  }
  const order = CONFIG.goals.map((g) => g.key);
  const tier = (g) => { const i = order.indexOf(g === 'jonmacai' ? 'jonmac' : g); return i < 0 ? order.length : i; };
  const waits = (it) => (tasks.get(rows.get(it.id)?.taskId)?.status === 'waiting_on_jon' ? 0 : 1);
  const at = (it) => (Number.isFinite(Date.parse(it.at)) ? Date.parse(it.at) : Infinity);
  const friday = C.P.today.weekday === 4;
  const jon = items.filter((it) => it.kind !== 'expenses' || friday).sort((a, b) => tier(a.goal) - tier(b.goal) || waits(a) - waits(b) || at(a) - at(b)).slice(0, 3);
  const rest = items.filter((it) => !jon.includes(it)); // needs.items: everything else, without repeating jon's 3

  const age = (iso) => (Number.isFinite(Date.parse(iso)) ? agoLabel(Math.max(0, C.nowMs - Date.parse(iso))) : '');
  const blockers = [];
  for (const x of t.tasks || []) {
    if (x.status === 'waiting_on_jon') blockers.push({ title: x.title, owner: nameOf(x.owner), goal: goalOf(x.project), ageLabel: age(x.updatedAt), why: plain(x.note) || 'Waiting on you', open: x.id });
  }
  for (const q of t.questions || []) {
    const task = q.taskId && tasks.get(q.taskId);
    if (!task || ['done', 'cancelled'].includes(task.status) || hiddenOf(C.keyOf.get(q.id)) || blockers.some((b) => b.open === task.id)) continue;
    blockers.push({ title: task.title, owner: nameOf(q.askedBy), goal: goalOf(task.project || q.project), ageLabel: age(q.createdAt), why: `Waiting on your answer: ${plain(q.question)}`, open: task.id });
  }
  for (const k of checks) {
    for (const d of k.days) if (d.ok === false) blockers.push({ title: `${k.title} missed ${d.ymd === C.today ? 'today' : dayName(d.ymd)}`, owner: k.owner, goal: null, ageLabel: daysAgo(d.ymd, C.today), why: d.note });
  }
  const targets = goals.flatMap((g) => g.day.map((m) => ({ goal: g.key, goalTitle: g.title, label: m.label, display: m.display, target: m.target, actual: m.actual, status: m.status, owner: m.owner, source: m.source })));
  return {
    jon,
    needs: { count: rest.length, items: rest, healthToAna: health, chargesFolded: charges.length },
    expenses: { count: charges.length, items: charges, label: 'Expenses review (Friday)' },
    targets, blockers,
  };
}

// ---- Pipeline: the sponsors board, cleaned (view only, on a deep copy) ----
// What the inbox scan files as a deal but isn't one, by subject or sender. A priced card is never hidden.
const JUNK = [
  ['refunds', /\brefund/i, null],
  ['receipts', /\breceipt|payment (received|confirmation)|order confirmation|your (order|payment)\b|billing statement/i, /\b(receipts?|billing|payments?|orders?)@|stripe\.com|paypal\.com/i],
  ['newsletters', /newsletter|digest|unsubscribe/i, /\b(newsletters?|news|digest|updates|marketing)@|substack\.com|beehiiv|mailchimp|convertkit|mailerlite/i],
];
const junkOf = (r) => r && JUNK.find(([, subject, sender]) => subject.test(`${r.subject || ''} ${r.reason || ''}`) || sender?.test(`${r.to || ''} ${r.contact || ''}`))?.[0];

function cleanSponsors(C) {
  const page = C.out.pages.sponsors;
  if (!page) return undefined;
  const copy = JSON.parse(JSON.stringify(page));
  if (!copy.board?.columns) return copy;
  const raw = new Map((parse(C.by.sponsors?.data).cards || []).map((c) => [c.id, c]));
  const hidden = { receipts: 0, refunds: 0, newsletters: 0 };
  const value = { usd: 0, priced: 0, unpriced: 0 }; // open deals: every column but Paid
  const archived = [];
  for (const col of copy.board.columns) {
    col.cards = col.cards.filter((k) => {
      const r = raw.get(k.id);
      const kind = !(k.amt > 0) && junkOf(r);
      if (kind) { hidden[kind]++; return false; }
      const last = Date.parse(r?.latestDate);
      if (Number.isFinite(last) && C.nowMs - last >= 60 * DAY) { archived.push(k); return false; }
      if (col.boardStage !== 'paid') {
        if (k.amt > 0) { value.usd += k.amt; value.priced++; } else value.unpriced++;
      }
      return true;
    });
  }
  copy.board.columns.push({ stage: 'Archived', title: 'Archived', archived: true, boardStage: null, empty: 'Nothing quiet for 60 days.', cards: archived });
  return { ...copy, hidden, value };
}

// ---- Money tiles: the same goal cards and cash object /dashboard shows ----
function moneyOf(C) {
  const card = (k) => C.cards.find((c) => c.key === k) || { value: 'no data', source: sourceOf(k, null, C.nowMs) };
  const tile = (label, c) => ({ label, value: c.value, sub: c.usd == null ? c.why || '' : c.drivers?.[0] ? `${c.drivers[0].label}: ${c.drivers[0].value}` : '', source: c.source });
  const cash = C.cash || {};
  const asOf = parse(C.by.moneyclaw?.data).income?.asOf;
  const bank = sourceOf('MoneyClaw bank feed', C.by.moneyclaw?.collected_at, C.nowMs);
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(asOf || '');
  if (!dated || Date.parse(`${C.today}T12:00:00Z`) - Date.parse(`${asOf}T12:00:00Z`) > 2 * DAY) bank.stale = true; // FEED_STALE_DAYS in src/cash.js
  return {
    tiles: [
      tile(`Sponsor cash · ${C.P.month.label}`, card('sponsors')),
      {
        label: 'Owed to you', value: cash.unpaidAvailable ? usd(cash.owed || 0) : 'no data',
        sub: cash.unpaidAvailable ? plural(cash.unpaid.length, 'sponsor') : 'The sponsor collections feed has not reported.',
        source: sourceOf('Sponsor collections', C.by.sponsors?.collected_at, C.nowMs),
      },
      tile('Viral View MRR', card('viral')),
      tile(`Webinar net · ${C.P.month.label}`, card('webinar')),
      tile(`Ebook sales · ${C.P.month.label}`, card('ebooks')),
      { label: 'Bank feed', value: dated ? `Through ${short(asOf)}` : 'no data', sub: cash.source?.kind === 'bank' ? cash.source.note || 'RBC USD deposits' : 'Not reporting deposits', source: bank },
    ],
  };
}

// `out` is mergeSnapshot's answer (never changed here), `rows` the snapshot rows, `extra` its extra (todayData etc.),
// `data` d2Data's reads.
export function buildD2(out, rows, extra, data, nowMs) {
  const P = periodOf(nowMs);
  const by = Object.fromEntries((rows || []).map((r) => [r.source, r]));
  const first = `${P.month.key}-01`;
  const C = {
    P, nowMs, data, out, by, t: extra?.today || {},
    keyOf: new Map((data.keys || []).map((r) => [r.id, r.idem_key || ''])),
    today: P.today.ymd, ws: P.week.start, we: P.week.end, first, last: addDays(first, P.month.daysInMonth - 1),
    weekShare: clamp((nowMs - midnight(P.week.start)) / (7 * DAY)), dayShare: clamp((nowMs - midnight(P.today.ymd)) / DAY),
    cards: out.pages.today?.goals || [], cash: out.pages.sponsors?.cash || null,
  };
  C.src = {
    calendar: data.calendar ? sourceOf('Channel calendars', data.calAt, nowMs) : live('Channel calendars', false, nowMs),
    cards: live('Dashboard cards', !!data.tasks, nowMs),
    ticks: live('Daily checklist ticks', !!data.ticks, nowMs),
    questions: live('Bot questions', !!C.t.questions, nowMs),
  };
  const built = CONFIG.goals.map((g) => buildGoal(g, C));
  const goals = built.map((b) => b.goal);
  const checks = checksOf(C);
  const money = moneyOf(C);
  const stale = new Map();
  const add = (src, goal) => {
    if (src?.stale && !stale.has(src.label)) stale.set(src.label, { label: src.label, ageLabel: src.ageLabel, ...(goal ? { goal } : {}) });
  };
  for (const g of goals) for (const m of [g.month, ...g.week, ...g.day]) add(m.source, g.key);
  for (const k of checks) add(k.today.source);
  for (const tile of money.tiles) add(tile.source);
  for (const s of out.pages.today?.needs?.sources || []) add(s);
  const summary = buildSummary(C, {
    weather: data.weather, videoCards: videoCards(C), sponsors: cleanSponsors(C),
    goals: ['jonmac', 'jonmacai', 'hgp'].map((k) => CONFIG.goals.find((g) => g.key === k)).map((g) => ({
      key: g.key, title: g.title, owner: g.owner, project: g.project, group: g.group, chans: channelsOf(g, C).focus,
    })),
  });
  return {
    period: P,
    goals,
    stale: [...stale.values()],
    checks,
    today: todayOf(C, goals, checks),
    pipeline: {
      boards: built.map(({ goal: g, tabs }) => ({
        goal: g.key, title: g.title, project: g.project, channels: tabs,
        ...(g.key === 'sponsors' ? { sponsors: cleanSponsors(C) } : {}),
      })),
    },
    money,
    summary,
  };
}
