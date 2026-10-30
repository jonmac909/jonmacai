import { esc, botName, linkLabel } from '../ui.js';
import { goalCard, needItem, summaryCard } from './today.js';

// Projects (2026-10-29): the project list, the chosen project's goal cards and board, and its
// daily checklist. Questions and approvals use Today's cards and buttons.

// The deliverable of a Review or Done card (also in its modal): a web link opens in a new tab;
// a file path on GPU1 is plain text, never a link. A review-site video opens in the dashboard's own
// Review page (same sign-in, no passcode), where Approve and Send back also move this card.
const REVIEW_LINK = /^https:\/\/jonmac\.ai\/(?:dashboard\/)?review\/([a-z0-9-]+)\/?(?:[?#].*)?$/i;
export function deliverableLink(d, cls = '') {
  if (!d?.link) return '';
  const review = REVIEW_LINK.exec(d.link);
  if (review) return `<a class="pjdeliv${cls ? ` ${cls}` : ''}" href="/dashboard/review/${esc(review[1].toLowerCase())}" target="_blank" rel="noopener">Open review</a>`;
  return /^https?:\/\//i.test(d.link)
    ? `<a class="pjdeliv${cls ? ` ${cls}` : ''}" href="${esc(d.link)}" target="_blank" rel="noopener">${esc(linkLabel(d.link, d.kind))}</a>`
    : `<span class="pjdeliv">Local file: ${esc(String(d.link).split(/[\\/]/).pop())}</span>`;
}

// Approve finalises a Review card, so it asks first (data-confirm).
export const approveButton = (url, title) =>
  `<button type="button" class="btn" data-ttick="${esc(url)}" data-confirm="${esc(`Approve "${title}"? It moves to Done.`)}">Approve</button>`;

// Every board card opens in the card modal (modals.js) on click, Enter or Space; so does Send back.
function card(it, col) {
  const open = ` tabindex="0" data-open="${esc(it.id)}"`;
  if (it.kind !== 'task') return needItem(it, open);
  const deliv = col === 'review' || col === 'done' ? deliverableLink(it.deliverable) : '';
  const proof = !deliv && /^https?:\/\//i.test(it.proof || '') ? `<a class="pjlink" href="${esc(it.proof)}" target="_blank" rel="noopener">Proof</a>` : '';
  const done = it.tickUrl ? `<div class="qopts"><button type="button" class="btn" data-ttick="${esc(it.tickUrl)}">Done</button></div>` : '';
  const review = it.reviewUrl ? `<div class="qopts">${approveButton(it.reviewUrl, it.title)}
    <button type="button" class="btn line" data-sendback="${esc(it.id)}">Send back</button></div>` : '';
  const close = col === 'done' ? '' : `<button type="button" class="pjx" data-tclose="/dashboard/api/v1/tasks/${esc(it.id)}" data-title="${esc(it.title)}" aria-label="${esc(`Close "${it.title}"`)}" title="Close card">×</button>`;
  return `<li class="pjcard"${open}>${close}<span class="pjt">${esc(it.title)}</span>${deliv}
    <span class="pjm"><span class="jttag">${esc(botName(it.from))}</span>${it.ageLabel ? `<i>·</i><span>${esc(it.ageLabel)}</span>` : ''}${proof}</span>${done}${review}</li>`;
}

function column(c) {
  const body = c.items.length ? `<ul class="pjcards">${c.items.map((it) => card(it, c.key)).join('')}</ul>` : '<p class="pjempty">Nothing here</p>';
  return `<section class="pjcol pjcol-${esc(c.key)}"><h3>${esc(c.label)}<span class="n">${c.items.length}</span></h3>${body}</section>`;
}

// Read-only for Jon: the project's bot ticks an item with dash.py daily-done. A ticked item shows who
// and when, and opens its proof when that is a web link; a file path shows as text.
function dailyItem(it) {
  const web = /^https?:\/\//i.test(it.link || '');
  const name = web ? `<a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.text)}</a>` : esc(it.text);
  const file = !web && it.link ? `<i>·</i>Local file: ${esc(String(it.link).split(/[\\/]/).pop())}` : '';
  const meta = it.done ? `<span class="pjm">${esc(botName(it.by))}<i>·</i>${esc(it.ageLabel)}${file}</span>` : '';
  return `<li><label class="pjci"><input type="checkbox" disabled${it.done ? ' checked' : ''}><span>${name}${meta}</span></label></li>`;
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
