// Dashboard 3 Factory page (docs/dashboard-3.md): live progress of the new video program, laid out as the old Factory
// page (/dashboard/#factory, public/js/pages/factory.js): one table, a row per video, a column per step (and, when the
// board sends a step's own sub-steps as `parts`, a column per part under the step's heading, each with its own
// progress bar). When a video carries `stages` (the steps folded into a few columns, each with its own `label`), the
// page draws the stages and not the steps: a column per stage, no part columns, and a last column "Total time" when
// the board sends each video's `started`. When the board lists `channels`, the videos sit under a heading per channel. renderFactory is
// a pure function over the /dashboard/api/d3 answer (d3.factory = the newest video_line feed entry, built in src/d3.js).
// Everything from the feed is data: every string is escaped, none is ever HTML.
import { esc } from './util.js';

const STALE_S = 180; // the pusher posts every few seconds; src/d3.js marks the entry stale after 3 minutes
const EVENTS = 12;
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const list = (v) => (Array.isArray(v) ? v : []);
const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
// The old page's time format: "45m", "2h 5m".
const wait = (min) => (!num(min) || min < 0 ? '' : min >= 60 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m` : `${Math.round(min)}m`);
// How long a finished part took: "54s", "10m 14s", "1h 2m".
export function took(sec) {
  if (!num(sec) || sec < 0) return '';
  const t = Math.round(sec);
  return t < 60 ? `${t}s` : t < 3600 ? `${Math.floor(t / 60)}m ${t % 60}s` : `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`;
}
// A running part's clock, counted from when it started: "0:07", "2:07", "1:02:07". '' when either time is missing.
export function clock(startIso, nowMs) {
  const from = typeof startIso === 'string' ? Date.parse(startIso) : NaN;
  if (!Number.isFinite(from) || !num(nowMs)) return '';
  const t = Math.max(0, Math.floor((nowMs - from) / 1000));
  const two = (n) => String(n).padStart(2, '0');
  return t >= 3600 ? `${Math.floor(t / 3600)}:${two(Math.floor((t % 3600) / 60))}:${two(t % 60)}` : `${Math.floor(t / 60)}:${two(t % 60)}`;
}
const short = (s, n = 46) => { const t = String(s || '').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
// A tool's own name ("preflight_render:") means nothing to Jon: drop snake_case names that lead a clause.
const plain = (s) => String(s || '').replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+:\s*/g, '').replace(/\s+/g, ' ').trim();
// A failed note's part name ("Render check: ...") and the rest, both in plain words.
function failText(raw) {
  const t = plain(raw);
  const m = /^([A-Z][A-Za-z ]{1,28}):\s+(.+)$/.exec(t);
  return m ? { part: m[1], note: m[2] } : { part: '', note: t };
}
const pill = (text, cls = '', title = '') => `<span class="fypill${cls ? ` ${cls}` : ''}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
const svg = (cls, label, d, px = 20) => `<span class="${cls}" role="img" aria-label="${label}"><svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg></span>`;

// A time in Kelowna (America/Vancouver): "Nov 11, 3:36 PM". '' when it is not a time.
export function kelowna(iso) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
}

