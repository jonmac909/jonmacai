import { esc, pill } from '../ui.js';

// Factory (Jon, 2026-11-05): one table, a row per open video, oldest first. A plain script on GPU1 (tools/factory_publish.py)
// posts the rows every 30 s; this page only fetches them every 15 s. No bot reads it and no model is involved.
const API = '/dashboard/api/v1/factory';
const POLL_MS = 15000;
const STALE_S = 120; // the script posts every 30 s; older than this and the board says it is stale

let last = null; // { factory, asOf, channels }: tab clicks repaint from this before the next fetch

const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const mine = (t, c) => !c || fold(t.channel) === fold(c.label) || fold(t.channel) === fold(c.slug);
const wait = (min) => (min == null ? '' : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);
const hours = (min) => `${Math.floor((min || 0) / 60)}h`;

const svg = (cls, label, d) => `<span class="${cls}" role="img" aria-label="${label}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg></span>`;

// done: green check. run: blue bar with n/total (or an unmeasured bar). new: grey "Not started". fail: red X with the reason. else: grey circle.
function cell(c) {
  if (c?.s === 'done') return svg('fyok', 'Done', 'M5 13l4 4L19 7');
  if (c?.s === 'new') return '<span class="fynew">Not started</span>';
  if (c?.s === 'run') {
    const total = Number(c.total) || 0;
    const done = Math.min(Number(c.done) || 0, total);
    if (!total) return '<div class="fyrun"><div class="pg ind" role="progressbar" aria-label="In progress"><i></i></div><span>In progress</span></div>';
    const pct = Math.round((done / total) * 100);
    return `<div class="fyrun"><div class="pg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><span>${done}/${total}</span></div>`;
  }
  if (c?.s === 'fail') return `<div class="fyfail" title="${esc(c.full || c.why || '')}">${svg('fybad', 'Failed', 'M6 18L18 6M6 6l12 12')}<small>${esc(c.why || 'Failed')}</small></div>`;
  return '<span class="fyidle" role="img" aria-label="Later step"></span>';
}

// live: the cell has a real signal from the last ~10 min (a GPU job, a render, a bot at work). Only that cell turns green, with a Live dot and what is running.
function row(t, cols, liveOn) {
  const title = String(t.title ?? '');
  const name = t.channel && title.endsWith(` - ${t.channel}`) ? title.slice(0, -(t.channel.length + 3)) : title;
  const cs = Array.isArray(t.cells) ? t.cells : [];
  return `<tr class="fyrow"><td><b>${esc(name)}</b><small>${esc(t.channel)}</small></td>${cols.map((_, i) => { const lv = liveOn && cs[i]?.live; return `<td class="fycell${lv ? ' fylv' : ''}">${cell(cs[i])}${lv ? `<span class="fylt"><i class="fydot"></i>Live</span><small class="fylx">${esc(lv)}</small>` : ''}</td>`; }).join('')}<td class="fywait"><b>${esc(t.owner || '')}</b>${t.stuck ? pill(`Stuck ${hours(t.waitMin)}`, 'crit') : `<small>${esc(wait(t.waitMin))}</small>`}</td></tr>`;
}

function tabs(channels, tiles, on) {
  const n = (c) => tiles.filter((t) => mine(t, c)).length;
  const chip = (slug, label, count) => `<button type="button" class="chip${slug === (on?.slug || '') ? ' on' : ''}" data-page="factory${slug ? `/${esc(slug)}` : ''}"${slug === (on?.slug || '') ? ' aria-current="page"' : ''}>${esc(label)}<span class="ccn">${count}</span></button>`;
  const groups = [...new Set(channels.map((c) => c.group))];
  return `<nav class="cctabs" aria-label="Channels"><div class="ccgrp">${chip('', 'All channels', tiles.length)}</div>${groups.map((g) => `<div class="ccgrp"><b>${esc(g)}</b>${channels.filter((c) => c.group === g).map((c) => chip(c.slug, c.label, n(c))).join('')}</div>`).join('')}</nav>`;
}

// one line: videos per step (the first step that is not done), then how many are stuck
function summary(rows, cols, liveOn) {
  const names = [...cols, 'Review']; // all steps done = waiting on Jon
  const n = names.map(() => 0);
  rows.forEach((t) => { const i = t.cells.findIndex((c) => c?.s !== 'done'); n[i < 0 ? cols.length : i]++; });
  const stuck = rows.filter((t) => t.stuck).length;
  const liveN = liveOn ? rows.filter((t) => t.cells.some((c) => c?.live)).length : 0;
  return `<p class="fysum"><span class="fylc${liveN ? ' on' : ''}"><i class="fydot"></i><b>${liveN}</b> live now</span>${names.map((c, i) => `<span${n[i] ? '' : ' class="z"'}><b>${n[i]}</b> ${esc(c)}</span>`).join('')}${pill(`${stuck} stuck`, stuck ? 'crit' : 'ok')}</p>`;
}

