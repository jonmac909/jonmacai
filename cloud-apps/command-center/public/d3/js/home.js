// Dashboard 3 Home page: the default page at /dash/ (design: Jacqueline's handover "new Home page", 12 Nov 2026).
// Top to bottom: four small widgets (today, now, this week, this month), the Schedule card (List | Calendar) and
// Progress (Today | This week | This month) as four category cards. Pure functions over the /dashboard/api/d2 and
// /dashboard/api/d3 answers, so tests run them without a browser.
// What is real: every goal number (the same feeds as Goals and Money), today's meetings (d2 calendar section), and the
// done / missed marks on workouts and date nights (the habit log). What is not: the schedule's routine blocks are the
// handover's standing rules (ROUTINE below), not saved tasks, and the spending budgets are the handover's (BUDGET).
// A goal with no source reads "No feed" with a grey dot. View only, except "+ Log" (the Goals page's own write).
import { esc, usd, toneOf } from './util.js';
import { periodOf, pipelineOf, dueOf } from './goals.js';
import { reviewItems } from './review.js';
import { dealStages } from './money.js';

const TZ = 'America/Vancouver';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const START = 8; // the calendar's first hour (8am, so the home routines fit)
const END = 21;
const H = 64; // px per hour
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const one = (v) => (Array.isArray(v) ? v[0] : v) || null;
const pctOf = (a, b) => Math.max(0, Math.min(100, Math.round((a / b) * 100)));
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const wdOf = (ymd) => (new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// 9.5 -> "9:30" (12-hour, as the design)
export const clockOf = (h) => {
  const hh = Math.floor(h);
  return `${((hh + 11) % 12) + 1}:${String(Math.round((h - hh) * 60)).padStart(2, '0')}`;
};

export const CATS = [['factory', 'Factory', '#039be5'], ['sponsors', 'Sponsors', '#33b679'], ['personal', 'Personal', '#e67c73'], ['pnl', 'PNL', '#7986cb']];
// Budgets written in the handover (section 4), CAD a month. No feed holds them yet, so each row says where it is from.
export const BUDGET = { personal: [8000, 10000, '$8–10k'], business: [3000, 5000, '$3–5k'], businessWeek: [700, 1150, '$700–1,150'] };

// ---- category colours: Jon's own picks, kept in this browser ----
const COL_KEY = 'd3-home-colours';
const HEX = /^#[0-9a-f]{6}$/i;
export function savedColours() {
  const out = {};
  try {
    const raw = JSON.parse(localStorage.getItem(COL_KEY) || '{}');
    for (const [k] of CATS) if (HEX.test(raw?.[k] || '')) out[k] = raw[k];
  } catch { /* private mode or bad JSON: the defaults */ }
  return out;
}
export function setColour(input, ui) {
  const k = input.dataset.hmcol;
  if (!CATS.some(([c]) => c === k) || !HEX.test(input.value)) return;
  ui.hmCols = { ...(ui.hmCols || {}), [k]: input.value };
  input.closest('.hm')?.style.setProperty(`--c-${k}`, input.value);
  try { localStorage.setItem(COL_KEY, JSON.stringify(ui.hmCols)); } catch { /* private mode */ }
}

// The time now in Vancouver: hours into the day and the clock text.
export function nowOf(ms) {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return { h: (p.hour || 0) + (p.minute || 0) / 60, clock: new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d) };
}

// ---- schedule ----
// The handover's standing rules (section 5) for one date. Carry-over of missed items (retry at 3pm, Late the next
// day, make-up days) needs saved tasks and is not built.
export function routineOf(ymd) {
  const wd = wdOf(ymd);
  const workout = wd === 0 || wd === 2 || wd === 4;
  const out = [];
  const add = (s, e, w, c, key) => out.push({ s, e, w, c, key: key || '' });
  if (wd === 1) add(8, 8.25, 'Garbage out', 'personal');
  if (wd < 5) add(9, 9.5, 'Sponsor emails', 'sponsors', 'emails');
  if (wd === 6) add(10.5, 11, 'Plan meals for the week', 'personal');
  if (workout) add(11, 12, 'Workout', 'personal', 'workout');
  add(workout ? 12 : 11.5, workout ? 12.75 : 12.25, 'Cook lunch', 'personal'); // after the workout on workout days
  if (wd === 4) add(15.5, 16.5, 'Friday review', 'pnl');
  if (wd === 3) add(16, 19, 'Date night · happy hour', 'personal', 'date'); // covers dinner
  else add(17, 18, 'Dinner', 'personal');
  return out;
}