// A video's group, in page order: needs you, failed, running, waiting, done.
const RANK = { need: 0, fail: 1, run: 2, wait: 3, done: 4 };
// Jon asked for changes on its review page: a stage reads "changes" until the new version is up (video line, 2026-11-12).
const inChanges = (job) => [...list(job?.stages), ...list(job?.steps)].some((st) => String(st?.status || '').toLowerCase() === 'changes');
function kindOf(job) {
  const s = String(job?.state || '').toLowerCase();
  if (job?.needs_person || s === 'needs a person') return 'need';
  if (s === 'failed') return 'fail';
  if (s.startsWith('running')) return 'run'; // "running? (process gone)" stays with the running videos
  if (inChanges(job)) return 'run'; // changes in progress, not Done
  return s === 'done' ? 'done' : 'wait';
}
function stepKind(st) {
  const s = String(st?.status || '').toLowerCase();
  return s === 'running' ? 'run' : s === 'done' ? 'done' : s === 'failed' ? 'fail' : s === 'skip' ? 'skip' : s === 'waiting' ? 'hold' : s === 'changes' ? 'chg' : 'todo';
}
// A review page address the page may link to: only jonmac.ai's own review pages. '' for anything else.
const reviewHref = (u) => (typeof u === 'string' && /^https:\/\/jonmac\.ai\/review\/[a-z0-9][a-z0-9-]{0,79}$/.test(u) ? u : '');
// A link a stage carries (a thumbnail, a page): a jonmac.ai review page or a proof picture (/dashboard/f/). '' for anything else.
const lookHref = (u) => (typeof u === 'string' && /^https:\/\/jonmac\.ai\/(review\/[a-z0-9][a-z0-9-]{0,79}(\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,79})?|dashboard\/f\/[0-9a-f]{32}\.(png|jpg))$/.test(u) ? u : '');
// Where a made video is now (the board's `phase`, 2026-11-12): on its review page it waits for Jon, it is not Done.
// making, changes and stuck keep the pills they had (changes: the amber Changes in its stage).
const PHASES = { review: ['Waiting for review', 'rev'], approved: ['Approved', 'ok'], scheduled: ['Scheduled', 'ok'] };
const phaseOf = (job) => (Object.hasOwn(PHASES, String(job?.phase ?? '')) ? PHASES[job.phase] : null);
// The Done pill (or the phase's): a link to the video's review page when the board sends one, else the pill with the file
// as its tooltip.
const donePill = (job) => {
  const [text, cls] = phaseOf(job) || ['Done', 'ok'];
  return reviewHref(job.review_url)
    ? `<a class="fypill ${cls} fylink" href="${esc(reviewHref(job.review_url))}" target="_blank" rel="noopener" title="Open the review page">${esc(text)}</a>`
    : pill(text, cls, job.final);
};
// The whole time a video took, in minutes: from `started` to `ended`, or to now while it is still being made (a live
// board only). null when the board does not send the times (an older board).
export function totalMinutes(job, nowMs, live) {
  const from = typeof job?.started === 'string' ? Date.parse(job.started) : NaN;
  const to = typeof job?.ended === 'string' ? Date.parse(job.ended) : NaN;
  if (Number.isFinite(from) && Number.isFinite(to)) return Math.max(0, Math.floor((to - from) / 60000));
  if (Number.isFinite(from) && !job.ended && live && num(nowMs)) return Math.max(0, Math.floor((nowMs - from) / 60000));
  return num(job?.total_minutes) ? job.total_minutes : null;
}
// The last column: the state pill and under it the whole time the video took; on an older board, the minutes in its state.
function lastCell(job, kind, nowMs, live, attrs = '') {
  const state = kind === 'need' ? pill('Needs you', 'crit') : kind === 'done' || (kind !== 'fail' && phaseOf(job)) ? donePill(job) : '';
  const total = totalMinutes(job, nowMs, live);
  const min = total != null ? wait(total) : /^\d+(\.\d+)?$/.test(String(job.minutes_in_state ?? '')) ? wait(Number(job.minutes_in_state)) : '';
  const tip = total != null ? ` title="${job.ended ? 'From the start of the video until its render was finished and checked' : 'Since the video was started; still counting'}"` : '';
  return `<td class="fywait"${attrs}>${state}<small${tip}>${esc(min)}</small></td>`;
}

// Videos in page order; inside a group the oldest first (by `created`, else the feed's order).
export function factoryJobs(F) {
  const at = (j) => (Number.isFinite(Date.parse(j.created)) ? Date.parse(j.created) : Infinity);
  return list(F?.jobs).filter((j) => j && typeof j === 'object')
    .map((j, i) => ({ j, i }))
    .sort((a, b) => RANK[kindOf(a.j)] - RANK[kindOf(b.j)] || at(a.j) - at(b.j) || a.i - b.i).map((x) => x.j);
}

// The table's step columns: every step name the videos carry, in pipeline order. A step first seen on a later video
// goes right after the step before it on that video, so [pack, render] then [pack, plan, render] reads pack, plan, render.
export function factoryCols(jobs) {
  const cols = [];
  for (const j of jobs) {
    let at = -1;
    for (const s of list(j.steps)) {
      if (!s?.name) continue;
      const i = cols.indexOf(s.name);
      if (i >= 0) at = i; else cols.splice(++at, 0, s.name);
    }
  }
  return cols;
}

const partsOf = (st) => list(st?.parts).filter((p) => p && typeof p === 'object' && p.name);
// A name as a heading: "pack" -> "Pack", "some_name" -> "Some name" (underscores read as spaces so a long name can wrap).
const head = (s) => cap(String(s || '').replace(/_+/g, ' ').trim());

