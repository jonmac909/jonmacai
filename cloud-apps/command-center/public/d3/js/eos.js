// EOS page (Jon, 2026-11-18; card t_75395eabd6774bdc): Scorecard, Rocks, Issues, Meetings and Your queue, the same
// tabs as the old /dashboard EOS page (public/js/pages/eos.js), drawn in the Dashboard 3 style. Data: GET /dashboard/api/v1/eos
// (src/bots.js, src/eos.js); nothing is typed into the page. #eos/<tab> picks the tab, anything else is the Scorecard.
// Pure functions (tests run them without a browser), plus eosKeep / eosAfter to keep open scorecard lines open on redraw.
import { esc } from './util.js';
import { headerOnly } from './goals.js';

export const EOS_TABS = [['scorecard', 'Scorecard'], ['rocks', 'Rocks'], ['issues', 'Issues'], ['meetings', 'Meetings'], ['queue', 'Your queue']];
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

// Scorecard colour (Jon, 2026-11-18; card t_e28750c475be4838), one rule for every cell:
// 'off' red = off goal; 'behind' amber = only this week, under a day behind the pro-rata pace; 'part' grey = the number's
// oldest data week when it held only part of a week (no verdict); 'nodata' grey = nothing to judge. A lower-is-better
// number (op '<=') is off once it passes its goal, this week too (73 corrections vs a goal of 10 is red). Past weeks are
// red or green, never amber. A Rock with a due date is judged at its due date.
const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
export function eosTone({ value, op, goal, current = false, elapsed = 7, rate = false, due = '', weekEnd = '', part = false } = {}) {
  if (!has(value) || !has(goal)) return 'nodata';
  if (part && !current) return 'part';
  if (due && weekEnd && weekEnd < due) return 'ok';
  const v = Number(value);
  const g = Number(goal);
  if (op === '<=') return v > g ? 'off' : 'ok';
  if (!current || rate) return v >= g ? 'ok' : 'off';
  const d = Math.min(7, Math.max(1, Number(elapsed) || 7));
  if (v >= (g * d) / 7) return 'ok';
  return v >= (g * (d - 1)) / 7 ? 'behind' : 'off';
}

