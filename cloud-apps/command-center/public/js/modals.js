const PREFIX = '/dashboard';
let sending = false;

export function bindModals({ say, act, go }) {
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
      const id = (location.hash || '#home').replace(/^#/, '') || 'home';
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