// The part columns under each step column, in the order the work happens: for every name in `cols`, the part names the
// videos carry for that step (merged like the step columns). An empty list is a step no video sends parts for: it keeps
// its one cell.
export function factoryParts(jobs, cols) {
  return cols.map((c) => {
    const names = [];
    for (const j of jobs) {
      let at = -1;
      for (const p of partsOf(list(j.steps).find((s) => s?.name === c))) {
        const i = names.indexOf(p.name);
        if (i >= 0) at = i; else names.splice(++at, 0, p.name);
      }
    }
    return names;
  });
}

// One part's cell: a progress bar, then one short line. Never a made-up percentage.
//   todo: an empty grey track.            done: a full green track, a check and the time it took (`seconds`).
//   running with a total: a blue fill at done/total, "61 / 198" and the clock since `started`.
//   running without one: a moving striped track (working, not a percentage) and the clock; no `started`, no clock.
//   failed: a red track, an X and the reason.   waiting: an amber track, a clock icon and the reason.
// The note is always the tooltip. A stale board is not live: the stripe stands still and no clock counts.
function partCell(p, first, live, now) {
  const g = first ? ' fyg1' : '';
  if (!p) return `<td class="fyp${g}"></td>`;
  const note = String(p.note || '').trim();
  const tip = note ? ` title="${esc(note)}"` : '';
  const text = note ? `<small>${esc(short(note, 44))}</small>` : '';
  const s = String(p.status || '').toLowerCase();
  const bar = (cls, label) => `<div class="fypb ${cls}" role="img" aria-label="${label}"><i></i></div>`;
  if (s === 'done') return `<td class="fyp${g}"${tip}>${bar('ok', 'Done')}<span class="fypl">${svg('fyok', 'Done', 'M5 13l4 4L19 7', 12)}${took(p.seconds) ? `<span>${took(p.seconds)}</span>` : ''}</span></td>`;
  if (s === 'failed') return `<td class="fyp fypbad${g}"${tip}>${bar('bad', 'Failed')}<span class="fypl">${svg('fybad', 'Failed', 'M6 18L18 6M6 6l12 12', 12)}</span>${text}</td>`;
  if (s === 'waiting') return `<td class="fyp fypwait${g}"${tip}>${bar('wait', 'Waiting')}<span class="fypl">${svg('fywt', 'Waiting', 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z', 12)}</span>${text}</td>`;
  if (s === 'running') {
    const total = num(p.total) && p.total > 0 ? p.total : 0;
    const done = Math.min(num(p.done) && p.done > 0 ? p.done : 0, total);
    const since = live ? clock(p.started, now) : '';
    const time = since ? `<span class="fyt" data-since="${esc(p.started)}">${since}</span>` : '';
    const track = total
      ? `<div class="fypb run" role="progressbar" aria-label="Running" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i style="width:${Math.round((done / total) * 1000) / 10}%"></i></div><span class="fypl"><b>${done} / ${total}</b></span>`
      : `<div class="fypb run ${live ? 'ind' : 'off'}" role="progressbar" aria-label="Running"><i></i></div>`;
    return `<td class="fyp fyprun${g}"${tip}>${track}${time}</td>`;
  }
  return `<td class="fyp${g}"${tip}><div class="fypb" role="img" aria-label="Not started"></div></td>`;
}

// A step's own short summary above its part cells: a thin bar of parts done out of parts, the count ("8/12") and the
// step's minutes; a failed step says "Failed, try N", a step that waits says "Waiting" and why. Spans the step's part
// columns. Plain: no fill behind it, nothing sticky.
function stepSum(job, st, firstTodo, span, mine) {
  const k = stepKind(st);
  const n = mine.length;
  const d = mine.filter((p) => String(p.status || '').toLowerCase() === 'done').length;
  const min = wait(st.minutes) ? `<span>${esc(wait(st.minutes))}</span>` : '';
  const base = `<div class="fysb${k === 'done' ? ' ok' : k === 'fail' ? ' bad' : ''}" role="img" aria-label="${d} of ${n} done"><i style="width:${Math.round((d / n) * 1000) / 10}%"></i></div><b>${d}/${n}</b>${min}`;
  let tip = k === 'run' ? st.doing || st.note : '';
  let more = '';
  if (k === 'fail') {
    tip = [st.note, st.fix ? `Fix: ${st.fix}` : ''].filter(Boolean).join(' · ');
    more = `<em class="fysf">${num(st.tries) && st.tries > 1 ? `Failed, try ${st.tries}` : 'Failed'}</em>`;
  } else if (k === 'todo') {
    const why = st === firstTodo ? st.note || (kindOf(job) === 'wait' ? job.note : '') : '';
    if (why) { tip = why; more = `<em class="fysw">Waiting</em><small>${esc(why)}</small>`; }
  }
  return `<td class="fyst fyg1" colspan="${span}"${tip ? ` title="${esc(tip)}"` : ''}><div class="fyss">${base}${more}</div></td>`;
}

