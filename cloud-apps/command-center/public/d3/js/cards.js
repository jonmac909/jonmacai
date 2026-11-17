// Dashboard 3 Cards page: a checklist of every open card (one row each: tick box, title, owner, status), grouped by owner,
// with MacFrames cards in a group of their own on top and the cards done in the last 7 days ticked at the bottom.
// Jon's session only (Jon, 2026-11-17): every row, and the card's own detail view, has a tick box and a Delete.
//   tick     POST /v1/tasks/:id/tick {on}      done (struck through, moved to Done) / back to the status it had
//   delete   POST /v1/tasks/:id/delete         asks "Delete this card?" first; soft delete, nothing is removed
//   undo     POST /v1/tasks/:id/undelete       the toast's Undo for ~10 s (for a tick, the toast's Undo ticks it back)
// Data: GET /dashboard/api/cards (the lists), GET /dashboard/api/v1/tasks/:id (one card's detail view).
import { esc } from './util.js';
import { headerOnly } from './goals.js';

const STATUS = { todo: 'To do', doing: 'Doing', waiting_on_jon: 'Waiting on Jon', qc: 'QC', review: 'Review', done: 'Done' };
const ORDER = ['doing', 'waiting_on_jon', 'qc', 'review', 'todo', 'done'];
// Owners that read better with a name than a slug; any other owner shows as written.
const OWNER = { ana: 'Ana', jon: 'Jon', qc: 'QC', 'hgp-scripts': 'HGP Scripts', 'short-form': 'Short-form', 'video-editor': 'Video Editor', 'jon-mac-youtube': 'Jon Mac YouTube', 'home-guide-press': 'Home Guide Press', 'viral-view': 'Viral View', developer: 'Developer', sponsors: 'Sponsors', accounting: 'Accounting', marketing: 'Marketing', spotify: 'Spotify', historient: 'Historient', moneyclaw: 'MoneyClaw' };
export const ownerName = (slug) => OWNER[slug] || slug || 'No owner';
export const statusName = (s) => STATUS[s] || s || '';
export const UNDO_MS = 10000;
const ID = /^t_[0-9a-f]{16}$/;
const safeHref = (h) => (/^(https?:\/\/|\/(?![/\\]))/i.test(String(h || '')) ? String(h) : '');

const CHECK = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg>';
const TRASH = '<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"></path><path d="M9 7V4h6v3"></path></svg>';

// The tick box: a real button. on = the card is done; a click asks for the opposite.
const box = (c) => {
  const done = c.status === 'done';
  return `<button type="button" class="ckbox${done ? ' on' : ''}" data-ck-tick="${esc(c.id)}" data-on="${done ? 'false' : 'true'}" aria-pressed="${done}" aria-label="${done ? 'Untick' : 'Mark done'}: ${esc(c.title)}">${done ? CHECK : ''}</button>`;
};
const askOrTrash = (c, ui) => (ui.ckConfirm === c.id
  ? `<span class="ckask" role="alertdialog" aria-label="Delete this card?"><span>Delete this card?</span><button type="button" class="btn sm ckyes" data-ck-yes="${esc(c.id)}">Delete</button><button type="button" class="btn sm" data-ck-no>Cancel</button></span>`
  : `<button type="button" class="ckdel" data-ck-del="${esc(c.id)}" aria-label="Delete card: ${esc(c.title)}" title="Delete card">${TRASH}</button>`);

const row = (c, ui) => `<li class="ckrow${c.status === 'done' ? ' done' : ''}" data-ck="${esc(c.id)}">${box(c)}<span class="cktext"><button type="button" class="ckt" data-ck-open="${esc(c.id)}">${esc(c.title)}</button><span class="ckm"><span class="ckown">${esc(ownerName(c.owner))}</span> <span class="ckst s-${esc(c.status)}">${esc(statusName(c.status))}</span>${c.macframes ? ' <span class="ckmf">MacFrames</span>' : ''}</span></span>${askOrTrash(c, ui)}<span class="sr">${c.status === 'done' ? 'Done' : 'Open'}</span></li>`;

const byStatus = (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));

function group(title, cards, ui, open = true) {
  const o = ui.ckFold && title in ui.ckFold ? ui.ckFold[title] : open; // a group Jon opened or folded stays so across redraws
  return `<details class="card ckgroup" data-ckg="${esc(title)}"${o ? ' open' : ''}><summary><b>${esc(title)}</b> <span class="mut">${cards.length}</span></summary><ul class="cklist">${cards.map((c) => row(c, ui)).join('')}</ul></details>`;
}

