import { esc, pill } from '../ui.js';

// Factory (Jon, 2026-11-05): the live production board. A plain script on GPU1 (tools/factory_publish.py) posts one
// snapshot every 30 s; this page only fetches it every 15 s. No bot reads it and no model is involved.
const API = '/dashboard/api/v1/factory';
const POLL_MS = 15000;
const STALE_S = 120; // the script posts every 30 s; older than this and the board says it is stale

let last = null; // { factory, asOf, channels }: tab clicks repaint from this before the next fetch

const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const mine = (t, c) => !c || fold(t.channel) === fold(c.label) || fold(t.channel) === fold(c.slug);
const wait = (min) => (min == null ? '' : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);

function tile(t) {
  const p = t.progress;
  const pct = p && p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
  const bar = pct == null ? '' : `<div class="pgrow"><div class="lab"><span>${esc(p.label)}</span><span>${p.done} of ${p.total}</span></div><div class="pg${pct >= 100 ? ' ok' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div></div>`;
  const link = /^https?:\/\//i.test(t.link || '') ? `<a class="fyopen" href="${esc(t.link)}" target="_blank" rel="noopener">Open</a>` : '';
  return `<li class="fytile${t.stuck ? ' stuck' : ''}"><b class="fytitle">${esc(t.title)}</b>
    <span class="fymeta">${esc(t.channel)}${t.owner ? ` · ${esc(t.owner)}` : ''}${t.waitMin != null ? ` · ${esc(wait(t.waitMin))} here` : ''}${t.note ? ` · ${esc(t.note)}` : ''}</span>${bar}
    ${t.gpu ? `<span class="fygpu">${pill('GPU', 'violet')} ${esc(t.gpu)}</span>` : ''}${link}</li>`;
}

function tabs(channels, tiles, on) {
  const n = (c) => tiles.filter((t) => mine(t, c)).length;
  const chip = (slug, label, count) => `<button type="button" class="chip${slug === (on?.slug || '') ? ' on' : ''}" data-page="factory${slug ? `/${esc(slug)}` : ''}"${slug === (on?.slug || '') ? ' aria-current="page"' : ''}>${esc(label)}<span class="ccn">${count}</span></button>`;
  const groups = [...new Set(channels.map((c) => c.group))];
  return `<nav class="cctabs" aria-label="Channels"><div class="ccgrp">${chip('', 'All channels', tiles.length)}</div>${groups.map((g) => `<div class="ccgrp"><b>${esc(g)}</b>${channels.filter((c) => c.group === g).map((c) => chip(c.slug, c.label, n(c))).join('')}</div>`).join('')}</nav>`;
}

function gpuLine(g) {
  if (!g) return '';
  const run = (g.running || []).map((r) => `${esc(r.who || '')} ${esc(r.model || '')} ${esc(r.note || '')} (${wait(Math.floor((r.runningS || 0) / 60)) || '0m'})`).join('; ');
  return `<p class="fygpuline">${pill('GPU1', 'violet')} ${g.running?.length ? `Running: ${run}` : 'Idle'} · ${g.waiting || 0} waiting${g.owner ? ` · card held by ${esc(g.owner)}` : ''}</p>`;
}

function paint(el, sub) {
  const box = el.querySelector('.fybody');
  const f = last?.factory;
  const age = last?.asOf ? Math.max(0, Math.round((Date.now() - Date.parse(last.asOf)) / 1000)) : null;
  const status = age == null ? pill('Not publishing yet', 'crit') : age > STALE_S ? pill(`Stale: last update ${wait(Math.floor(age / 60)) || `${age}s`} ago`, 'crit') : pill(`Live · ${age}s ago`, 'ok');
  el.querySelector('.fystatus').innerHTML = status;
  if (!f) { box.innerHTML = '<div class="card pad"><p class="muted">The Factory board has no data yet. The publisher on GPU1 has not posted.</p></div>'; return; }
  const channels = last.channels || [];
  const on = channels.find((c) => c.slug === sub) || null;
  const tiles = (f.tiles || []).filter((t) => mine(t, on));
  const cols = (f.columns || []).map((name, i) => {
    const here = tiles.filter((t) => t.column === i);
    return `<section class="fycol"><h3>${esc(name)} <span class="ccn">${here.length}</span></h3><ul class="fylist">${here.map(tile).join('') || '<li class="muted fyempty">Nothing here</li>'}</ul></section>`;
  }).join('');
  box.innerHTML = `${tabs(channels, f.tiles || [], on)}${gpuLine(f.gpu)}<div class="fyboard">${cols}</div>
    ${(f.notes || []).map((n) => `<p class="muted">${esc(n)}</p>`).join('')}`;
}

export function render(_d, _data, sub) {
  return `<div class="wrap" data-sub="${esc(sub || '')}">
  <div class="head"><div><h1>Factory</h1><p>Every video from source breakdown to live. Updates on its own.</p></div><div class="fystatus"></div></div>
  <div class="fybody"><div class="card pad"><p class="muted">Loading…</p></div></div>
</div>`;
}

export function mount(el) {
  if (!el) return;
  const sub = el.dataset.sub || '';
  if (last) paint(el, sub);
  const load = async () => {
    const res = await fetch(`${API}?v=${Date.now()}`).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    if (!el.isConnected) return; // moved to another page: stop polling
    if (j?.ok) last = { factory: j.factory, asOf: j.asOf, channels: j.channels };
    else if (!last) el.querySelector('.fybody').innerHTML = '<div class="card pad"><p class="muted">Could not load the Factory board. It tries again in 15 seconds.</p></div>';
    if (last) paint(el, sub);
    setTimeout(load, POLL_MS);
  };
  load();
}
