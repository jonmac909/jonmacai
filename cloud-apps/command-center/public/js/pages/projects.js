import { esc } from '../ui.js';

// Projects page (2026-10-24): a project picker with progress bars, one Kanban board per
// project, and today's checklist in a right sidebar. Data comes from tasks.json and
// deliverables-today.json only; the page never writes anything back.
const DONE_SHOWN = 6;

function card(c, colKey) {
  const proof = c.link
    ? `<a class="pjlink" href="${esc(c.link)}" target="_blank" rel="noopener">${colKey === 'review' ? 'Review' : 'Proof'}</a>`
    : '';
  const meta = [c.owner ? `<span class="jttag">${esc(c.owner)}</span>` : '', c.age ? `<span title="${esc(c.askedLabel)}">${esc(c.age)}</span>` : '']
    .filter(Boolean).join('<i>·</i>');
  return `<li class="pjcard${c.needs ? ' needs' : ''}">
    <span class="pjt">${esc(c.task)}</span>
    ${c.note ? `<span class="pjnote">${esc(c.note)}</span>` : ''}
    <span class="pjm">${meta}${proof}</span>
  </li>`;
}

function column(col) {
  const first = col.key === 'done' ? col.cards.slice(0, DONE_SHOWN) : col.cards;
  const rest = col.key === 'done' ? col.cards.slice(DONE_SHOWN) : [];
  const more = rest.length
    ? `<details class="pjmore"><summary>Show ${rest.length} more</summary><ul class="pjcards">${rest.map((c) => card(c, col.key)).join('')}</ul></details>`
    : '';
  const body = col.cards.length
    ? `<ul class="pjcards">${first.map((c) => card(c, col.key)).join('')}</ul>${more}`
    : '<p class="pjempty">Nothing here</p>';
  return `<section class="pjcol pjcol-${esc(col.key)}"><h3>${esc(col.label)}<span class="n">${col.count}</span></h3>${body}</section>`;
}

function bar(p) {
  return `<span class="pjbar" role="img" aria-label="${p.done} of ${p.total} done"><i style="width:${p.pct}%"></i></span>`;
}

function picker(projects, sel) {
  return `<div class="pjpick" role="tablist" aria-label="Projects">${projects.map((p, i) => `
    <button type="button" class="pjtab${i === sel ? ' on' : ''}" role="tab" aria-selected="${i === sel}" data-proj="${i}">
      <span class="pjtn">${esc(p.name)}</span><span class="pjtc">${p.done} / ${p.total} done</span>${bar(p)}
    </button>`).join('')}</div>`;
}

function boards(projects, sel) {
  return projects.map((p, i) => `<div class="pjboard" data-pjpanel="${i}"${i === sel ? '' : ' hidden'}>
    <div class="pjhead"><h2>${esc(p.name)}</h2><span class="pjsum">${p.done} of ${p.total} done${p.needsYou ? ` · ${p.needsYou} need${p.needsYou === 1 ? 's' : ''} you` : ''}</span></div>
    <div class="pjkan">${p.columns.map(column).join('')}</div>
  </div>`).join('');
}

function checkItem(it) {
  const label = it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title);
  return `<li class="${it.done ? 'done' : ''}"><span class="jtbox" aria-hidden="true">${it.done ? '<svg class="ic"><use href="#i-check"/></svg>' : ''}</span><span class="pjci">${label}</span></li>`;
}

function checklist(c) {
  if (!c || !c.groups || !c.groups.length) return '';
  const pct = c.total ? Math.round(c.done / c.total * 100) : 0;
  const note = c.stale ? '<p class="dailynote">Today&#39;s list has not been pushed yet.</p>' : '';
  const groups = c.groups.map((g) => `<h4 class="pjgh">${esc(g.label)}<span>${Math.min(g.done, g.target)} / ${g.target}</span></h4><ul class="pjchecks">${g.items.map(checkItem).join('')}</ul>`).join('');
  return `<aside class="pjside card pad" aria-label="Daily checklist">
    <div class="pjhead"><h2>Today</h2><span class="pjsum">${c.done} of ${c.total}</span></div>
    <span class="pjbar big" role="img" aria-label="${c.done} of ${c.total} done today"><i style="width:${pct}%"></i></span>
    ${note}${groups}
  </aside>`;
}

export function render(d) {
  const page = d || {};
  const board = page.board || {};
  const projects = board.projects || [];
  let sel = 0;
  try {
    const saved = localStorage.getItem('cc-pj');
    const at = projects.findIndex((p) => p.name === saved);
    if (at >= 0) sel = at;
  } catch {}
  const main = projects.length
    ? `${picker(projects, sel)}${boards(projects, sel)}`
    : '<div class="card pad"><p class="muted">No tasks yet. Ana keeps the list and pushes it here.</p></div>';
  return `<div class="wrap">
  <div class="head"><div><h1>${esc(page.title || 'Projects')}</h1><p>${board.updatedLabel ? `Updated ${esc(board.updatedLabel)}` : esc(page.sub || '')}</p></div></div>
  <div class="pjlayout"><div class="pjmain">${main}</div>${checklist(page.checklist)}</div>
</div>`;
}