const toast = (t) => (t ? `<div class="cktoast" role="status"><span>${esc(t.kind === 'delete' ? 'Card deleted' : t.kind === 'untick' ? 'Card unticked' : 'Card ticked off')}: ${esc(String(t.title).slice(0, 80))}</span><button type="button" class="btn sm" data-ck-undo>Undo</button></div>` : '');

const when = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '');

// One card's own page: facts, note, proof, history, with the same tick box and Delete.
function detail(ui) {
  const d = ui.ckDetail;
  const back = '<p><button type="button" class="btn sm" data-ck-back>← All cards</button></p>';
  if (!d || d.loading) return `${back}<section class="card"><p class="mut">Loading</p></section>`;
  if (d.error || !d.task) return `${back}<section class="card"><p class="mut">${esc(d.error || 'Could not read this card.')}</p></section>`;
  const t = d.task;
  const facts = [['Owner', ownerName(t.owner)], ['Status', statusName(t.status)], ['Project', t.project], ['Stage', t.stage], ['Due', t.due], ['Updated', when(t.updatedAt)], ['Done', when(t.doneAt)]]
    .filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  const proofs = (t.proofs || []).map((p) => {
    const h = safeHref(p.link);
    return `<li>${esc(p.kind)} · ${esc(p.status)} · ${h ? `<a href="${esc(h)}" target="_blank" rel="noopener">${esc(p.link)}</a>` : esc(p.link)}</li>`;
  }).join('');
  const hist = (t.history || []).slice(-15).reverse().map((h) => `<li><span class="mut">${esc(when(h.at))} · ${esc(h.by)}</span> ${esc(h.detail || h.kind)}</li>`).join('');
  return `${back}<section class="card ckdet" data-ck="${esc(t.id)}"><div class="ckdethead">${box(t)}<h2 class="ckdett${t.status === 'done' ? ' done' : ''}">${esc(t.title)}</h2>${askOrTrash(t, ui)}</div>
<dl class="ckfacts">${facts}</dl>${t.note ? `<p class="cknote">${esc(t.note)}</p>` : ''}
${proofs ? `<h3>Proof</h3><ul class="ckplain">${proofs}</ul>` : ''}${hist ? `<h3>History</h3><ul class="ckplain">${hist}</ul>` : ''}</section>`;
}

export function renderCards(d2resp, resp, ui = {}) {
  const head = headerOnly(d2resp, 'Cards', 'Every open card, every owner. Tick one off or delete it.');
  if (ui.ckOpen) return `<div class="ckpage">${head}${detail(ui)}${toast(ui.ckToast)}</div>`;
  const cards = resp?.cards;
  if (!cards) return `${head}<section class="card"><p class="mut">${resp === undefined ? 'Loading' : 'Could not read the cards.'}</p></section>`;
  const open = cards.open || [];
  const done = cards.done || [];
  const mf = open.filter((c) => c.macframes).sort(byStatus);
  const rest = open.filter((c) => !c.macframes);
  const owners = new Map();
  const everyOwner = new Set(open.map((c) => c.owner));
  for (const c of rest) { if (!owners.has(c.owner)) owners.set(c.owner, []); owners.get(c.owner).push(c); }
  const groups = [...owners.entries()].sort((a, b) => b[1].length - a[1].length || ownerName(a[0]).localeCompare(ownerName(b[0])))
    .map(([o, list]) => group(ownerName(o), list.sort(byStatus), ui));
  const parts = [];
  parts.push(`<section class="card ckhead"><p><b>${open.length}</b> open cards · <b>${everyOwner.size}</b> owners · <b>${mf.length}</b> MacFrames</p>${cards.cut ? '<p class="mut">The list is cut: it shows the newest cards only.</p>' : ''}</section>`);
  parts.push(mf.length ? group('MacFrames', mf, ui) : '<section class="card"><p class="mut">No open MacFrames cards.</p></section>');
  parts.push(...groups);
  parts.push(done.length ? group('Done in the last 7 days', done.slice().sort(byStatus), ui, false) : '<section class="card"><p class="mut">Nothing done in the last 7 days.</p></section>');
  return `<div class="ckpage">${head}${parts.join('')}${toast(ui.ckToast)}</div>`;
}

