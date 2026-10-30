import { render as today } from './pages/today.js';
import { render as todo } from './pages/todo.js';
import { render as projects } from './pages/projects.js';
import { render as feed, mount as mountFeed } from './pages/feed.js';
import { render as journal, mount as mountJournal } from './pages/journal.js';
import { render as sponsors } from './pages/sponsors.js';
import { render as viral } from './pages/viral.js';
import { render as webinar } from './pages/webinar.js';
import { render as money } from './pages/money.js';
import { render as life } from './pages/life.js';
import { formatJobResult, noLoneWords } from './ui.js';
import { bindModals, openCard, openDraft, restoreAnswers, typedAnswers } from './modals.js';
const PREFIX = '/dashboard';
// Any other #page (old bookmarks to removed pages) falls back to Today. A page may have a
// sub-path, like #projects/sponsors; the page itself decides what an unknown one shows.
const pages = { today, todo, projects, feed, sponsors, viral, webinar, money, life, journal };
// Feed and Journal fetch their own rows (from /v1) once rendered.
const mounts = { feed: mountFeed, journal: mountJournal };
let data = null;

const root = document.documentElement;
const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function curTheme() { return root.getAttribute('data-theme') || (mq && mq.matches ? 'dark' : 'light'); }
function syncTheme() {
  const c = curTheme();
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === c)));
}
function setTheme(t) { root.setAttribute('data-theme', t); try { localStorage.setItem('cc-theme', t); } catch {} syncTheme(); }
let savedTheme = null; try { savedTheme = localStorage.getItem('cc-theme'); } catch {}
if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme); else syncTheme();
if (mq && mq.addEventListener) mq.addEventListener('change', syncTheme);

