export const REVIEW_SOURCE = 'cc_review_drafts';

export function plannerDestination(title) {
  const name = `Planner - ${String(title || 'Mastermind idea').trim().slice(0, 48)}`;
  return `Created "${name}" under Planner in Orca. Open that worktree.`;
}

export function draftId(payload = {}) {
  return String(payload.id || payload.uid || '');
}

export function isIsolated(payload = {}) {
  return payload.isolated === true || draftId(payload).startsWith('qa-');
}

export function reviewMutate(kind) {
  if (kind === 'sponsor.save_draft' || kind === 'support.save_draft') return 'save';
  if (kind === 'sponsor.discard_draft' || kind === 'support.discard_draft') return 'drop';
  if (kind === 'sponsor.send_draft' || kind === 'support.send' || kind === 'support.decide_refund' || kind === 'support.send_all_safe') return 'send';
  return '';
}

export function parseReview(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.rows)) return raw.rows;
  if (typeof raw === 'string') {
    try { return parseReview(JSON.parse(raw)); } catch { return []; }
  }
  return [];
}

export function upsertReview(rows, draft) {
  const id = String(draft?.id || '');
  if (!id) return rows;
  const next = (rows || []).filter((r) => r.id !== id);
  if (draft.status === 'discarded') return next;
  next.push({
    id,
    kind: draft.kind || '',
    recipient: draft.recipient || '',
    subject: draft.subject || '',
    body: draft.body || '',
    isolated: Boolean(draft.isolated),
    status: 'draft',
    updated_at: draft.updated_at || new Date().toISOString(),
  });
  return next;
}

function patchPayload(payload, hit) {
  if (!payload) return;
  payload.to = hit.recipient || payload.to || '';
  payload.subject = hit.subject ?? payload.subject;
  payload.body = hit.body ?? payload.body;
}

export function applyReviewDrafts(snap, rows = []) {
  if (!snap?.pages) return snap;
  const live = parseReview(rows).filter((r) => r?.id && r.status !== 'discarded');
  const sponsors = snap.pages.sponsors;
  const emails = sponsors?.emails?.rows;
  if (emails) {
    for (const row of emails) {
      const hit = live.find((r) => r.id === row.id);
      if (!hit) continue;
      row.to = hit.recipient || row.to || '';
      row.subject = hit.subject ?? row.subject;
      row.body = hit.body ?? row.body;
    }
    for (const hit of live) {
      if (!hit.isolated || String(hit.kind).startsWith('support.')) continue;
      if (emails.some((r) => r.id === hit.id)) continue;
      emails.push({
        id: hit.id,
        title: 'Isolated draft',
        sub: 'Not a customer · QA only',
        to: hit.recipient || '',
        subject: hit.subject || '',
        body: hit.body || '',
        send: 'Not sent · isolated draft',
        saveKind: 'sponsor.save_draft',
        sendKind: 'sponsor.send_draft',
        discardKind: 'sponsor.discard_draft',
        isolated: true,
      });
    }
  }
  for (const col of sponsors?.board?.columns || []) {
    for (const card of col.cards || []) {
      const hit = live.find((r) => r.id === card.id);
      if (!hit) continue;
      patchPayload(card.payload, hit);
      card.draft = true;
    }
  }
  for (const row of snap.pages.support?.drafts?.rows || []) {
    const id = row.payload?.uid || row.id;
    const hit = live.find((r) => r.id === id);
    if (!hit) continue;
    row.to = hit.recipient || row.to || '';
    row.subject = hit.subject ?? row.subject;
    row.body = hit.body ?? row.body;
    patchPayload(row.payload, hit);
  }
  return snap;
}
