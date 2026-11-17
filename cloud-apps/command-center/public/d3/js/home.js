// Dashboard 3 Home page: the default page at /dash/ (design: Jacqueline's handover "new Home page", 12 Nov 2026).
// Top to bottom: four small widgets (today, now, this week, this month), the Schedule card (List | Calendar) and
// Progress (Today | This week | This month) as four category cards. Pure functions over the /dashboard/api/d2 and
// /dashboard/api/d3 answers, so tests run them without a browser.
// What is real: every built-in goal number (the same feeds as Goals and Money), the schedule's tasks (Jon's saved ones,
// GET /dashboard/api/home, seeded from the handover's standing rules), his own goals ("+ Add goal"), and the meetings:
// his Google Calendar week when it is connected, else today's from the d2 calendar section. The spending budgets are
// the handover's (BUDGET). A goal with no source reads "No feed" with a grey dot.
// What saves: ticks, the task pop-up (add, change, delete), dragging a calendar block, Add goal and its logs
// (src/home.js), and "+ Log" on workouts and date nights (the Goals page's own write).
import { esc, usd, toneOf } from './util.js';
import { periodOf, pipelineOf, dueOf } from './goals.js';
import { reviewItems } from './review.js';
import { dealStages } from './money.js';
import { DAYS, addDays, wdOf, dayItems, zoned, goalState } from './sched.js';

const TZ = 'America/Vancouver';
const START = 8; // the calendar's first hour (8am, so the home routines fit)
const END = 21;
const H = 64; // px per hour
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const one = (v) => (Array.isArray(v) ? v[0] : v) || null;
const pctOf = (a, b) => Math.max(0, Math.min(100, Math.round((a / b) * 100)));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// 9.5 -> "9:30" (12-hour, as the design)
export const clockOf = (h) => {
  const hh = Math.floor(h);
  return `${((hh + 11) % 12) + 1}:${String(Math.round((h - hh) * 60)).padStart(2, '0')}`;
};

export const CATS = [['factory', 'Factory', '#039be5'], ['sponsors', 'Sponsors', '#33b679'], ['personal', 'Personal', '#e67c73'], ['pnl', 'PnL', '#7986cb']];
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
const emailsWaiting = (d2resp) => {
  const st = dealStages(d2resp);
  return st ? st.flatMap((s) => s.deals.filter((d) => d.draft)) : null;
};
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// This week Monday to Sunday (desktop), plus the days a phone shows (today and the next two). Tasks are Jon's saved
// ones (home.tasks); meetings are his Google Calendar's when it is connected, else today's from Ana's calendar feed.
export function scheduleOf(d2resp, d3resp, P = periodOf(d2resp), home = null, now = nowOf()) {
  if (!P.ymd) return { days: [], cal: 'none' };
  const mine = emailsWaiting(d2resp);
  const google = !!home?.calendar?.connected;
  const feed = ((d2resp?.d2?.summary?.sections || []).find((s) => s.key === 'calendar')?.rows || []).map((r) => {
    const m = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/.exec(String(r.label || '').trim());
    if (!m) return null;
    const s = Number(m[1]) + Number(m[2]) / 60;
    const e = Number(m[3]) + Number(m[4]) / 60;
    return e > s ? { ymd: P.ymd, s, e, w: String(r.value || 'Meeting') } : null;
  }).filter(Boolean);
  const events = google ? (home.calendar.events || []).map((ev) => {
    const z = zoned(ev.start, ev.end, home.tz);
    return z ? { ...z, w: ev.title || 'Busy' } : null;
  }).filter(Boolean) : feed;
  const monday = addDays(P.ymd, -P.weekday);
  const ymds = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
  for (const d of [1, 2]) if (!ymds.includes(addDays(P.ymd, d))) ymds.push(addDays(P.ymd, d));
  const days = ymds.map((ymd, i) => {
    const today = ymd === P.ymd;
    const items = dayItems(home, ymd, P.ymd, now.h).map((it) => (it.key === 'emails' && today && mine?.length && !it.ghost ? { ...it, w: `${it.w} · ${mine.length} waiting` } : it));
    // a calendar event with a task's own name (a "Workout" series, say) is that task, not a second row
    const meets = events.filter((ev) => ev.ymd === ymd && !items.some((it) => sameName(it.w.split(' · ')[0], ev.w)))
      .map((ev, n) => ({ k: `m|${ymd}|${n}`, s: ev.s, e: ev.e, w: ev.w, c: 'meeting', key: '', meet: true, on: ymd }));
    items.push(...meets);
    items.sort((a, b) => a.s - b.s || a.e - b.e);
    const diff = Math.round((Date.parse(`${ymd}T12:00:00Z`) - Date.parse(`${P.ymd}T12:00:00Z`)) / 86400000);
    return { ymd, name: DAYS[wdOf(ymd)], n: Number(ymd.slice(8, 10)), today, week: i < 7, phone: diff >= 0 && diff <= 2, items };
  });
  return { days, cal: google ? 'google' : home?.calendar?.canConnect ? 'ready' : 'none' };
}

