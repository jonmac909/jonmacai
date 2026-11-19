// EOS page (Jon, 2026-11-18; card t_75395eabd6774bdc): Scorecard, Rocks, Issues, Meetings and Your queue, the same
// tabs as the old /dashboard EOS page (public/js/pages/eos.js), drawn in the Dashboard 3 style. Data: GET /dashboard/api/v1/eos
// (src/bots.js, src/eos.js); nothing is typed into the page. #eos/<tab> picks the tab, anything else is the Scorecard.
// Pure functions (tests run them without a browser), plus eosKeep / eosAfter for the scorecard's sideways scroll.
import { esc } from './util.js';
import { headerOnly } from './goals.js';

export const EOS_TABS = [['scorecard', 'Scorecard'], ['rocks', 'Rocks'], ['issues', 'Issues'], ['meetings', 'Meetings'], ['queue', 'Your queue']];
const NODATA = '<span class="mut">no data yet</span>';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS = { todo: 'To do', doing: 'Doing', qc: 'In QC', review: 'In review', done: 'Done', blocked: 'Blocked', waiting_on_jon: 'Waiting on you', cancelled: 'Cancelled' };
const STATUS_CLS = { done: 'ok', review: 'ok', blocked: 'bad', waiting_on_jon: 'warn' };
const KIND = { approval: 'Approval', question: 'Question', card: 'Card' };

export const eosTab = (sub) => (EOS_TABS.some(([id]) => id === sub) ? sub : 'scorecard');

// "Nov 16" from YYYY-MM-DD, no time zone shift.
const md = (ymd) => (/^\d{4}-\d{2}-\d{2}/.test(ymd || '') ? `${MON[+ymd.slice(5, 7) - 1]} ${+ymd.slice(8, 10)}` : esc(ymd));
const day = (ymd) => (/^\d{4}-\d{2}-\d{2}/.test(ymd || '') ? `${DAYS[new Date(`${ymd.slice(0, 10)}T12:00:00Z`).getUTCDay()]} ${md(ymd)}` : esc(ymd));
// Jon's time zone (America/Vancouver): the Vancouver day of an instant, its Monday, and "09:00".
const TZ = 'America/Vancouver';
const DAY_MS = 86400000;
const vanYmd = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const vanHm = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const mondayOf = (ms) => { const d = vanYmd(ms); const dow = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; return new Date(Date.parse(`${d}T12:00:00Z`) - dow * DAY_MS).toISOString().slice(0, 10); };
// A stored moment (ISO, usually UTC) as its Vancouver day; a bare YYYY-MM-DD stays as it is.
const vanDay = (at) => { const s = String(at || ''); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const t = Date.parse(s); return Number.isFinite(t) ? vanYmd(t) : ''; };
// The 13 Vancouver Monday weeks up to this one, oldest first.
export const weeks13 = (now = Date.now()) => { const cur = mondayOf(now); return Array.from({ length: 13 }, (_, i) => new Date(Date.parse(`${cur}T12:00:00Z`) - (12 - i) * 7 * DAY_MS).toISOString().slice(0, 10)); };

const pill = (text, cls = '') => `<span class="pill${cls ? ` ${cls}` : ''}">${esc(text)}</span>`;
const section = (title, meta, inner) => `<section class="card"><div class="hd cardhd"><h2>${esc(title)}</h2>${meta ? `<span class="mut sp">${meta}</span>` : ''}</div>${inner}</section>`;
const empty = (text) => `<section class="card"><p class="mut">${esc(text)}</p></section>`;
const statusPill = (s) => pill(STATUS[s] || String(s || '').replace(/_/g, ' '), STATUS_CLS[s] || '');
const proof = (url) => (/^https:\/\//i.test(url || '') ? `<a href="${esc(url)}" target="_blank" rel="noopener">Proof</a>` : '<span class="mut">No proof yet</span>');

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
  const head = `<tr><th class="eosnum">Number</th>${weeks.map((w) => `<th class="eoswk${w.current ? ' cur' : ''}">${w.current ? 'This week<br>' : ''}${md(w.start)}</th>`).join('')}</tr>`;
  const rows = sc.numbers.map((n) => {
    const byWeek = new Map((n.values || []).map((v) => [v.week, v]));
    const cells = weeks.map((w) => {
      const v = byWeek.get(w.start);
      if (!v || v.status === 'nodata' || v.value === null || v.value === undefined || v.value === '' || !Number.isFinite(Number(v.value))) return `<td class="eosv nodata">${NODATA}</td>`;
      const cls = ['ok', 'off', 'partial'].includes(v.status) ? v.status : 'ok';
      return `<td class="eosv ${cls}"${v.note ? ` title="${esc(v.note)}"` : ''}>${money(v.value, n.unit)}</td>`;
    }).join('');
    const hand = n.handKeyed ? ` ${pill('hand-keyed', 'warn')}` : '';
    return `<tr><td class="eosnum"><b>${esc(n.name)}</b>${hand}<small>${esc(n.owner)} · ${esc(n.goal?.text || '')}</small></td>${cells}</tr>`;
  }).join('');
  const gen = Date.parse(sc.generated || sc.postedAt || '');
  const stale = Number.isFinite(gen) && now - gen > 7 * DAY_MS ? ' · over a week old' : '';
  const meta = Number.isFinite(gen) ? `Updated ${md(vanYmd(gen))} ${vanHm(gen)}${stale}` : '';
  return section('Scorecard', meta, `<p class="mut eoslegend"><span class="eosv off">red</span> = off goal · <span class="eosv partial">amber</span> = part of the week · hand-keyed = typed in by its owner, not read by a script</p>
<div class="eoswrap"><table class="eostbl"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`);
}