// Plain numbers in chips and tiles (the unit is said once, under the name); 2,000 is 2.0k.
const num = (v) => { const n = Number(v); const a = Math.abs(n); return a >= 1000 ? `${n < 0 ? '-' : ''}${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : n.toLocaleString('en-US', { maximumFractionDigits: 1 }); };
const big = (v, unit) => (unit === '$' ? `${Number(v) < 0 ? '-' : ''}$${num(Math.abs(Number(v)))}` : `${num(v)}${unit === '%' ? '%' : ''}`);
const plusDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const goalShort = (t) => String(t || '').replace(/(\s*\([^()]*\))+\s*$/, '');
const ORDER = { off: 0, behind: 1, ok: 2, part: 3, nodata: 4 };

// Seat list (mockup A): KPI boxes, then each person's numbers, off-goal lines first. One line per number: last 3 weeks as
// chips, this week big on the right; tap the line for every week that has data. No 13-column table.
export function scorecardHtml(sc, now = Date.now()) {
  if (!sc || !Array.isArray(sc.weeks) || !Array.isArray(sc.numbers)) return empty('Scorecard: no data yet. The scorecard script has not posted it.');
  const weeks = weeks13(now);
  const gen = Date.parse(sc.generated || sc.postedAt || '');
  const at = Number.isFinite(gen) && mondayOf(gen) === weeks[12] ? gen : now;
  const elapsed = ((new Date(`${vanYmd(at)}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const rows = sc.numbers.map((n) => {
    const vals = new Map((n.values || []).filter((v) => v && v.status !== 'nodata' && has(v.value) && weeks.includes(v.week)).map((v) => [v.week, v]));
    const oldest = [...vals.keys()].sort()[0];
    const tone = (w, i) => { const v = vals.get(w); return v ? eosTone({ value: v.value, op: n.goal?.op, goal: n.goal?.value, current: i === 12, elapsed, rate: n.unit === '%', due: n.goal?.due, weekEnd: plusDays(w, 6), part: w === oldest && v.status === 'partial' }) : 'nodata'; };
    return { n, vals, tone, now: tone(weeks[12], 12), person: String(n.owner || 'No owner').split(/[\s(]/)[0] };
  });
  const tracked = rows.filter((r) => r.vals.size);
  const untracked = rows.filter((r) => !r.vals.size);
  const count = (t, list = tracked) => list.filter((r) => r.now === t).length;
  const tip = (w, t, v) => ` title="${md(w)}${t === 'part' ? ', part week' : ''}${v.note ? `: ${esc(v.note)}` : ''}"`;
  const line = (r) => {
    const { n, vals, tone } = r;
    const unit = n.unit && !['$', '%', '#'].includes(n.unit) ? ` · ${n.unit}` : '';
    const hand = n.handKeyed || /^hand-keyed/i.test(n.source || '') ? ', typed in' : '';
    const chips = [9, 10, 11].map((i) => { const w = weeks[i]; const v = vals.get(w); const t = tone(w, i); return v ? `<i class="eosc ${t}"${tip(w, t, v)}>${num(v.value)}</i>` : `<i class="eosc nodata" title="${md(w)}: no data">-</i>`; }).join('');
    const cur = vals.get(weeks[12]);
    const tiles = weeks.map((w, i) => { const v = vals.get(w); if (!v) return ''; const t = tone(w, i); return `<span class="eost ${t}"${tip(w, t, v)}><small>${i === 12 ? 'Now' : md(w)}${t === 'part' ? ' part' : ''}</small><b>${num(v.value)}</b></span>`; }).join('');
    const def = n.definition ? ` · ${esc(n.definition)}` : '';
    return `<details class="eosln" data-id="${esc(n.id || n.name)}"><summary><span class="eosnm"><b>${esc(n.name)}</b><small>goal ${esc(goalShort(n.goal?.text))}${esc(unit)}${hand}</small></span><span class="eoschips">${chips}</span><span class="eosnow ${r.now}">${cur ? big(cur.value, n.unit) : '-'}</span></summary><div class="eoshist"><div class="eostiles">${tiles}</div><p class="mut">Goal: ${esc(n.goal?.text || '')}${def}</p></div></details>`;
  };
  const people = [...new Set(tracked.map((r) => r.person))];
  const seats = people.map((p) => {
    const list = tracked.filter((r) => r.person === p).sort((a, b) => ORDER[a.now] - ORDER[b.now]);
    const names = [...new Set(list.map((r) => r.n.seat).filter(Boolean))];
    const off = count('off', list);
    const behind = count('behind', list);
    const tag = off ? `<em class="off">${off} off</em>` : behind ? `<em class="behind">${behind} behind</em>` : '<em class="ok">on goal</em>';
    return `<div class="eosseat"><span>${esc(p)}${names.length ? `, ${esc(names.join(' and '))}` : ''}</span>${tag}</div>${list.map(line).join('')}`;
  }).join('');
  const behind = count('behind');
  const kpi = `<div class="eoskpi"><span class="off"><b>${count('off')}</b>off goal</span>${behind ? `<span class="behind"><b>${behind}</b>behind pace</span>` : ''}<span class="ok"><b>${count('ok')}</b>on goal</span><span class="nodata"><b>${untracked.length}</b>not tracked</span></div>`;
  const notTracked = untracked.length ? `<details class="eosln eosoff" data-id="_untracked"><summary>Not tracked yet (${untracked.length}): ${untracked.map((r) => esc(r.n.name)).join(', ')}</summary><ul>${untracked.map(({ n }) => `<li><b>${esc(n.name)}</b> · ${esc(n.owner || 'no owner')} · goal ${esc(n.goal?.text || '')}${n.no_data_how ? ` · ${esc(n.no_data_how)}` : ''}</li>`).join('')}</ul></details>` : '';
  const stale = Number.isFinite(gen) && now - gen > 7 * DAY_MS ? ' · over a week old' : '';
  const meta = Number.isFinite(gen) ? `Updated ${md(vanYmd(gen))} ${vanHm(gen)}${stale}` : '';
  const legend = `<p class="mut eoslegend">Chips: ${[9, 10, 11].map((i) => md(weeks[i])).join(', ')}. Big number: this week, day ${elapsed} of 7. Red = off goal · amber = this week, under a day behind pace · grey = no data or a part week. Off-goal lines sit first in each seat; tap a line for every week.</p>`;
  return `<section class="card eossc"><div class="hd cardhd"><h2>Scorecard</h2>${meta ? `<span class="mut sp">${meta}</span>` : ''}</div>${kpi}${seats}${notTracked}${legend}</section>`;
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

// The 60 s redraw keeps the scorecard lines Jon opened open (matched by data-id).
const openSel = '.eos[data-tab="scorecard"] details';
const idOf = (d) => d.dataset?.id ?? d.getAttribute?.('data-id');
export function eosKeep(main) {
  const list = main?.querySelectorAll?.(`${openSel}[open]`);
  return list ? [...list].map(idOf) : null;
}
export function eosAfter(main, keep) {
  if (!keep?.length) return;
  for (const d of main?.querySelectorAll?.(`${openSel}[data-id]`) || []) if (keep.includes(idOf(d))) d.open = true;
}
