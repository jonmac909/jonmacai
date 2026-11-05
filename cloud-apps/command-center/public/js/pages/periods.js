import { esc, pill } from '../ui.js';
import { goalCard } from './today.js';

// Weekly and Monthly (Jon, 2026-11-05). Weekly's rows are one snapshot that tools/factory_publish.py posts every
// 3 minutes (a plain script: no model, no bot); the page only fetches it. The habit checkboxes are Jon's own and
// save the moment he ticks them. Monthly reuses Today's four goal tiles.
const API = '/dashboard/api/v1/periods';
const POLL_MS = 15000;
const STALE_S = 15 * 60; // the script posts every 5 min; older than this and the page says it is stale

let last = null; // the newest GET /v1/periods answer: repaints use it before the next fetch

const when = (ymd, opt) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opt });
const SHORT = { weekday: 'short', month: 'short', day: 'numeric' };
const weekText = (mon) => `${when(mon, SHORT)} to ${when(new Date(Date.parse(`${mon}T12:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10), SHORT)}`;
const ago = (s) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`);

export function row(r) {
  const t = Number(r.target) || 0;
  const d = Number(r.done) || 0;
  const pct = t > 0 ? Math.min(100, Math.round((d / t) * 100)) : 0;
  const bar = `<div class="pg${t === 0 ? ' idle' : d >= t ? ' ok' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`;
  const note = [r.note, /^\d{4}-\d\d-\d\d$/.test(r.due || '') ? `Due ${when(r.due, SHORT)}` : ''].filter(Boolean).join(' · ');
  return `<div class="pdrow"><div class="pgrow"><div class="lab"><span>${esc(r.label)}</span><span>${t > 0 ? `${d} of ${t}` : d > 0 ? `${d} done, none due` : 'none due'}</span></div>${bar}</div>${note ? `<p class="muted pdnote">${esc(note)}</p>` : ''}</div>`;
}

// One card per group (Sponsor videos, Jon Mac channels, ...). A group with no rows says why in its own words.
export function group(g) {
  const rows = Array.isArray(g.rows) ? g.rows : [];
  return `<div class="card pad"><div class="cardhead"><h2>${esc(g.title)}</h2></div><div class="pdrows">${rows.length ? rows.map(row).join('') : `<p class="muted">${esc(g.empty || 'Nothing to count yet.')}</p>`}</div></div>`;
}

// One week of the report: per project, cards planned that week and how many were done by that Sunday.
export function weekBlock(w) {
  const rows = Array.isArray(w.rows) ? w.rows : [];
  const body = rows.length ? rows.map((r) => row({ label: r.label, target: r.planned, done: r.done })).join('') : '<p class="muted">Nothing was planned.</p>';
  return `<div class="card pad"><div class="cardhead"><h2>${esc(weekText(w.weekStart))}${w.current ? ' (this week)' : ''}</h2><span class="meta">${Number(w.done) || 0} of ${Number(w.planned) || 0} done</span></div><div class="pdrows">${body}</div></div>`;
}

// What was planned in an earlier week and is still open, with how many weeks it has slipped (2 or more shows red).
export function carryCard(rep) {
  const list = Array.isArray(rep?.carry) ? rep.carry : [];
  const total = Number(rep?.carryTotal) || list.length;
  const items = list.map((c) => `<div class="pdrow"><div class="pgrow"><div class="lab"><span>${esc(c.title)}</span>${pill(`${c.slipped} ${c.slipped === 1 ? 'week' : 'weeks'} slipped`, c.slipped >= 2 ? 'crit' : 'warn')}</div></div><p class="muted pdnote">${esc([c.label, c.stage, c.owner].filter(Boolean).join(' · '))}</p></div>`).join('');
  return `<div class="card pad"><div class="cardhead"><h2>Carried over into this week</h2><span class="meta">${total}${total > list.length ? `, showing ${list.length}` : ''}</span></div><div class="pdrows">${list.length ? items : '<p class="muted">Nothing carried over: every earlier week is done.</p>'}</div></div>`;
}

// The week-by-week blocks for Monthly. A missing or failed report says so instead of an empty page.
export function reportBlocks(weekly) {
  const rep = weekly?.report;
  if (!rep || !Array.isArray(rep.weeks)) {
    return `<div class="card pad"><p class="muted">${weekly?.reportError ? 'The week-by-week report failed on GPU1. It tries again in a few minutes.' : 'The week-by-week report has not been posted yet.'}</p></div>`;
  }
  return carryCard(rep) + rep.weeks.map(weekBlock).join('');
}

export function habits(scope, list) {
  return `<ul class="pdhabits">${(list || []).map((h) => `<li><label class="pdhabit"><input type="checkbox" data-hscope="${scope}" data-hkey="${esc(h.key)}"${h.done ? ' checked' : ''}><span>${esc(h.label)}</span></label></li>`).join('')}</ul>`;
}