// ---- Jon's clicks ----

async function call(method, path, body) {
  try {
    const res = await fetch(`/dashboard/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const b = await res.json().catch(() => null);
    return { ok: res.ok && b?.ok !== false, error: b?.error || (res.ok ? '' : `answered ${res.status}`), body: b };
  } catch (err) {
    return { ok: false, error: err.message, body: null };
  }
}

// A group Jon opens or folds stays that way (the 'toggle' event does not bubble: listen in the capture phase).
export function cardsToggle(e, ui) {
  const g = e.target?.closest?.('[data-ckg]');
  if (!g) return;
  ui.ckFold = { ...(ui.ckFold || {}), [g.dataset.ckg]: g.open };
}

// -> true when the click was one of this page's own controls. reload() re-reads the lists and redraws.
export async function cardsClick(e, S, render, reload) {
  const t = e.target;
  const ui = S.ui;
  const one = (sel) => t.closest?.(sel);
  const done = async (what, r) => { if (!r.ok) S.error = `Could not ${what} (${r.error || 'no answer'}).`; else S.error = ''; };
  const loadDetail = async () => { const r = await call('GET', `/v1/tasks/${ui.ckOpen}`); ui.ckDetail = r.ok ? { task: r.body.task } : { error: `Could not read this card (${r.error}).` }; };
  const say = (kind, id, title) => {
    clearTimeout(ui.ckTimer);
    ui.ckToast = { kind, id, title };
    ui.ckTimer = setTimeout(() => { ui.ckToast = null; render(); }, UNDO_MS);
  };
  const after = async () => { if (ui.ckOpen) await loadDetail(); await reload(); };

  const tick = one('[data-ck-tick]');
  if (tick) {
    const id = tick.dataset.ckTick;
    if (ui.ckBusy || !ID.test(id)) return true;
    ui.ckBusy = true;
    const on = tick.dataset.on === 'true';
    const title = tick.getAttribute('aria-label').replace(/^[^:]*: /, '');
    const r = await call('POST', `/v1/tasks/${id}/tick`, { on });
    ui.ckBusy = false;
    await done('tick the card', r);
    if (r.ok) say(on ? 'tick' : 'untick', id, title);
    await after();
    return true;
  }
  const del = one('[data-ck-del]');
  if (del) { ui.ckConfirm = del.dataset.ckDel; render(); return true; }
  if (one('[data-ck-no]')) { ui.ckConfirm = null; render(); return true; }
  const yes = one('[data-ck-yes]');
  if (yes) {
    const id = yes.dataset.ckYes;
    if (ui.ckBusy || !ID.test(id)) return true;
    ui.ckBusy = true;
    const title = (ui.ckOpen && ui.ckDetail?.task?.id === id ? ui.ckDetail.task.title : t.closest('[data-ck]')?.querySelector('.ckt')?.textContent) || 'card';
    const r = await call('POST', `/v1/tasks/${id}/delete`);
    ui.ckBusy = false;
    ui.ckConfirm = null;
    await done('delete the card', r);
    if (r.ok) { say('delete', id, title); ui.ckOpen = null; ui.ckDetail = null; }
    await after();
    return true;
  }
  if (one('[data-ck-undo]')) {
    const k = ui.ckToast;
    if (!k || ui.ckBusy) return true;
    ui.ckBusy = true;
    clearTimeout(ui.ckTimer);
    ui.ckToast = null;
    const r = k.kind === 'delete' ? await call('POST', `/v1/tasks/${k.id}/undelete`) : await call('POST', `/v1/tasks/${k.id}/tick`, { on: k.kind === 'untick' });
    ui.ckBusy = false;
    await done(k.kind === 'delete' ? 'restore the card' : 'undo the tick', r);
    await after();
    return true;
  }
  const open = one('[data-ck-open]');
  if (open) {
    if (!ID.test(open.dataset.ckOpen)) return true;
    ui.ckOpen = open.dataset.ckOpen;
    ui.ckConfirm = null;
    ui.ckDetail = { loading: true };
    render();
    await loadDetail();
    render();
    return true;
  }
  if (one('[data-ck-back]')) { ui.ckOpen = null; ui.ckDetail = null; ui.ckConfirm = null; render(); return true; }
  return false;
}