// One step's cell, in the old page's language. done: green check, minutes under it. run: blue bar with done/total (or
// an unmeasured bar), the Live dot and what it is doing. fail: red X with the short reason. A step that waits for a
// reason: "Waiting" and one short line. Any later step: grey circle.
function cell(job, st, live, firstTodo) {
  if (!st) return '<td class="fycell"></td>';
  const k = stepKind(st);
  if (k === 'skip') return '<td class="fycell" title="Not a part of this video"><span class="fyskip" role="img" aria-label="Not a part of this video">–</span></td>';
  if (k === 'chg') { // amber Changes, Jon's first comment under it, what is running now as its tooltip
    const asked = String(st.note || '').replace(/^Jon asked for changes:?\s*/i, '').trim();
    const tip = [st.note, st.doing ? `Now: ${st.doing}` : ''].filter(Boolean).join(' · ');
    return `<td class="fycell"${tip ? ` title="${esc(tip)}"` : ''}><span class="fypill chg">Changes</span>${asked ? `<small class="fywhy">${esc(short(asked))}</small>` : ''}</td>`;
  }
  if (k === 'hold') {
    const why = st.doing || st.note;
    return `<td class="fycell"${why ? ` title="${esc(why)}"` : ''}><span class="fynew">Waiting</span>${why ? `<small class="fywhy">${esc(short(why))}</small>` : ''}</td>`;
  }
  if (k === 'todo' && num(st.total) && st.total > 0 && num(st.done) && st.done > 0) { // begun, nothing of it running now
    const done = Math.min(st.done, st.total);
    const pct = Math.round((done / st.total) * 100);
    return `<td class="fycell"><div class="fyrun"><div class="fypg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><span>${done}/${st.total}</span></div></td>`;
  }
  if (k === 'done') {
    // A stage that made something to look at: its text under the check (the video's title), its link as "Open" (the thumbnail).
    const text = String(st.text || '').trim();
    // With a link, the check itself opens it (Jon, 2026-11-12: click the Thumbnail check to review it).
    const href = lookHref(st.url);
    const what = st.label || st.name || 'it';
    const check = href ? `<a class="fyopen" href="${esc(href)}" target="_blank" rel="noopener" title="Open ${esc(what)}">${svg('fyok', `Done, open ${what}`, 'M5 13l4 4L19 7')}</a>` : svg('fyok', 'Done', 'M5 13l4 4L19 7');
    const look = href ? `<a class="fylook2" href="${esc(href)}" target="_blank" rel="noopener">Open</a>` : '';
    return `<td class="fycell${text ? ' fytx' : ''}"${text ? ` title="${esc(text)}"` : ''}>${check}${wait(st.minutes) ? `<small>${esc(wait(st.minutes))}</small>` : ''}${text ? `<small class="fytitle">${esc(text)}</small>` : ''}${look}</td>`;
  }
  if (k === 'run') {
    const total = num(st.total) && st.total > 0 ? st.total : 0;
    const done = Math.min(num(st.done) ? st.done : 0, total);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const bar = total
      ? `<div class="fyrun"><div class="fypg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><span>${done}/${total}</span></div>`
      : '<div class="fyrun"><div class="fypg ind" role="progressbar" aria-label="In progress"><i></i></div><span>In progress</span></div>';
    const doing = st.doing || st.note;
    return `<td class="fycell${live ? ' fylv' : ''}"${doing ? ` title="${esc(doing)}"` : ''}>${bar}${live ? '<span class="fylt"><i class="fydot"></i>Live</span>' : ''}${doing ? `<small class="fylx">${esc(short(doing, 70))}</small>` : ''}</td>`;
  }
  if (k === 'fail') { // a short plain label in the cell; the whole note and the fix open from "Why?" (Jon, 2026-11-12)
    const { part, note } = failText(st.note);
    const fix = plain(st.fix);
    const full = [note, fix && fix !== note ? `Fix: ${fix}` : ''].filter(Boolean).join(' · ');
    const tries = num(st.tries) && st.tries > 1 ? `try ${st.tries}` : '';
    const sub = [part, tries].filter(Boolean).join(' · ');
    const why = full ? `<details class="fywhyd"><summary>Why?</summary><div class="fypop">${note ? `<p>${esc(note)}</p>` : ''}${fix && fix !== note ? `<p><b>Fix:</b> ${esc(fix)}</p>` : ''}</div></details>` : '';
    return `<td class="fycell"><div class="fyfail" title="${esc(full)}">${svg('fybad', 'Failed', 'M6 18L18 6M6 6l12 12')}<b class="fyfl">Failed</b>${sub ? `<small>${esc(sub)}</small>` : ''}${why}</div></td>`;
  }
  const why = st === firstTodo ? st.note || (kindOf(job) === 'wait' ? job.note : '') : '';
  if (why) return `<td class="fycell" title="${esc(why)}"><span class="fynew">Waiting</span><small class="fywhy">${esc(short(why))}</small></td>`;
  return '<td class="fycell"><span class="fyidle" role="img" aria-label="Later step"></span></td>';
}

