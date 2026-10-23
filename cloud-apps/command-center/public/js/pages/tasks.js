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

function deliverableRow(r) {
  const meta = [r.typeLabel, r.owner, r.finished].filter(Boolean)
    .map((x) => `<span>${esc(x)}</span>`).join('<i>·</i>');
  const action = r.approved
    ? `<span class="dlvok">Approved by ${esc(r.approvedBy || 'Jon')}${r.approvedWhen ? ` · ${esc(r.approvedWhen)}` : ''}</span>`
    : `<button type="button" class="btn dlvbtn" data-approve="${esc(r.id)}" aria-label="Approve ${esc(r.title)}">Approve</button>`;
  const open = r.url ? ` data-href="${esc(r.url)}" role="link" tabindex="0"` : '';
  return `<li class="jtrow dlv${r.approved ? ' isapproved' : ''}${r.url ? ' islink' : ''}"${open}>
    <span class="jtbody"><span class="jtt">${esc(r.title)}</span><span class="jtm">${meta}</span></span>${action}</li>`;
}

// Daily checklist: three rows that reset each Pacific day. Count against target,
// the items with their links, and one Approve button per row.
function dailyItem(it) {
  const label = esc(it.title || it.url);
  const link = it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${label}</a>` : label;
  return `<li>${link}${it.text ? `<span class="dailytext">${esc(it.text)}</span>` : ''}</li>`;
}

function dailyRow(r) {
  const action = r.approved
    ? `<span class="dlvok">Approved by ${esc(r.approvedBy || 'Jon')}${r.approvedWhen ? ` · ${esc(r.approvedWhen)}` : ''}</span>`
    : `<button type="button" class="btn dlvbtn" data-approve="${esc(r.id)}"${r.count ? '' : ' disabled'} aria-label="Approve ${esc(r.label)}">Approve</button>`;
  const items = r.items.length ? `<ol class="dailyitems">${r.items.map(dailyItem).join('')}</ol>` : '<span class="dailyempty">Nothing delivered yet today</span>';
  return `<li class="jtrow dlv daily${r.approved ? ' isapproved' : ''}${r.met ? ' met' : ''}">
    <span class="jtbox" aria-hidden="true">${r.met ? '<svg class="ic"><use href="#i-check"/></svg>' : ''}</span>
    <span class="jtbody"><span class="jtt">${esc(r.label)} <span class="dailycount">${r.count} / ${r.target}</span></span>
    <span class="jtm"><span>${esc(r.hint)}</span></span>${items}</span>${action}</li>`;
}

function dailyPanel(daily) {
  if (!daily || !daily.rows || !daily.rows.length) return '';
  const note = daily.stale ? '<p class="dailynote">Today&#39;s list has not been pushed yet.</p>' : '';
  return `<h2 class="jtprojh">Today</h2>${note}<ul class="jtlist">${daily.rows.map(dailyRow).join('')}</ul>`;
}

function deliverablesPanel(dl, daily) {
  const pending = dl && dl.pending ? dl.pending : [];
  const approved = dl && dl.approved ? dl.approved : [];
  const today = dailyPanel(daily);
  if (!pending.length && !approved.length) {
    if (dl && dl.error) return `${today}<p class="jtnone">Deliverables unavailable: ${esc(dl.error || dl.debug)}</p>`;
    return `${today}<p class="jtnone">Nothing waiting on your approval.</p>`;
  }
  const list = pending.length
    ? `<ul class="jtlist">${pending.map(deliverableRow).join('')}</ul>`
    : '<p class="jtnone">Nothing waiting on you.</p>';
  const done = approved.length
    ? `<details class="jtdone"><summary>Approved ${approved.length}</summary><ul class="jtlist">${approved.map(deliverableRow).join('')}</ul></details>`
    : '';
  return `${today}${today ? '<h2 class="jtprojh dailyother">Other deliverables</h2>' : ''}${list}${done}`;
}

function taskBoard(t) {
  if ((!t || !t.available) && !(t && t.daily && t.daily.rows)) {
    return '<div class="card pad jtcard"><p class="muted">No tasks yet. Ana keeps the list and pushes it here.</p></div>';
  }
  let tab = 'active';
  try {
    const saved = localStorage.getItem('cc-jt-tab');
    if (saved === 'next' || saved === 'deliverables') tab = saved;
  } catch {}
  const dl = { ...(t.deliverables || { pending: [], approved: [], pendingCount: 0, approvedCount: 0 }), error: t.deliverablesError || '' };
  const projects = t.projects || [];
  const active = `<div data-jtpanel="active"${tab === 'active' ? '' : ' hidden'}>${projects.map((p) => projectSection(p, 'active')).join('') || '<p class="jtnone">Nothing active.</p>'}</div>`;
  const next = `<div data-jtpanel="next"${tab === 'next' ? '' : ' hidden'}>${projects.map((p) => projectSection(p, 'next')).join('') || '<p class="jtnone">Nothing queued.</p>'}</div>`;
  const pendingBadge = dl.pendingCount ? `<span class="jtcount">${dl.pendingCount}</span>` : '';
  const deliverables = `<div data-jtpanel="deliverables"${tab === 'deliverables' ? '' : ' hidden'}>${deliverablesPanel(dl, t.daily)}</div>`;
  return `<section class="card pad jtcard" aria-label="Jon's tasks">
    <div class="jttabs" role="tablist">
      <button type="button" class="jttab${tab === 'active' ? ' on' : ''}" data-jtab="active" role="tab" aria-selected="${tab === 'active'}">Active</button>
      <button type="button" class="jttab${tab === 'next' ? ' on' : ''}" data-jtab="next" role="tab" aria-selected="${tab === 'next'}">Up next</button>
      <button type="button" class="jttab${tab === 'deliverables' ? ' on' : ''}" data-jtab="deliverables" role="tab" aria-selected="${tab === 'deliverables'}">Deliverables${pendingBadge}</button>
    </div>
    <p class="jtmeta"><button type="button" class="jtneed" data-jneeds data-needs="${Number(t.needsYou) || 0}" aria-pressed="false">Needs you ${Number(t.needsYou) || 0}</button><span>${t.updatedLabel ? `Updated ${esc(t.updatedLabel)}` : 'Not updated yet'}</span></p>
    ${active}${next}${deliverables}
  </section>`;
}

export function render(d) {
  const page = d || {};
  const tasks = page.tasks || {};
  // The snapshot puts the Deliverables tab beside `tasks` on the page object,
  // not inside it; accept either shape.
  const board = {
    ...tasks,
    deliverables: page.deliverables || tasks.deliverables,
    deliverablesError: page.deliverablesError || tasks.deliverablesError,
    daily: page.daily || tasks.daily,
  };
  return `<div class="wrap">
  <div class="head"><div><h1>${esc(page.title || 'Tasks')}</h1><p>${esc(page.sub || '')}</p></div></div>
  ${taskBoard(board)}
</div>`;
}
