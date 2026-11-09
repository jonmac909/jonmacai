import { esc, pill } from '/dashboard/js/ui.js';
import { top } from './month.js';

// Pending: every card marked as Jon's ask, Done / In progress / Blocked. View only (docs/dashboard-2-pending.md).
// A row opens its card; nothing here changes one.
const GROUPS = [
  ['done', 'Done', 'Nothing done yet.'],
  ['progress', 'In progress', 'Nothing in progress.'],
  ['blocked', 'Blocked', 'Nothing is blocked.'],
];

function row(r, done) {
  const needs = r.needs ? `<div class="d2note"><b>Needs from ${esc(r.from === 'You' ? 'you' : r.from)}:</b> ${esc(r.needs)}</div>` : '';
  return `<li tabindex="0" data-open="${esc(r.id)}">
    <div class="d2t"><span class="d2mark ${done ? 'ok' : ''}" aria-label="${done ? 'Done' : 'Not done'}">${done ? '✓' : '○'}</span><b>${esc(r.title)}</b>${pill(r.status.text, r.status.cls === 'idle' ? '' : r.status.cls)}</div>
    ${needs}
    <div class="d2meta"><span>${esc(r.owner)}</span><span>${esc(r.due.label)}${r.due.late ? ` ${pill('Late', 'crit')}` : ''}</span><span>${esc(r.updated.label)}</span></div>
  </li>`;
}

export function render(data) {
  const p = data?.pending;
  if (!p) return `<div class="wrap">${top('Pending', '', data?.d2)}<section class="card pad"><p class="muted">Jon's requests could not be read just now. This page tries again every minute.</p></section></div>`;
  const sections = GROUPS.map(([key, title, empty]) => {
    const list = p[key] || [];
    return `<section class="card pad">
      <div class="cardhead"><h2>${esc(title)}</h2><span class="meta">${list.length}</span></div>
      ${list.length ? `<ul class="d2list">${list.map((r) => row(r, key === 'done')).join('')}</ul>` : `<p class="muted">${esc(empty)}</p>`}
    </section>`;
  }).join('');
  return `<div class="wrap">
  ${top('Pending', `Everything you asked for · ${(p.done?.length || 0)} done of ${(p.done?.length || 0) + (p.progress?.length || 0) + (p.blocked?.length || 0)}`, data.d2)}
  ${sections}
</div>`;
}
