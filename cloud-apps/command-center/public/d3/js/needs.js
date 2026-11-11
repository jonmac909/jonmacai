// Needs you: Jon's open items (blockerRows rows with you: true) as a short work list in four groups he can clear.
// Writes: Approve = POST /v1/approvals/:id/decide (same call as Review); Drop / Not now = POST /v1/needs/:id/drop|later.
import { esc } from './util.js';

const API = '/dashboard/api/v1';
export const GROUPS = [['sign', 'Sign in'], ['money', 'Money'], ['approve', 'Approve'], ['answer', 'Answer']];
const SIGN = /sign ?in|log ?in|login|2fa|verify/i;
const MONEY = /\$\s?\d|invoice|payment|\bpay\b|refund|\bprice|\bgst\b|\btax|money|budget|checkout|discount|\bterms\b|\bfee\b|billing|subscription/i;
const APPROVE = /approv|publish|upload|thumbnail|video/i;
const ts = (iso) => (Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : Infinity);
const text = (b) => `${b.title || ''} ${b.blocks || ''}`;

export function groupOf(b) {
  const t = text(b);
  if (b.id === 'youtube' || SIGN.test(t)) return 'sign';
  if (MONEY.test(t)) return 'money';
  if (b.id.startsWith('a:') || (!b.id.startsWith('q:') && APPROVE.test(t))) return 'approve';
  return 'answer';
}

// Sponsor items first (newest first), then videos first in Approve, then oldest first.
const sponsor = (b) => b.sponsor || /sponsor/i.test(text(b));
const video = (b) => /video|render|thumbnail|upload/i.test(text(b));
function order(g) {
  return (a, b) => Number(sponsor(b)) - Number(sponsor(a))
    || (sponsor(a) && sponsor(b) ? ts(b.at) - ts(a.at) : 0)
    || (g === 'approve' ? Number(video(b)) - Number(video(a)) : 0)
    || ts(a.at) - ts(b.at);
}

// [{ key, label, rows }] for every group with rows; each you-row lands in exactly one group.
export function needsGroups(rows) {
  const you = (rows || []).filter((b) => b.you);
  return GROUPS.map(([key, label]) => ({ key, label, rows: you.filter((b) => groupOf(b) === key).sort(order(key)) })).filter((g) => g.rows.length);
}

function itemHtml(b, queue, open) {
  const raw = b.id.slice(2);
  const q = (queue || []).find((x) => x.id === b.id);
  const acts = [];
  if (b.id.startsWith('a:')) acts.push(`<button type="button" class="btn sm pri" data-nact="${esc(b.id)}" data-confirm="${esc(q?.act?.confirm || `Approve "${b.title}"?`)}">Approve</button>`);
  if (b.review) acts.push(`<a class="btn sm${b.id.startsWith('q:') ? ' pri' : ''}" href="#review" data-rvgo="${esc(b.id)}">${b.id.startsWith('q:') ? 'Answer' : 'Open in Review'}</a>`);
  if (b.id.startsWith('t:')) acts.push(`<button type="button" class="btn sm" data-bl="${esc(b.id)}" aria-expanded="${open}">${open ? 'Hide' : 'Details'}</button>`);
  if (/^[tqa]:/.test(b.id)) {
    acts.push(`<button type="button" class="btn sm" data-nlater="${esc(raw)}" data-title="${esc(b.title)}">Not now</button>`);
    acts.push(`<button type="button" class="btn sm" data-ndrop="${esc(raw)}" data-title="${esc(b.title)}">Drop</button>`);
  }
  const sub = [b.owner, b.age].filter(Boolean).join(' · ');
  return `<div class="needrow" style="padding: 10px 0; border-top: 1px solid var(--line, #0001)">
<div class="hd" style="flex-wrap: wrap; gap: 8px"><span class="dot r"></span><b class="ell" style="flex: 1 1 240px">${esc(b.title)}</b><span class="sub">${esc(sub || '–')}</span>
<span class="hd" style="gap: 6px; flex-wrap: wrap">${acts.join('')}</span></div>
${open ? `<div class="mut" style="padding: 6px 0 0 18px">${esc(b.blocks || '')}</div>` : ''}
</div>`;
}

export function renderNeeds(rows, d3resp, ui = {}) {
  if (!rows) return '';
  const groups = needsGroups(rows);
  const n = groups.reduce((s, g) => s + g.rows.length, 0);
  const off = d3resp?.d3?.notNow;
  const queue = d3resp?.d3?.queue;
  const body = groups.length ? groups.map((g) => `<div style="padding-top: 12px"><h3 style="font-size: 14px; margin: 0 0 4px">${esc(g.label)} <span class="mut">${g.rows.length}</span></h3>
${g.rows.map((b) => itemHtml(b, queue, ui.openBl === b.id)).join('\n')}</div>`).join('\n') : '<p class="mut" style="padding-top: 14px">Nothing needs you.</p>';
  return `<section class="card" style="gap: 0" id="needs">
<div class="hd cardhd"><h2>Needs you</h2><span class="pill ${n ? 'bad' : 'ok'}">${n}</span>${off ? `<span class="mut sp">${off} put off</span>` : ''}</div>
${ui.needErr ? `<p class="mut" role="alert">${esc(ui.needErr)}</p>` : ''}
${body}
</section>`;
}

// Approve / Not now / Drop. Returns true when it handled the click.
export async function needsClick(e, S, render, reload) {
  const b = e.target.closest('[data-nact],[data-nlater],[data-ndrop]');
  if (!b) return false;
  if (S.ui.busy) return true;
  const title = b.dataset.title || '';
  let url; let body = {}; let ask;
  if (b.dataset.nact) {
    url = `${API}/approvals/${encodeURIComponent(b.dataset.nact.slice(2))}/decide`; body = { decision: 'approve' }; ask = b.dataset.confirm;
  } else if (b.dataset.nlater) {
    url = `${API}/needs/${encodeURIComponent(b.dataset.nlater)}/later`; ask = `Put off "${title}" for 24 hours?`;
  } else {
    url = `${API}/needs/${encodeURIComponent(b.dataset.ndrop)}/drop`; ask = `Drop "${title}"? It closes and leaves your list.`;
  }
  if (!window.confirm(ask)) return true;
  S.ui.busy = true; S.ui.needErr = '';
  try {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: JSON.stringify(body) });
    if (!res.ok) { const r = await res.json().catch(() => ({})); S.ui.needErr = `Could not save (${r.error || `answered ${res.status}`}).`; }
  } catch (err) {
    S.ui.needErr = `Could not save (${err.message}).`;
  }
  S.ui.busy = false;
  render();
  await reload();
  return true;
}