// A video on a board with parts: two table rows that read as one. The first holds the video, each step's summary and
// the state; the second holds the part cells. A step that sends no parts (an older board) keeps its one cell, spanning
// both rows and all of that step's part columns (plain there: no green Live cell in this table).
function wideRows(job, cols, groups, live, key, now, grouped) {
  const kind = kindOf(job);
  const steps = list(job.steps).filter((s) => s && typeof s === 'object');
  const firstTodo = steps.find((s) => stepKind(s) === 'todo');
  let top = '';
  let low = '';
  cols.forEach((c, i) => {
    const st = steps.find((s) => s.name === c);
    const span = Math.max(1, groups[i].length);
    const mine = partsOf(st);
    if (st && mine.length && groups[i].length) {
      top += stepSum(job, st, firstTodo, span, mine);
      low += groups[i].map((name, n) => partCell(mine.find((p) => p.name === name), n === 0, live, now)).join('');
    } else {
      top += cell(job, st, false, firstTodo).replace('<td class="fycell', `<td colspan="${span}" rowspan="2" class="fycell fyg1`);
    }
  });
  return `<tr class="fyrow fytop" data-id="${esc(key)}" data-kind="${kind}"><td class="fyvid" rowspan="2"><b>${esc(job.id)}</b>${grouped ? '' : `<small>${esc(job.channel)}</small>`}</td>${top}${lastCell(job, kind, now, live, ' rowspan="2"')}</tr>
<tr class="fyrow fylow" data-id="${esc(key)}~parts" data-kind="${kind}">${low}</tr>`;
}

function rowHtml(job, cols, live, key, grouped, now) {
  const kind = kindOf(job);
  const steps = list(job.steps).filter((s) => s && typeof s === 'object');
  const firstTodo = steps.find((s) => stepKind(s) === 'todo');
  return `<tr class="fyrow" data-id="${esc(key)}" data-kind="${kind}"><td><b>${esc(job.id)}</b>${grouped ? '' : `<small>${esc(job.channel)}</small>`}</td>${cols.map((c) => cell(job, steps.find((s) => s.name === c), live, firstTodo)).join('')}${lastCell(job, kind, now, live)}</tr>`;
}