const emailsWaiting = (d2resp) => {
  const st = dealStages(d2resp);
  return st ? st.flatMap((s) => s.deals.filter((d) => d.draft)) : null;
};

// This week Monday to Sunday (desktop), plus the days a phone shows (today and the next two).
export function scheduleOf(d2resp, d3resp, P = periodOf(d2resp)) {
  if (!P.ymd) return { days: [] };
  const g3 = d3resp?.d3?.goals || null;
  const woDays = Array.isArray(g3?.workouts?.days) ? g3.workouts.days : null;
  const dnDays = g3?.dateNights && num(g3.dateNights.actual) ? g3.dateNights.perDay || {} : null;
  const mine = emailsWaiting(d2resp);
  const meetings = ((d2resp?.d2?.summary?.sections || []).find((s) => s.key === 'calendar')?.rows || []).map((r) => {
    const m = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/.exec(String(r.label || '').trim());
    if (!m) return null;
    const s = Number(m[1]) + Number(m[2]) / 60;
    const e = Number(m[3]) + Number(m[4]) / 60;
    return e > s ? { s, e, w: String(r.value || 'Meeting'), c: 'meeting', key: '', meet: true } : null;
  }).filter(Boolean);
  const monday = addDays(P.ymd, -P.weekday);
  const ymds = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
  for (const d of [1, 2]) if (!ymds.includes(addDays(P.ymd, d))) ymds.push(addDays(P.ymd, d));
  const days = ymds.map((ymd, i) => {
    const today = ymd === P.ymd;
    const items = routineOf(ymd).map((x) => {
      const it = { ...x };
      if (x.key === 'workout' && woDays) {
        const d = woDays.find((r) => r.ymd === ymd);
        if (d?.actual === 1) it.done = true; else if (d && d.actual === 0 && ymd < P.ymd) it.missed = true;
      }
      if (x.key === 'date' && dnDays) {
        if (dnDays[ymd]) it.done = true; else if (ymd < P.ymd) it.missed = true;
      }
      if (x.key === 'emails' && today && mine?.length) it.w = `${x.w} · ${mine.length} waiting`;
      return it;
    });
    if (today) items.push(...meetings);
    items.sort((a, b) => a.s - b.s || a.e - b.e);
    const diff = Math.round((Date.parse(`${ymd}T12:00:00Z`) - Date.parse(`${P.ymd}T12:00:00Z`)) / 86400000);
    return { ymd, name: DAYS[wdOf(ymd)], n: Number(ymd.slice(8, 10)), today, week: i < 7, phone: diff >= 0 && diff <= 2, items };
  });
  return { days };
}

const spanOf = (x) => `${clockOf(x.s)}–${clockOf(x.e)}`;
function listHtml(day, now) {
  if (!day) return '<p class="mut">No feed: today\'s date could not be read.</p>';
  const next = day.items.find((x) => x.e > now.h);
  return day.items.map((x) => {
    const cur = x.s <= now.h && x.e > now.h;
    const box = x.meet ? '<span class="hmnb" aria-hidden="true"></span>'
      : `<input type="checkbox" disabled${x.done ? ' checked' : ''} aria-label="${x.done ? 'Done' : 'Not done'}">`;
    return `<div class="hmrow${x.done ? ' done' : ''}${x.missed ? ' miss' : ''}${x.meet ? ' meet' : ''}${cur ? ' now' : ''}"${x === next ? ' data-hmnow' : ''}>${box}<span class="hmtm">${spanOf(x)}</span><i class="hmcd" style="--c: var(--c-${x.c})"></i><span class="hmwhat">${esc(x.w)}</span>${x.meet ? '<span class="hmtag">Meeting</span>' : ''}${x.missed ? '<span class="hmtag">Missed</span>' : ''}</div>`;
  }).join('') || '<p class="mut">Nothing planned today.</p>';
}

function calHtml(days, now) {
  const top = (h) => Math.round((Math.max(START, Math.min(END, h)) - START) * H);
  const hours = Array.from({ length: END - START }, (_, i) => {
    const h = START + i;
    return `<span style="top: ${i * H}px">${i ? `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}` : ''}</span>`;
  }).join('');
  const cols = days.map((d) => {
    const evs = d.items.filter((x) => x.e > START && x.s < END).map((x) => {
      const small = x.e - x.s < 0.75;
      const t = `${spanOf(x)} ${x.w}`;
      return `<div class="hmev${small ? ' sm' : ''}${x.meet ? ' m' : ''}${x.done ? ' done' : ''}${x.missed ? ' miss' : ''}" style="top: ${top(x.s)}px; height: ${Math.max(14, top(x.e) - top(x.s) - 2)}px; --c: var(--c-${x.c})" title="${esc(t)}">${small ? `<b>${clockOf(x.s)} ${esc(x.w)}</b>` : `<b>${esc(x.w)}</b><span>${spanOf(x)}</span>`}</div>`;
    }).join('');
    return `<div class="hmday${d.today ? ' today' : ''}${d.week ? ' hmwk' : ''}${d.phone ? ' hmph' : ''}"><div class="hmdh"><small>${d.name}</small><b>${d.n}</b></div><div class="hmcol">${d.today ? `<div class="hmnow" style="top: ${top(now.h)}px"></div>` : ''}${evs}</div></div>`;
  }).join('');
  return `<div class="hmcal"><div class="hmhrs"><div class="hmdh"></div><div class="hmhb">${hours}</div></div>${cols}</div>`;
}

