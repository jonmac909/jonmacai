import { esc, pill } from '../ui.js';

// Factory (Jon, 2026-11-05): one table, a row per open video, oldest first. A plain script on GPU1 (tools/factory_publish.py)
// posts the rows every 30 s; this page only fetches them every 15 s. No bot reads it and no model is involved.
const API = '/dashboard/api/v1/factory';
const POLL_MS = 15000;
const STALE_S = 120; // the script posts every 30 s; older than this and the board says it is stale

let last = null; // { factory, asOf, channels }: tab clicks repaint from this before the next fetch

const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
// A card names its host short ("Nora Fairweather"); the chip has the full name ("Nora Fairweather Cats"). The tile joins the chip with that exact
// name, or the one chip whose name begins with the host's words. Two chips that fit (just "Rosa") join neither.
export function chipOf(host, known) {
  const f = fold(host);
  if (!f) return '';
  const exact = known.find((c) => f === fold(c.label) || f === fold(c.slug));
  if (exact) return exact.slug;
  const w = words(host);
  const part = known.filter((c) => { const cw = words(c.label); return w.every((x, i) => cw[i] === x); });
  return part.length === 1 ? part[0].slug : f;
}
const mine = (t, c) => !c || t.chip === c.slug;
const wait = (min) => (min == null ? '' : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);
const hours = (min) => `${Math.floor((min || 0) / 60)}h`;

const svg = (cls, label, d) => `<span class="${cls}" role="img" aria-label="${label}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg></span>`;

// only a YouTube watch or youtu.be link is ever rendered as a link (the feed is data, not markup)
const YT = /^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}$/;
const ytLink = (url, cls, label) => (YT.test(url || '') ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : '');

// done: green check. run: blue bar with n/total (or an unmeasured bar). new: grey "Not started". fail: red X with the reason. else: grey circle.
function cell(c) {
  if (c?.s === 'done') return svg('fyok', 'Done', 'M5 13l4 4L19 7');
  if (c?.s === 'new') return '<span class="fynew">Not started</span>';
  if (c?.s === 'run') {
    const total = Number(c.total) || 0;
    const done = Math.min(Number(c.done) || 0, total);
    if (!total) return '<div class="fyrun"><div class="pg ind" role="progressbar" aria-label="In progress"><i></i></div><span>' + esc(c.note || 'In progress') + '</span></div>';
    const pct = Math.round((done / total) * 100);
    return `<div class="fyrun"><div class="pg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><span>${done}/${total}</span></div>`;
  }
  if (c?.s === 'fail') return `<div class="fyfail" title="${esc(c.full || c.why || '')}">${svg('fybad', 'Failed', 'M6 18L18 6M6 6l12 12')}<small>${esc(c.why || 'Failed')}</small></div>`;
  return '<span class="fyidle" role="img" aria-label="Later step"></span>';
}

