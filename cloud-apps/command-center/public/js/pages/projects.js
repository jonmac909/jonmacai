import { esc } from '../ui.js';
import { goalCard, needItem, summaryCard } from './today.js';

// Projects (2026-10-29): the project list, the chosen project's goal cards and board, and its
// daily checklist. Questions and approvals use Today's cards and buttons.
function card(it) {
  if (it.kind !== 'task') return needItem(it);
  const proof = /^https?:\/\//i.test(it.proof || '') ? `<a class="pjlink" href="${esc(it.proof)}" target="_blank" rel="noopener">Proof</a>` : '';
  const done = it.tickUrl ? `<div class="qopts"><button type="button" class="btn" data-ttick="${esc(it.tickUrl)}">Done</button></div>` : '';
  return `<li class="pjcard"><span class="pjt">${esc(it.title)}</span>
    <span class="pjm"><span class="jttag">${esc(it.from)}</span>${it.ageLabel ? `<i>·</i><span>${esc(it.ageLabel)}</span>` : ''}${proof}</span>${done}</li>`;
}

function column(c) {
  const body = c.items.length ? `<ul class="pjcards">${c.items.map(card).join('')}</ul>` : '<p class="pjempty">Nothing here</p>';
  return `<section class="pjcol pjcol-${esc(c.key)}"><h3>${esc(c.label)}<span class="n">${c.items.length}</span></h3>${body}</section>`;
}

// Read-only for Jon: the project's bot ticks an item with dash.py daily-done. A ticked item shows who
// and when, and opens its proof when that is a web link; a file path shows as text.
function dailyItem(it) {
  const web = /^https?:\/\//i.test(it.link || '');
  const name = web ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.text)}</a>` : esc(it.text);
  const meta = it.done ? `<span class="pjm">${esc(it.by)}<i>·</i>${esc(it.ageLabel)}${web ? '' : `<i>·</i>${esc(it.link)}`}</span>` : '';
  return `<li><label class="pjci"><input type="checkbox" disabled${it.done ? ' checked' : ''}> ${name}${meta}</label></li>`;
}

function checklistCard(c) {
  if (!c) return '';
  const body = c.missing ? `<p class="muted">${esc(c.missing)}</p>` : `<ul class="pjtodo">${c.items.map(dailyItem).join('')}</ul>`;
  return `<div class="card pad"><div class="cardhead"><h2>Daily checklist</h2>${c.missing ? '' : `<span class="meta">${c.done}/${c.total}</span>`}</div>${body}</div>`;
}

function calendarCard(c) {
  const body = c.missing ? `<p class="muted">${esc(c.missing)}</p>`
    : c.events.length ? `<ul class="pjtodo">${c.events.map((e) => `<li><b class="pjest">${esc(e.time)}</b><span class="pjci">${esc(e.title)}</span></li>`).join('')}</ul>`
      : '<p class="muted">Nothing on the calendar today.</p>';
  return `<div class="card pad"><div class="cardhead"><h2>Today's calendar</h2></div>${body}</div>`;
}

export function render(d, _data, sub) {
  const all = d?.projects || [];
  if (!all.length) return '<div class="wrap"><div class="card pad"><p class="muted">Projects has no data yet.</p></div></div>';
  const p = all.find((x) => x.slug === sub) || all[0];
  const list = all.map((x) => `<button type="button" class="chip${x === p ? ' on' : ''}" data-page="projects/${esc(x.slug)}"${x === p ? ' aria-current="page"' : ''}>
    ${esc(x.label)}${x.waiting ? `<span class="pjn" title="Waiting on Jon">${x.waiting}</span>` : ''}</button>`).join('');
  return `<div class="wrap">
  <div class="head"><div><h1>Projects</h1><p>${esc(p.label)}</p></div></div>
  <div class="pjpage">
    <nav class="chips pjlist" aria-label="Projects">${list}</nav>
    <div class="pjmain">
      ${p.goals.length ? `<div class="goals">${p.goals.map(goalCard).join('')}</div>` : ''}
      <div class="card pad"><div class="cardhead"><h2>Board</h2>${d.available ? '' : '<span class="meta">The bot tables could not be read.</span>'}</div>
        <div class="pjkan">${p.columns.map(column).join('')}</div></div>
    </div>
    <div class="pjright todayside">${checklistCard(p.checklist)}${summaryCard(d.summary)}${calendarCard(d.calendar)}</div>
  </div>
</div>`;
}
