import { BOT_NAMES, botName, esc, linkify, whenLabel } from '../ui.js';
import { deliverableLink } from './projects.js';

// Feed (Jon, 2026-10-30): every update from every bot, newest first, from /v1/activity. A chip
// (#feed/<slug>) shows what that bot did and what happened on its work. A row with a card opens it.
const API = '/dashboard/api/v1/activity';
const STATUS = { todo: 'To do', doing: 'Doing', waiting_on_jon: 'Waiting on Jon', qc: 'QC', review: 'Review', done: 'Done', cancelled: 'Cancelled' };
const SAID = { created: 'added a task', tick: 'ticked done', comment: 'commented', proof: 'added proof', question: 'asked', answer: 'answered', approval: 'asked to approve' };
const CHIPS = [['', 'All'], ...Object.entries(BOT_NAMES).filter(([slug]) => slug !== 'jon'), ['jon', 'You']];

function phrase(r) {
  const m = r.kind === 'status' && /^status (\w+) → (\w+)(.*)$/.exec(r.body || '');
  if (m) return `moved ${STATUS[m[1]] || m[1]} → ${STATUS[m[2]] || m[2]}${m[3]}`;
  return SAID[r.kind] || r.body || r.kind; // QC checks, owner/project/due changes, approve/reject decisions
}

export function rowHtml(r, now = Date.now()) {
  const card = r.taskId || (r.pending ? r.id : ''); // an answered question or decided approval has no card of its own
  const more = r.kind === 'proof' ? deliverableLink({ link: r.link, kind: r.body })
    : r.kind === 'comment' || r.kind === 'answer' ? linkify(r.body) : '';
  return `<li class="fdrow"${card ? ` tabindex="0" data-open="${esc(card)}"` : ''}>
    <div class="fdtop"><b>${esc(botName(r.who))}</b><span>${esc(phrase(r))}</span><time datetime="${esc(r.at)}">${esc(whenLabel(r.at, now))}</time></div>
    ${r.title ? `<p class="fdtitle">${linkify(r.title)}</p>` : ''}${more ? `<p class="fdbody">${more}</p>` : ''}</li>`;
}

export function render(_d, _data, sub) {
  const on = CHIPS.some(([slug]) => slug && slug === sub) ? sub : '';
  const chips = CHIPS.map(([slug, name]) => `<button type="button" class="chip${slug === on ? ' on' : ''}" data-page="feed${slug ? `/${slug}` : ''}"${slug === on ? ' aria-current="page"' : ''}>${esc(name)}</button>`).join('');
  return `<div class="wrap">
  <div class="head"><div><h1>Feed</h1><p>${on ? `${esc(botName(on))}: what they did and what happened on their work` : 'Every update from every bot, newest first'}</p></div></div>
  <nav class="chips fdchips" aria-label="Filter by bot">${chips}</nav>
  <div class="card pad"><ul class="fdlist" data-bot="${esc(on)}"><li class="muted">Loading…</li></ul><div class="fdmore"></div></div>
</div>`;
}

// Loads the newest 100 rows, then 100 more per "Load more".
export async function mount(el) {
  const list = el.querySelector('.fdlist');
  const more = el.querySelector('.fdmore');
  const load = async (before) => {
    const q = new URLSearchParams({ limit: '100' });
    if (list.dataset.bot) q.set('bot', list.dataset.bot);
    if (before) q.set('before', before);
    const res = await fetch(`${API}?${q}`).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    if (!before) list.innerHTML = '';
    list.querySelector('.fderr')?.remove();
    if (!j?.items) {
      list.insertAdjacentHTML('beforeend', '<li class="muted fderr">Could not load the feed.</li>');
      more.innerHTML = before ? `<button type="button" class="btn line" data-fdmore="${esc(before)}">Try again</button>` : '';
      return;
    }
    list.insertAdjacentHTML('beforeend', j.items.map((r) => rowHtml(r)).join('') || (before ? '' : '<li class="muted">Nothing yet.</li>'));
    more.innerHTML = j.next ? `<button type="button" class="btn line" data-fdmore="${esc(j.next)}">Load more</button>` : '';
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fdmore]');
    if (b && !b.disabled) { b.disabled = true; load(b.dataset.fdmore); }
  });
  await load();
}