// live: the cell has a real signal from the last ~10 min (a GPU job, a render, a bot at work). Only that cell turns green, with a Live dot and what is running.
function row(t, cols, liveOn, key) {
  const title = String(t.title ?? '');
  const name = t.channel && title.endsWith(` - ${t.channel}`) ? title.slice(0, -(t.channel.length + 3)) : title;
  const cs = Array.isArray(t.cells) ? t.cells : [];
  return `<tr class="fyrow" data-id="${esc(key)}"><td>${ytLink(t.original, 'fyorig', 'Original')}<b>${esc(name)}</b><small>${esc(t.channel)}</small></td>${cols.map((_, i) => { const lv = liveOn && cs[i]?.live; return `<td class="fycell${lv ? ' fylv' : ''}">${cell(cs[i])}${ytLink(cs[i]?.link, 'fylk', 'YouTube')}${lv ? `<span class="fylt"><i class="fydot"></i>Live</span><small class="fylx">${esc(lv)}</small>` : ''}</td>`; }).join('')}<td class="fywait"><b>${esc(t.owner || '')}</b>${t.stuck ? pill(`Stuck ${hours(t.waitMin)}`, 'crit') : `<small>${esc(wait(t.waitMin))}</small>`}</td></tr>`;
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

// Top panel (Jon, 2026-11-05): the GPUs (what runs now, how long, how many wait) and the team (working first, then idle).
const gpuRow = (name, g) => {
  if (g === undefined) return '';
  if (!g) return `<p class="fygpuline"><b>${name}</b> <span class="muted">queue unreadable</span></p>`;
  const run = (g.running || []).map((r) => `${esc(r.type || '')}${r.what ? ` · ${esc(r.what)}` : ''} · ${wait(Math.floor((r.runningS || 0) / 60)) || '0m'}`).join('; ');
  return `<p class="fygpuline"><b>${name}</b> ${run || '<span class="muted">Idle</span>'} · ${Number(g.waiting) || 0} waiting</p>`;
};
function panel(f) {
  let g1 = f.gpus ? f.gpus.gpu1 : undefined;
  if (g1 === undefined && f.gpu) g1 = { running: (f.gpu.running || []).map((r) => ({ type: r.model, what: r.who, runningS: r.runningS })), waiting: f.gpu.waiting }; // an older snapshot has GPU1 only
  const team = Array.isArray(f.team) ? f.team : [];
  const gpus = gpuRow('GPU1', g1) + gpuRow('GPU2', f.gpus ? f.gpus.gpu2 : undefined);
  // The states OpenBot's agent list shows (Jon, 2026-11-09): Working, Queued (yellow) and Idle, each with the minutes since its last activity.
  const who = (m) => {
    const st = m.state || (m.working ? 'working' : 'idle');
    const ago = m.idleMin == null ? '' : esc(wait(m.idleMin) || '0m');
    const text = st === 'working' ? `Working${ago ? ` · ${ago}` : ''}` : st === 'queued' ? `Queued ${Number(m.queued) || 0}${ago ? ` · ${ago}` : ''}` : `Idle${ago ? ` ${ago}` : ''}`;
    return `<p class="fyt ${st === 'working' ? 'on' : st === 'queued' ? 'qd' : ''}"${ago ? ` title="last activity ${ago} ago"` : ''}><i class="fydot"></i><b>${esc(m.name)}</b><span>${text}</span><em title="${esc(m.card || '')}">${esc(m.card || '')}</em></p>`;
  };
  return gpus || team.length ? `<div class="fypan">${gpus ? `<div class="fygpus">${gpus}</div>` : ''}${team.length ? `<div class="fyteam">${team.map(who).join('')}</div>` : ''}</div>` : '';
}

// Refresh without a jump (Jon, 2026-11-05): the page's skeleton is built once and a refresh only touches what changed. A section's HTML is written only
// when it differs; table rows are matched by card id, so an unchanged row, the table and its scroll box are never rebuilt and the view stays where Jon put it.
function put(node, html) {
  if (node.__h === html) return;
  node.__h = html;
  const x = node.firstElementChild?.scrollLeft; // the phone's sideways channel row keeps its place
  node.innerHTML = html;
  if (x && node.firstElementChild) node.firstElementChild.scrollLeft = x;
}

function syncRows(body, rows) {
  const have = new Map([...body.children].map((tr) => [tr.dataset.id, tr]));
  const want = new Set(rows.map((r) => r.id));
  have.forEach((tr, id) => { if (!want.has(id)) tr.remove(); });
  let at = body.firstElementChild;
  rows.forEach(({ id, html }) => {
    const tr = have.get(id);
    if (tr && tr.__h === html) {
      if (tr === at) at = at.nextElementSibling; else body.insertBefore(tr, at);
      return;
    }
    const t = document.createElement('template');
    t.innerHTML = html;
    const n = t.content.firstElementChild;
    n.__h = html;
    if (tr) { if (tr === at) at = tr.nextElementSibling; tr.remove(); }
    body.insertBefore(n, at);
  });
}

function msg(el, html) {
  const m = el.querySelector('.fymsg');
  put(m, html);
  m.hidden = !html;
  el.querySelector('.fyview').hidden = !!html;
}

function paint(el, sub) {
  const q = (s) => el.querySelector(s);
  const f = last?.factory;
  const age = last?.asOf ? Math.max(0, Math.round((Date.now() - Date.parse(last.asOf)) / 1000)) : null;
  const status = age == null ? pill('Not publishing yet', 'crit') : age > STALE_S ? pill(`Stale: last update ${wait(Math.floor(age / 60)) || `${age}s`} ago`, 'crit') : pill(`Live · ${age}s ago`, 'ok');
  put(q('.fystatus'), status);
  if (!f) { msg(el, '<div class="card pad"><p class="muted">The Factory board has no data yet. The publisher on GPU1 has not posted.</p></div>'); return; }
  const cols = Array.isArray(f.cols) ? f.cols : [];
  if (!cols.length) { msg(el, '<div class="card pad"><p class="muted">Waiting for the publisher to send the new table.</p></div>'); return; }
  const known = last.channels || [];
  const open = (f.tiles || []).filter((t) => Array.isArray(t.cells)).map((t) => ({ ...t, chip: chipOf(t.channel, known) })); // calendar-only tiles (already scheduled or live) have no cells
  // hosts that match no channel chip get their own chip in "Other", so the tab counts add up to All channels
  const extra = [...new Map(open.filter((t) => t.chip && !known.some((c) => c.slug === t.chip)).map((t) => [t.chip, t.channel])).entries()]
    .map(([slug, name]) => ({ slug, label: name, group: 'Other' }));
  const channels = [...known, ...extra];
  const on = channels.find((c) => c.slug === sub) || null;
  const rows = open.filter((t) => mine(t, on));
  const liveOn = age != null && age <= STALE_S; // a stale snapshot shows nothing as live
  const owners = Array.isArray(f.owners) ? f.owners : [];
  msg(el, '');
  let pan = ''; try { pan = panel(f); } catch { /* a malformed team or gpus field hides the panel, never the table */ }
  put(q('.fypanel'), pan);
  put(q('.fytabsbox'), tabs(channels, open, on));
  put(q('.fysumbox'), summary(rows, cols, liveOn));
  q('.fytable').style.setProperty('--fyn', String(cols.length)); // fixed column widths: a cell changing never moves a column
  put(q('.fycols'), `<col class="fyc1">${cols.map(() => '<col class="fycs">').join('')}<col class="fycw">`);
  put(q('.fythead'), `<tr><th>Video</th>${cols.map((c, i) => `<th class="fycell">${esc(c)}${owners[i] ? `<small class="fyown">(${esc(owners[i])})</small>` : ''}</th>`).join('')}<th>Waiting</th></tr>`);
  const seen = new Map(); // two cards with one id (or none) still get their own row
  const list = rows.map((t) => { const id = String(t.id ?? ''); const n = seen.get(id) || 0; seen.set(id, n + 1); const key = n ? `${id}#${n}` : id; return { id: key, html: row(t, cols, liveOn, key) }; });
  if (!list.length) list.push({ id: '_empty', html: `<tr class="fyrow" data-id="_empty"><td colspan="${cols.length + 2}" class="muted">No open videos${on ? ' on this channel' : ''}.</td></tr>` });
  syncRows(q('.fytbody'), list);
  put(q('.fynotes'), (f.notes || []).map((n) => `<p class="muted">${esc(n)}</p>`).join(''));
}

export function render(_d, _data, sub) {
  return `<div class="wrap" data-sub="${esc(sub || '')}">
  <div class="head"><div><h1>Factory</h1><p>Every open video, oldest first. Updates on its own.</p></div><div class="fystatus"></div></div>
  <div class="fybody"><div class="fymsg"><div class="card pad"><p class="muted">Loading…</p></div></div>
  <div class="fyview" hidden><div class="fypanel"></div><div class="fytabsbox"></div><div class="fysumbox"></div>
  <div class="tblwrap"><table class="fytable"><colgroup class="fycols"></colgroup><thead class="fythead"></thead><tbody class="fytbody"></tbody></table></div>
  <div class="fynotes"></div></div></div>
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
      else if (!last) msg(el, '<div class="card pad"><p class="muted">Could not load the Factory board. It tries again in 15 seconds.</p></div>');
      if (last) paint(el, sub);
    } catch (e) {
      console.error('factory board', e); // one odd snapshot must not freeze the refresh
    } finally {
      if (el.isConnected) setTimeout(load, POLL_MS);
    }
  };
  load();
}
