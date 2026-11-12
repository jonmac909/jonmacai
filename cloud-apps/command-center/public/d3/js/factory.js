// Dashboard 3 Factory page (docs/dashboard-3.md): live progress of the new video program, laid out as the old Factory
// page (/dashboard/#factory, public/js/pages/factory.js): one table, a row per video, a column per step (and, when the
// board sends a step's own sub-steps as `parts`, a column per part under the step's heading). renderFactory is
// a pure function over the /dashboard/api/d3 answer (d3.factory = the newest video_line feed entry, built in src/d3.js).
// Everything from the feed is data: every string is escaped, none is ever HTML.
import { esc } from './util.js';

const STALE_S = 180; // the pusher posts every 30 s; src/d3.js marks the entry stale after 3 minutes
const EVENTS = 12;
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const list = (v) => (Array.isArray(v) ? v : []);
const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
// The old page's time format: "45m", "2h 5m".
const wait = (min) => (!num(min) || min < 0 ? '' : min >= 60 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m` : `${Math.round(min)}m`);
const short = (s, n = 46) => { const t = String(s || '').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
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
function kindOf(job) {
  const s = String(job?.state || '').toLowerCase();
  if (job?.needs_person || s === 'needs a person') return 'need';
  if (s === 'failed') return 'fail';
  if (s.startsWith('running')) return 'run'; // "running? (process gone)" stays with the running videos
  return s === 'done' ? 'done' : 'wait';
}
function stepKind(st) {
  const s = String(st?.status || '').toLowerCase();
  return s === 'running' ? 'run' : s === 'done' ? 'done' : s === 'failed' ? 'fail' : 'todo';
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

// One part's cell: narrow, icon first. done: green check. failed: red X and the reason. running: the blue bar and what
// is happening. waiting: an amber clock and the reason. todo: grey circle. The note is always the tooltip.
function partCell(p, first, live) {
  const g = first ? ' fyg1' : '';
  if (!p) return `<td class="fyp${g}"></td>`;
  const note = String(p.note || '').trim();
  const tip = note ? ` title="${esc(note)}"` : '';
  const text = note ? `<small>${esc(short(note, 44))}</small>` : '';
  const s = String(p.status || '').toLowerCase();
  if (s === 'done') return `<td class="fyp${g}"${tip}>${svg('fyok', 'Done', 'M5 13l4 4L19 7', 16)}</td>`;
  if (s === 'failed') return `<td class="fyp fypbad${g}"${tip}>${svg('fybad', 'Failed', 'M6 18L18 6M6 6l12 12', 16)}${text}</td>`;
  if (s === 'running') return `<td class="fyp fyprun${g}"${tip}><div class="fypg${live ? ' ind' : ' off'}" role="progressbar" aria-label="Running"><i></i></div>${text}</td>`;
  if (s === 'waiting') return `<td class="fyp fypwait${g}"${tip}>${svg('fywt', 'Waiting', 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z', 16)}${text}</td>`;
  return `<td class="fyp${g}"${tip}><span class="fyidle" role="img" aria-label="Not started"></span></td>`;
}

// A step's own line above its part cells: how long it took, or its running bar (done/total), the Live dot and what it
// is doing, or that it failed, or why it waits. Spans the step's part columns.
function stageLine(job, st, live, firstTodo, span) {
  const k = stepKind(st);
  const td = (cls, tip, inner) => `<td class="fystg fyg1${cls}" colspan="${span}"${tip ? ` title="${esc(tip)}"` : ''}><div class="fysl">${inner}</div></td>`;
  if (k === 'done') return td('', '', `${svg('fyok', 'Done', 'M5 13l4 4L19 7', 14)}<b>${esc(wait(st.minutes))}</b>`);
  if (k === 'run') {
    const total = num(st.total) && st.total > 0 ? st.total : 0;
    const done = Math.min(num(st.done) ? st.done : 0, total);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const bar = total
      ? `<div class="fypg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><b>${done}/${total}</b>`
      : `<div class="fypg${live ? ' ind' : ' off'}" role="progressbar" aria-label="In progress"><i></i></div><b>In progress</b>`;
    const doing = st.doing || st.note;
    return td(live ? ' fylv' : '', doing, `${bar}${wait(st.minutes) ? `<span>${esc(wait(st.minutes))}</span>` : ''}${live ? '<span class="fylt"><i class="fydot"></i>Live</span>' : ''}${doing ? `<small class="fylx">${esc(doing)}</small>` : ''}`);
  }
  if (k === 'fail') {
    const full = [st.note, st.fix ? `Fix: ${st.fix}` : ''].filter(Boolean).join(' · ');
    return td(' fysbad', full, `${svg('fybad', 'Failed', 'M6 18L18 6M6 6l12 12', 14)}<b>${num(st.tries) && st.tries > 1 ? `Failed, try ${st.tries}` : 'Failed'}</b>${wait(st.minutes) ? `<span>${esc(wait(st.minutes))}</span>` : ''}${st.note ? `<small>${esc(st.note)}</small>` : ''}`);
  }
  const why = st === firstTodo ? st.note || (kindOf(job) === 'wait' ? job.note : '') : '';
  return td('', why, why ? `<span class="fynew">Waiting</span><small class="fywhy">${esc(why)}</small>` : '');
}

// One step's cell, in the old page's language. done: green check, minutes under it. run: blue bar with done/total (or
// an unmeasured bar), the Live dot and what it is doing. fail: red X with the short reason. A step that waits for a
// reason: "Waiting" and one short line. Any later step: grey circle.
function cell(job, st, live, firstTodo) {
  if (!st) return '<td class="fycell"></td>';
  const k = stepKind(st);
  if (k === 'done') return `<td class="fycell">${svg('fyok', 'Done', 'M5 13l4 4L19 7')}${wait(st.minutes) ? `<small>${esc(wait(st.minutes))}</small>` : ''}</td>`;
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
  if (k === 'fail') {
    const full = [st.note, st.fix ? `Fix: ${st.fix}` : ''].filter(Boolean).join(' · ');
    const why = st.note ? short(st.note) : num(st.tries) && st.tries > 1 ? `Failed, try ${st.tries}` : 'Failed';
    return `<td class="fycell"><div class="fyfail" title="${esc(full)}">${svg('fybad', 'Failed', 'M6 18L18 6M6 6l12 12')}<small>${esc(why)}</small></div></td>`;
  }
  const why = st === firstTodo ? st.note || (kindOf(job) === 'wait' ? job.note : '') : '';
  if (why) return `<td class="fycell" title="${esc(why)}"><span class="fynew">Waiting</span><small class="fywhy">${esc(short(why))}</small></td>`;
  return '<td class="fycell"><span class="fyidle" role="img" aria-label="Later step"></span></td>';
}

// A video on a board with parts: two table rows that read as one. The first holds the video, each step's own line and
// the state; the second holds the part cells. A step that sends no parts (an older board) keeps its one cell, spanning
// both rows and all of that step's part columns.
function wideRows(job, cols, groups, live, key) {
  const kind = kindOf(job);
  const steps = list(job.steps).filter((s) => s && typeof s === 'object');
  const firstTodo = steps.find((s) => stepKind(s) === 'todo');
  const min = /^\d+(\.\d+)?$/.test(String(job.minutes_in_state ?? '')) ? wait(Number(job.minutes_in_state)) : '';
  const state = kind === 'need' ? pill('Needs you', 'crit') : kind === 'done' ? pill('Done', 'ok', job.final) : '';
  let top = '';
  let low = '';
  cols.forEach((c, i) => {
    const st = steps.find((s) => s.name === c);
    const span = Math.max(1, groups[i].length);
    const mine = partsOf(st);
    if (st && mine.length && groups[i].length) {
      top += stageLine(job, st, live, firstTodo, span);
      low += groups[i].map((name, n) => partCell(mine.find((p) => p.name === name), n === 0, live)).join('');
    } else {
      top += cell(job, st, live, firstTodo).replace('<td class="fycell', `<td colspan="${span}" rowspan="2" class="fycell fyg1`);
    }
  });
  return `<tr class="fyrow fytop" data-id="${esc(key)}" data-kind="${kind}"><td class="fyvid" rowspan="2"><b>${esc(job.id)}</b><small>${esc(job.channel)}</small></td>${top}<td class="fywait" rowspan="2">${state}<small>${esc(min)}</small></td></tr>
<tr class="fyrow fylow" data-id="${esc(key)}~parts" data-kind="${kind}">${low}</tr>`;
}

function rowHtml(job, cols, live, key) {
  const kind = kindOf(job);
  const steps = list(job.steps).filter((s) => s && typeof s === 'object');
  const firstTodo = steps.find((s) => stepKind(s) === 'todo');
  const min = /^\d+(\.\d+)?$/.test(String(job.minutes_in_state ?? '')) ? wait(Number(job.minutes_in_state)) : '';
  const state = kind === 'need' ? pill('Needs you', 'crit') : kind === 'done' ? pill('Done', 'ok', job.final) : '';
  return `<tr class="fyrow" data-id="${esc(key)}" data-kind="${kind}"><td><b>${esc(job.id)}</b><small>${esc(job.channel)}</small></td>${cols.map((c) => cell(job, steps.find((s) => s.name === c), live, firstTodo)).join('')}<td class="fywait">${state}<small>${esc(min)}</small></td></tr>`;
}

// One line: how many are live now, how many videos sit at each step (the first step not done), how many are done, how many need you.
function summary(jobs, cols, live) {
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

const HEAD = (status) => `<header class="hd fyhead"><div><h1>Factory</h1><p class="mut">Every video in the new video program, step by step. Updates on its own.</p></div><div class="fystatus sp" data-fy="status">${status}</div></header>`;

export function renderFactory(d3resp, ui = {}) {
  const F = d3resp?.d3?.factory;
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
  const seen = new Map(); // two videos with one id still get their own row
  const groups = factoryParts(jobs, cols);
  const wide = groups.some((g) => g.length); // the board sends parts: a column per part, grouped under its step
  const partN = groups.reduce((n, g) => n + g.length, 0);
  const soloN = groups.filter((g) => !g.length).length;
  const rows = jobs.map((j) => { const id = String(j.id ?? ''); const n = seen.get(id) || 0; seen.set(id, n + 1); const key = n ? `${id}#${n}` : id; return wide ? wideRows(j, cols, groups, live, key) : rowHtml(j, cols, live, key); });
  if (!rows.length) rows.push(`<tr class="fyrow" data-id="_empty"><td colspan="${cols.length + 2}" class="mut">No videos in the program right now.</td></tr>`);
  const table = wide
    ? `<table class="fytable fyw" style="--fyn: ${soloN}; --fyp: ${partN}">
<colgroup><col class="fyc1">${groups.map((g) => (g.length ? g.map(() => '<col class="fycp">').join('') : '<col class="fycs">')).join('')}<col class="fycw"></colgroup>
<thead data-fy="cols"><tr><th class="fyh1" rowspan="2">Video</th>${cols.map((c, i) => (groups[i].length ? `<th class="fygrp fyg1" colspan="${groups[i].length}"><span>${esc(head(c))}</span></th>` : `<th class="fycell fyg1" rowspan="2">${esc(head(c))}</th>`)).join('')}<th class="fyhw" rowspan="2">Waiting</th></tr>
<tr>${groups.map((g) => g.map((name, n) => `<th class="fypt${n ? '' : ' fyg1'}">${esc(head(name))}</th>`).join('')).join('')}</tr></thead>`
    : `<table class="fytable" style="--fyn: ${cols.length}">
<colgroup><col class="fyc1">${cols.map(() => '<col class="fycs">').join('')}<col class="fycw"></colgroup>
<thead data-fy="cols"><tr><th>Video</th>${cols.map((c) => `<th class="fycell">${esc(cap(c))}</th>`).join('')}<th>Waiting</th></tr></thead>`;
  const needs = jobs.filter((j) => kindOf(j) === 'need').map((j) => {
    const np = j.needs_person && typeof j.needs_person === 'object' ? j.needs_person : {};
    return `<p class="fyneed"><b>${esc(j.id)}</b><span>${esc(cap(np.step || j.step))}</span><span>${esc(np.why || j.note || 'The video program is waiting for a person.')}</span><span class="fylook">${np.look_at ? `Look at ${esc(np.look_at)}` : ''}</span></p>`;
  });
  const events = list(F.events).filter((e) => typeof e === 'string').slice(-EVENTS).reverse();
  const unread = list(F.unreadable_jobs);
  return `<div class="fy">${HEAD(status)}
<div data-fy="sum">${summary(jobs, cols, live)}</div>
<section class="card fybox"><div class="fytblwrap">${table}
<tbody class="fytbody">
${rows.join('\n')}
</tbody></table></div></section>
<div data-fy="notes">${unread.length ? `<p class="mut">${unread.length === 1 ? '1 video' : `${unread.length} videos`} could not be read: ${esc(unread.join(', '))}</p>` : ''}</div>
<div data-fy="needs">${needs.length ? `<section class="card fylist"><h2>Needs you</h2>${needs.join('')}</section>` : ''}</div>
<div data-fy="events"><section class="card fylist"><h2>Latest events <small class="mut">newest first, Kelowna time</small></h2>${events.length ? events.map(eventHtml).join('') : '<p class="mut">No events yet.</p>'}</section></div>
</div>`;
}

// Refresh without a jump (the old page's idea): when the Factory table is already on screen, only the parts whose HTML
// changed are rewritten and the rows are matched by video id, so the table's scroll box and unchanged rows stay as they
// are (a video on a board with parts is two rows, matched as "id" and "id~parts"). Returns false when the page has to be drawn whole (first draw, or the table's columns changed).
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
    if (now.innerHTML !== next.innerHTML) now.innerHTML = next.innerHTML;
  }
  const have = new Map([...body.children].map((tr) => [tr.dataset.id, tr]));
  const want = [...nextBody.children];
  const ids = new Set(want.map((tr) => tr.dataset.id));
  have.forEach((tr, id) => { if (!ids.has(id)) tr.remove(); });
  let at = body.firstElementChild;
  for (const n of want) {
    const tr = have.get(n.dataset.id);
    if (tr && tr.outerHTML === n.outerHTML) {
      if (tr === at) at = at.nextElementSibling; else body.insertBefore(tr, at);
      continue;
    }
    if (tr) { if (tr === at) at = tr.nextElementSibling; tr.remove(); }
    body.insertBefore(n, at);
  }
  return true;
}