// One line: how many are live now, how many videos sit at each step (the first step not done), how many are done, how many need you.
function summary(jobs, cols, live, staged) {
  if (staged) { // stages: several are called QC, so no count per column; how many are being made, done, need you
    const liveN = live ? jobs.filter((j) => list(j.steps).some((s) => stepKind(s) === 'run')).length : 0;
    const done = jobs.filter((j) => kindOf(j) === 'done').length;
    const need = jobs.filter((j) => kindOf(j) === 'need').length;
    const making = jobs.length - done - need;
    return `<p class="fysum"><span class="fylc${liveN ? ' on' : ''}"><i class="fydot"></i><b>${liveN}</b> live now</span><span${making ? '' : ' class="z"'}><b>${making}</b> In progress</span><span${done ? '' : ' class="z"'}><b>${done}</b> Done</span>${pill(need === 1 ? '1 needs you' : `${need} need you`, need ? 'crit' : 'ok')}</p>`;
  }
  const n = cols.map(() => 0);
  let done = 0;
  for (const j of jobs) {
    const steps = list(j.steps);
    const at = steps.find((s) => stepKind(s) !== 'done');
    if (kindOf(j) === 'done' || (steps.length && !at)) done++;
    else if (at && cols.includes(at.name)) n[cols.indexOf(at.name)]++;
  }
  const liveN = live ? jobs.filter((j) => list(j.steps).some((s) => stepKind(s) === 'run')).length : 0;
  const need = jobs.filter((j) => kindOf(j) === 'need').length;
  return `<p class="fysum"><span class="fylc${liveN ? ' on' : ''}"><i class="fydot"></i><b>${liveN}</b> live now</span>${cols.map((c, i) => `<span${n[i] ? '' : ' class="z"'}><b>${n[i]}</b> ${esc(cap(c))}</span>`).join('')}<span${done ? '' : ' class="z"'}><b>${done}</b> Done</span>${pill(need === 1 ? '1 needs you' : `${need} need you`, need ? 'crit' : 'ok')}</p>`;
}

// "2026-11-11T23:36:42Z  nora-5   pack   started   pid 2732" -> its Kelowna time and the rest, columns joined by dots.
function eventHtml(e) {
  const m = /^(\S+)\s+(.*)$/.exec(String(e ?? '').trim());
  const at = m ? kelowna(m[1]) : '';
  const rest = (at ? m[2] : String(e ?? '')).trim().split(/\s{2,}/).filter(Boolean).join(' · ');
  return `<p class="fyev"><span>${esc(at)}</span>${esc(rest)}</p>`;
}

// The board's channels, in its order, each with its videos (already in page order); then, last, the videos whose
// channel the board does not list, under a heading of their own channel id. [] when the board sends no channels.
export function factoryChannels(F, jobs) {
  const chans = list(F?.channels).filter((c) => c && typeof c === 'object' && c.id != null && String(c.id) !== '');
  if (!chans.length) return [];
  const of = (j) => String(j.channel ?? '');
  const out = chans.map((c) => ({ id: String(c.id), label: String(c.label || c.id), note: String(c.note || '').trim(), jobs: jobs.filter((j) => of(j) === String(c.id)) }));
  const known = new Set(out.map((c) => c.id));
  for (const j of jobs) {
    if (known.has(of(j))) continue;
    let g = out.find((c) => c.extra && c.id === of(j));
    if (!g) out.push(g = { id: of(j), label: of(j) || 'No channel', note: '', jobs: [], extra: true });
    g.jobs.push(j);
  }
  return out;
}

// A channel's heading row, and the one quiet row of a channel with no video. The text sits in the Video column's cell
// (the one column that stays put when the stages scroll) and runs on over an empty cell, so it stays in view.
function channelRows(c, span, body) {
  const n = c.jobs.length;
  const key = esc(`~ch:${c.extra ? '~' : ''}${c.id}`);
  const two = (cls, inner, tip = '') => `<td class="fyvid ${cls}"${tip}>${inner}</td><td colspan="${span - 1}"></td>`;
  const headRow = `<tr class="fych" data-id="${key}">${two('fychn', `<span>${esc(c.label)}</span>${n ? `<small>${n === 1 ? '1 video' : `${n} videos`}</small>` : ''}`)}</tr>`;
  const none = c.note || 'No video in the program yet';
  return n ? `${headRow}\n${body}` : `${headRow}\n<tr class="fyrow fynone" data-id="${key}~none">${two('fychq', `<span>${esc(none)}</span>`, ` title="${esc(none)}"`)}</tr>`;
}

const TIGHT = 8; // more stage columns than this: the narrow layout (.fyt)
const HEAD = (status) => `<header class="hd fyhead"><div><h1>Factory</h1><p class="mut">Every video in the new video program, stage by stage. Updates on its own.</p></div><div class="fystatus sp" data-fy="status">${status}</div></header>`;

