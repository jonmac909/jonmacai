import { esc } from '../ui.js';

// Questions page (2026-10-24): what Ana and the team still need from Jon. Pick an option or
// type an answer and press Send; the answer is stored at once and Ana collects it.
function meta(q) {
  return [q.from ? `<span class="jttag">${esc(q.from)}</span>` : '', q.project ? `<span>${esc(q.project)}</span>` : '', q.askedLabel ? `<span>${esc(q.askedLabel)}</span>` : '']
    .filter(Boolean).join('<i>·</i>');
}

function openCard(q) {
  const opts = q.options.length
    ? `<div class="qopts" role="group" aria-label="Quick answers">${q.options.map((o) => `<button type="button" class="btn qopt" data-qopt="${esc(o)}">${esc(o)}</button>`).join('')}</div>`
    : '';
  return `<li class="card pad qcard" data-qid="${esc(q.id)}">
    <div class="qmeta">${meta(q)}</div>
    <h3 class="qq">${esc(q.question)}</h3>
    ${q.context ? `<p class="qctx">${esc(q.context)}</p>` : ''}
    ${opts}
    <div class="qform">
      <textarea class="qtext" rows="2" maxlength="4000" placeholder="Type your answer" aria-label="Your answer to: ${esc(q.question)}"></textarea>
      <button type="button" class="btn qsend" data-qsend="${esc(q.id)}">Send</button>
    </div>
  </li>`;
}

function doneCard(q) {
  return `<li class="qdone">
    <div class="qmeta">${meta(q)}</div>
    <p class="qq">${esc(q.question)}</p>
    <p class="qans"><b>Answer</b> ${q.answer ? esc(q.answer) : '<span class="muted">Answered elsewhere</span>'}${q.answeredLabel ? ` <span class="muted">· ${esc(q.answeredLabel)}</span>` : ''}</p>
  </li>`;
}

export function render(d) {
  const page = d || {};
  const open = page.open || [];
  const answered = page.answered || [];
  const list = open.length
    ? `<ul class="qlist">${open.map(openCard).join('')}</ul>`
    : '<div class="card pad"><p class="muted">Nothing waiting on you. New questions show up here.</p></div>';
  const done = answered.length
    ? `<details class="qanswered"><summary>Answered ${answered.length}</summary><ul class="qlist">${answered.map(doneCard).join('')}</ul></details>`
    : '';
  return `<div class="wrap">
  <div class="head"><div><h1>${esc(page.title || 'Questions')}</h1><p>${open.length ? `${open.length} waiting on you` : 'All answered'}</p></div></div>
  ${list}${done}
</div>`;
}
