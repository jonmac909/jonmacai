// Dashboard 3 Blockers page (docs/dashboard-3.md), laid out as the approved design (Blockers.dc.html). Pure functions
// over the /dashboard/api/d2 and /dashboard/api/d3 answers. Rows: d3.blockers (cards waiting on Jon, open questions,
// pending approvals, Stuck cards, late cards) plus the rail's YouTube login and token limit and d2's missed daily jobs.
// blockerRows() is also the rail's Blockers count.
import { cardLink, esc, icon } from './util.js';
import { headerOnly } from './goals.js';
import { renderNeeds } from './needs.js';

export const KINDS = { p: 'Waiting on a person', f: 'Work that failed', a: 'Access and limits', s: 'Slow or idle' };
export const FILTERS = [['all', 'All'], ['you', 'Need you'], ['p', 'Person'], ['f', 'Failed'], ['a', 'Access'], ['s', 'Slow']];
const SHORT = Object.fromEntries(FILTERS.slice(2)); // tile sub-labels: Person, Failed, Access, Slow
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const ts = (iso) => (Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : Infinity);
const one = (v) => (Array.isArray(v) ? v[0] : v) || null;
const match = (f) => (b) => f === 'all' || (f === 'you' ? b.you : b.kind === f);

// Every open blocker, Jon's first, then oldest first; null when the cards could not be read.
export function blockerRows(d2resp, d3resp) {
  const list = d3resp?.d3?.blockers;
  if (!Array.isArray(list)) return null;
  const rail = d3resp.d3.rail || {};
  const rows = [...list];
  const yt = rail.youtube;
  if (yt?.state === 'r') {
    rows.push({ id: 'youtube', kind: 'a', you: true, title: 'YouTube login out', age: '', blocks: `${yt.out} of ${yt.connected} connected channels can't sync until you sign in again.` });
  }
  if (num(rail.tokens?.pct) && rail.tokens.pct >= 100 && !rail.tokens.stale) { // an old reading is not a limit hit
    rows.push({ id: 'tokens', kind: 'a', you: false, title: 'Weekly token limit reached', age: '', blocks: 'Bot work until the weekly limit resets.' });
  }
  for (const c of d2resp?.d2?.checks || []) {
    if (c?.today?.ok !== false) continue;
    rows.push({ id: `chk:${c.key}`, kind: 'f', you: false, title: `${c.title} missed`, age: 'today', owner: c.owner, blocks: `${c.title} today: ${c.today.status?.text || 'Missed'}` });
  }
  return rows.sort((a, b) => Number(!!b.you) - Number(!!a.you) || ts(a.at) - ts(b.at));
}

function tile(ic, label, sub, value) {
  const v = value == null ? '<b class="num sp nf">No feed</b>' : `<b class="num sp" style="font-size: 30px">${esc(value)}</b>`;
  return `<div class="tile" style="flex: 1 1 200px"><span class="chip">${icon(ic)}</span><span class="stack" style="white-space: nowrap"><b>${esc(label)}</b><span class="mut">${esc(sub)}</span></span>${v}</div>`;
}

function rowHtml(b, i, open) {
  const blocks = b.owner ? `${b.owner} · ${b.blocks}` : b.blocks;
  const head = `<button type="button" class="blrow${i === 0 ? ' first' : ''}" aria-expanded="${open}" data-bl="${esc(b.id)}">
<span class="hd"><span class="dot ${b.you ? 'r' : 'y'}"></span><b class="ell">${esc(b.title)}</b></span>
<span><span class="pill">${esc(KINDS[b.kind] || '')}</span></span>
<span class="sub">${esc(b.age || '–')}</span>
<span style="text-align: right"><span class="pill ${b.you ? 'bad' : ''}">${b.you ? 'Needs you' : 'Ana on it'}</span></span>
</button>`;
  if (!open) return `<div>\n${head}\n</div>`;
  return `<div>
${head}
<div class="inner" style="margin-bottom: 14px; gap: 4px">
<div class="hrow"><span class="mut" style="width: 64px; flex: none">Blocks</span><span>${esc(blocks)}</span></div>
${b.review || b.card ? `<div class="hd" style="padding-top: 8px; gap: 8px">${b.review ? `<a class="btn pri" href="#review" data-rvgo="${esc(b.id)}">Open in Review</a>` : ''}${cardLink(b.card)}</div>` : ''}
</div>
</div>`;
}