function scheduleHtml(sch, now, ui) {
  const view = ui.hmView === 'cal' ? 'cal' : 'list';
  const seg = [['list', 'List'], ['cal', 'Calendar']].map(([k, l]) => `<button type="button" data-hmview="${k}" aria-pressed="${view === k}">${l}</button>`).join('');
  const legend = CATS.map(([k, l, def]) => `<label><input type="color" data-hmcol="${k}" value="${esc(ui.hmCols?.[k] || def)}" aria-label="${l} colour">${l}</label>`).join('');
  const today = sch.days.find((d) => d.today);
  const body = view === 'cal' ? calHtml(sch.days, now) : listHtml(today, now);
  return `<section class="card hmsch${ui.hmMore ? ' hmexp' : ''}" aria-label="Schedule">
<div class="hd"><h2>Schedule</h2><div class="hmseg sp" role="group" aria-label="Schedule view">${seg}</div></div>
<div class="hmleg">${legend}</div>
<p class="hmex"><span class="hmlg">Routine blocks follow the standing rules in the handover; meetings are today's, from the calendar feed. Tasks cannot be edited, dragged or ticked here yet. Click a colour to change it.</span><span class="hmsm">Routine from the standing rules · tap a colour to change it</span></p>
<div class="hmbox" data-hmscroll="${view}" data-hmtop="${Math.max(0, Math.round((now.h - START) * H) - 40)}">${body}</div>
<button type="button" class="btn sm hmmore" data-hmmore aria-expanded="${ui.hmMore ? 'true' : 'false'}">${ui.hmMore ? 'See less ▴' : 'See more ▾'}</button>
</section>`;
}

// ---- progress: one row per goal { k, n, v, st (off | risk | on | none), word, info, pct, pace, det } ----
const ST = { r: 'off', y: 'risk', g: 'on', n: 'none' };
const WORD = { off: 'Off track', risk: 'At risk', on: 'On track', none: 'No data' };
const row = (k, n, v, st, info, det, more = {}) => ({ k, n, v, st, word: WORD[st], info, pct: null, pace: null, det: det || null, ...more });
const noFeed = (k, n, why, page) => row(k, n, 'No feed', 'none', why, page ? { h: '', items: [], page } : null, { word: 'No feed', nf: true });
const PG = { money: ['Money', '#money'], factory: ['Factory', '#factory'], review: ['Review', '#review'], track: ['Track', '#track'] };

// A d2 / d3 metric as a row: status from the data, grey when the number is stale, pace mark from the data's pace.
function fromMetric(k, n, m, { money = false, info = '', det = null, why = 'Nothing reports this yet.' } = {}) {
  if (!m) return noFeed(k, n, why, det?.page);
  const has = num(m.actual) && m.display !== 'No data';
  const stale = !!m.source?.stale;
  const st = has && !stale ? ST[toneOf(m.status)] : 'none';
  const f = (x) => (money ? usd(x) : String(Math.round(x * 10) / 10));
  const hasT = num(m.target) && m.target > 0;
  const rate = /%$/.test(m.display || '');
  const behind = (st === 'off' || st === 'risk') && hasT && num(m.pace) && m.actual < m.pace;
  const age = m.source?.ageLabel || '';
  return row(k, n,
    has ? `${rate ? m.display : f(m.actual)}${hasT ? ` / ${f(m.target)}` : m.target === 0 ? ' · target 0' : ''}` : 'No data',
    st,
    [info, behind ? `Should be ~${f(m.pace)} by today` : '', age ? (stale ? `${age}, stale` : age) : ''].filter(Boolean).join(' · '),
    det || { h: '', items: m.note ? [m.note] : [] },
    {
      word: !has ? 'No data' : stale ? 'Stale' : st === 'none' ? 'No target' : WORD[st],
      nf: !has,
      pct: has && hasT ? pctOf(m.actual, m.target) : has && rate ? pctOf(m.actual, 100) : null,
      pace: has && hasT && num(m.pace) ? pctOf(m.pace, m.target) : null,
    });
}

