// Budget page (cards t_13a6d327341447f0, t_9a6930f719354c07): the dashboard's own copy of MoneyClaw's /budget page, no
// MoneyClaw frame and no MoneyClaw sign-in. Business and Personal rows, each with Yesterday, Last 7 days and This month
// cards (red over budget, green under; This month also says On track or Over pace). The Travel switch counts travel too
// (off by default, remembered in this browser), as on MoneyClaw's page. Tapping a card opens its categories, then the
// transactions behind one category (or all of them).
// Data: GET /dashboard/api/v1/budget (src/budget.js), MoneyClaw's own budget numbers, read server to server.
import { esc } from './util.js';
import { headerOnly } from './goals.js';
import { MC_ORIGIN } from './moneyclaw.js';

const money = (n) => (n == null ? '-' : `${n < 0 ? '-' : ''}$${Math.abs(Math.round(Number(n))).toLocaleString('en-CA')}`);
const money2 = (n) => `$${Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PERIODS = ['yesterday', 'week', 'month'];
const TRAVEL_KEY = 'd3-budget-travel';

export function budgetTravel() {
  try { return localStorage.getItem(TRAVEL_KEY) === '1'; } catch { return false; }
}
function saveTravel(on) {
  try { localStorage.setItem(TRAVEL_KEY, on ? '1' : '0'); } catch { /* private mode: this visit only */ }
}

// The numbers behind a card: travel left out (default) or counted (the API sends both; budgets are the same).
export const shown = (p, travel) => (travel && p?.withTravel ? { ...p, ...p.withTravel } : p);

function short(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
const dates = (p) => (!p.from ? '' : p.from === p.to ? short(p.to) : `${short(p.from)} - ${short(p.to)}`);

function card(g, k, p0, travel) {
  const p = shown(p0, travel);
  const tone = p.spent == null ? '' : p.over ? ' bad' : ' ok';
  let pace = '';
  if (k === 'month' && p.onTrack != null) {
    pace = p.paceBudget != null
      ? `<span class="bgp ${p.onTrack ? 'ok' : 'bad'}">${p.onTrack ? 'On track' : 'Over pace'}<i>${money(p.paceBudget)} budget for ${p.daysGone} of ${p.daysInMonth} days</i></span>`
      : `<span>On track for month: ${p.onTrack ? 'yes' : 'no'}</span>`;
  }
  return `<button type="button" class="bgc${tone}" data-bgopen="${g}/${k}">
<small>${esc(p.label)}</small><em>${esc(dates(p))}</em><b>${money(p.spent)}</b><span>of ${money(p.budget)} budget</span>${pace}</button>`;
}

function basisNote(c) {
  if (c.budget == null) return 'no budget';
  if (c.basis === 'yearly') return `${money(c.budget)} a year${c.due ? `, due ${esc(c.due)}` : ''}`;
  if (c.basis === 'fixed') return `${money(c.budget)} fixed bill`;
  return `${money2(c.budget)} budget`;
}

function txnRows(rows) {
  if (!rows.length) return '<p class="mut">No transactions in this period.</p>';
  return rows.map((t) => `<div class="bgt"><div><b>${esc(t.merchant)}${t.pending ? ' <i>pending</i>' : ''}</b><span>${esc(t.date)} · ${esc(t.category)}${t.currency && t.currency !== 'CAD' ? ` · ${esc(t.currency)} charge` : ''}</span></div><strong>${money2(t.amount)}</strong></div>`).join('');
}

// open: { g, k, view: 'cats' | 'all' | 'line', line }. The panel covers the screen on phones and scrolls on its own.
function drawer(b, open, travel) {
  const grp = b.groups[open.g];
  const p0 = grp?.periods?.[open.k];
  if (!p0) return '';
  const p = shown(p0, travel);
  const base = `${grp.label} · ${p.label}`;
  const total = `${money2(p.spent)} of ${money(p.budget)}${travel ? ' · travel counted' : ''}`;
  const cats = Array.isArray(p.categories) ? p.categories : [];
  const list = Array.isArray(p.transactions) ? p.transactions : null;
  let title = base;
  let sub;
  let body;
  if (!list) {
    sub = dates(p);
    body = '<p class="mut">Transactions not loaded yet.</p>';
  } else if (open.view === 'cats' && cats.length) {
    sub = `${dates(p)} · ${cats.length} categories · ${total}`;
    body = `<button type="button" class="bgall" data-bgall="1"><span>All ${list.length} transaction${list.length === 1 ? '' : 's'}</span><span aria-hidden="true">›</span></button>`
      + cats.map((c) => `<button type="button" class="bgcat ${c.budget == null ? 'none' : c.over ? 'bad' : 'ok'}" data-bgcat="${esc(c.name)}"><span><b>${esc(c.name)}</b><i>${c.count} charge${c.count === 1 ? '' : 's'}</i></span><span><strong>${money2(c.spent)}</strong><i>${basisNote(c)}</i></span></button>`).join('');
  } else {
    const line = open.view === 'line' ? open.line : null;
    const c = line ? cats.find((x) => x.name === line) : null;
    const rows = (line ? list.filter((t) => t.line === line) : list).slice().sort((a, z) => z.amount - a.amount || (a.date < z.date ? 1 : -1));
    title = line ? `${base} · ${line}` : cats.length ? `${base} · all transactions` : base;
    sub = c ? `${dates(p)} · ${rows.length} transaction${rows.length === 1 ? '' : 's'} · ${money2(c.spent)} · ${basisNote(c)}` : `${dates(p)} · ${rows.length} transaction${rows.length === 1 ? '' : 's'} · ${total}`;
    body = txnRows(rows);
  }
  const back = open.view !== 'cats' && cats.length ? '<button type="button" class="btn" data-bgback="1">‹ Categories</button>' : '';
  return `<div class="bgd" data-bgclose="1"><section class="card bgdp" role="dialog" aria-label="${esc(title)}">
