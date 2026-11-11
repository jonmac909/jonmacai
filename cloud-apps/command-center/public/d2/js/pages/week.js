import { esc } from '/dashboard/js/ui.js';
import { age, bar, fmt, status, top, value } from './month.js';

// Mon to Sun cells, today outlined. `cell(day, i)` gives [class, text, tooltip] for each day.
function dayRow(days, cell) {
  return `<ol class="d2days">${days.map((d, i) => {
    const [cls, text, tip] = cell(d, i);
    return `<li class="${cls}${d.isToday ? ' today' : ''}"${tip ? ` title="${esc(tip)}"` : ''}><small>${esc(d.label)}</small><b>${esc(text)}</b></li>`;
  }).join('')}</ol>`;
}

function metricDays(x, days) {
  if (!x.days?.length) return '';
  const by = new Map(x.days.map((d) => [d.ymd, d]));
  return dayRow(days, (d) => {
    const v = by.get(d.ymd);
    if (v?.actual == null) return ['', '', ''];
    const text = v.target == null ? fmt(x.unit, v.actual) : `${fmt(x.unit, v.actual)}/${fmt(x.unit, v.target)}`;
    const cls = v.target == null ? '' : v.actual >= v.target ? 'ok' : d.isPast ? 'miss' : '';
    return [cls, text, `${d.label}: ${text}`];
  });
}

const rowsList = (rows) => (rows?.length ? `<ul class="d2ch">${rows.map((r) => `<li><span>${esc(r.label)}</span><b>${esc(r.display)}</b>${status(r.status)}<span class="muted">${esc(r.owner || '')}${r.note ? ` · ${esc(r.note)}` : ''}</span></li>`).join('')}</ul>` : '');

// Behind lines name the owner; one with a task opens its card, one with a web link opens that, one with a page
// (a channel's Calendar tab) opens it in this dashboard.
function behindList(list) {
  if (!list?.length) return '';
  return `<ul class="d2behind">${list.map((b) => {
    const open = b.open ? ` tabindex="0" data-open="${esc(b.open)}"` : '';
    const link = /^https?:\/\//i.test(b.href || '') ? ` <a href="${esc(b.href)}" target="_blank" rel="noopener">${esc(b.linkLabel || 'Open')}</a>`
      : b.page ? ` <a href="#${esc(b.page)}" data-page="${esc(b.page)}">Open</a>` : '';
    return `<li${open}><b>Behind:</b> ${esc(b.title)} <span class="muted">· ${esc(b.owner)}${b.why ? ` · ${esc(b.why)}` : ''}</span>${link}</li>`;
  }).join('')}</ul>`;
}

// Small facts under a metric (last check date, published today, waiting for review), each with its links.
const factsList = (facts) => (facts?.length ? `<ul class="d2ch d2facts">${facts.map((f) => `<li><span>${esc(f.label)}</span><b>${esc(f.value)}</b>${(f.links || []).filter((l) => /^https?:\/\//i.test(l.href || '')).map((l) => ` <a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</li>`).join('')}</ul>` : '');

function metric(x, days) {
  const target = x.target == null || x.actual == null || x.unit === 'yesno' || / of /.test(x.display) ? '' : ` <span class="muted">target ${esc(fmt(x.unit, x.target))}</span>`;
  return `<div class="d2metric">
    <div class="d2t"><b>${esc(x.label)}</b>${status(x.status)}<span class="muted">${esc(x.owner || '')}</span></div>
    <div class="d2v">${value(x)}${target}</div>
    ${bar(x)}${metricDays(x, days)}${factsList(x.facts)}${rowsList(x.rows)}${behindList(x.behind)}
    <div class="d2meta">${age(x.source)}</div>
  </div>`;
}

function goalCard(g, days) {
  const parked = g.parked?.length
    ? `<ul class="d2ch parked">${g.parked.map((c) => `<li><span>${esc(c.label)}</span><span class="muted">parked, no target</span></li>`).join('')}</ul>` : '';
  return `<section class="card pad">
    <div class="cardhead"><h2>${esc(g.title)}</h2><span class="meta">${esc((g.team?.length ? g.team : [g.owner]).join(', '))}</span></div>
    ${(g.week || []).map((x) => metric(x, days)).join('') || '<p class="muted">No weekly target.</p>'}${parked}
  </section>`;
}

export function render(data) {
  const d2 = data?.d2 || {};
  const w = d2.period?.week || {};
  const days = w.days || [];
  return `<div class="wrap">
  ${top('Week', w.label || '')}
  ${(d2.goals || []).map((g) => goalCard(g, days)).join('')}
</div>`;
}