const PENCIL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const spanOf = (x) => `${clockOf(x.s)}–${clockOf(x.e)}`;
function listHtml(day, now, ui) {
  if (!day) return '<p class="mut">No feed: today\'s date could not be read.</p>';
  const next = day.items.find((x) => x.e > now.h && !x.ghost);
  return day.items.map((x) => {
    const cur = x.s <= now.h && x.e > now.h && !x.ghost && !x.done;
    const tag = x.meet ? '<span class="hmtag">Meeting</span>' : x.tag ? `<span class="hmtag${x.late && !x.done ? ' late' : ''}">${x.tag}</span>` : '';
    const cls = `hmrow${x.done ? ' done' : ''}${x.missed ? ' miss' : ''}${x.meet ? ' meet' : ''}${cur ? ' now' : ''}`;
    if (x.meet) return `<div class="${cls}"${x === next ? ' data-hmnow' : ''}><span class="hmnb" aria-hidden="true"></span><span class="hmtm">${spanOf(x)}</span><i class="hmcd" style="--c: var(--c-${x.c})"></i><span class="hmwhat">${esc(x.w)}</span>${tag}</div>`;
    const k = esc(x.k);
    const box = x.ghost ? '<span class="hmnb" aria-hidden="true"></span>'
      : `<input type="checkbox" data-hmtick="${k}"${x.done ? ' checked' : ''} aria-label="${esc(x.w)}: ${x.done ? 'done' : 'not done'}">`;
    return `<div class="${cls}"${x === next ? ' data-hmnow' : ''}>${box}<button type="button" class="hmtm hmlink" data-hmit="${k}">${spanOf(x)}</button><i class="hmcd" style="--c: var(--c-${x.c})"></i><button type="button" class="hmwhat hmlink" data-hmit="${k}">${esc(x.w)}</button>${tag}<button type="button" class="hmedb" data-hmit="${k}" aria-label="Edit ${esc(x.w)}" title="Edit">${PENCIL}</button></div>`;
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
      return `<div class="hmev${small ? ' sm' : ''}${x.meet ? ' m' : ''}${x.done ? ' done' : ''}${x.missed ? ' miss' : ''}"${x.meet ? '' : ` data-hmit="${esc(x.k)}" role="button" tabindex="0"`} style="top: ${top(x.s)}px; height: ${Math.max(14, top(x.e) - top(x.s) - 2)}px; --c: var(--c-${x.c})" title="${esc(t)}">${small ? `<b>${clockOf(x.s)} ${esc(x.w)}</b>` : `<b>${esc(x.w)}</b><span>${spanOf(x)}</span>`}</div>`;
    }).join('');
    return `<div class="hmday${d.today ? ' today' : ''}${d.week ? ' hmwk' : ''}${d.phone ? ' hmph' : ''}"><div class="hmdh"><small>${d.name}</small><b>${d.n}</b></div><div class="hmcol" data-ymd="${d.ymd}">${d.today ? `<div class="hmnow" style="top: ${top(now.h)}px"></div>` : ''}${evs}</div></div>`;
  }).join('');
  return `<div class="hmcal"><div class="hmhrs"><div class="hmdh"></div><div class="hmhb">${hours}</div></div>${cols}</div>`;
}

function scheduleHtml(sch, now, ui, home) {
  const view = ui.hmView === 'cal' ? 'cal' : 'list';
  const seg = [['list', 'List'], ['cal', 'Calendar']].map(([k, l]) => `<button type="button" data-hmview="${k}" aria-pressed="${view === k}">${l}</button>`).join('');
  const legend = CATS.map(([k, l, def]) => `<label><input type="color" data-hmcol="${k}" value="${esc(ui.hmCols?.[k] || def)}" aria-label="${l} colour">${l}</label>`).join('');
  const today = sch.days.find((d) => d.today);
  const body = !home ? '<p class="mut">Your saved tasks could not be loaded. They show again on the next refresh.</p>' : view === 'cal' ? calHtml(sch.days, now) : listHtml(today, now, ui);
  const meet = sch.cal === 'google' ? 'Meetings come from your Google Calendar.'
    : sch.cal === 'ready' ? 'Meetings are only today\'s, from Ana\'s feed: <a href="/dashboard/api/google/start">connect Google Calendar</a> to see the week.'
      : 'Meetings are only today\'s, from Ana\'s feed, until Google Calendar is connected.';
  return `<section class="card hmsch${ui.hmMore ? ' hmexp' : ''}" aria-label="Schedule">
<div class="hd"><h2>Schedule</h2><button type="button" class="btn sm sp" data-hmadd${home ? '' : ' disabled'}>+ <span class="hmlg">Add </span>task</button><div class="hmseg" role="group" aria-label="Schedule view">${seg}</div></div>
<div class="hmleg">${legend}</div>
<p class="hmex"><span class="hmlg">Tick a task when it is done. Click any task to change its name, day or time. ${meet} Click a colour to change it.</span><span class="hmsm">Tap a task to edit · tap a colour to change it</span></p>
<div class="hmbox" data-hmscroll="${view}" data-hmtop="${Math.max(0, Math.round((now.h - START) * H) - 40)}">${body}</div>
${view === 'cal' && home ? '<p class="hmex hmlg">Drag a block to move it. Click it to change the time. A repeating task moves for that day only; its usual time stays.</p>' : ''}
<button type="button" class="btn sm hmmore" data-hmmore aria-expanded="${ui.hmMore ? 'true' : 'false'}">${ui.hmMore ? 'See less ▴' : 'See more ▾'}</button>
</section>`;
}

// ---- the task pop-up (handover section 6) ----
const toT = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const fromT = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const REPN = { none: "Doesn't repeat", daily: 'Every day', weekdays: 'Every weekday', weekly: 'Weekly', monthly: 'Monthly' };
const MISSN = { next: 'If missed → next day', retry: 'If missed → retry, then next day', makeup: 'If missed → pick a make-up day', none: 'If missed → skip' };
const REMN = { none: 'No reminder', 0: 'Reminder at start', 10: 'Reminder 10 min before', 30: 'Reminder 30 min before', 60: 'Reminder 1 hr before' };
const dayLabel = (ymd) => `${DAYS[wdOf(ymd)]} ${Number(ymd.slice(8))}`;