const cad0 = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
// RBC spending against a handover budget. Month-to-date figures get a pace mark and a projection; a "last 30 days"
// figure is compared as it is.
function spendRow(k, n, sec, g, field, [, hi, label], P) {
  if (!g || !num(g[field])) return noFeed(k, n, sec?.line || 'These figures are not in the MoneyClaw expenses feed.', PG.money);
  const amt = g[field];
  const mtd = field === 'month' && g.basis === 'stages' && !g.monthFrom;
  const span = field === 'week' ? 'last 7 days' : mtd ? 'this month so far' : g.basis === 'stages' ? `this month from ${g.monthFrom.slice(5).replace('-', '/')}` : 'last 30 days';
  const proj = mtd && P.monthT >= 0.1 ? amt / P.monthT : null;
  const st = sec?.stale ? 'none' : amt > hi || (proj != null && proj > hi * 1.25) ? 'off' : proj != null && proj > hi ? 'risk' : 'on';
  const left = mtd && amt < hi ? Math.max(1, P.daysInMonth - P.day + 1) : 0;
  const items = [num(g.yesterday) ? `Yesterday ${cad0(g.yesterday)}` : '', field !== 'week' && num(g.week) ? `Last 7 days ${cad0(g.week)}` : '',
    left ? `To stay under ${cad0(hi)}: about ${cad0((hi - amt) / left)} a day for the rest of the month` : '',
    amt > hi ? `${cad0(amt - hi)} over the ${cad0(hi)} max` : ''].filter(Boolean);
  return row(k, n, `${cad0(amt)} / ${label}`, st,
    [span, proj != null ? `on pace for ~${cad0(proj)}` : '', `RBC ${sec?.currency || 'CAD'}`, 'budget from the handover', sec?.stale ? 'feed stale' : ''].filter(Boolean).join(' · '),
    { h: `Budget ${label} a ${field === 'week' ? 'week' : 'month'}`, items, page: PG.money },
    { word: sec?.stale ? 'Stale' : WORD[st], pct: pctOf(amt, hi), pace: mtd ? pctOf(P.monthT, 1) : null });
}