function cardRows(list) {
  return list.map((r) => `<div class="eosrow"><div class="eosmain"><b>${esc(r.title)}</b><span class="mut">${esc(r.owner || 'no owner')}</span></div><div class="eosside">${statusPill(r.status)} ${proof(r.proofLink)}</div></div>`).join('');
}

export function rocksHtml(list) {
  if (!list?.length) return empty('No Rock cards yet. A Rock is a card titled "Rock Q1: ..." to "Rock Q4: ...".');
  return section('Rocks', `${list.length} this quarter`, `<div class="eosrows">${cardRows(list)}</div>`);
}

export function issuesHtml(list) {
  if (!list?.length) return empty('No Issue cards yet. An Issue is a card titled "Issue: ...".');
  const open = list.filter((r) => !['done', 'cancelled'].includes(r.status)).length;
  return section('Issues', `${open} open`, `<div class="eosrows">${cardRows(list)}</div>`);
}

export function meetingsHtml(list) {
  if (!list?.length) return empty('no data yet, first meeting Monday 08:00');
  return list.map((m) => {
    const r = Number(m.rating);
    const rating = Number.isFinite(r) && m.rating !== null && m.rating !== undefined && m.rating !== '' ? pill(`${r} / 10`, r >= 8 ? 'ok' : r >= 6 ? 'warn' : 'bad') : '<span class="mut">Not rated yet</span>';
    return section(day(m.date), '', `<p class="eossum">${esc(m.summary)}</p><p class="mut">Jon's rating: ${rating}</p>`);
  }).join('');
}

// Money items first, then oldest first (the server sends it so; sorted again here so the page never depends on it).
export const queueSorted = (list) => [...list].sort((a, b) => (!!a.money === !!b.money ? String(a.createdAt || '').localeCompare(String(b.createdAt || '')) : a.money ? -1 : 1));

export function queueHtml(list) {
  if (!list?.length) return empty('Nothing waiting on you.');
  const rows = queueSorted(list).map((i) => `<div class="eosrow"><div class="eosmain"><b>${esc(i.title)}</b><span class="mut">${esc(KIND[i.kind] || i.kind || '')}${vanDay(i.createdAt) ? ` · since ${md(vanDay(i.createdAt))}` : ''}</span></div><div class="eosside">${i.money ? pill('Money', 'bad') : ''}</div></div>`).join('');
  return section('Your queue', `${list.length} waiting · money first, then oldest`, `<div class="eosrows">${rows}</div>`);
}

const PAINT = { scorecard: (d, now) => scorecardHtml(d.scorecard, now), rocks: (d) => rocksHtml(d.rocks), issues: (d) => issuesHtml(d.issues), meetings: (d) => meetingsHtml(d.meetings), queue: (d) => queueHtml(d.queue) };

// data: the /v1/eos answer, undefined while loading, null when it could not be read.
export function renderEos(d2resp, data, sub, now = Date.now()) {
  const tab = eosTab(sub);
  const tabs = EOS_TABS.map(([id, label]) => `<a class="btn sm" href="#eos/${id}"${id === tab ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  let body;
  if (data === undefined) body = '<section class="card"><p class="mut">Loading</p></section>';
  else if (!data || data.ok === false) body = '<section class="card"><p class="mut">Could not load the EOS page. Refresh to try again.</p></section>';
  else {
    try { body = PAINT[tab](data, now); } catch { body = '<section class="card"><p class="mut">This tab could not be drawn. Refresh to try again.</p></section>'; }
  }
  return `${headerOnly(d2resp, 'EOS', 'Scorecard, Rocks, Issues and meetings, read live from the cards and scripts')}
<nav class="hd eostabs" aria-label="EOS">${tabs}</nav>
<div class="eos" data-tab="${tab}">${body}</div>`;
}

// The scorecard opens scrolled to this week (right end); a redraw of the same tab keeps where Jon scrolled it.
export function eosKeep(main) {
  const wrap = main?.querySelector?.('.eos[data-tab="scorecard"] .eoswrap');
  return wrap ? wrap.scrollLeft : null;
}
export function eosAfter(main, keep) {
  const wrap = main?.querySelector?.('.eos[data-tab="scorecard"] .eoswrap');
  if (wrap) wrap.scrollLeft = keep ?? wrap.scrollWidth;
}
