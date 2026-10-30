import { esc } from '../ui.js';
import { goalCard, needItem, summaryCard } from './today.js';

// Projects (2026-10-29): the project list, the chosen project's goal cards and board, and one
// Today checklist (Jon, then each bot). Questions and approvals use Today's cards and buttons.
// Every board card opens in the card modal (modals.js) on click, Enter or Space.
function card(it) {
  const open = ` tabindex="0" data-open="${esc(it.id)}"`;
  if (it.kind !== 'task') return needItem(it, open);
  const proof = /^https?:\/\//i.test(it.proof || '') ? `<a class="pjlink" href="${esc(it.proof)}" target="_blank" rel="noopener">Proof</a>` : '';
  const done = it.tickUrl ? `<div class="qopts"><button type="button" class="btn" data-ttick="${esc(it.tickUrl)}">Done</button></div>` : '';
  return `<li class="pjcard"${open}><span class="pjt">${esc(it.title)}</span>
    <span class="pjm"><span class="jttag">${esc(it.from)}</span>${it.ageLabel ? `<i>·</i><span>${esc(it.ageLabel)}</span>` : ''}${proof}</span>${done}</li>`;
}

function column(c) {
  const body = c.items.length ? `<ul class="pjcards">${c.items.map(card).join('')}</ul>` : '<p class="pjempty">Nothing here</p>';
  return `<section class="pjcol pjcol-${esc(c.key)}"><h3>${esc(c.label)}<span class="n">${c.items.length}</span></h3>${body}</section>`;
}

// Only Jon's open tasks have a live box (the tick). Team tasks tick themselves when their bot moves
// them to done; questions and approvals stay unticked until answered, then leave the list.
function checkItem(it) {
  const what = `<span class="jttag">${esc(it.project)}</span> `;
  const box = it.tickUrl ? `<input type="checkbox" data-ttick="${esc(it.tickUrl)}">`
    : `<input type="checkbox" disabled${it.done ? ' checked' : ''}${it.card ? ` aria-label="${esc(it.title)}"` : ''}>`;
  const body = it.card
    ? `<span class="pjci">${box} ${what}<button type="button" class="jtneed" data-page="${esc(it.page)}" data-card="${esc(it.card)}">${esc(it.title)}</button></span>`
    : `<label class="pjci">${box} ${what}${esc(it.title)}</label>`;
  return `<li>${body}<span class="pjest">${esc(it.minutes)} min</span></li>`;
}

function todayCard(t) {
  const list = t.groups.map((g) => `<h3 class="pjgrp">${esc(g.label)}<span class="n">${g.done}/${g.total}</span></h3>
    <ul class="pjtodo">${g.items.map(checkItem).join('')}</ul>`).join('') || '<p class="muted">Nothing on the list today.</p>';
  return `<div class="card pad"><div class="cardhead"><h2>Today</h2><span class="meta">Jon: ${esc(t.total)}</span></div>${list}</div>`;
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
    <div class="pjright todayside">${todayCard(d.today)}${summaryCard(d.summary)}${calendarCard(d.calendar)}</div>
  </div>
</div>`;
}