export function homeGoals(d2resp, d3resp, P = periodOf(d2resp), now = nowOf()) {
  const goals = d2resp?.d2?.goals || [];
  const G = (key) => goals.find((g) => g.key === key) || null;
  const g3 = d3resp?.d3?.goals || null;
  const sp = G('sponsors');
  const wk = (g, i) => g?.week?.[i] || null;
  const open = d3resp?.d3?.openCards;
  const collected = one(sp?.month);
  const thru = /through ([A-Z][a-z]{2} \d{1,2})/.exec(collected?.source?.label || '')?.[1];

  // Sponsors
  const mine = emailsWaiting(d2resp);
  const emails = !mine ? noFeed('emails', 'Emails waiting on you', 'The Sponsors board could not be read.', PG.money)
    : row('emails', 'Emails waiting on you', `${mine.length} · target 0`, mine.length ? 'risk' : 'on',
      mine.length ? mine.map((d) => d.name).join(', ') : 'Nothing is waiting on your send',
      { h: `${plural(mine.length, 'deal')} need${mine.length === 1 ? 's' : ''} your send`, items: mine.map((d) => `${d.name} · ${d.stage}`), page: PG.money });
  const sv = wk(sp, 1);
  let videoDue;
  if (!sv || !Array.isArray(sv.behind)) videoDue = noFeed('due', 'Sponsor video due', 'Sponsor video cards could not be read.', PG.factory);
  else {
    const due = sv.behind.map((b) => ({ b, d: dueOf(b.why, P) })).filter((x) => x.d != null && x.d <= 0);
    const late = due.some((x) => x.d < 0);
    videoDue = row('due', 'Sponsor video due', due.length === 1 ? due[0].b.title : due.length ? plural(due.length, 'video') : 'None due',
      late ? 'off' : due.length ? 'risk' : 'on',
      due.length ? due.map((x) => `${x.b.title} · ${x.d < 0 ? `${plural(-x.d, 'day')} late` : 'due today'}`).join(', ') : `${sv.behind.length} more open this week, none due today`,
      { h: due.length ? 'Due today or late' : 'Open this week', items: (due.length ? due.map((x) => x.b) : sv.behind).slice(0, 8).map((b) => `${b.title} · ${b.why || ''}`), page: PG.factory });
  }
  const behindItems = (m) => (Array.isArray(m?.behind) ? m.behind.slice(0, 8).map((b) => `${b.title}${b.why ? ` · ${b.why}` : ''}`) : []);
  const inv = wk(sp, 2);
  const unsure = Number((inv?.facts || []).find((f) => f.label === 'No live video found')?.value) || 0;
  const pipe = pipelineOf(d2resp);
  const amt = (r) => `${r.name} · ${r.amt == null ? 'no amount' : usd(r.amt)}`;
  const sponsors = {
    today: [emails, videoDue],
    week: [
      fromMetric('deals', 'Deals signed', wk(sp, 0), { info: 'Counted from first video card per sponsor', det: { h: 'This week', items: [wk(sp, 0)?.note].filter(Boolean), page: PG.money } }),
      fromMetric('delivered', 'Sponsor videos delivered', sv, { info: sv?.behind?.length ? `${sv.behind.length} more due` : '', det: { h: 'Still open this week', items: behindItems(sv), page: PG.factory } }),
      fromMetric('invoices', 'Invoices waiting', inv, { info: unsure ? `${unsure} older not counted (no live video found)` : 'Sent the day a video goes live', det: { h: 'Waiting for an invoice', items: behindItems(inv), page: PG.money } }),
    ],
    month: [
      fromMetric('collected', 'Collected', collected, { money: true, info: thru ? `Through ${thru}` : '', det: { h: `Collected in ${P.monthName || 'this month'}`, items: [collected?.note, collected?.source?.label].filter(Boolean), page: PG.money } }),
      !pipe ? noFeed('pipeline', 'Pipeline', 'The Sponsors board could not be read.', PG.money)
        : row('pipeline', 'Pipeline', `${pipe.close.length} to close · ${pipe.collect.length} to collect`, 'none',
          `${plural(pipe.close.length + pipe.collect.length, 'deal')} · ${usd(pipe.totals.close)} to close · ${usd(pipe.totals.collect)} to collect`,
          { h: 'To close', items: pipe.close.map(amt), h2: 'To collect', items2: pipe.collect.map(amt), page: PG.money }, { word: 'No target' }),
    ],
  };

  // Factory
  const queue = reviewItems(d2resp, d3resp);
  const aw = g3?.approvedWaiting || null;
  const qc = g3?.qcFirstTry || null;
  const channel = (key, id) => {
    const g = G(key);
    const m = wk(g, 0);
    const n = open && g ? open[g.project] || 0 : null;
    const rows = Array.isArray(m?.rows) ? m.rows.map((r) => `${r.label} · ${r.actual} / ${r.target}`) : [];
    return fromMetric(id, g?.title || { jonmac: 'Jon Mac', jonmacai: '@JonMacAI', hgp: 'Home Guide Press' }[key], m,
      { info: [rows.length > 1 ? plural(rows.length, 'channel') : '', n == null ? '' : plural(n, 'open card')].filter(Boolean).join(' · '), det: { h: 'Uploaded this week', items: rows.length ? rows : [m?.note].filter(Boolean), page: PG.factory } });
  };
  const factory = {
    today: [
      !queue ? noFeed('review', 'To review', 'The review queue could not be read.', PG.review)
        : row('review', 'To review', String(queue.length), queue.length ? 'risk' : 'on', queue.length ? 'Waiting for your review' : 'Nothing waiting', { h: `${plural(queue.length, 'item')} waiting`, items: [], page: PG.review }),
      fromMetric('approved', 'Approved, not uploaded', aw, { info: aw?.actual ? `Oldest ${aw.oldestLabel || ''}`.trim() : 'None waiting', why: 'Approvals and the YouTube calendar could not be read.',
        det: { h: 'Approved, not on YouTube yet', items: (aw?.items || []).slice(0, 8).map((x) => x.title), page: PG.factory } }),
      fromMetric('qc', 'QC-passed today', g3?.scoreboard, { info: 'Today', why: 'QC results on renders could not be read.', det: { h: '', items: [g3?.scoreboard?.note].filter(Boolean), page: PG.track } }),
    ],
    week: [channel('jonmac', 'jm'), channel('jonmacai', 'ai'), channel('hgp', 'hgp')],
    month: [
      fromMetric('qc1', 'Passed QC first try', qc, { info: num(qc?.total) ? `${qc.passed} of ${qc.total} passed on first proof` : '', why: 'QC verdicts on renders could not be read.', det: { h: '', items: [qc?.note].filter(Boolean), page: PG.track } }),
    ],
  };

  // Personal
  const wo = g3?.workouts || null;
  const dn = g3?.dateNights || null;
  const ch = g3?.charges || null;
  const habit = (k, n, m, kind, endH, at) => {
    if (!m || !num(m.actual)) return noFeed(k, n, 'Your habit log could not be read.');
    const done = !!m.loggedToday;
    const lateNow = !done && now.h >= endH;
    return row(k, n, `${done ? 1 : 0} / 1`, lateNow ? 'risk' : 'on', done ? 'Logged today' : lateNow ? `${at} · not logged yet` : at,
      { h: `Today ${at}`, items: [done ? 'Logged today' : 'Log it here when it is done'], log: { kind, done } }, { pct: done ? 100 : 0 });
  };
  const monday = P.ymd ? addDays(P.ymd, -P.weekday) : '';
  const dnWeek = dn && num(dn.actual) && monday ? Object.entries(dn.perDay || {}).filter(([d]) => d >= monday && d <= addDays(monday, 6)).reduce((a, [, c]) => a + c, 0) : null;
  const dnLate = dnWeek === 0 && (P.weekday > 3 || (P.weekday === 3 && now.h >= 19));
  const today = [];
  if ([0, 2, 4].includes(P.weekday)) today.push(habit('workout', 'Workout', wo, 'workout', 12, '11am'));
  if (P.weekday === 3) today.push(habit('date', 'Date night', dn, 'date_night', 19, '4pm · happy hour'));
  today.push(!ch || !num(ch.open) || ch.display === 'No data'
    ? row('charges', 'Check odd charges', 'No data', 'none', ch?.note || 'MoneyClaw charge questions could not be read.', { h: '', items: [], page: PG.money }, { nf: true })
    : row('charges', 'Check odd charges', `${ch.open} open`, ch.open ? 'risk' : 'on', ['Goal 0', 'MoneyClaw charge questions this month', ch.source?.ageLabel].filter(Boolean).join(' · '),
      { h: `${ch.open} open · goal 0`, items: [ch.note].filter(Boolean), page: PG.money }));
  const split = (d2resp?.d2?.summary?.sections || []).find((s) => s.key === 'expenses');
  const personal = {
    today,
    week: [
      fromMetric('workouts', 'Workouts', wo, { info: 'Mon, Wed, Fri at 11am · resets every Monday', why: 'Your habit log could not be read.',
        det: { h: 'Mon · Wed · Fri', items: (wo?.days || []).filter((d) => [0, 2, 4].includes(wdOf(d.ymd))).map((d) => `${DAYS[wdOf(d.ymd)]} · ${d.actual === 1 ? 'done' : d.actual === 0 && d.ymd < P.ymd ? 'missed' : d.ymd === P.ymd ? 'today' : 'to come'}`), log: { kind: 'workout', done: !!wo?.loggedToday } } }),
      dnWeek == null ? noFeed('datewk', 'Date night', 'Your habit log could not be read.')
        : row('datewk', 'Date night', `${dnWeek} / 1`, dnWeek >= 1 ? 'on' : dnLate ? 'risk' : 'on', 'Thursdays 4pm, happy hour · resets every Monday',
          { h: 'Thursdays', items: [dnWeek >= 1 ? 'Logged this week' : dnLate ? 'Not logged this week: pick a make-up day' : 'Thursday 4pm'], log: { kind: 'date_night', done: !!dn.loggedToday } }, { pct: pctOf(dnWeek, 1), pace: pctOf(P.weekT, 1) }),
      noFeed('trip', 'Book trip', 'A checklist goal: saving goals is not built yet.'),
    ],
    month: [
      spendRow('pspend', 'Personal spending', split, split?.split?.personal, 'month', BUDGET.personal, P),
      noFeed('trips', 'Trips', 'No travel spending feed and no limit set yet.', PG.money),
      noFeed('groups', 'Expense goals by group', 'MoneyClaw Goals is not connected yet.', PG.money),
      noFeed('networth', 'Net worth', 'MoneyClaw monthly snapshots are not connected yet.', PG.money),
    ],
  };

  // PNL
  const pnl = {
    today: [],
    week: [spendRow('bweek', 'Business spending', split, split?.split?.business, 'week', BUDGET.businessWeek, P)],
    month: [
      fromMetric('revenue', 'Revenue', collected, { money: true, info: ['Sponsor cash only', thru ? `through ${thru}` : ''].filter(Boolean).join(' · '),
        det: { h: `${P.monthName || 'This month'} so far`, items: ['Sponsor cash collected', 'YouTube ads and affiliates: no feed yet'], page: PG.money } }),
      spendRow('bmonth', 'Business spending', split, split?.split?.business, 'month', BUDGET.business, P),
      row('profit', 'Profit so far', 'No data', 'none', 'Income is in USD and spending in CAD, and ads and affiliate income have no feed',
        { h: '', items: ['Shown once income and spending are in one currency'], page: PG.money }, { nf: true }),
    ],
  };
  return [{ key: 'sponsors', title: 'Sponsors', ...sponsors }, { key: 'factory', title: 'Factory', ...factory }, { key: 'personal', title: 'Personal', ...personal }, { key: 'pnl', title: 'PNL', ...pnl }];
}