const toastEl = document.getElementById('toast');
let toastTimer;
export function say(m) {
  toastEl.textContent = m;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

export async function act(kind, payload = {}) {
  const idemKey = crypto.randomUUID();
  const scan = kind === 'sponsor.scan_inbox';
  const polls = scan ? 300 : 75; // ponytail: 10 min matches collector refresh timeout
  const wait = scan ? 2000 : 400;
  const res = await fetch(`${PREFIX}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ kind, payload, idemKey }),
  });
  const row = await res.json().catch(() => ({}));
  if (row.result) { say(formatJobResult(kind, row.result)); return row; }
  for (let i = 0; i < polls; i++) {
    await new Promise((r) => setTimeout(r, wait));
    const s = await fetch(`${PREFIX}/api/actions/${row.id}`);
    const j = await s.json().catch(() => ({}));
    if (j.status === 'done' || j.status === 'failed') {
      const text = formatJobResult(kind, j.result);
      say(j.status === 'failed' && !String(text).startsWith('Scan failed') && !String(text).startsWith('Failed') ? `Failed: ${text}` : text);
      return j;
    }
  }
  say(scan ? 'Scan has not finished yet. It is still running.' : 'Still working…');
  return row;
}

function hashPage() {
  const id = (location.hash || '#today').replace(/^#/, '') || 'today';
  return Object.hasOwn(pages, id.split('/')[0]) ? id : 'today';
}

// Today's answer and approve buttons (and the Projects tick) send to the URL the server put on the button.
function todayPost(url, body, okText, button, method = 'POST') {
  const failed = () => { button.disabled = false; button.checked = false; };
  if (!String(url).startsWith(`${PREFIX}/api/`)) { failed(); say('Could not send'); return; }
  fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: JSON.stringify(body) })
    .then(async (res) => {
      const row = await res.json().catch(() => ({}));
      if (!res.ok) {
        failed();
        say(row.error || 'Could not send');
        if (res.status === 409) go(hashPage(), { refetch: true });
        return;
      }
      say(okText);
      button.closest('dialog')?.close(); // answered from the card modal
      go(hashPage(), { refetch: true });
    })
    .catch(() => { failed(); say('Could not send'); });
}

let shownPage = null;

function navHtml() {
  const badges = data.nav.badges || {};
  return data.nav.groups.map((g) => {
    const items = g.items.map((it) => {
      const n = badges[it.id];
      const badge = n ? `<span class="n">${n}</span>` : '';
      return `<button class="nav" data-page="${it.id}"><svg class="ic"><use href="#i-${it.icon}"/></svg>${it.label}${badge}</button>`;
    }).join('');
    return `<div class="navgrp"><h4>${g.title}</h4>${items}</div>`;
  }).join('');
}

function bindKanban() {
  const kan = document.getElementById('kan');
  if (!kan) return;
  let dragging = null;
  function ktotals() {
    kan.querySelectorAll('.kcol').forEach((c) => {
      const cards = c.querySelectorAll('.kcard');
      let sum = 0;
      cards.forEach((k) => { sum += Number(k.dataset.amt || 0); });
      c.querySelector('.kn').textContent = cards.length + (sum ? ` · $${sum.toLocaleString()}` : '');
      const e = c.querySelector('.kempty');
      if (e) e.hidden = cards.length > 0;
    });
  }
  kan.addEventListener('dragstart', (e) => {
    const k = e.target.closest('.kcard');
    if (!k) return;
    dragging = k;
    k.classList.add('drag');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', 'card'); } catch {}
  });
  kan.addEventListener('dragend', () => {
    if (dragging) dragging.classList.remove('drag');
    dragging = null;
    kan.querySelectorAll('.over').forEach((c) => c.classList.remove('over'));
  });
  kan.addEventListener('dragover', (e) => {
    const c = e.target.closest('.kcol');
    if (!c || !dragging) return;
    e.preventDefault();
    kan.querySelectorAll('.over').forEach((x) => { if (x !== c) x.classList.remove('over'); });
    c.classList.add('over');
  });
  kan.addEventListener('drop', (e) => {
    const c = e.target.closest('.kcol');
    if (!c || !dragging) return;
    e.preventDefault();
    c.appendChild(dragging);
    c.classList.remove('over');
    ktotals();
    const name = dragging.querySelector('strong')?.textContent || 'card';
    act('sponsor.move_stage', {
      id: dragging.dataset.id,
      stage: c.dataset.board || c.dataset.stage,
      msg: `Moved ${name} to ${c.dataset.stage}`,
    });
  });
  ktotals();
}

// The deploy this page's code came from (its first snapshot's). Jon's tab stays open for days, so a
// newer deploy reloads it, unless a card is open or something is typed.
let build;
const stale = (d) => {
  build ??= d?.build;
  return !!d?.build && d.build !== build && !document.querySelector('dialog[open]')
    && ![...document.querySelectorAll('#page textarea, #page input:not([type]), #page input[type=text]')].some((el) => el.value.trim());
};

export async function go(id, { refetch = false } = {}) {
  if (!Object.hasOwn(pages, id.split('/')[0])) id = 'today';
  const [name, sub] = id.split('/');
  if (location.hash !== `#${id}`) history.replaceState(null, '', `${PREFIX}/#${id}`);
  if (refetch || name === 'today' || name === 'todo') {
    const snap = await fetch(`${PREFIX}/api/snapshot?v=${Date.now()}`);
    if (snap.ok) data = await snap.json();
    if (stale(data)) { location.reload(); return; }
    document.getElementById('navs').innerHTML = navHtml();
  }
  document.querySelectorAll('.nav').forEach((n) => {
    if (n.dataset.page === name) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  });
  const page = data.pages[name];
  const same = shownPage === id;
  const root = document.getElementById('page');
  // Half-typed answers survive a re-render of the same page (refresh, or after another item is sent).
  const typed = same ? typedAnswers(root) : {};
  root.innerHTML = pages[name](page, data, sub);
  mounts[name]?.(root.firstElementChild, { say });
  shownPage = id;
  restoreAnswers(root, typed);
  if (!same) window.scrollTo(0, 0);
  try { localStorage.setItem('cc-page', id); } catch {}
  bindKanban();
}

// A board, Todo or Feed card opens in the card modal, unless the click was on one of its own controls or links.
const boardCard = (el) => el.closest?.('#page [data-open]');
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && boardCard(e.target) === e.target) {
    e.preventDefault();
    openCard(e.target.dataset.open, data.pages.projects);
  }
});

