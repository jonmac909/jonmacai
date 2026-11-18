import { esc, pill } from '../ui.js';

// EOS page (Jon, 2026-11-18; card t_75395eabd6774bdc): Scorecard, Rocks, Issues, Meetings and Your queue.
// Everything comes from GET /v1/eos (cards, approvals, questions and the eos_scorecard / eos_meeting feeds);
// nothing is typed into the page. #eos/<tab> picks the tab.

const API = '/dashboard/api/v1/eos';
const TABS = [['scorecard', 'Scorecard'], ['rocks', 'Rocks'], ['issues', 'Issues'], ['meetings', 'Meetings'], ['queue', 'Your queue']];
const NODATA = '<span class="muted">no data yet</span>';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS = { todo: 'To do', doing: 'Doing', qc: 'In QC', review: 'In review', done: 'Done', blocked: 'Blocked', waiting_on_jon: 'Waiting on you', cancelled: 'Cancelled' };
const STATUS_CLS = { done: 'ok', review: 'ok', blocked: 'crit', waiting_on_jon: 'risk' };
const KIND = { approval: 'Approval', question: 'Question', card: 'Card' };

let last = null; // newest GET /v1/eos answer: a tab switch paints it at once, then refetches

// "Nov 16" from YYYY-MM-DD, no time zone shift.
const md = (ymd) => (/^\d{4}-\d{2}-\d{2}/.test(ymd || '') ? `${MON[+ymd.slice(5, 7) - 1]} ${+ymd.slice(8, 10)}` : esc(ymd));
const day = (ymd) => (/^\d{4}-\d{2}-\d{2}/.test(ymd || '') ? `${DAYS[new Date(`${ymd.slice(0, 10)}T12:00:00Z`).getUTCDay()]} ${md(ymd)}` : esc(ymd));
// Jon's time zone (America/Vancouver): the Vancouver day of an instant, its Monday, and "Nov 18 09:00".
const TZ = 'America/Vancouver';
const DAY_MS = 86400000;
const vanYmd = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const vanHm = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const mondayOf = (ms) => { const d = vanYmd(ms); const dow = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; return new Date(Date.parse(`${d}T12:00:00Z`) - dow * DAY_MS).toISOString().slice(0, 10); };
// A stored moment (ISO, usually UTC) as its Vancouver day; a bare YYYY-MM-DD stays as it is.
const vanDay = (at) => { const s = String(at || ''); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const t = Date.parse(s); return Number.isFinite(t) ? vanYmd(t) : ''; };
// The 13 Vancouver Monday weeks up to this one, oldest first.
export const weeks13 = (now = Date.now()) => { const cur = mondayOf(now); return Array.from({ length: 13 }, (_, i) => new Date(Date.parse(`${cur}T12:00:00Z`) - (12 - i) * 7 * DAY_MS).toISOString().slice(0, 10)); };
const box = (inner) => `<div class="card pad">${inner}</div>`;
const empty = (text) => box(`<p class="muted">${esc(text)}</p>`);
const statusPill = (s) => pill(STATUS[s] || String(s || '').replace(/_/g, ' '), STATUS_CLS[s] || '');
const proof = (url) => (/^https:\/\//i.test(url || '') ? `<a href="${esc(url)}" target="_blank" rel="noopener">Proof</a>` : '<span class="muted">No proof yet</span>');

function money(v, unit) {
  const n = Number(v);
  if (unit === '$') return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const s = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return unit && unit !== '#' ? `${s}${unit === '%' ? '%' : ` ${esc(unit)}`}` : s;
}

// Always 13 Vancouver Monday weeks, oldest left and this week right; a week the feed has no value for says "no data yet".
export function scorecardHtml(sc, now = Date.now()) {
  if (!sc || !Array.isArray(sc.weeks) || !Array.isArray(sc.numbers)) return empty('Scorecard: no data yet. The scorecard script has not posted it.');
  const weeks = weeks13(now).map((start, i) => ({ start, current: i === 12 }));
  const head = `<tr><th class="eosnum">Number</th>${weeks.map((w) => `<th class="eoswk${w.current ? ' cur' : ''}">${md(w.start)}</th>`).join('')}</tr>`;
  const rows = sc.numbers.map((n) => {
    const byWeek = new Map((n.values || []).map((v) => [v.week, v]));
    const cells = weeks.map((w) => {
      const v = byWeek.get(w.start);
      if (!v || v.status === 'nodata' || v.value === null || v.value === undefined || !Number.isFinite(Number(v.value))) return `<td class="eosv nodata">${NODATA}</td>`;
      const cls = ['ok', 'off', 'partial'].includes(v.status) ? v.status : 'ok';
      return `<td class="eosv ${cls}"${v.note ? ` title="${esc(v.note)}"` : ''}>${money(v.value, n.unit)}</td>`;
    }).join('');
    const hand = n.handKeyed ? ` ${pill('hand-keyed', 'risk')}` : '';
    return `<tr><td class="eosnum"><span>${esc(n.name)}</span>${hand}<small>${esc(n.owner)} · ${esc(n.goal?.text || '')}</small></td>${cells}</tr>`;
  }).join('');
  const gen = Date.parse(sc.generated || sc.postedAt || '');
  const stale = Number.isFinite(gen) && now - gen > 7 * DAY_MS ? ' · over a week old' : '';
  const meta = Number.isFinite(gen) ? `Updated ${md(vanYmd(gen))} ${vanHm(gen)}${stale}` : '';
  return `<div class="card pad"><div class="cardhead"><h2>Scorecard</h2><span class="meta">${meta}</span></div>
<p class="muted eoslegend"><span class="eosv off">red</span> = off goal · <span class="eosv partial">amber</span> = part of the week · hand-keyed = typed in by its owner, not read by a script</p>
<div class="tblwrap eostbl"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div></div>`;
}

function cardRows(list) {
  return list.map((r) => `<div class="pdrow eosrow"><div class="eosmain"><b>${esc(r.title)}</b><small class="muted">${esc(r.owner || 'no owner')}</small></div><div class="eosside">${statusPill(r.status)} ${proof(r.proofLink)}</div></div>`).join('');
}

export function rocksHtml(list) {
  if (!list?.length) return empty('No Rock cards yet. A Rock is a card titled "Rock Q1: ..." to "Rock Q4: ...".');
  return box(`<div class="cardhead"><h2>Rocks</h2><span class="meta">${list.length} this quarter</span></div><div class="pdrows">${cardRows(list)}</div>`);
}

export function issuesHtml(list) {
  if (!list?.length) return empty('No Issue cards yet. An Issue is a card titled "Issue: ...".');
  const open = list.filter((r) => !['done', 'cancelled'].includes(r.status)).length;
  return box(`<div class="cardhead"><h2>Issues</h2><span class="meta">${open} open</span></div><div class="pdrows">${cardRows(list)}</div>`);
}

export function meetingsHtml(list) {
  if (!list?.length) return empty('no data yet, first meeting Monday 08:00');
  return list.map((m) => {
    const r = Number(m.rating);
    const rating = Number.isFinite(r) && m.rating !== null && m.rating !== undefined ? pill(`${r} / 10`, r >= 8 ? 'ok' : r >= 6 ? 'risk' : 'crit') : '<span class="muted">Not rated yet</span>';
    return box(`<div class="cardhead"><h2>${day(m.date)}</h2></div><p class="eossum">${esc(m.summary)}</p><p class="eosrate">Jon's rating: ${rating}</p>`);
  }).join('');
}

export function queueHtml(list) {
  if (!list?.length) return empty('Nothing waiting on you.');
  const rows = list.map((i) => `<div class="pdrow eosrow"><div class="eosmain"><b>${esc(i.title)}</b><small class="muted">${esc(KIND[i.kind] || i.kind || '')}${vanDay(i.createdAt) ? ` · since ${md(vanDay(i.createdAt))}` : ''}</small></div><div class="eosside">${i.money ? pill('Money', 'crit') : ''}</div></div>`).join('');
  return box(`<div class="cardhead"><h2>Your queue</h2><span class="meta">${list.length} waiting · money first, then oldest</span></div><div class="pdrows">${rows}</div>`);
}

const PAINT = { scorecard: (d) => scorecardHtml(d.scorecard), rocks: (d) => rocksHtml(d.rocks), issues: (d) => issuesHtml(d.issues), meetings: (d) => meetingsHtml(d.meetings), queue: (d) => queueHtml(d.queue) };

export function eos(_page, _data, sub) {
  const tab = TABS.some(([id]) => id === sub) ? sub : 'scorecard';
  const chips = TABS.map(([id, label]) => `<button type="button" class="chip${id === tab ? ' on' : ''}" data-page="eos/${id}"${id === tab ? ' aria-current="page"' : ''}>${label}</button>`).join('');
  return `<div class="wrap" data-tab="${tab}">
  <div class="head"><div><h1>EOS</h1><p>Scorecard, Rocks, Issues and meetings, read live from the cards and scripts</p></div></div>
  <nav class="cctabs" aria-label="EOS"><div class="ccgrp">${chips}</div></nav>
  <div class="eosbody">${last ? PAINT[tab](last) : '<div class="card pad"><p class="muted">Loading…</p></div>'}</div>
</div>`;
}

export function mountEos(el) {
  if (!el) return;
  const tab = PAINT[el.dataset?.tab] ? el.dataset.tab : 'scorecard';
  const paint = (html) => { const b = el.querySelector('.eosbody'); if (b) b.innerHTML = html; };
  fetch(`${API}?v=${Date.now()}`).then(async (res) => {
    const d = res && res.ok ? await res.json() : null;
    if (!el.isConnected) return; // moved to another page
    if (!d || d.ok === false) { if (!last) paint('<div class="card pad"><p class="muted">Could not load the EOS page. Refresh to try again.</p></div>'); return; }
    last = d;
    try { paint(PAINT[tab](d)); } catch { paint('<div class="card pad"><p class="muted">This tab could not be drawn. Refresh to try again.</p></div>'); }
  }).catch(() => { if (el.isConnected && !last) paint('<div class="card pad"><p class="muted">Could not load the EOS page. Refresh to try again.</p></div>'); });
}