// The pop-up's fields for a schedule item (or a new task when it is null).
export function editorOf(it, home, P, now) {
  const t = it ? (home?.tasks || []).find((x) => x.id === it.id) : null;
  if (it && !t) return null;
  if (!t) {
    const s = Math.min(22 * 60, Math.ceil((now.h * 60 + 1) / 30) * 30);
    return { id: null, occ: null, was: 'none', kind: '', title: '', cat: 'personal', day: P.ymd, start: toT(s), end: toT(s + 30), scope: 'all', rep: 'none', days: [P.weekday], miss: 'next', retry: '15:00', rem: 'none', text: false, note: '' };
  }
  return {
    id: t.id, occ: it.day, was: t.rep, kind: t.kind, title: t.title, cat: t.cat, day: it.on, start: toT(Math.round(it.s * 60)), end: toT(Math.round(it.e * 60)),
    scope: 'once', rep: t.rep, days: t.days.length ? t.days : [wdOf(it.day)], miss: t.miss, retry: toT(t.retry ?? 900), rem: String(t.rem), text: t.text, note: t.note,
  };
}
export function editorSummary(ed) {
  const s = fromT(ed.start);
  const e = fromT(ed.end);
  if (s == null || e == null || !ed.day) return '';
  return [`${dayLabel(ed.day)} · ${clockOf(s / 60)}–${clockOf(e / 60)}`,
    ed.rep === 'weekly' && ed.days.length ? `Weekly on ${ed.days.map((d) => DAYS[d]).join(', ')}` : REPN[ed.rep],
    MISSN[ed.miss], `${REMN[ed.rem]}${ed.text ? ' + text' : ''}`].join('  ·  ');
}
// What a task counts toward, for the pop-up's pill.
function countsToward(ed, d2resp, d3resp) {
  const g3 = d3resp?.d3?.goals;
  if (ed.kind === 'workout' && num(g3?.workouts?.actual)) return `Workouts · ${g3.workouts.actual} / ${g3.workouts.target} this week`;
  if (ed.kind === 'workout') return 'Workouts this week';
  if (ed.kind === 'date_night') return 'Date night · 1 a week';
  if (ed.kind === 'emails') { const m = emailsWaiting(d2resp); return m ? `Emails waiting on you · ${m.length}` : 'Emails waiting on you'; }
  return 'Nothing yet';
}
const opt = (v, l, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${l}</option>`;
function editorHtml(ed, sch, d2resp, d3resp) {
  const dayOpts = [...new Set([...sch.days.map((d) => d.ymd), ed.day])].sort().map((d) => opt(d, dayLabel(d), ed.day)).join('');
  const rep = !!ed.id && ed.was !== 'none';
  const lock = rep && ed.scope === 'once' ? ' disabled' : '';
  return `<div class="hmhost" data-hmhost><form class="hmed" data-hmform="task" aria-label="${ed.id ? 'Change task' : 'New task'}" novalidate>
<div class="hmedh"><input name="title" class="hmedt" value="${esc(ed.title)}" maxlength="120" placeholder="New task, e.g. Call the bank" aria-label="Task name"><button type="button" class="hmx" data-hmx aria-label="Close">✕</button></div>
<p class="hmedsum" data-hmsum>${esc(editorSummary(ed))}</p>
<div class="hmedg">
<label>Category</label><select name="cat" aria-label="Category">${CATS.map(([k, l]) => opt(k, l, ed.cat)).join('')}</select>
<label>When</label><div class="hmedrow"><select name="day" aria-label="Day">${dayOpts}</select><input type="time" name="start" step="900" value="${esc(ed.start)}" aria-label="Start time"><span>to</span><input type="time" name="end" step="900" value="${esc(ed.end)}" aria-label="End time"></div>
${rep ? `<label>Change</label><div class="hmedrow"><label class="hmck"><input type="radio" name="scope" value="once"${ed.scope === 'once' ? ' checked' : ''}> Just this one (usual time stays)</label><label class="hmck"><input type="radio" name="scope" value="all"${ed.scope === 'all' ? ' checked' : ''}> Every time</label></div>` : ''}
<label class="sep">Repeats</label><div class="hmedcol"><select name="rep" aria-label="Repeats"${lock}>${opt('none', 'Does not repeat', ed.rep)}${opt('daily', 'Every day', ed.rep)}${opt('weekdays', 'Every weekday (Mon–Fri)', ed.rep)}${opt('weekly', 'Weekly on…', ed.rep)}${opt('monthly', 'Monthly', ed.rep)}</select>
${ed.rep === 'weekly' ? `<div class="hmchips">${DAYS.map((d, i) => `<label><input type="checkbox" name="days" value="${i}"${ed.days.includes(i) ? ' checked' : ''}${lock}>${d}</label>`).join('')}</div>` : ''}
${ed.rep !== 'none' ? `<span class="hmhint">${lock ? 'Pick "Every time" to change how it repeats' : 'Weekly goals reset every Monday'}</span>` : ''}</div>
<label class="sep">If missed</label><div class="hmedcol"><select name="miss" aria-label="If missed">${opt('next', 'Move to the next day, marked Late', ed.miss)}${opt('retry', 'Retry later the same day, then next day', ed.miss)}${opt('makeup', 'Pick a make-up day (usual day stays)', ed.miss)}${opt('none', 'Skip, don&#39;t carry over', ed.miss)}</select>
${ed.miss === 'retry' ? `<div class="hmedrow"><span>Retry at</span><input type="time" name="retry" step="900" value="${esc(ed.retry)}" aria-label="Retry time"><span>then next day at the usual time</span></div>` : ''}</div>
<label class="sep">Reminder</label><div class="hmedcol"><div class="hmedrow"><select name="rem" aria-label="Reminder">${opt('none', 'No reminder', ed.rem)}${opt('0', 'At start time', ed.rem)}${opt('10', '10 min before', ed.rem)}${opt('30', '30 min before', ed.rem)}${opt('60', '1 hour before', ed.rem)}</select>
<label class="hmck"><input type="checkbox" name="text"${ed.text ? ' checked' : ''}> Also text me</label></div><span class="hmhint">Saved with the task. Reminders and texts are not sent yet.</span></div>
<label class="sep">Counts toward</label><div class="hmgoalp"><span class="hmgpill">${esc(countsToward(ed, d2resp, d3resp))}</span></div>
<label>Note</label><textarea name="note" rows="2" maxlength="1000" placeholder="Add a note">${esc(ed.note)}</textarea>
</div>
<div class="hmedf">${ed.id ? `<button type="button" class="btn hmdel" data-hmdel${ed.busy ? ' disabled' : ''}>${ed.arm ? (rep && ed.scope === 'once' ? 'Remove just this one?' : rep ? 'Delete every time?' : 'Delete it?') : 'Delete'}</button>` : ''}<span class="hmerr" role="alert">${esc(ed.err || '')}</span><button type="submit" class="btn primary"${ed.busy ? ' disabled' : ''}>${ed.busy ? 'Saving' : 'Save'}</button></div>
</form></div>`;
}

// ---- the Add goal pop-up (handover section 7) ----
export const SUBS = { sponsors: ['Outreach', 'Deals', 'Delivery', 'Invoicing'], factory: ['Jon Mac', '@JonMacAI', 'Home Guide Press', 'QC', 'Uploads'], personal: ['Trips', 'Health', 'Relationship', 'House', 'Spending'], pnl: ['Revenue', 'Business spending', 'Profit'] };
const PERN = { today: 'daily', week: 'weekly', month: 'monthly' };
export const newGoal = (cat, per, P) => ({ name: '', cat: cat || 'sponsors', sub: '', per: per || 'week', type: 'count', target: '', due: P.ymd ? addDays(P.ymd, 3) : '', steps: '', time: '11:00', days: [], track: 'log' });
export function goalSummary(g) {
  const v = Number(g.target);
  const catName = CATS.find(([k]) => k === g.cat)?.[1] || '';
  const dOn = g.per === 'week' || g.type === 'habit';
  const tgt = g.type === 'pile' ? ' · keep at 0'
    : !(v > 0) || !['count', 'money', 'spend', 'percent'].includes(g.type) ? ''
      : g.type === 'spend' ? ` · stay under $${v.toLocaleString('en-US')}` : ` · target ${g.type === 'money' ? `$${v.toLocaleString('en-US')}` : g.type === 'percent' ? `${v}%` : v}`;
  return `${g.name.trim() || 'New goal'} · ${catName}${g.sub.trim() ? ` › ${g.sub.trim()}` : ''} · ${PERN[g.per]}${tgt}${dOn && g.days.length ? ` · on ${g.days.map((d) => DAYS[d]).join(', ')}` : ''}`;
}
function goalFormHtml(g) {
  const t = g.type;
  const hasT = ['count', 'money', 'spend', 'percent'].includes(t);
  const dOn = g.per === 'week' || t === 'habit';
  return `<div class="hmhost" data-hmhost><form class="hmed" data-hmform="goal" aria-label="Add goal" novalidate>
<div class="hmedh"><input name="name" class="hmedt" value="${esc(g.name)}" maxlength="80" placeholder="New goal, e.g. Podcast episodes" aria-label="Goal name"><button type="button" class="hmx" data-hmx aria-label="Close">✕</button></div>
<p class="hmedsum" data-hmsum>${esc(goalSummary(g))}</p>
<div class="hmedg">
<label>Category</label><select name="cat" aria-label="Category">${[CATS[1], CATS[0], CATS[2], CATS[3]].map(([k, l]) => opt(k, l, g.cat)).join('')}</select>
<label>Sub-category</label><div class="hmedcol"><input name="sub" list="hmsubs" value="${esc(g.sub)}" maxlength="40" placeholder="e.g. ${esc(SUBS[g.cat]?.[0] || 'Trips')}" aria-label="Sub-category"><datalist id="hmsubs">${(SUBS[g.cat] || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist><span class="hmhint">Pick one or type a new one</span></div>
<label class="sep">How often</label><select name="per" aria-label="How often">${opt('today', 'Daily (resets every day)', g.per)}${opt('week', 'Weekly (resets Monday)', g.per)}${opt('month', 'Monthly (resets on the 1st)', g.per)}</select>
<label>Type</label><select name="type" aria-label="Type">${opt('count', 'A count (e.g. 3 videos)', t)}${opt('money', 'Money (e.g. $10,000)', t)}${opt('pile', 'Keep at 0 (a pile to clear)', t)}${opt('spend', 'Spending limit (stay under $)', t)}${opt('once', 'Do once, by a date', t)}${opt('checklist', 'Checklist (several steps)', t)}${opt('percent', 'Rate % (e.g. 80% pass)', t)}${opt('habit', 'Habit on set days, at a time', t)}</select>
${hasT ? `<label>${t === 'spend' ? 'Max $' : t === 'percent' ? 'Target %' : 'Target'}</label><input name="target" type="number" min="1" step="1" value="${esc(g.target)}" placeholder="${t === 'spend' ? '2000' : t === 'money' ? '10000' : t === 'percent' ? '80' : '3'}" aria-label="Target">` : ''}
${t === 'once' || t === 'checklist' ? `<label>By</label><input name="due" type="date" value="${esc(g.due)}" aria-label="By date">` : ''}
${t === 'checklist' ? `<label>Steps</label><textarea name="steps" rows="3" placeholder="One per line, e.g.&#10;Book flights&#10;Book hotel&#10;Book car rental" aria-label="Steps">${esc(g.steps)}</textarea>` : ''}
${t === 'habit' ? `<label>At</label><input name="time" type="time" step="900" value="${esc(g.time)}" aria-label="At time">` : ''}
${dOn ? `<label>On days</label><div class="hmchips">${DAYS.map((d, i) => `<label><input type="checkbox" name="days" value="${i}"${g.days.includes(i) ? ' checked' : ''}>${d}</label>`).join('')}</div>` : ''}
<label class="sep">Tracked by</label><div class="hmedcol"><select name="track" aria-label="Tracked by">${opt('log', 'I log it (+ Log button)', g.track)}${opt('auto', 'Updates automatically', g.track)}</select>${g.track === 'auto' ? '<span class="hmhint">It reads "No feed" until a bot is set up to report it.</span>' : ''}</div>
</div>
<div class="hmedf"><span class="hmerr" role="alert">${esc(g.err || '')}</span><button type="submit" class="btn primary"${g.busy ? ' disabled' : ''}>${g.busy ? 'Adding' : 'Add goal'}</button></div>
</form></div>`;
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

// One of Jon's own goals ("+ Add goal") as a Progress row; its detail carries the controls to log or delete it.
function ownRow(g, logs, P) {
  const s = goalState(g, logs, P);
  const info = [g.sub, g.type === 'habit' ? `${g.days.map((d) => DAYS[d]).join(', ')}${g.time != null ? ` at ${clockOf(g.time / 60)}` : ''}` : '',
    g.due ? `by ${DAYS[wdOf(g.due)]} ${Number(g.due.slice(8))}` : '', g.track === 'auto' ? 'Nothing reports this yet' : 'You log it'].filter(Boolean).join(' · ');
  return row(`g:${g.id}`, g.name, s.v, s.st, info, { h: '', items: [], goal: { id: g.id, type: g.type, track: g.track, doneToday: s.doneToday, steps: s.steps || [] } },
    { word: s.word || WORD[s.st], nf: !!s.nf, pct: s.pct, pace: s.pace });
}

// Profit this month in USD: sponsor cash (USD) less RBC business spending (CAD) at the Bank of Canada's daily rate.
// Grey, with no number, when any part is missing; grey with the number when either side is stale.
function profitRow(collected, sec, fx) {
  const rev = collected && num(collected.actual) && collected.display !== 'No data' ? collected.actual : null;
  const b = sec?.split?.business;
  const exp = b && num(b.month) ? b.month : null;
  const rate = num(fx?.usdcad) && fx.usdcad > 0 ? fx.usdcad : null;
  const why = rev == null ? 'Sponsor cash this month has not reported' : exp == null ? 'Business spending is not in the MoneyClaw feed' : !rate ? 'No USD to CAD rate yet (Bank of Canada, pulled every 6 hours)' : '';
  if (why) return row('profit', 'Business profit this month', 'No data', 'none', why, { h: '', items: [], page: PG.money }, { nf: true });
  const p = rev - exp / rate;
  const stale = !!(collected.source?.stale || sec?.stale);
  const span = b.basis === 'stages' && !b.monthFrom ? '' : b.basis === 'stages' ? `spending from ${b.monthFrom.slice(5).replace('-', '/')}` : 'spending is the last 30 days';
  const st = stale ? 'none' : p >= 0 ? 'on' : 'off';
  return row('profit', 'Business profit this month', `${p < 0 ? '−' : ''}${usd(Math.abs(p))}`, st,
    [`${usd(rev)} in − ${cad0(exp)} CAD out`, `1 USD = ${rate.toFixed(4)} CAD`, span, stale ? 'a feed is stale' : ''].filter(Boolean).join(' · '),
    { h: 'In USD', items: [`Revenue ${usd(rev)} (sponsor cash only; ads and affiliates have no feed yet)`, `Business spending ${cad0(exp)} CAD = ${usd(exp / rate)}`, `Bank of Canada rate${fx.day ? ` for ${fx.day}` : ''}`], page: PG.money },
    { word: stale ? 'Stale' : p >= 0 ? 'Profit' : 'Loss' });
}

export function homeGoals(d2resp, d3resp, P = periodOf(d2resp), now = nowOf(), home = null) {
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
    ],
  };
  // Money owed and deals to close, in dollars, under every period (Jon, 2026-11-12)
  // A deal owing money with no amount on the board is counted but not priced; all unpriced reads "Not priced", never a
  // bare $0. Deals to close holds priced deals only (Jon, 2026-11-13), so it is always a dollar total.
  const money$ = (list, total) => (total > 0 ? usd(total) : list.some((r) => r.amt == null) ? 'Not priced' : usd(0));
  const dealsInfo = (list, none, what) => {
    if (!list.length) return none;
    const np = list.filter((r) => r.amt == null).length;
    return `${plural(list.length, 'deal')}${what}${np ? ` · ${np === list.length ? 'no amounts on the Sponsors board' : `${np} not priced`}` : ''}`;
  };
  const owed = !pipe ? noFeed('owed', 'Money owed', 'The Sponsors board could not be read.', PG.money)
    : row('owed', 'Money owed', money$(pipe.collect, pipe.totals.collect), 'none', dealsInfo(pipe.collect, 'Nothing owed', ' still to pay you'),
      { h: 'To collect', items: pipe.collect.map(amt), page: PG.money }, { word: 'To collect' });
  const toClose = !pipe ? noFeed('close', 'Deals to close', 'The Sponsors board could not be read.', PG.money)
    : row('close', 'Deals to close', usd(pipe.totals.close), 'none', dealsInfo(pipe.close, 'None open', ''),
      { h: 'To close', items: pipe.close.map(amt), page: PG.money }, { word: 'Pipeline' });
  for (const per of ['today', 'week', 'month']) sponsors[per].push(owed, toClose);

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
    ],
    month: [
      spendRow('pspend', 'Personal spending', split, split?.split?.personal, 'month', BUDGET.personal, P),
      noFeed('trips', 'Trips', 'No travel spending feed yet. Set a limit with + Add goal, Spending limit.', PG.money),
      noFeed('groups', 'Expense goals by group', 'MoneyClaw Goals is not connected yet.', PG.money),
    ],
  };

  // PnL: revenue, expenses and profit this month under every period (Jon, 2026-11-12)
  const revenue = fromMetric('revenue', 'Revenue this month', collected, { money: true, info: ['Sponsor cash only', thru ? `through ${thru}` : ''].filter(Boolean).join(' · '),
    det: { h: `${P.monthName || 'This month'} so far`, items: ['Sponsor cash collected', 'YouTube ads and affiliates: no feed yet'], page: PG.money } });
  // Expenses split into Business and Personal (Jon, 2026-11-13); profit is revenue less business spending only
  const expenses = spendRow('bmonth', 'Business expenses', split, split?.split?.business, 'month', BUDGET.business, P);
  const pexp = spendRow('pmonth', 'Personal expenses', split, split?.split?.personal, 'month', BUDGET.personal, P);
  const profit = profitRow(collected, split, home?.fx);
  const pnl = {
    today: [revenue, expenses, pexp, profit],
    week: [revenue, expenses, pexp, profit, spendRow('bweek', 'Business spending', split, split?.split?.business, 'week', BUDGET.businessWeek, P)],
    month: [revenue, expenses, pexp, profit],
  };
  const cats = [{ key: 'pnl', title: 'PnL', ...pnl }, { key: 'sponsors', title: 'Sponsors', ...sponsors }, { key: 'factory', title: 'Factory', ...factory }, { key: 'personal', title: 'Personal', ...personal }];
  if (P.ymd) for (const g of home?.goals || []) cats.find((c) => c.key === g.cat)?.[g.per]?.push(ownRow(g, home.logs || [], P));
  return cats;
}

const DOT = { off: 'r', risk: 'y', on: 'hmon', none: '' };
const listOf = (h, items) => `${h ? `<p class="hmdh2">${esc(h)}</p>` : ''}${items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}`;
// The controls under one of Jon's own goals: log it, tick its steps or type its number, and delete it.
function goalCtlHtml(g, ui) {
  const id = esc(g.id);
  const off = ui.hmBusy ? ' disabled' : '';
  let ctl = '';
  if (g.track === 'auto') ctl = '';
  else if (g.type === 'checklist') ctl = `<div class="hmsteps">${g.steps.map((s, i) => `<label class="hmck"><input type="checkbox" data-hmgstep="${id}|${i}"${s.done ? ' checked' : ''}${off}> ${esc(s.name)}</label>`).join('')}</div>`;
  else if (g.type === 'count') ctl = `<button type="button" class="btn sm" data-hmglog="${id}|add|1"${off}>+ Log</button>${g.doneToday ? `<button type="button" class="btn sm" data-hmglog="${id}|add|-1"${off}>Undo 1</button>` : ''}`;
  else if (g.type === 'once' || g.type === 'habit') ctl = g.doneToday ? `<button type="button" class="btn sm" data-hmglog="${id}|done|0"${off}>Undo</button>` : `<button type="button" class="btn sm" data-hmglog="${id}|done|1"${off}>+ Log</button>`;
  else {
    const what = g.type === 'percent' ? 'Rate now, %' : g.type === 'pile' ? 'How many are open now' : 'Today\'s total, $';
    ctl = `<input type="number" min="0" step="any" class="hmgnum" data-hmgval="${id}" placeholder="${what}" aria-label="${what}"><button type="button" class="btn sm" data-hmgset="${id}"${off}>Save</button>`;
  }
  return `<div class="hmact">${ctl}<button type="button" class="btn sm hmdel sp" data-hmgdel="${id}"${off}>${ui.hmGDel === g.id ? 'Delete this goal?' : 'Delete goal'}</button></div>`;
}
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
    det = `<div class="hmdet">${listOf(d.h, d.items)}${listOf(d.h2, d.items2)}${d.goal ? goalCtlHtml(d.goal, ui) : log || link ? `<div class="hmact">${log}${link}</div>` : ''}</div>`;
  }
  return `<div class="hmpr${open ? ' open' : ''}">
<button type="button" class="hml1" data-hmrow="${esc(key)}" aria-expanded="${open ? 'true' : 'false'}"><i class="dot ${DOT[r.st]}"></i><span class="hmpn">${esc(r.n)}</span><span class="hmpv${r.nf ? ' nf' : ''}">${esc(r.v)}</span><span class="hmsw">${esc(r.word)}</span></button>
${bar}${r.info ? `<div class="hminfo">${esc(r.info)}</div>` : ''}${det}</div>`;
}

function progressHtml(cats, P, ui, home) {
  const per = ['today', 'week', 'month'].includes(ui.hmPer) ? ui.hmPer : 'today';
  const seg = [['today', 'Today'], ['week', '<span class="hmlg">This </span>week'], ['month', '<span class="hmlg">This </span>month']]
    .map(([k, l]) => `<button type="button" data-hmper="${k}" aria-pressed="${per === k}">${l}</button>`).join('');
  const can = home ? '' : ' disabled';
  const cards = cats.map((c) => {
    const rows = c[per] || [];
    const scored = rows.filter((r) => r.st !== 'none');
    const on = scored.filter((r) => r.st === 'on').length;
    const badge = scored.length ? `<span class="pill sp"><i class="dot ${on < scored.length ? 'r' : 'hmon'}"></i><span class="hmlg">${on} of ${scored.length} on track</span><span class="hmsm">${on}/${scored.length}</span></span>` : '';
    return `<section class="card hmpc" data-hmcat="${c.key}" aria-label="${c.title}">
<div class="hmpch"><span class="hmsq" style="--c: var(--c-${c.key})"></span><h2>${c.title}</h2>${badge}</div>
${rows.length ? rows.map((r) => rowHtml(c.key, r, ui)).join('\n') : '<div class="hmpr"><span class="hminfo">Nothing for this period</span></div>'}
<div class="hmfoot"><button type="button" class="hmmh" hidden></button><button type="button" class="hmaddc" data-hmgadd="${c.key}"${can}>+ Add goal</button></div>
</section>`;
  }).join('\n');
  return `<div class="hmper"><h2>Progress</h2><div class="hmseg" role="group" aria-label="Progress period">${seg}</div>${P.updated ? `<span class="mut hmlg hmupd">Updated ${esc(P.updated)}</span>` : ''}<button type="button" class="btn sm primary hmaddg" data-hmgadd=""${can}>+ <span class="hmlg">Add </span>goal</button></div>
<div class="hmsecs" data-hmper="${per}">
${cards}
</div>`;
}

// `home` is GET /dashboard/api/home's answer (Jon's saved tasks, his own goals and his calendar), null when it could not be read.
export function renderHome(d2resp, d3resp, ui = {}, nowMs, home = null) {
  const P = periodOf(d2resp);
  const now = nowOf(nowMs);
  const sch = scheduleOf(d2resp, d3resp, P, home, now);
  ui.hmItems = Object.fromEntries(sch.days.flatMap((d) => d.items.filter((x) => !x.meet).map((x) => [x.k, x]))); // what a click on a task opens
  const today = sch.days.find((d) => d.today);
  const live = (today?.items || []).filter((x) => !x.missed && !x.done);
  const cur = live.find((x) => x.s <= now.h && x.e > now.h);
  const next = live.find((x) => x.s > now.h);
  const doing = cur ? cur.w.split(' · ')[0] : next ? `Next ${clockOf(next.s)} ${next.w.split(' · ')[0]}` : 'Free';
  const cols = CATS.map(([k, , def]) => `--c-${k}: ${HEX.test(ui.hmCols?.[k] || '') ? ui.hmCols[k] : def}`).join('; ');
  const wkDay = P.weekday + 1;
  const pop = ui.hmEd ? editorHtml(ui.hmEd, sch, d2resp, d3resp) : ui.hmGoal ? goalFormHtml(ui.hmGoal) : '';
  return `<div class="hm" style="${cols}">
<h1 class="hmh1">Home</h1>
<div class="hmwid">
<div class="hmw"><small>Today</small><b>${P.ymd ? `<span class="hmlg">${esc(P.weekdayName)}</span><span class="hmsm">${DAYS[P.weekday]}</span>` : 'No data'}</b><span>${P.ymd ? `${esc(P.day)} ${esc(P.monthShort)}` : ''}</span></div>
<div class="hmw"><small>Now</small><b class="hmclock">${esc(now.clock)}</b><span title="${esc(doing)}">${esc(doing)}</span></div>
<div class="hmw"><small><span class="hmlg">This </span>week</small><b>${P.ymd ? `Day ${wkDay} <i>of 7</i>` : 'No data'}</b><div class="hmwbar"><u style="width: ${P.ymd ? pctOf(wkDay, 7) : 0}%"></u></div></div>
<div class="hmw"><small><span class="hmlg">This </span>month</small><b>${P.ymd ? `Day ${esc(P.day)} <i>of ${esc(P.daysInMonth)}</i>` : 'No data'}</b><div class="hmwbar"><u style="width: ${P.ymd ? pctOf(P.day, P.daysInMonth) : 0}%"></u></div></div>
</div>
${scheduleHtml(sch, now, ui, home)}
${progressHtml(homeGoals(d2resp, d3resp, P, now, home), P, ui, home)}
${pop}</div>`;
}

// ---- the page in the browser: scroll places, "N more" hints, clicks, ticks, the pop-ups, dragging ----
// Where the scroll boxes are, read before a redraw so the redraw does not jump them.
export function homeKeep(main) {
  const box = main.querySelector?.('.hmbox');
  if (!box) return null;
  const cats = {};
  for (const c of main.querySelectorAll('.hmpc')) cats[c.dataset.hmcat] = c.scrollTop;
  return { view: box.dataset.hmscroll, box: box.scrollTop, per: main.querySelector('.hmsecs')?.dataset.hmper, cats, pop: main.querySelector('.hmed')?.scrollTop || 0 };
}

// "▾ N more" at the foot of a category card when rows sit below the fold.
export function homeHints(main) {
  for (const c of main.querySelectorAll?.('.hmpc') || []) {
    const h = c.querySelector('.hmmh');
    if (!h) continue;
    const lim = c.querySelector('.hmfoot').getBoundingClientRect().top;
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
  const pop = main.querySelector('.hmed');
  if (pop && keep?.pop) pop.scrollTop = keep.pop;
  homeHints(main);
}

// Reads the open pop-up's form into its state (ui.hmEd or ui.hmGoal), so a redraw keeps what was typed.
export function homeForm(form, ui) {
  const st = form?.dataset?.hmform === 'task' ? ui.hmEd : ui.hmGoal;
  if (!st) return null;
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.name === 'days') continue;
    if (el.type === 'radio') { if (el.checked) st[el.name] = el.value; } else if (el.type === 'checkbox') st[el.name] = el.checked;
    else st[el.name] = el.value;
  }
  const days = [...form.elements].filter((el) => el.name === 'days');
  if (days.length && !days[0].disabled) st.days = days.filter((el) => el.checked).map((el) => Number(el.value));
  st.err = '';
  st.arm = false;
  return st;
}
const sumOf = (form, ui) => (form.dataset.hmform === 'task' ? editorSummary(ui.hmEd) : goalSummary(ui.hmGoal));
const RELAY = ['rep', 'miss', 'scope', 'type', 'per', 'cat', 'track']; // fields whose change shows or hides other fields

// Typing in a pop-up: keep it in the state and refresh the one-line summary. true when the event was a pop-up's.
export function homeInput(e, ui) {
  const form = e.target.closest?.('[data-hmform]');
  if (!form || !homeForm(form, ui)) return false;
  const sum = form.querySelector('[data-hmsum]');
  if (sum) sum.textContent = sumOf(form, ui);
  return true;
}

const failed = (S, what, r) => { S.error = `Could not ${what} (${r?.error || 'no answer'}).`; };

// A tick box or a pop-up field changed. true when it was handled here.
export function homeChange(e, S, render, api, reload) {
  const t = e.target;
  const ui = S.ui;
  const form = t.closest?.('[data-hmform]');
  if (form) {
    if (!homeForm(form, ui)) return true;
    if (RELAY.includes(t.name)) {
      render();
      const sel = `[data-hmform] [name="${t.name}"]${t.type === 'radio' ? `[value="${t.value}"]` : ''}`;
      form.ownerDocument?.querySelector(sel)?.focus?.();
    } else homeInput(e, ui);
    return true;
  }
  if (t.dataset?.hmtick) {
    const it = ui.hmItems?.[t.dataset.hmtick];
    if (!it || !S.home) return true;
    const done = !!t.checked;
    // show it at once; the reload after the save brings the stored truth
    const days = S.home.days.filter((d) => !(d.id === it.id && d.day === it.day));
    const old = S.home.days.find((d) => d.id === it.id && d.day === it.day) || { id: it.id, day: it.day, skip: false, moveDay: null, start: null, end: null };
    S.home.days = [...days, { ...old, done, doneOn: done ? it.on : null }];
    if (it.key === 'workout' || it.key === 'date_night') {
      S.home.habits = S.home.habits.filter((h) => !(h.kind === it.key && (h.day === it.on || h.day === old.doneOn)));
      if (done) S.home.habits.push({ day: it.on, kind: it.key });
    }
    render();
    api('POST', `/home/tasks/${it.id}/day`, { day: it.day, on: it.on, done }).then((r) => { if (!r.ok) failed(S, 'save the tick', r); return reload(); });
    return true;
  }
  if (t.dataset?.hmgstep) {
    const [id, step] = t.dataset.hmgstep.split('|');
    ui.hmBusy = true;
    api('POST', `/home/goals/${id}/log`, { step: Number(step), done: !!t.checked }).then((r) => { ui.hmBusy = false; if (!r.ok) failed(S, 'save the step', r); return reload(); });
    return true;
  }
  return false;
}

// Save in a pop-up.
export async function homeSubmit(e, S, render, api, reload) {
  const form = e.target.closest?.('[data-hmform]');
  if (!form) return false;
  e.preventDefault();
  const ui = S.ui;
  const st = homeForm(form, ui);
  if (!st || st.busy) return true;
  const stop = (msg) => { st.err = msg; st.busy = false; render(); return true; };
  let call;
  if (form.dataset.hmform === 'task') {
    const start = fromT(st.start);
    const end = fromT(st.end);
    if (!st.title.trim()) return stop('Give it a name');
    if (start == null || end == null || end <= start) return stop('End time has to be after the start time');
    if (st.rep === 'weekly' && !st.days.length) return stop('Pick at least one day');
    const body = { title: st.title.trim(), cat: st.cat, day: st.day, start, end, rep: st.rep, days: st.days, miss: st.miss, retry: fromT(st.retry), rem: st.rem, text: !!st.text, note: st.note };
    if (st.id && st.was !== 'none' && st.scope === 'once') Object.assign(body, { scope: 'once', occ: st.occ });
    call = st.id ? ['PATCH', `/home/tasks/${st.id}`, body] : ['POST', '/home/tasks', body];
  } else {
    const t = st.type;
    const steps = String(st.steps || '').split('\n').map((x) => x.trim()).filter(Boolean);
    if (!st.name.trim()) return stop('Give the goal a name');
    if (['count', 'money', 'spend', 'percent'].includes(t) && !(Number(st.target) > 0)) return stop('Add a target above 0');
    if (t === 'checklist' && !steps.length) return stop('Add at least one step');
    if (t === 'habit' && !st.days.length) return stop('Pick at least one day');
    call = ['POST', '/home/goals', { name: st.name.trim(), cat: st.cat, sub: st.sub, per: st.per, type: t, target: Number(st.target), due: st.due, steps, time: fromT(st.time), days: st.days, track: st.track }];
  }
  st.busy = true;
  render();
  const r = await api(...call);
  if (!r.ok) return stop(r.error || 'Could not save');
  if (form.dataset.hmform === 'goal') { ui.hmPer = st.per; ui.hmOpen = null; }
  ui.hmEd = null;
  ui.hmGoal = null;
  await reload();
  return true;
}

// Clicks on the Home page. true when the click was handled here. S, api and reload are needed for what saves.
export function homeClick(e, ui, render, S = null, api = null, reload = null) {
  const t = e.target;
  const focus = (sel) => t.ownerDocument?.querySelector(sel)?.focus?.();
  // the pop-ups first: ✕ or a click outside closes; Delete asks once more; anything else inside stays inside
  if (t.closest('[data-hmx]') || t.matches?.('[data-hmhost]')) { ui.hmEd = null; ui.hmGoal = null; render(); return true; }
  if (t.closest('[data-hmdel]') && ui.hmEd?.id && api) {
    const ed = ui.hmEd;
    if (!ed.arm) { homeForm(t.closest('[data-hmform]'), ui); ed.arm = true; render(); focus('[data-hmdel]'); return true; }
    ed.busy = true;
    render();
    const once = ed.was !== 'none' && ed.scope === 'once';
    api('DELETE', `/home/tasks/${ed.id}${once ? `?scope=once&occ=${ed.occ}` : ''}`).then((r) => {
      if (!r.ok) { ed.busy = false; ed.arm = false; ed.err = r.error || 'Could not delete'; render(); return null; }
      ui.hmEd = null;
      return reload();
    });
    return true;
  }
  if (t.closest('[data-hmform]')) return true;

  const view = t.closest('[data-hmview]');
  if (view) { ui.hmView = view.dataset.hmview; render(); return true; }
  const per = t.closest('button[data-hmper]');
  if (per) { ui.hmPer = per.dataset.hmper; ui.hmOpen = null; ui.hmGDel = null; render(); return true; }
  if (t.closest('[data-hmmore]')) { ui.hmMore = !ui.hmMore; render(); return true; }
  const more = t.closest('.hmmh');
  if (more) { const c = more.closest('.hmpc'); c?.scrollBy?.({ top: c.clientHeight - 80, behavior: 'smooth' }); return true; }
  const r = t.closest('[data-hmrow]');
  if (r) { ui.hmOpen = ui.hmOpen === r.dataset.hmrow ? null : r.dataset.hmrow; ui.hmGDel = null; render(); return true; }
  if (!S) return false;

  const P = periodOf(S.d2);
  const now = nowOf(ui.now ?? undefined);
  if (t.closest('[data-hmadd]')) {
    if (S.home && P.ymd) { ui.hmEd = editorOf(null, S.home, P, now); render(); focus('.hmedt'); }
    return true;
  }
  const item = t.closest('[data-hmit]');
  if (item) {
    if (Date.now() - (ui.hmDragged || 0) < 400) return true; // the click that ends a drag
    const it = ui.hmItems?.[item.dataset.hmit];
    const ed = it && editorOf(it, S.home, P, now);
    if (ed) { ui.hmEd = ed; render(); focus('.hmedt'); }
    return true;
  }
  const add = t.closest('[data-hmgadd]');
  if (add) {
    if (S.home && P.ymd) { ui.hmGoal = newGoal(add.dataset.hmgadd, 'week', P); render(); focus('.hmedt'); }
    return true;
  }
  const goalCall = (path, body, what, method = 'POST') => {
    ui.hmBusy = true;
    ui.hmGDel = null;
    render();
    api(method, path, body).then((res) => { ui.hmBusy = false; if (!res.ok) failed(S, what, res); return reload(); });
    return true;
  };
  const log = t.closest('[data-hmglog]');
  if (log) {
    const [id, kind, n] = log.dataset.hmglog.split('|');
    return goalCall(`/home/goals/${id}/log`, kind === 'add' ? { add: Number(n) } : { done: n === '1' }, 'save the log');
  }
  const set = t.closest('[data-hmgset]');
  if (set) {
    const input = set.parentElement?.querySelector('[data-hmgval]');
    if (!input || input.value === '' || !(Number(input.value) >= 0)) { input?.focus?.(); return true; }
    return goalCall(`/home/goals/${set.dataset.hmgset}/log`, { value: Number(input.value) }, 'save the number');
  }
  const del = t.closest('[data-hmgdel]');
  if (del) {
    const id = del.dataset.hmgdel;
    if (ui.hmGDel !== id) { ui.hmGDel = id; render(); return true; }
    ui.hmOpen = null;
    return goalCall(`/home/goals/${id}`, undefined, 'delete the goal', 'DELETE');
  }
  return false;
}

// Calendar blocks: drag one with the mouse to a new time or day (15-minute snap). A touch only taps, so the page still scrolls.
export function homeDrag(main, S, api, reload) {
  let d = null;
  main.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('.hmev[data-hmit]');
    const it = el && S.ui.hmItems?.[el.dataset.hmit];
    if (!it || e.button || e.pointerType !== 'mouse' || S.ui.hmEd || S.ui.hmGoal) return;
    d = { el, it, x0: e.clientX, y0: e.clientY, moved: false, ns: null, nd: it.on };
    el.setPointerCapture?.(e.pointerId);
  });
  main.addEventListener('pointermove', (e) => {
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) <= 4) return;
    d.moved = true;
    S.ui.hmDrag = true; // holds the page's own redraws until the drop
    const dur = d.it.e - d.it.s;
    d.ns = Math.max(START, Math.min(END - dur, Math.round((d.it.s + dy / H) * 4) / 4));
    Object.assign(d.el.style, { top: `${(d.ns - START) * H}px`, transform: `translateX(${dx}px)`, zIndex: 5, opacity: 0.85 });
    const col = [...main.querySelectorAll('.hmcol[data-ymd]')].find((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && e.clientX >= r.left && e.clientX < r.right; });
    d.nd = col ? col.dataset.ymd : d.it.on;
  });
  const drop = () => {
    if (!d) return;
    const { it, moved, ns, nd } = d;
    d = null;
    S.ui.hmDrag = false;
    if (!moved || ns == null) return; // a plain click: homeClick opens the pop-up
    S.ui.hmDragged = Date.now();
    const start = Math.round(ns * 60);
    const end = start + Math.round((it.e - it.s) * 60);
    if (nd === it.on && start === Math.round(it.s * 60)) { reload(); return; }
    const body = it.rep === 'none' ? { day: nd, start, end } : { scope: 'once', occ: it.day, day: nd, start, end };
    api('PATCH', `/home/tasks/${it.id}`, body).then((r) => { if (!r.ok) failed(S, 'move the task', r); return reload(); });
  };
  main.addEventListener('pointerup', drop);
  main.addEventListener('pointercancel', drop);
}
