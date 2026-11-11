// Dashboard 3 Scripts page: every open @JonMacAI video card, newest first, with a one-click link to its script Doc and
// "To record" or "Recorded". Pure functions over the /dashboard/api/d3 answer (d3.scripts, built in src/d3.js).
import { esc, icon } from './util.js';
import { headerOnly } from './goals.js';

const DOC = /^https:\/\/docs\.google\.com\//i;
const day = (iso) => (Number.isFinite(Date.parse(iso))
  ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric' }).format(new Date(iso)) : '');

function rowHtml(s, i) {
  const rec = s.status === 'Recorded';
  const doc = DOC.test(s.doc || '')
    ? `<a class="btn sm" href="${esc(s.doc)}" target="_blank" rel="noopener noreferrer">Open script</a>`
    : '<span class="nf">No Doc</span>';
  return `<div class="scrow${i === 0 ? ' first' : ''}" data-script="${esc(s.id)}">
<span class="stack" style="min-width: 0"><b class="ell" title="${esc(s.title)}">${esc(s.title)}</b><span class="mut">${esc(day(s.at) ? `Card made ${day(s.at)}` : '')}</span></span>
<span><span class="pill ${rec ? 'ok' : 'warn'}">${rec ? 'Recorded' : 'To record'}</span></span>
<span style="text-align: right">${doc}</span>
</div>`;
}

export function renderScripts(d2resp, d3resp) {
  const rows = d3resp?.d3?.scripts;
  const ok = Array.isArray(rows);
  const toRecord = ok ? rows.filter((s) => s.status !== 'Recorded').length : null;
  const head = headerOnly(d2resp, 'Scripts', '@JonMacAI scripts to read on camera',
    ok ? `<span class="pill ${toRecord ? 'warn' : 'ok'} sp">${toRecord} to record</span>` : '<span class="pill sp">No feed</span>');
  const list = !ok ? '<p class="mut" style="padding-top: 14px">No feed: the dashboard cards could not be read.</p>'
    : rows.length ? rows.map(rowHtml).join('\n') : '<p class="mut" style="padding-top: 14px">No open @JonMacAI video cards.</p>';
  return `${head}
<section class="card" style="gap: 0">
<div class="hd cardhd"><span class="chip">${icon('list')}</span><h2>Scripts</h2><span class="mut sp">${ok ? `${rows.length} open, newest first` : ''}</span></div>
${list}
</section>`;
}