// A tick saves at once; if the save fails the box goes back and the toast says so.
function bindTicks(el, say) {
  el.addEventListener('change', async (e) => {
    const box = e.target.closest?.('[data-hscope]');
    if (!box) return;
    const want = box.checked;
    box.disabled = true;
    const res = await fetch(`${API}/tick`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
      body: JSON.stringify({ scope: box.dataset.hscope, key: box.dataset.hkey, done: want }),
    }).catch(() => null);
    box.disabled = false;
    if (res?.ok) {
      const list = last?.[box.dataset.hscope === 'week' ? 'weekHabits' : 'monthHabits'] || [];
      const h = list.find((x) => x.key === box.dataset.hkey);
      if (h) h.done = want;
      say?.(want ? 'Ticked' : 'Unticked');
    } else {
      box.checked = !want;
      say?.('Could not save that tick');
    }
  });
}

async function fetchPeriods() {
  const res = await fetch(`${API}?v=${Date.now()}`).catch(() => null);
  const j = res?.ok ? await res.json().catch(() => null) : null;
  if (j?.ok) last = j;
  return !!j?.ok;
}

const saving = (el) => !!el.querySelector('[data-hscope]:disabled');

function paintWeekly(el) {
  if (!last || saving(el)) return;
  const w = last.weekly;
  const age = last.asOf ? Math.max(0, Math.round((Date.now() - Date.parse(last.asOf)) / 1000)) : null;
  const old = w && w.weekStart !== last.week;
  el.querySelector('.fystatus').innerHTML = age == null ? pill('Not publishing yet', 'crit')
    : old ? pill('Counts are from last week', 'crit')
      : age > STALE_S ? pill(`Stale: last update ${ago(age)} ago`, 'crit') : pill(`Live · ${ago(age)} ago`, 'ok');
  el.querySelector('.pdweek').textContent = weekText(last.week);
  el.querySelector('.pdgroups').innerHTML = w && !old ? (w.groups || []).map(group).join('')
    : '<div class="card pad"><p class="muted">No counts for this week yet. The script on GPU1 has not posted them.</p></div>';
  el.querySelector('.pdcarry').innerHTML = w?.report ? carryCard(w.report) : '';
  el.querySelector('.pdhab').innerHTML = habits('week', last.weekHabits);
}

export function weekly() {
  return `<div class="wrap">
  <div class="head"><div><h1>Weekly</h1><p class="pdweek"></p></div><div class="fystatus"></div></div>
  <div class="pdgroups"><div class="card pad"><p class="muted">Loading…</p></div></div>
  <div class="pdcarry"></div>
  <div class="card pad"><div class="cardhead"><h2>Your habits this week</h2><span class="meta">You tick these yourself</span></div><div class="pdhab"></div></div>
</div>`;
}

export function mountWeekly(el, { say } = {}) {
  if (!el) return;
  bindTicks(el, say);
  if (last) paintWeekly(el);
  const load = async () => {
    const ok = await fetchPeriods();
    if (!el.isConnected) return; // moved to another page: stop polling
    setTimeout(load, POLL_MS); // schedule first so a paint error never stops polling
    if (ok) paintWeekly(el);
    else if (!last) el.querySelector('.pdgroups').innerHTML = '<div class="card pad"><p class="muted">Could not load the weekly counts. It tries again in 15 seconds.</p></div>';
  };
  load();
}

export function monthly(_d, data) {
  const goals = data?.pages?.today?.goals;
  const month = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', month: 'long', year: 'numeric' }).format(new Date());
  return `<div class="wrap">
  <div class="head"><div><h1>Monthly</h1><p>${esc(month)} · each goal against $10,000, with where it should be today</p></div></div>
  ${goals ? `<div class="goals four">${goals.map(goalCard).join('')}</div>` : '<div class="card pad"><p class="muted">The goal tiles have no data yet.</p></div>'}
  <div class="head"><div><h2>Week by week</h2><p>Cards planned each week against what got done, and what carried over</p></div></div>
  <div class="pdreport"><div class="card pad"><p class="muted">Loading…</p></div></div>
  <div class="card pad"><div class="cardhead"><h2>Your habits this month</h2><span class="meta">You tick these yourself</span></div><div class="pdhab"><p class="muted">Loading…</p></div></div>
</div>`;
}

export function mountMonthly(el, { say } = {}) {
  if (!el) return;
  bindTicks(el, say);
  const paint = () => {
    if (saving(el)) return;
    el.querySelector('.pdreport').innerHTML = reportBlocks(last?.weekly);
    el.querySelector('.pdhab').innerHTML = habits('month', last?.monthHabits);
  };
  if (last) paint();
  fetchPeriods().then((ok) => {
    if (!el.isConnected) return;
    if (ok) paint();
    else if (!last) {
      el.querySelector('.pdreport').innerHTML = '<div class="card pad"><p class="muted">Could not load the weekly report. Open the page again.</p></div>';
      el.querySelector('.pdhab').innerHTML = '<p class="muted">Could not load your habits. Open the page again.</p>';
    }
  });
}