<header><div><h2>${esc(title)}</h2><p class="mut">${esc(sub)}</p></div><div class="bgdb">${back}<button type="button" class="btn" data-bgclose="1">Close</button></div></header>
<div class="bgdl">${body}</div></section></div>`;
}

// data: the API body ({ ok, budget }), null while loading, or { error }. ui: { bgOpen, bgTravel }.
export function renderBudget(d2resp, data, ui = {}) {
  const link = `<a class="btn sm sp" href="${MC_ORIGIN}/budget/" target="_blank" rel="noopener">Open in MoneyClaw</a>`;
  const head = headerOnly(d2resp, 'Budget', 'Business and personal: yesterday, last 7 days, this month', link);
  if (!data) return `${head}<section class="card"><p class="mut">Loading</p></section>`;
  if (data.error || !data.budget) return `${head}<section class="card"><p class="mut">${esc(data.error || 'Budget could not be read.')}</p></section>`;
  const b = data.budget;
  const travel = !!ui.bgTravel;
  const hasTravel = ['business', 'personal'].some((g) => b.groups[g]?.periods?.month?.withTravel);
  const sw = hasTravel
    ? `<div class="bgtools"><button type="button" class="bgsw${travel ? ' on' : ''}" role="switch" aria-checked="${travel}" data-bgtravel="1"><span>Travel</span><i aria-hidden="true"><u></u></i></button><span class="mut">${travel ? 'Travel counted' : 'Travel not counted'}</span></div>`
    : '<p class="mut">Travel not counted.</p>';
  const rows = ['business', 'personal'].map((g) => `<section class="bgrow"><h2>${esc(b.groups[g].label)}</h2><div class="bgcards">${PERIODS.map((k) => card(g, k, b.groups[g].periods[k], travel)).join('')}</div></section>`).join('');
  const note = b.transactionsLoaded ? '' : '<p class="mut bgnote">Transactions not loaded yet: totals are MoneyClaw\'s own and include Travel.</p>';
  return `${head}<div class="bg">${sw}${rows}${note}</div>${ui.bgOpen ? drawer(b, ui.bgOpen, travel) : ''}`;
}

// Clicks on the Budget page. Returns true when it changed ui (the caller redraws).
export function budgetClick(e, ui) {
  const t = e.target;
  const hit = (sel) => t.closest?.(sel);
  if (hit('[data-bgtravel]')) { ui.bgTravel = !ui.bgTravel; saveTravel(ui.bgTravel); return true; }
  const open = hit('[data-bgopen]');
  if (open) { const [g, k] = open.dataset.bgopen.split('/'); ui.bgOpen = { g, k, view: 'cats', line: null }; return true; }
  if (!ui.bgOpen) return false;
  if (hit('[data-bgall]')) { ui.bgOpen = { ...ui.bgOpen, view: 'all', line: null }; return true; }
  if (hit('[data-bgback]')) { ui.bgOpen = { ...ui.bgOpen, view: 'cats', line: null }; return true; }
  const cat = hit('[data-bgcat]');
  if (cat) { ui.bgOpen = { ...ui.bgOpen, view: 'line', line: cat.dataset.bgcat }; return true; }
  const close = hit('[data-bgclose]');
  if (close && (close.tagName === 'BUTTON' || t === close)) { ui.bgOpen = null; return true; }
  return false;
}
