// Dashboard 3 Cards page: a read-only checklist of every open card (one row each: box, title, owner, status), grouped by
// owner, with MacFrames cards in a group of their own on top and the cards done in the last 7 days ticked at the bottom.
// The box is a drawn shape, not a form control: nothing on this page can change a card. Data: GET /dashboard/api/cards.
import { esc } from './util.js';
import { headerOnly } from './goals.js';

const STATUS = { todo: 'To do', doing: 'Doing', waiting_on_jon: 'Waiting on Jon', qc: 'QC', review: 'Review', done: 'Done' };
const ORDER = ['doing', 'waiting_on_jon', 'qc', 'review', 'todo', 'done'];
// Owners that read better with a name than a slug; any other owner shows as written.
const OWNER = { ana: 'Ana', jon: 'Jon', qc: 'QC', 'hgp-scripts': 'HGP Scripts', 'short-form': 'Short-form', 'video-editor': 'Video Editor', 'jon-mac-youtube': 'Jon Mac YouTube', 'home-guide-press': 'Home Guide Press', 'viral-view': 'Viral View', developer: 'Developer', sponsors: 'Sponsors', accounting: 'Accounting', marketing: 'Marketing', spotify: 'Spotify', historient: 'Historient', moneyclaw: 'MoneyClaw' };
export const ownerName = (slug) => OWNER[slug] || slug || 'No owner';
export const statusName = (s) => STATUS[s] || s || '';

const box = (done) => `<span class="ckbox${done ? ' on' : ''}" aria-hidden="true">${done ? '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg>' : ''}</span>`;
const row = (c) => `<li class="ckrow${c.status === 'done' ? ' done' : ''}">${box(c.status === 'done')}<span class="cktext"><span class="ckt">${esc(c.title)}</span><span class="ckm"><span class="ckown">${esc(ownerName(c.owner))}</span> <span class="ckst s-${esc(c.status)}">${esc(statusName(c.status))}</span>${c.macframes ? ' <span class="ckmf">MacFrames</span>' : ''}</span></span><span class="sr">${c.status === 'done' ? 'Done' : 'Open'}</span></li>`;

const byStatus = (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));

function group(title, cards, open = true) {
  return `<details class="card ckgroup"${open ? ' open' : ''}><summary><b>${esc(title)}</b> <span class="mut">${cards.length}</span></summary><ul class="cklist">${cards.map(row).join('')}</ul></details>`;
}

export function renderCards(d2resp, resp) {
  const head = headerOnly(d2resp, 'Cards', 'Every open card, every owner. View only.');
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
    .map(([o, list]) => group(ownerName(o), list.sort(byStatus)));
  const parts = [];
  parts.push(`<section class="card ckhead"><p><b>${open.length}</b> open cards · <b>${everyOwner.size}</b> owners · <b>${mf.length}</b> MacFrames</p>${cards.cut ? '<p class="mut">The list is cut: it shows the newest cards only.</p>' : ''}</section>`);
  parts.push(mf.length ? group('MacFrames', mf) : '<section class="card"><p class="mut">No open MacFrames cards.</p></section>');
  parts.push(...groups);
  parts.push(done.length ? group('Done in the last 7 days', done.slice().sort(byStatus), false) : '<section class="card"><p class="mut">Nothing done in the last 7 days.</p></section>');
  return `<div class="ckpage">${head}${parts.join('')}</div>`;
}