// ---- System health: four small cards; a line with no source reads "No feed" ----
const line = (l, v, tone = '') => ({ l, v, tone });
const NO = (l) => line(l, null);
function healthOf(d2resp, d3resp) {
  const rail = d3resp?.d3?.rail || {};
  const checks = d2resp?.d2?.checks;
  const jobs = Array.isArray(checks) ? checks.map((c) => line(c.title, c.today?.status?.text || 'No data', c.today?.ok === true ? 'g' : c.today?.ok === false ? 'r' : '')) : [NO('Daily jobs')];
  const missed = jobs.filter((r) => r.tone === 'r').length;
  const yt = rail.youtube;
  const ytRow = !yt || yt.state === 'none' ? (yt?.text && yt.text !== 'No feed' ? line('YouTube login', yt.text.replace(/^YouTube /, '')) : NO('YouTube login'))
    : line('YouTube login', yt.state === 'r' ? `Out (${yt.out} of ${yt.connected})` : 'Signed in', yt.state);
  const tk = rail.tokens;
  const tkRow = !num(tk?.pct) ? NO('Weekly tokens')
    : tk.stale ? line('Weekly tokens', `${tk.pct}%, ${String(tk.text).replace(/^Tokens \d+%, /, '')}`) // grey, with its age
      : line('Weekly tokens', `${tk.pct}%`, tk.state);
  const hg = rail.heygen;
  // Rows with no source are left out rather than shown as "No feed" (Sponsor inbox has none yet).
  const logins = [ytRow, tkRow, ...(hg && hg.state !== 'none' ? [line('HeyGen today', hg.text, hg.state)] : [])];
  const down = logins.filter((r) => r.tone === 'r').length;
  const age = (label, src) => (src ? line(label, String(src.ageLabel || '').replace(/^updated /, ''), src.stale ? 'r' : 'g') : NO(label));
  const sponsors = one((d2resp?.d2?.goals || []).find((g) => g.key === 'sponsors')?.month);
  const board = d3resp?.d3?.team?.line ? [line('Video board', 'live', 'g')] : []; // built from the cards on each load
  const feeds = [age('Sponsor money', sponsors?.source), ...board, age('Token use', tk?.source),
    ...(Array.isArray(checks) ? checks.filter((c) => c.today?.source).map((c) => age(c.title, c.today.source)) : [])];
  const stale = feeds.filter((r) => r.tone === 'r').length;
  // Dispatcher card: heartbeat and runs going (rail), failed runs and Stuck cards today (live feed via team.fails).
  const ln = (l, x) => (!x || x.text === 'No feed' ? NO(l) : line(l, x.text, x.state === 'none' ? '' : x.state));
  const fl = d3resp?.d3?.team?.fails;
  const cnt = (l, kind) => { if (!Array.isArray(fl)) return NO(l); const n = fl.filter((f) => (f.kind || 'run') === kind).length; return line(l, String(n), n ? 'r' : 'g'); };
  const disp = [ln('Heartbeat', rail.dispatcher), ln('Bots', rail.bots), cnt('Failed runs today', 'run'), cnt('Stuck today', 'stuck')];
  const dispBad = disp.filter((r) => r.tone === 'r').length;
  const pill = (bad, cls, text, okText, any) => (bad ? { pill: cls, state: text } : any ? { pill: 'ok', state: okText } : { pill: '', state: 'No feed' });
  return [
    { title: 'Daily jobs', rows: jobs, ...pill(missed, 'bad', `${missed} missed`, 'On time', jobs.some((r) => r.tone)) },
    { title: 'Dispatcher', rows: disp, ...pill(dispBad, 'bad', `${dispBad} down`, 'Running', disp.some((r) => r.tone)) },
    { title: 'Logins and limits', rows: logins, ...pill(down, 'bad', `${down} down`, 'All in', logins.some((r) => r.tone)) },
    { title: 'Feed age', rows: feeds, ...pill(stale, 'warn', `${stale} stale`, 'All fresh', feeds.some((r) => r.tone)) },
  ];
}

export function renderBlockers(d2resp, d3resp, ui = {}) {
  const rows = blockerRows(d2resp, d3resp);
  const f = FILTERS.some(([k]) => k === ui.blFilter) ? ui.blFilter : 'all';
  const head = headerOnly(d2resp, 'Blockers', 'Ana tries first · you see everything', '<span class="pill sp">No feed = its source could not be read</span>');
  const you = rows ? rows.filter((b) => b.you).length : null;
  const dated = rows ? rows.filter((b) => Number.isFinite(ts(b.at))) : [];
  const oldest = dated.length ? dated.reduce((a, b) => (ts(b.at) < ts(a.at) ? b : a)) : null;
  const tiles = `<div class="row">
${tile('blockers', 'Open', 'all kinds', rows ? rows.length : null)}
${tile('you', 'Need you', 'only you can clear', you)}
${tile('team', 'Ana on it', 'no action from you', rows ? rows.length - you : null)}
${tile('clock', 'Oldest', oldest ? SHORT[oldest.kind] : 'no blockers', oldest ? String(oldest.age).replace(/ days?$/, ' d') : rows ? '–' : null)}
</div>`;
  const filters = FILTERS.map(([k, label]) => `<button type="button" class="btn sm" aria-pressed="${f === k}" data-blf="${k}">${esc(label)} ${rows ? rows.filter(match(k)).length : ''}</button>`).join('');
  const shown = rows ? rows.filter(match(f)) : [];
  const list = !rows ? '<p class="mut" style="padding-top: 14px">No feed: the dashboard cards could not be read.</p>'
    : shown.length ? shown.map((b, i) => rowHtml(b, i, ui.openBl === b.id)).join('\n') : '<p class="mut" style="padding-top: 14px">Nothing open here.</p>';
  const health = healthOf(d2resp, d3resp).map((h) => `<section class="card" style="gap: 4px; padding: 18px">
<div class="hd" style="margin-bottom: 8px"><h2 style="font-size: 15px">${esc(h.title)}</h2><span class="pill ${h.pill} sp">${esc(h.state)}</span></div>
${h.rows.map((r) => `<div class="hrow"><span class="dot ${r.tone}"></span><span class="ell">${esc(r.l)}</span>${r.v == null ? '<b class="nf">No feed</b>' : `<b>${esc(r.v)}</b>`}</div>`).join('')}
</section>`).join('\n');
  return `${head}
${tiles}
${renderNeeds(rows, d3resp, ui)}
<section class="card" style="gap: 0">
<div class="hd cardhd" style="flex-wrap: wrap"><span class="chip">${icon('list')}</span><h2>Open blockers</h2>
<div class="hd sp" style="gap: 6px; flex-wrap: wrap" role="group" aria-label="Filter">${filters}</div>
</div>
${list}
</section>
<div class="hd" style="padding: 10px 4px 0"><h2 style="font-size: 20px; font-weight: 400">System health</h2></div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 16px">
${health}
</div>`;
}