const DOT = { off: 'r', risk: 'y', on: 'hmon', none: '' };
const listOf = (h, items) => `${h ? `<p class="hmdh2">${esc(h)}</p>` : ''}${items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}`;
function rowHtml(cat, r, ui) {
  const key = `${cat}.${r.k}`;
  const open = ui.hmOpen === key;
  const bar = r.pct != null ? `<span class="bar"><i style="width: ${r.pct}%"></i>${r.pace != null && r.pace > 0 ? `<b style="left: ${r.pace}%"></b>` : ''}</span>` : '';
  let det = '';
  if (open && r.det) {
    const d = r.det;
    const armed = d.log && !d.log.done && !ui.busy && ui.confirmLog === d.log.kind;
    const log = d.log ? `<button type="button" class="btn sm${armed ? ' primary' : ''}" data-log="${esc(d.log.kind)}"${d.log.done || ui.busy ? ' disabled' : ''}>${d.log.done ? 'Logged today' : armed ? 'Confirm log?' : '+ Log'}</button>` : '';
    const link = d.page ? `<a href="${d.page[1]}">Open ${d.page[0]} ›</a>` : '';
    det = `<div class="hmdet">${listOf(d.h, d.items)}${listOf(d.h2, d.items2)}${log || link ? `<div class="hmact">${log}${link}</div>` : ''}</div>`;
  }
  return `<div class="hmpr${open ? ' open' : ''}">
<button type="button" class="hml1" data-hmrow="${esc(key)}" aria-expanded="${open ? 'true' : 'false'}"><i class="dot ${DOT[r.st]}"></i><span class="hmpn">${esc(r.n)}</span><span class="hmpv${r.nf ? ' nf' : ''}">${esc(r.v)}</span><span class="hmsw">${esc(r.word)}</span></button>
${bar}${r.info ? `<div class="hminfo">${esc(r.info)}</div>` : ''}${det}</div>`;
}

