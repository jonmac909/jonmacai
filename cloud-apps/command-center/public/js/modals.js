import { esc, pill, botName, linkLabel, friendlyWhen } from './ui.js';
import { needItem, summaryHtml, inline, HEADING } from './pages/today.js';
import { approveButton, deliverableLink } from './pages/projects.js';

const PREFIX = '/dashboard';
let sending = false;

// ---- Card modal (2026-10-29): any Projects board card. A task loads its proof, history and comment
// thread; a question or approval shows the board's own card, with the same Reply or Approve/Reject.

const PROOF_PILL = { passed: 'ok', failed: 'crit', pending: 'risk' };
// Under Jon's comments: whether the owner bot was woken. On his own cards no one is, and nothing shows.
const wakeLine = (status, owner) => (status === 'owner is Jon' ? '' : status == null ? `sending to ${owner}…`
  : status === '200' || status === '202' ? `sent to ${owner}` : `couldn't notify (${status})`);

const STATUS = { todo: 'To do', doing: 'Doing', waiting_on_jon: 'Waiting on you', qc: 'In QC', review: 'Ready for your review', done: 'Done', cancelled: 'Cancelled' };

// One proof, compact: its QC result, a labelled button (never a raw URL or a local path) and the first
// line of its note. The rest of the note and QC's notes sit behind Details.
function proofItem(p) {
  const open = /^https?:\/\//i.test(p.link)
    ? `<a class="btn line cmopen" href="${esc(p.link)}" target="_blank" rel="noopener">${esc(linkLabel(p.link, p.kind))}</a>`
    : `<span class="cmfile">Local file: ${esc(String(p.link || '').split(/[\\/]/).pop())}</span>`;
  const qc = p.status === 'passed' ? 'QC passed' : p.status === 'failed' ? 'QC failed' : 'Waiting for QC';
  const lines = String(p.note || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = (lines.find((l) => !HEADING.test(l)) || '').replace(/^[-*•]\s+/, '');
  const more = lines.length > 1 || first.length > 140 ? `<div class="cmsmall">${summaryHtml(p.note)}</div>` : '';
  const check = p.checkNote ? `<div class="cmsmall"><strong>QC:</strong> ${inline(p.checkNote)}</div>` : '';
  return `<li><div class="cmrow">${pill(qc, PROOF_PILL[p.status] || '')}${open}</div>${first ? `<p class="cmsmall cmone">${inline(first)}</p>` : ''}${more || check ? `<details class="cmdet"><summary>Details</summary>${more}${check}</details>` : ''}</li>`;
}

// History in words: statuses as the board names them, owners by name.
const histText = (h) => String(h.detail || h.kind).replace(/^(status|owner) (\S+) → (\S+)/, (_, k, a, b) => (k === 'status'
  ? `${STATUS[a] || a} → ${STATUS[b] || b}` : `owner ${botName(a)} → ${botName(b)}`));

export function taskModal(t, projectLabel) {
  const meta = [botName(t.owner), STATUS[t.status] || String(t.status).replace(/_/g, ' '), projectLabel, t.due ? `due ${t.due}` : '', t.minutes ? `${t.minutes} min of your time` : '']
    .filter(Boolean).map(esc).join(' · ');
  // Your move: only when Jon has to act, with everything he needs right there.
  const url = `${PREFIX}/api/v1/tasks/${t.id}`;
  const open = ['todo', 'doing', 'waiting_on_jon'].includes(t.status);
  const mine = t.owner === 'jon' && open;
  const done = mine ? `<button type="button" class="btn" data-ttick="${esc(url)}">Done</button>` : '';
  const review = t.status === 'review' ? `${approveButton(url, t.title)}
    <button type="button" class="btn line" data-tback="${esc(url)}">Send back</button>` : '';
  const d = t.deliverable;
  const deliv = d?.link && (t.status === 'review' || t.status === 'waiting_on_jon' || mine) ? deliverableLink(d, 'btn line') : '';
  const asks = (t.asks || []).map((it) => needItem(it)).join('');
  const buttons = deliv || done || review ? `<div class="qopts">${deliv}${done}${review}</div>` : '';
  const hint = review ? '<p class="cmsmall">To send it back, write what to change in the comment box.</p>'
    : !buttons && !asks ? '<p class="cmsmall">Read the note and reply in the comment box.</p>' : '';
  const move = buttons || asks || t.status === 'waiting_on_jon'
    ? `<section class="cmact"><h3>Your move</h3>${buttons}${hint}${asks ? `<ul class="qlist">${asks}</ul>` : ''}</section>` : '';
  const doneLink = t.status === 'done' && d?.link ? `<p class="cmdeliv">${deliverableLink(d, 'btn line')}</p>` : '';
  const proofs = (t.proofs || []).map(proofItem).join('');
  const history = (t.history || []).map((h) => `<li>${esc(histText(h))} <span class="cmby">· ${esc(botName(h.by))} · ${esc(friendlyWhen(h.at))}</span></li>`).join('');
  const comments = (t.comments || []).map((c) => {
    const wake = c.author === 'jon' ? wakeLine(c.wakeStatus, botName(t.owner)) : '';
    return `<li><span class="cmby"><b>${esc(botName(c.author))}</b> · ${esc(friendlyWhen(c.createdAt))}</span><div class="cmtextbody">${summaryHtml(c.body)}</div>${wake ? `<span class="cmby">${esc(wake)}</span>` : ''}</li>`;
  }).join('');
  return `<h2>${esc(t.title)}</h2><p class="cmmeta">${meta}</p>${move}${doneLink}
    ${t.note ? `<div class="cmnote">${summaryHtml(t.note)}</div>` : ''}
    ${proofs ? `<h3>Proof</h3><ul class="cmlist cmproofs">${proofs}</ul>` : ''}
    <h3>Comments</h3>${comments ? `<ul class="cmlist">${comments}</ul>` : ''}
    <div class="cmcompose"><textarea class="qtext cmtext" rows="2" maxlength="4000" placeholder="Write a comment" aria-label="Your comment"></textarea>
      <button type="button" class="btn" data-csend="${esc(`${PREFIX}/api/v1/tasks/${t.id}/comments`)}">Send</button></div>
    ${t.status === 'done' || t.status === 'cancelled' ? '' : `<p class="cmclose"><button type="button" class="btn line" data-tclose="${esc(url)}" data-title="${esc(t.title)}">Close card</button></p>`}
    ${history ? `<details class="cmhist"><summary>History (${(t.history || []).length})</summary><ul class="cmlist">${history}</ul></details>` : ''}`;
}

// Questions and approvals: the same card as the board, so its Reply and Approve/Reject work as there.
export const askModal = (it) => `<ul class="qlist">${needItem(it)}</ul>`;

let shown = null; // the task in the card modal: { id, label }

export function openCard(id, page) {
  const dlg = document.getElementById('cardModal');
  const lanes = page?.projects || [];
  const item = lanes.flatMap((l) => l.columns.flatMap((c) => c.items)).find((i) => i.id === id);
  if (!dlg || !item) return;
  shown = item.kind === 'task' ? { id, label: (slug) => lanes.find((l) => l.slug === (slug || 'unsorted'))?.label || slug } : null;
  dlg.setAttribute('aria-label', item.title);
  dlg.querySelector('.cmbody').innerHTML = shown ? `<h2>${esc(item.title)}</h2><p class="muted cmload">Loading…</p>` : askModal(item);
  if (!dlg.open) dlg.showModal();
  if (shown) loadTask(dlg);
}

async function loadTask(dlg) {
  const want = shown;
  const res = await fetch(`${PREFIX}/api/v1/tasks/${encodeURIComponent(want.id)}`).catch(() => null);
  const j = res?.ok ? await res.json().catch(() => null) : null;
  if (shown !== want || !dlg.open) return null; // closed, or another card opened meanwhile
  const body = dlg.querySelector('.cmbody');
  if (!j?.task) {
    if (body.querySelector('.cmload')) body.querySelector('.cmload').textContent = 'Could not load this task.';
    return null;
  }
  // A half-typed comment, and half-typed answers to the card's questions, survive the reload.
  const box = body.querySelector('.cmtext');
  const typed = box?.value || '';
  const focused = !!box && document.activeElement === box;
  const answers = typedAnswers(body);
  body.innerHTML = taskModal(j.task, want.label(j.task.project));
  restoreAnswers(body, answers);
  const next = body.querySelector('.cmtext');
  next.value = typed;
  if (typed) next.dispatchEvent(new Event('input', { bubbles: true })); // grow to fit, like typing does
  if (focused) next.focus();
  return j.task;
}

// Half-typed answers in question cards under `root`, keyed by their Send URL, to put back after a re-render.
export function typedAnswers(root) {
  const out = {};
  root.querySelectorAll('.qcard').forEach((c) => {
    const box = c.querySelector('.qtext');
    const key = c.querySelector('[data-tsend]');
    if (box && box.value && key) out[key.dataset.tsend] = box.value;
  });
  return out;
}

export function restoreAnswers(root, typed) {
  root.querySelectorAll('.qcard').forEach((c) => {
    const key = c.querySelector('[data-tsend]');
    const box = c.querySelector('.qtext');
    const text = key && typed[key.dataset.tsend];
    if (box && text) box.value = text;
  });
}

async function sendComment(dlg, button, say) {
  const box = dlg.querySelector('.cmbody .cmtext');
  const body = box.value.trim();
  if (!body) { say('Type a comment first'); return; }
  button.disabled = true;
  try {
    const res = await fetch(button.dataset.csend, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: JSON.stringify({ body }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { say(j.error || 'Could not send'); return; }
    box.value = '';
    say('Comment sent');
    const want = shown;
    const task = await loadTask(dlg);
    dlg.querySelector('.cmbody .cmtext')?.focus();
    // The wake finishes after the reply (with retries): look once more so "sending to …" shows its result.
    if (task && task.comments.filter((c) => c.author === 'jon').at(-1)?.wakeStatus == null) {
      setTimeout(() => { if (shown === want) loadTask(dlg); }, 8000);
    }
  } catch {
    say('Could not send');
  } finally {
    button.disabled = false;
  }
}

export function bindModals({ say, act, go }) {
  const card = document.getElementById('cardModal');
  card?.addEventListener('input', (e) => { // the comment box grows with what Jon types
    if (!e.target.matches('.cmtext')) return;
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight + 2, 240)}px`;
  });
  card?.addEventListener('click', (e) => {
    if (e.target.closest('[data-cclose]')) { card.close(); return; }
    const send = e.target.closest('[data-csend]');
    if (send && !send.disabled) sendComment(card, send, say);
  });

  const draft = document.getElementById('draftModal');
  if (!draft) return;

  draft.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-draft-act]');
    if (!b) return;
    const payload = JSON.parse(draft.dataset.payload || '{}');
    payload.to = draft.querySelector('[name=to]')?.value || '';
    payload.subject = draft.querySelector('[name=subject]')?.value || '';
    payload.body = draft.querySelector('[name=body]')?.value || '';
    const actn = b.dataset.draftAct;
    if (actn === 'discard' && !confirm('Discard this draft? Nothing is emailed.')) return;
    const kind = actn === 'save' ? payload.saveKind : actn === 'send' ? payload.sendKind : payload.discardKind;
    if (!kind) return;
    if (actn === 'send') {
      if (sending) return;
      sending = true;
      b.disabled = true;
    }
    draft.close();
    try {
      await act(kind, payload);
      const id = (location.hash || '#today').replace(/^#/, '') || 'today';
      await go(id, { refetch: true });
    } finally {
      sending = false;
      if (actn === 'send') b.disabled = false;
    }
  });
}

export function openDraft(payload = {}) {
  sending = false;
  const draft = document.getElementById('draftModal');
  if (!draft) return;
  draft.dataset.payload = JSON.stringify(payload);
  draft.querySelector('[name=to]').value = payload.to || '';
  draft.querySelector('[name=subject]').value = payload.subject || '';
  draft.querySelector('[name=body]').value = payload.body || '';
  const sendBtn = draft.querySelector('[data-draft-act="send"]');
  if (sendBtn) sendBtn.disabled = false;
  draft.showModal();
}