export function renderFactory(d3resp, ui = {}) {
  const F0 = d3resp?.d3?.factory;
  // A board that sends `stages` (the steps folded into a few columns: Outlier, Script, QC, ...) is drawn by its stages:
  // one column a stage, no column a part. A video without stages on such a board shows its steps, without their parts.
  const staged = list(F0?.jobs).some((j) => list(j?.stages).length);
  const F = staged ? { ...F0, jobs: list(F0.jobs).map((j) => (j && typeof j === 'object' ? { ...j, steps: (list(j.stages).length ? j.stages : list(j.steps)).filter((s) => s && typeof s === 'object').map(({ parts, ...st }) => st) } : j)) } : F0;
  if (!F || typeof F !== 'object') {
    return `<div class="fy">${HEAD(pill('Not publishing yet', 'crit'))}
<section class="card"><p class="mut">No feed: the video program has not posted its board yet.</p></section></div>`;
  }
  const nowMs = num(ui.now) ? ui.now : Date.parse(d3resp?.asOf);
  const age = Number.isFinite(nowMs) && Number.isFinite(Date.parse(F.at)) ? Math.max(0, Math.round((nowMs - Date.parse(F.at)) / 1000)) : null;
  const stale = !!F.stale || age == null || age > STALE_S;
  const status = `${stale ? pill(`Stale: last update ${age == null ? 'unknown' : `${wait(Math.floor(age / 60)) || `${age}s`} ago`}`, 'crit') : pill(`Live · ${age}s ago`, 'ok')}${F.scheduler_running === false ? pill('Scheduler stopped', 'crit') : ''}`;
  const live = !stale; // a stale board shows nothing as live
  const jobs = factoryJobs(F);
  const cols = factoryCols(jobs);
  const labels = new Map(); // a stage's heading: its label ("QC" for script_qc), else its name
  for (const j of jobs) for (const st of list(j.steps)) if (st?.name && typeof st.label === 'string' && st.label && !labels.has(st.name)) labels.set(st.name, st.label);
  const timed = jobs.some((j) => typeof j.started === 'string' && j.started); // the board sends each video's whole time
  const lastHead = timed ? 'Total time' : 'Waiting';
  const seen = new Map(); // two videos with one id still get their own row
  const groups = factoryParts(jobs, cols);
  const wide = groups.some((g) => g.length); // the board sends parts: a column per part, grouped under its step
  const partN = groups.reduce((n, g) => n + g.length, 0);
  const soloN = groups.filter((g) => !g.length).length;
  const chans = factoryChannels(F, jobs);
  const grouped = chans.length > 0;
  const span = wide ? partN + soloN + 2 : cols.length + 2;
  const html = new Map(jobs.map((j) => { const id = String(j.id ?? ''); const n = seen.get(id) || 0; seen.set(id, n + 1); const key = n ? `${id}#${n}` : id; return [j, wide ? wideRows(j, cols, groups, live, key, nowMs, grouped) : rowHtml(j, cols, live, key, grouped, nowMs)]; }));
  const rows = grouped ? chans.map((c) => channelRows(c, span, c.jobs.map((j) => html.get(j)).join('\n'))) : jobs.map((j) => html.get(j));
  if (!rows.length) rows.push(`<tr class="fyrow" data-id="_empty"><td colspan="${cols.length + 2}" class="mut">No videos in the program right now.</td></tr>`);
  // Many stages (a staged board has about 15): narrow stage columns, so most of the table fits a desktop window. A column
  // that shows text (the video's title) stays wide.
  const tight = cols.length > TIGHT;
  const texty = new Set(cols.filter((c) => jobs.some((j) => list(j.steps).some((st) => st?.name === c && stepKind(st) === 'done' && String(st.text || '').trim()))));
  const table = wide
    ? `<table class="fytable fyw" style="--fyn: ${soloN}; --fyp: ${partN}">
<colgroup><col class="fyc1">${groups.map((g) => (g.length ? g.map(() => '<col class="fycp">').join('') : '<col class="fycs">')).join('')}<col class="fycw"></colgroup>
<thead data-fy="cols"><tr><th class="fyh1" rowspan="2">Video</th>${cols.map((c, i) => (groups[i].length ? `<th class="fygrp fyg1" colspan="${groups[i].length}">${esc(head(c))}</th>` : `<th class="fycell fyg1" rowspan="2">${esc(head(c))}</th>`)).join('')}<th class="fyhw" rowspan="2">${lastHead}</th></tr>
<tr>${groups.map((g) => g.map((name, n) => `<th class="fypt${n ? '' : ' fyg1'}">${esc(head(name))}</th>`).join('')).join('')}</tr></thead>`
    : `<table class="fytable${tight ? ' fyt' : ''}" style="--fyn: ${cols.length}${tight ? `; --fyt: ${texty.size}` : ''}">
<colgroup><col class="fyc1">${cols.map((c) => (tight && texty.has(c) ? '<col class="fyct">' : '<col class="fycs">')).join('')}<col class="fycw"></colgroup>
<thead data-fy="cols"><tr><th>Video</th>${cols.map((c) => `<th class="fycell">${esc(labels.get(c) || cap(c))}</th>`).join('')}<th>${lastHead}</th></tr></thead>`;
  const needs = jobs.filter((j) => kindOf(j) === 'need').map((j) => {
    const np = j.needs_person && typeof j.needs_person === 'object' ? j.needs_person : {};
    return `<p class="fyneed"><b>${esc(j.id)}</b><span>${esc(cap(np.step || j.step))}</span><span>${esc(np.why || j.note || 'The video program is waiting for a person.')}</span><span class="fylook">${np.look_at ? `Look at ${esc(np.look_at)}` : ''}</span></p>`;
  });
  const events = list(F.events).filter((e) => typeof e === 'string').slice(-EVENTS).reverse();
  const unread = list(F.unreadable_jobs);
  return `<div class="fy">${HEAD(status)}
<div data-fy="sum">${summary(jobs, cols, live, staged)}</div>
<section class="card fybox"><div class="fytblwrap">${table}
<tbody class="fytbody">
${rows.join('\n')}
</tbody></table></div></section>
<div data-fy="notes">${unread.length ? `<p class="mut">${unread.length === 1 ? '1 video' : `${unread.length} videos`} could not be read: ${esc(unread.join(', '))}</p>` : ''}</div>
<div data-fy="needs">${needs.length ? `<section class="card fylist"><h2>Needs you</h2>${needs.join('')}</section>` : ''}</div>
<div data-fy="events"><section class="card fylist"><h2>Latest events <small class="mut">newest first, Kelowna time</small></h2>${events.length ? events.map(eventHtml).join('') : '<p class="mut">No events yet.</p>'}</section></div>
</div>`;
}

