import { botName, dayLabel, esc, pill, whenLabel } from '../ui.js';
import { needItem } from './today.js';
import { approveButton, deliverableLink } from './projects.js';

// Todo (Jon, 2026-10-30): Jon's things for today, overdue first, then the quickest. The buttons are
// the board's own: Done, Answer, Approve/Reject, and in Review Approve or Send back (opens the card).
// Every row opens its card, like the board.
const mins = (m) => (m ? `${m} min` : '');
const open = (id) => ` tabindex="0" data-open="${esc(id)}"`;

function taskItem(it, now) {
  const meta = [`<span class="jttag">${esc(botName(it.from))}</span>`,
    ...[it.project, mins(it.minutes), it.due ? `due ${dayLabel(it.due, now)}` : ''].filter(Boolean).map((s) => `<span>${esc(s)}</span>`)].join('<i>·</i>');
  const act = it.tickUrl
    ? `<button type="button" class="btn" data-ttick="${esc(it.tickUrl)}">Done</button>`
    : `${approveButton(it.reviewUrl, it.title)}<button type="button" class="btn line" data-sendback="${esc(it.id)}">Send back</button>`;
  const deliv = it.reviewUrl ? deliverableLink(it.deliverable) : '';
  return `<li class="qcard nyi${it.overdue ? ' crit' : ''}"${open(it.id)}>
    <div class="qmeta">${it.overdue ? `${pill('Overdue', 'crit')} ` : ''}${meta}</div>
    <h3 class="qq">${esc(it.title)}</h3>${deliv ? `<p class="qctx">${deliv}</p>` : ''}
    <div class="qopts">${act}</div></li>`;
}

export function render(d, _data, _sub, now = Date.now()) {
  const items = d?.items || [];
  const rows = items.map((it) => (it.kind === 'task' ? taskItem(it, now)
    : needItem({ ...it, from: botName(it.from), ageLabel: [mins(it.minutes), whenLabel(it.at, now)].filter(Boolean).join(' · ') }, open(it.id))));
  const list = rows.length ? `<ul class="qlist nylist">${rows.join('')}</ul>`
    : `<p class="muted">${d?.available === false ? 'The bot tables could not be read.' : 'Nothing for you today.'}</p>`;
  const sub = items.length ? `${items.length === 1 ? '1 thing' : `${items.length} things`}${d.minutes ? ` · about ${d.minutes} min` : ''}` : 'All clear';
  return `<div class="wrap">
  <div class="head"><div><h1>Todo</h1><p>${esc(sub)}</p></div></div>
  <div class="card pad">${list}</div>
</div>`;
}
