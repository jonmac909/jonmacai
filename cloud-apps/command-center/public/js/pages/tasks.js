import { esc } from '../ui.js';

// Jon's Tasks page (DESIGN.md, 2026-10-22): Active and Up next tabs, grouped by
// project. Each project header carries its count; within a section rows run
// Needs you, In progress, Blocked, To do, with Done collapsed at the bottom.
function taskItem(t) {
  const tick = t.done ? '<svg class="ic"><use href="#i-check"/></svg>' : '';
  const stat = t.statusLabel ? `<span class="jtstat ${esc(t.tone || 'idle')}">${esc(t.statusLabel)}</span>` : '';
  const note = t.note ? `<span class="jtnote">${esc(t.note)}</span>` : '';
  const second = stat || note ? `<span class="jts">${stat}${stat && note ? '<i>·</i>' : ''}${note}</span>` : '';
  const meta = [t.ownerTag ? `<span class="jttag">${esc(t.ownerTag)}</span>` : '', t.asked ? `<span>${esc(t.asked)}</span>` : ''].filter(Boolean).join('<i>·</i>');
  const cls = `jtrow${t.done ? ' isdone' : ''}${t.link ? ' islink' : ''}${t.needs ? ' needs' : ''}`;
  const open = t.link ? ` data-href="${esc(t.link)}" role="link" tabindex="0"` : '';
  return `<li class="${cls}"${open}><span class="jtbox" aria-hidden="true">${tick}</span><span class="jtbody"><span class="jtt">${esc(t.task)}</span>${second}${meta ? `<span class="jtm">${meta}</span>` : ''}</span></li>`;
}

function taskList(list, empty) {
  if (!list || !list.length) return empty ? `<p class="jtnone">${esc(empty)}</p>` : '';
  return `<ul class="jtlist">${list.map(taskItem).join('')}</ul>`;
}

function projectSection(p, tab) {
  const rows = tab === 'active' ? p.active : p.upNext;
  const doneCount = tab === 'active' ? p.doneCount : 0;
  if (!rows.length && !doneCount) return '';
  const count = rows.length ? `<span class="n">${rows.length}</span>` : '';
  const needsCount = p.needsYou ? `<span class="n needsn">${p.needsYou}</span>` : '';
  const done = doneCount
    ? `<details class="jtdone"><summary>Done ${doneCount}</summary>${taskList(p.done, '')}</details>`
    : '';
  return `<section class="jtproj${p.needsYou ? ' has-needs' : ''}">
    <h2 class="jtprojh">${esc(p.name)}${count}${needsCount}</h2>
    ${taskList(rows, '')}${done}
  </section>`;
}

function taskBoard(t) {
  if (!t || !t.available) {
    return '<div class="card pad jtcard"><p class="muted">No tasks yet. Ana keeps the list and pushes it here.</p></div>';
  }
  let tab = 'active';
  try { if (localStorage.getItem('cc-jt-tab') === 'next') tab = 'next'; } catch {}
  const projects = t.projects || [];
  const active = `<div data-jtpanel="active"${tab === 'active' ? '' : ' hidden'}>${projects.map((p) => projectSection(p, 'active')).join('') || '<p class="jtnone">Nothing active.</p>'}</div>`;
  const next = `<div data-jtpanel="next"${tab === 'next' ? '' : ' hidden'}>${projects.map((p) => projectSection(p, 'next')).join('') || '<p class="jtnone">Nothing queued.</p>'}</div>`;
  return `<section class="card pad jtcard" aria-label="Jon's tasks">
    <div class="jttabs" role="tablist">
      <button type="button" class="jttab${tab === 'active' ? ' on' : ''}" data-jtab="active" role="tab" aria-selected="${tab === 'active'}">Active</button>
      <button type="button" class="jttab${tab === 'next' ? ' on' : ''}" data-jtab="next" role="tab" aria-selected="${tab === 'next'}">Up next</button>
    </div>
    <p class="jtmeta"><button type="button" class="jtneed" data-jneeds data-needs="${Number(t.needsYou) || 0}" aria-pressed="false">Needs you ${Number(t.needsYou) || 0}</button><span>${t.updatedLabel ? `Updated ${esc(t.updatedLabel)}` : 'Not updated yet'}</span></p>
    ${active}${next}
  </section>`;
}

export function render(d) {
  const page = d || {};
  return `<div class="wrap">
  <div class="head"><div><h1>${esc(page.title || 'Tasks')}</h1><p>${esc(page.sub || '')}</p></div></div>
  ${taskBoard(page.tasks)}
</div>`;
}
