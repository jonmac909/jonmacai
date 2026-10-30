import { esc, pill } from './ui.js';
import { needItem } from './pages/today.js';
import { approveButton, deliverableLink } from './pages/projects.js';

const PREFIX = '/dashboard';
let sending = false;

// ---- Card modal (2026-10-29): any Projects board card. A task loads its proof, history and comment
// thread; a question or approval shows the board's own card, with the same Reply or Approve/Reject.

const when = (at) => (Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const PROOF_PILL = { passed: 'ok', failed: 'crit', pending: 'risk' };
// Under Jon's comments: whether the owner bot was woken. On his own cards no one is, and nothing shows.
const wakeLine = (status, owner) => (status === 'owner is Jon' ? '' : status == null ? `sending to ${owner}…`
  : status === '200' || status === '202' ? `sent to ${owner}` : `couldn't notify (${status})`);

export function taskModal(t, projectLabel) {
  const facts = [['Owner', t.owner], ['Status', String(t.status).replace(/_/g, ' ')], ['Project', projectLabel], ['Due', t.due], ['Minutes', t.minutes]]
    .filter(([, v]) => v != null && v !== '').map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  const proofs = (t.proofs || []).map((p) => {
    const link = /^https?:\/\//i.test(p.link) ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.link)}</a>` : `<code>${esc(p.link)}</code>`;
    return `<li>${pill(p.status, PROOF_PILL[p.status] || '')} ${esc(p.kind)} · ${link}${p.note ? `<p>${esc(p.note)}</p>` : ''}${p.checkNote ? `<p>QC: ${esc(p.checkNote)}</p>` : ''}</li>`;
  }).join('');
  const history = (t.history || []).map((h) => `<li>${esc(h.detail || h.kind)} <span class="cmby">by ${esc(h.by)} · ${esc(when(h.at))}</span></li>`).join('');
  const comments = (t.comments || []).map((c) => {
    const wake = c.author === 'jon' ? wakeLine(c.wakeStatus, t.owner) : '';
    return `<li><span class="cmby"><b>${esc(c.author)}</b> · ${esc(when(c.createdAt))}</span><p>${esc(c.body)}</p>${wake ? `<span class="cmby">${esc(wake)}</span>` : ''}</li>`;
  }).join('');
  const list = (html, none) => (html ? `<ul class="cmlist">${html}</ul>` : `<p class="muted">${none}</p>`);
  // Jon's actions on this card: the same Answer and Approve/Reject as the board, Done on his own open
  // tasks (the only ones the tick accepts), and Approve or Send back (with the comment box) in review.
  const url = `${PREFIX}/api/v1/tasks/${t.id}`;
  const done = t.owner === 'jon' && ['todo', 'doing', 'waiting_on_jon'].includes(t.status)
    ? `<div class="qopts"><button type="button" class="btn" data-ttick="${esc(url)}">Done</button></div>` : '';
  const review = t.status === 'review' ? `<div class="qopts">${approveButton(url, t.title)}
    <button type="button" class="btn line" data-tback="${esc(url)}">Send back</button></div>
    <p class="muted">To send it back, write what to change in the comment box below.</p>` : '';
  const asks = (t.asks || []).map((it) => needItem(it)).join('');
  const action = done || review || asks ? `<section class="cmact"><h3>Your action</h3>${done}${review}${asks ? `<ul class="qlist">${asks}</ul>` : ''}</section>` : '';
  const deliv = t.status === 'review' || t.status === 'done' ? deliverableLink(t.deliverable) : '';
  return `<h2>${esc(t.title)}</h2>${deliv ? `<p class="cmdeliv">${deliv}</p>` : ''}<dl class="cmfacts">${facts}</dl>${t.note ? `<p class="cmnote">${esc(t.note)}</p>` : ''}${action}
    <h3>Proof</h3>${list(proofs, 'No proof yet.')}
    <h3>History</h3>${list(history, 'No history yet.')}
    <h3>Comments</h3>${list(comments, 'No comments yet.')}
    <div class="qform"><textarea class="qtext cmtext" rows="3" maxlength="4000" placeholder="Write a comment" aria-label="Your comment"></textarea>
      <button type="button" class="btn" data-csend="${esc(`${PREFIX}/api/v1/tasks/${t.id}/comments`)}">Send</button></div>`;
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
