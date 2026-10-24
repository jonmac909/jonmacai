import { esc } from '../ui.js';

// YouTube page (2026-10-24): one Kanban board per channel from youtube.json. Read-only links:
// the review page for approving a video and YouTube Studio for scheduling it. Nothing is
// published or changed from here.
function link(url, label, cls) {
  return `<a class="pjlink ytl${cls ? ` ${cls}` : ''}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`;
}

function card(c, col) {
  const links = [
    c.reviewUrl ? link(c.reviewUrl, col === 'review' ? 'Review & approve' : 'Review page') : '',
    c.studioUrl ? link(c.studioUrl, 'Open in Studio') : (col === 'draft' || col === 'live' ? '<span class="ytnone">No Studio link yet</span>' : ''),
  ].filter(Boolean).join('');
  const meta = [c.version ? `<span class="jttag">${esc(c.version)}</span>` : '', c.updatedLabel ? `<span title="${esc(c.updated)}">${esc(c.updatedLabel)}</span>` : '']
    .filter(Boolean).join('<i>·</i>');
  return `<li class="pjcard${c.blocker ? ' ytblocked' : ''}">
    <span class="pjt">${esc(c.title)}</span>
    ${c.blocker ? `<span class="ytblock">Blocked: ${esc(c.blocker)}</span>` : ''}
    ${c.note ? `<span class="pjnote">${esc(c.note)}</span>` : ''}
    <span class="pjm">${meta}</span>
    ${links ? `<span class="ytlinks">${links}</span>` : ''}
  </li>`;
}

function column(col) {
  const body = col.cards.length
    ? `<ul class="pjcards">${col.cards.map((c) => card(c, col.key)).join('')}</ul>`
    : '<p class="pjempty">Nothing here</p>';
  return `<section class="pjcol ytcol-${esc(col.key)}"><h3>${esc(col.label)}<span class="n">${col.count}</span></h3>${body}</section>`;
}

function lane(ch, studioHome) {
  const studio = ch.studioUrl || studioHome;
  const sum = ch.total ? `${ch.total} video${ch.total === 1 ? '' : 's'}${ch.blocked ? ` · ${ch.blocked} blocked` : ''}` : 'No video yet';
  return `<section class="ytlane card pad" id="yt-${esc(ch.id)}">
    <div class="pjhead"><h2>${esc(ch.name)}</h2><span class="pjsum">${esc(ch.groupLabel)} · ${esc(sum)}</span>${link(studio, ch.studioUrl ? 'Channel in Studio' : 'Open Studio')}</div>
    ${ch.note ? `<p class="dailynote">${esc(ch.note)}</p>` : ''}
    <div class="pjkan ytkan">${ch.columns.map(column).join('')}</div>
  </section>`;
}

export function render(d) {
  const page = d || {};
  const board = page.board || {};
  const channels = board.channels || [];
  const main = channels.length
    ? `<nav class="ytjump" aria-label="Channels">${channels.map((c) => `<a href="#yt-${esc(c.id)}" data-ytjump="${esc(c.id)}">${esc(c.name)}${c.blocked ? '<b aria-label="blocked"></b>' : ''}</a>`).join('')}</nav>
       ${channels.map((c) => lane(c, board.studioHome)).join('')}`
    : '<div class="card pad"><p class="muted">No channel data yet. Ana pushes youtube.json with the tasks.</p></div>';
  return `<div class="wrap">
  <div class="head"><div><h1>${esc(page.title || 'YouTube')}</h1><p>${board.updatedLabel ? `Updated ${esc(board.updatedLabel)} · ` : ''}${board.total || 0} videos across ${channels.length} channels. Links only: nothing is published or scheduled from here.</p></div></div>
  ${main}
</div>`;
}