document.addEventListener('click', (e) => {
  const cardEl = boardCard(e.target);
  if (cardEl && !e.target.closest('a, button, input, textarea, select, summary, label')) {
    openCard(cardEl.dataset.open, data.pages.projects);
    return;
  }
  const tsend = e.target.closest('[data-tsend]');
  if (tsend) {
    const answer = tsend.closest('.qcard').querySelector('.qtext').value.trim();
    if (!answer) { say('Type an answer first'); return; }
    if (tsend.disabled) return;
    tsend.disabled = true;
    todayPost(tsend.dataset.tsend, { answer }, 'Sent', tsend);
    return;
  }
  const tick = e.target.closest('[data-ttick]'); // Done on Jon's own task, or Approve in review
  if (tick) {
    if (tick.disabled) return;
    if (tick.dataset.confirm && !window.confirm(tick.dataset.confirm)) return;
    tick.disabled = true;
    todayPost(tick.dataset.ttick, { status: 'done' }, 'Done', tick, 'PATCH');
    return;
  }
  // Send back: on the board it opens the card, whose own Send back sends the comment box with it.
  const sendback = e.target.closest('[data-sendback]');
  if (sendback) { openCard(sendback.dataset.sendback, data.pages.projects); return; }
  const back = e.target.closest('[data-tback]');
  if (back) {
    const comment = back.closest('dialog')?.querySelector('.cmtext')?.value.trim();
    if (!comment) { say('Type what to change first'); return; }
    if (back.disabled) return;
    back.disabled = true;
    todayPost(back.dataset.tback, { status: 'doing', comment }, 'Sent back', back, 'PATCH');
    return;
  }
  // Close card, on the board or in its modal: what's in the modal's comment box goes with it as the reason.
  const close = e.target.closest('[data-tclose]');
  if (close) {
    if (close.disabled) return;
    const comment = close.closest('dialog')?.querySelector('.cmtext')?.value.trim() || '';
    if (!window.confirm(`Close "${close.dataset.title}"? It leaves the board${comment ? ' and your comment goes to its owner' : ''}.`)) return;
    close.disabled = true;
    todayPost(close.dataset.tclose, comment ? { status: 'cancelled', comment } : { status: 'cancelled' }, 'Closed', close, 'PATCH');
    return;
  }
  const tdec = e.target.closest('[data-tdecide]');
  if (tdec) {
    if (tdec.disabled) return;
    if (tdec.dataset.confirm && !window.confirm(tdec.dataset.confirm)) return;
    tdec.disabled = true;
    todayPost(tdec.dataset.tdecide, { decision: tdec.dataset.decision }, tdec.dataset.decision === 'reject' ? 'Rejected' : 'Approved', tdec);
    return;
  }
  if (e.target.id === 'nwbtn') {
    const el = document.getElementById('nw');
    const hid = el.textContent.indexOf('•') > -1;
    el.textContent = hid ? data.pages.money.netWorth.shown : data.pages.money.netWorth.hidden;
    e.target.textContent = hid ? 'Hide' : 'Show';
    return;
  }
  const th = e.target.closest('[data-theme-set]');
  if (th) { setTheme(th.dataset.themeSet); return; }
  const qopt = e.target.closest('[data-qopt]');
  if (qopt) {
    const card = qopt.closest('.qcard');
    card.querySelectorAll('[data-qopt]').forEach((b) => b.classList.toggle('on', b === qopt));
    const box = card.querySelector('.qtext');
    box.value = qopt.dataset.qopt;
    box.focus();
    return;
  }
  const href = e.target.closest('[data-href]');
  if (href) { window.open(href.dataset.href, '_blank', 'noopener'); return; }
  const draftBtn = e.target.closest('[data-draft]');
  if (draftBtn) {
    let payload = {};
    try { payload = JSON.parse(draftBtn.dataset.payload || '{}'); } catch { payload = {}; }
    openDraft(payload);
    return;
  }
  const actBtn = e.target.closest('[data-kind]');
  if (actBtn) {
    let payload = {};
    try { payload = JSON.parse(actBtn.dataset.payload || '{}'); } catch { payload = {}; }
    if (actBtn.dataset.edit) {
      const body = prompt('Edit draft', payload.body || '');
      if (body == null) return;
      payload = { ...payload, body, status: 'edited' };
    }
    if (actBtn.dataset.confirm && !window.confirm(actBtn.dataset.confirm)) return;
    const kind = actBtn.dataset.kind;
    act(kind, payload).then(async () => {
      if (actBtn.hasAttribute('data-done')) {
        const r = actBtn.closest('.r, .job');
        if (r) r.classList.add('done');
      }
      if (kind.startsWith('mastermind.') || kind.startsWith('sponsor.') || kind.startsWith('money.') || kind.startsWith('life.')) {
        const snap = await fetch(`${PREFIX}/api/snapshot?v=${Date.now()}`);
        if (snap.ok) {
          data = await snap.json();
          go(hashPage());
        }
      }
    });
    return;
  }
  const nav = e.target.closest('[data-page]');
  if (nav) { go(nav.dataset.page); return; }
  const b = e.target.closest('[data-msg]');
  if (b) {
    act('ui.toast', { msg: b.dataset.msg });
    if (b.hasAttribute('data-done')) {
      const r = b.closest('.r, .job');
      if (r) r.classList.add('done');
    }
  }
});

