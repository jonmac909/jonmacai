import { esc } from './ui.js';

const PREFIX = '/dashboard';
let sending = false;

function ymdNow() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function bindModals({ say, act, go, getData }) {
  const morning = document.getElementById('morningModal');
  const draft = document.getElementById('draftModal');
  if (!morning || !draft) return;

  document.getElementById('startMorning')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fillMorning(getData());
    morning.showModal();
    morning.querySelector('[data-item]')?.focus();
  });

  morning.addEventListener('click', async (e) => {
    const step = e.target.closest('[data-item]');
    if (!step) return;
    e.stopPropagation();
    const item = step.dataset.item;
    const done = step.getAttribute('aria-pressed') !== 'true';
    await fetch(`${PREFIX}/api/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
      body: JSON.stringify({ day: ymdNow(), item, done }),
    });
    step.setAttribute('aria-pressed', String(done));
    say(done ? `${step.textContent.trim()} checked` : `${step.textContent.trim()} unchecked`);
    await go(location.hash.replace('#', '') || 'home');
    fillMorning(getData());
  });

  draft.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-draft-act]');
    if (!b) return;
    const payload = JSON.parse(draft.dataset.payload || '{}');
    payload.to = draft.querySelector('[name=to]')?.value || '';
    payload.subject = draft.querySelector('[name=subject]')?.value || '';
    payload.body = draft.querySelector('[name=body]')?.value || '';
    const actn = b.dataset.draftAct;
    if (actn === 'discard' && !confirm('Discard this draft? The original email stays in the inbox.')) return;
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
      await go(location.hash.replace('#', '') || 'home');
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

function fillMorning(data) {
  const box = document.getElementById('morningSteps');
  if (!box) return;
  const steps = data?.pages?.home?.runThrough?.steps || [];
  box.innerHTML = steps.map((s) => (
    `<button type="button" class="step" data-item="${esc(s.item)}" data-page="${esc(s.page)}" aria-pressed="${s.done ? 'true' : 'false'}">${esc(s.label)}</button>`
  )).join('');
}