function progressHtml(cats, P, ui) {
  const per = ['today', 'week', 'month'].includes(ui.hmPer) ? ui.hmPer : 'today';
  const seg = [['today', 'Today'], ['week', '<span class="hmlg">This </span>week'], ['month', '<span class="hmlg">This </span>month']]
    .map(([k, l]) => `<button type="button" data-hmper="${k}" aria-pressed="${per === k}">${l}</button>`).join('');
  const cards = cats.map((c) => {
    const rows = c[per] || [];
    const scored = rows.filter((r) => r.st !== 'none');
    const on = scored.filter((r) => r.st === 'on').length;
    const badge = scored.length ? `<span class="pill sp"><i class="dot ${on < scored.length ? 'r' : 'hmon'}"></i><span class="hmlg">${on} of ${scored.length} on track</span><span class="hmsm">${on}/${scored.length}</span></span>` : '';
    return `<section class="card hmpc" data-hmcat="${c.key}" aria-label="${c.title}">
<div class="hmpch"><span class="hmsq" style="--c: var(--c-${c.key})"></span><h2>${c.title}</h2>${badge}</div>
${rows.length ? rows.map((r) => rowHtml(c.key, r, ui)).join('\n') : '<div class="hmpr"><span class="hminfo">Nothing for this period</span></div>'}
<div class="hmfoot"><button type="button" class="hmmh" hidden></button></div>
</section>`;
  }).join('\n');
  return `<div class="hmper"><h2>Progress</h2><div class="hmseg" role="group" aria-label="Progress period">${seg}</div>${P.updated ? `<span class="mut sp hmlg">Updated ${esc(P.updated)}</span>` : ''}</div>
<div class="hmsecs" data-hmper="${per}">
${cards}
</div>`;
}