bindModals({ say, act, go });

window.addEventListener('hashchange', () => go(hashPage()));

// Everything the app renders (pages, nav, modals, toasts) gets noLoneWords, in one pass per batch.
new MutationObserver((ms) => noLoneWords(ms.flatMap((m) => [...m.addedNodes]))).observe(document.body, { childList: true, subtree: true });
// Pairs were joined for the old width; after a rotation or resize, re-render so they fit again.
let shownWidth = innerWidth, resizing;
window.addEventListener('resize', () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => { if (data && innerWidth !== shownWidth) { shownWidth = innerWidth; go(hashPage()); } }, 300);
});

const snap = await fetch(`${PREFIX}/api/snapshot?v=${Date.now()}`);
if (snap.status === 401) { location.href = `${PREFIX}/`; throw new Error('auth'); }
data = await snap.json();
stale(data); // records this page's build
document.getElementById('navs').innerHTML = navHtml();
// Today, Todo, Projects and Webinar refresh every 60 s while visible, keeping the sub-path (the chosen project).
setInterval(() => {
  const id = hashPage();
  if (document.hidden || !['today', 'todo', 'projects', 'webinar'].includes(id.split('/')[0])) return;
  const el = document.activeElement;
  if (el && (/^(TEXTAREA|SELECT)$/.test(el.tagName) || (el.tagName === 'INPUT' && el.type !== 'checkbox'))) return;
  const y = window.scrollY;
  const x = document.querySelector('#page .pjkan')?.scrollLeft || 0;  // keep the board where Jon scrolled it
  go(id, { refetch: true }).then(() => {
    window.scrollTo(0, y);
    const board = document.querySelector('#page .pjkan');
    if (board) board.scrollLeft = x;
  }).catch(() => {});
}, 60000);
let last = hashPage();
try { if (!location.hash) last = localStorage.getItem('cc-page') || last; } catch {}
go(last);