function gpuLine(g) {
  if (!g) return '';
  const run = (g.running || []).map((r) => `${esc(r.who || '')} ${esc(r.model || '')} ${esc(r.note || '')} (${wait(Math.floor((r.runningS || 0) / 60)) || '0m'})`).join('; ');
  return `<p class="fygpuline">${pill('GPU1', 'violet')} ${g.running?.length ? `Running: ${run}` : 'Idle'} · ${Number(g.waiting) || 0} waiting${g.owner ? ` · card held by ${esc(g.owner)}` : ''}</p>`;
}

function paint(el, sub) {
  const box = el.querySelector('.fybody');
  const f = last?.factory;
  const age = last?.asOf ? Math.max(0, Math.round((Date.now() - Date.parse(last.asOf)) / 1000)) : null;
  const status = age == null ? pill('Not publishing yet', 'crit') : age > STALE_S ? pill(`Stale: last update ${wait(Math.floor(age / 60)) || `${age}s`} ago`, 'crit') : pill(`Live · ${age}s ago`, 'ok');
  el.querySelector('.fystatus').innerHTML = status;
  if (!f) { box.innerHTML = '<div class="card pad"><p class="muted">The Factory board has no data yet. The publisher on GPU1 has not posted.</p></div>'; return; }
  const cols = Array.isArray(f.cols) ? f.cols : [];
  if (!cols.length) { box.innerHTML = '<div class="card pad"><p class="muted">Waiting for the publisher to send the new table.</p></div>'; return; }
  const open = (f.tiles || []).filter((t) => Array.isArray(t.cells)); // calendar-only tiles (already scheduled or live) have no cells
  const known = last.channels || [];
  // hosts that match no channel chip get their own chip in "Other", so the tab counts add up to All channels
  const extra = [...new Map(open.filter((t) => t.channel && !known.some((c) => mine(t, c))).map((t) => [fold(t.channel), t.channel])).values()]
    .map((name) => ({ slug: fold(name), label: name, group: 'Other' }));
  const channels = [...known, ...extra];
  const on = channels.find((c) => c.slug === sub) || null;
  const rows = open.filter((t) => mine(t, on));
  const liveOn = age != null && age <= STALE_S; // a stale snapshot shows nothing as live
  const owners = Array.isArray(f.owners) ? f.owners : [];
  box.innerHTML = `${tabs(channels, open, on)}${summary(rows, cols, liveOn)}${gpuLine(f.gpu)}
    <div class="tblwrap"><table class="fytable"><thead><tr><th>Video</th>${cols.map((c, i) => `<th class="fycell">${esc(c)}${owners[i] ? `<small class="fyown">(${esc(owners[i])})</small>` : ''}</th>`).join('')}<th>Waiting</th></tr></thead>
    <tbody>${rows.map((t) => row(t, cols, liveOn)).join('') || `<tr><td colspan="${cols.length + 2}" class="muted">No open videos${on ? ' on this channel' : ''}.</td></tr>`}</tbody></table></div>
    ${(f.notes || []).map((n) => `<p class="muted">${esc(n)}</p>`).join('')}`;
}

export function render(_d, _data, sub) {
  return `<div class="wrap" data-sub="${esc(sub || '')}">
  <div class="head"><div><h1>Factory</h1><p>Every open video, oldest first. Updates on its own.</p></div><div class="fystatus"></div></div>
  <div class="fybody"><div class="card pad"><p class="muted">Loading…</p></div></div>
</div>`;
}

export function mount(el) {
  if (!el) return;
  const sub = el.dataset.sub || '';
  if (last) paint(el, sub);
  const load = async () => {
    if (!el.isConnected) return; // moved to another page: stop polling
    try {
      if (document.hidden && last) { paint(el, sub); return; } // hidden tab with data: no fetch, the stale pill still ages (first load always fetches)
      const res = await fetch(`${API}?v=${Date.now()}`).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (!el.isConnected) return;
      if (j?.ok) last = { factory: j.factory, asOf: j.asOf, channels: j.channels };
      else if (!last) el.querySelector('.fybody').innerHTML = '<div class="card pad"><p class="muted">Could not load the Factory board. It tries again in 15 seconds.</p></div>';
      if (last) paint(el, sub);
    } catch (e) {
      console.error('factory board', e); // one odd snapshot must not freeze the refresh
    } finally {
      if (el.isConnected) setTimeout(load, POLL_MS);
    }
  };
  load();
}