export function renderHome(d2resp, d3resp, ui = {}, nowMs) {
  const P = periodOf(d2resp);
  const now = nowOf(nowMs);
  const sch = scheduleOf(d2resp, d3resp, P);
  const today = sch.days.find((d) => d.today);
  const live = (today?.items || []).filter((x) => !x.missed);
  const cur = live.find((x) => x.s <= now.h && x.e > now.h);
  const next = live.find((x) => x.s > now.h);
  const doing = cur ? cur.w.split(' · ')[0] : next ? `Next ${clockOf(next.s)} ${next.w.split(' · ')[0]}` : 'Free';
  const cols = CATS.map(([k, , def]) => `--c-${k}: ${HEX.test(ui.hmCols?.[k] || '') ? ui.hmCols[k] : def}`).join('; ');
  const wkDay = P.weekday + 1;
  return `<div class="hm" style="${cols}">
<h1 class="hmh1">Home</h1>
<div class="hmwid">
<div class="hmw"><small>Today</small><b>${P.ymd ? `<span class="hmlg">${esc(P.weekdayName)}</span><span class="hmsm">${DAYS[P.weekday]}</span>` : 'No data'}</b><span>${P.ymd ? `${esc(P.day)} ${esc(P.monthShort)}` : ''}</span></div>
<div class="hmw"><small>Now</small><b class="hmclock">${esc(now.clock)}</b><span title="${esc(doing)}">${esc(doing)}</span></div>
<div class="hmw"><small><span class="hmlg">This </span>week</small><b>${P.ymd ? `Day ${wkDay} <i>of 7</i>` : 'No data'}</b><div class="hmwbar"><u style="width: ${P.ymd ? pctOf(wkDay, 7) : 0}%"></u></div></div>
<div class="hmw"><small><span class="hmlg">This </span>month</small><b>${P.ymd ? `Day ${esc(P.day)} <i>of ${esc(P.daysInMonth)}</i>` : 'No data'}</b><div class="hmwbar"><u style="width: ${P.ymd ? pctOf(P.day, P.daysInMonth) : 0}%"></u></div></div>
</div>
${scheduleHtml(sch, now, ui)}
${progressHtml(homeGoals(d2resp, d3resp, P, now), P, ui)}
</div>`;
}

// ---- the page in the browser: scroll places, "N more" hints, clicks ----
// Where the scroll boxes are, read before a redraw so the redraw does not jump them.
export function homeKeep(main) {
  const box = main.querySelector?.('.hmbox');
  if (!box) return null;
  const cats = {};
  for (const c of main.querySelectorAll('.hmpc')) cats[c.dataset.hmcat] = c.scrollTop;
  return { view: box.dataset.hmscroll, box: box.scrollTop, per: main.querySelector('.hmsecs')?.dataset.hmper, cats };
}

// "▾ N more" at the foot of a category card when rows sit below the fold.
export function homeHints(main) {
  for (const c of main.querySelectorAll?.('.hmpc') || []) {
    const h = c.querySelector('.hmmh');
    if (!h) continue;
    const lim = c.querySelector('.hmfoot').getBoundingClientRect().bottom;
    const n = [...c.querySelectorAll('.hml1')].filter((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 > lim; }).length;
    h.hidden = !n;
    h.textContent = `▾ ${n} more`;
    c.classList.toggle('hasmore', !!n);
  }
}

// After a draw: put the scroll boxes back where they were, or bring the current time into view on a fresh one.
export function homeAfter(main, keep) {
  const box = main.querySelector?.('.hmbox');
  if (!box) return;
  if (keep && keep.view === box.dataset.hmscroll) box.scrollTop = keep.box;
  else if (box.dataset.hmscroll === 'cal') box.scrollTop = Number(box.dataset.hmtop) || 0;
  else {
    const cur = box.querySelector('[data-hmnow]');
    if (cur) box.scrollTop = Math.max(0, cur.offsetTop - 4);
  }
  if (keep && keep.per === main.querySelector('.hmsecs')?.dataset.hmper) {
    for (const c of main.querySelectorAll('.hmpc')) c.scrollTop = keep.cats[c.dataset.hmcat] || 0;
  }
  homeHints(main);
}

// Clicks on the Home page. true when the click was handled here.
export function homeClick(e, ui, render) {
  const t = e.target;
  const view = t.closest('[data-hmview]');
  if (view) { ui.hmView = view.dataset.hmview; render(); return true; }
  const per = t.closest('button[data-hmper]');
  if (per) { ui.hmPer = per.dataset.hmper; ui.hmOpen = null; render(); return true; }
  if (t.closest('[data-hmmore]')) { ui.hmMore = !ui.hmMore; render(); return true; }
  const more = t.closest('.hmmh');
  if (more) { const c = more.closest('.hmpc'); c?.scrollBy?.({ top: c.clientHeight - 80, behavior: 'smooth' }); return true; }
  const r = t.closest('[data-hmrow]');
  if (r) { ui.hmOpen = ui.hmOpen === r.dataset.hmrow ? null : r.dataset.hmrow; render(); return true; }
  return false;
}
