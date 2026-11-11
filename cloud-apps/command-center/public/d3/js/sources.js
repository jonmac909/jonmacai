// Dashboard 3 System page: the Sources list. Pure function over the /dashboard/api/d3 answer (d3.sources, built in src/d3.js).
import { esc, icon } from './util.js';
import { headerOnly } from './goals.js';

function rowHtml(s, i) {
  return `<div class="scrow${i === 0 ? ' first' : ''}" data-source="${esc(s.name)}">
<span class="stack" style="min-width: 0"><b class="ell" title="${esc(s.label)}">${esc(s.label)}</b><span class="mut">${esc([s.kind, s.owner].filter(Boolean).join(' - '))}</span></span>
<span><span class="pill ${s.stale ? 'warn' : 'ok'}">${s.stale ? 'Stale' : 'Fresh'}</span></span>
<span class="mut" style="text-align: right">${esc(s.ageLabel)}</span>
</div>`;
}

export function renderSources(d2resp, d3resp) {
  const rows = d3resp?.d3?.sources;
  const ok = Array.isArray(rows);
  const stale = ok ? rows.filter((s) => s.stale).length : null;
  const head = headerOnly(d2resp, 'System', 'Where the dashboard numbers come from',
    ok ? `<span class="pill ${stale ? 'warn' : 'ok'} sp">${stale} stale</span>` : '<span class="pill sp">No feed</span>');
  const list = !ok ? '<p class="mut" style="padding-top: 14px">No feed: the sources could not be read.</p>'
    : rows.length ? rows.map(rowHtml).join('\n') : '<p class="mut" style="padding-top: 14px">Nothing has reported yet.</p>';
  return `${head}
<section class="card" style="gap: 0">
<div class="hd cardhd"><span class="chip">${icon('list')}</span><h2>Sources</h2><span class="mut sp">${ok ? `${rows.length} listed, stale first` : ''}</span></div>
${list}
</section>`;
}