// Make the node on screen equal to the freshly drawn one, touching only what differs: a changed text, a changed
// attribute (a bar's width), or a subtree whose shape changed. Unchanged nodes stay, so running bars keep moving.
function morph(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return; }
  if (a.nodeType !== 1) { if (a.data !== b.data) a.data = b.data; return; }
  if (a.isEqualNode(b)) return;
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name) && !(name === 'open' && a.nodeName === 'DETAILS')) a.removeAttribute(name); // an open Why? stays open
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  const [now, next] = [[...a.childNodes], [...b.childNodes]];
  if (now.length !== next.length) { a.replaceChildren(...next); return; }
  now.forEach((n, i) => morph(n, next[i]));
}

// Refresh without a jump (the old page's idea): when the Factory table is already on screen, only what changed is
// rewritten. Rows are matched by id (a video on a board with parts is two rows, "id" and "id~parts"; a channel's
// heading is "~ch:id") and inside a row only the cells, texts and bar widths that differ are touched, so the table's
// scroll box, the unchanged rows and the moving bars stay as they are. Called on every read (3 s) and every second for
// the clocks. Returns false when the page has to be drawn whole (first draw, or the table's columns changed).
export function syncFactory(main, html) {
  const body = main.querySelector?.('.fy .fytbody');
  if (!body) return false;
  const t = document.createElement('template');
  t.innerHTML = html;
  const nextBody = t.content.querySelector('.fytbody');
  const part = (root, k) => root.querySelector(`[data-fy="${k}"]`);
  if (!nextBody || part(t.content, 'cols').innerHTML !== part(main, 'cols')?.innerHTML) return false;
  for (const k of ['status', 'sum', 'notes', 'needs', 'events']) {
    const [now, next] = [part(main, k), part(t.content, k)];
    if (!now || !next) return false;
    morph(now, next);
  }
  const have = new Map([...body.children].map((tr) => [tr.dataset.id, tr]));
  const want = [...nextBody.children];
  const ids = new Set(want.map((tr) => tr.dataset.id));
  have.forEach((tr, id) => { if (!ids.has(id)) tr.remove(); });
  let at = body.firstElementChild;
  for (const n of want) {
    const tr = have.get(n.dataset.id);
    if (tr) morph(tr, n);
    if (tr && tr === at) at = at.nextElementSibling; else body.insertBefore(tr || n, at);
  }
  return true;
}
