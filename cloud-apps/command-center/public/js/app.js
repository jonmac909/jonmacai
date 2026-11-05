import { render as today } from './pages/today.js';
import { render as todo } from './pages/todo.js';
import { render as projects } from './pages/projects.js';
import { render as feed, mount as mountFeed } from './pages/feed.js';
import { render as journal, mount as mountJournal } from './pages/journal.js';
import { calendar, content } from './pages/channels.js';
import { track, setSort } from './pages/track.js';
import { render as factory, mount as mountFactory } from './pages/factory.js';
import { weekly, monthly, mountWeekly, mountMonthly } from './pages/periods.js';
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
const pages = { today, weekly, monthly, todo, projects, feed, calendar, content, track, factory, sponsors, viral, webinar, money, life, journal };
// Feed, Factory and Journal fetch their own rows (from /v1) once rendered.
const mounts = { weekly: mountWeekly, monthly: mountMonthly, feed: mountFeed, factory: mountFactory, journal: mountJournal };
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

// Sidebar (Jon, 2026-11-05): the panel button in the brand row hides the nav, kept per browser. A desktop shrinks to an icon rail; a phone hides the nav strip and keeps the bar. index.html sets data-side before first paint.
const sideBtn = document.getElementById('sideToggle');
function syncSide() {
  const closed = root.getAttribute('data-side') === 'closed';
  const t = closed ? 'Show sidebar' : 'Hide sidebar';
  sideBtn.setAttribute('aria-expanded', String(!closed));
  sideBtn.setAttribute('aria-label', t);
  sideBtn.title = t;
}
function toggleSide() {
  const closed = root.getAttribute('data-side') !== 'closed';
  if (closed) root.setAttribute('data-side', 'closed'); else root.removeAttribute('data-side');
  try { localStorage.setItem('cc-side', closed ? '0' : '1'); } catch {}
  syncSide();
}
syncSide();

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
      if (it.href) return `<a class="nav" href="${it.href}" title="${it.label}"><svg class="ic"><use href="#i-${it.icon}"/></svg><span class="nl">${it.label}</span></a>`;
      return `<button class="nav" data-page="${it.id}" title="${it.label}"><svg class="ic"><use href="#i-${it.icon}"/></svg><span class="nl">${it.label}</span>${badge}</button>`;
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
  if (refetch || name === 'today' || name === 'todo' || name === 'monthly') { // Monthly shows Today's goal tiles
    const snap = await fetch(`${PREFIX}/api/snapshot?v=${Date.now()}`);
    if (snap.ok) data = await snap.json();
    if (stale(data)) { location.reload(); return; }
    document.getElementById('navs').innerHTML = navHtml();
  }
  if (name === 'track' && (shownPage?.split('/')[0] !== 'track' || !data.pages.track?.title)) { // loaded on opening; sorting and tabs reuse it
    const r = await fetch(`${PREFIX}/api/snapshot?pages=track&v=${Date.now()}`);
    if (r.ok) data.pages.track = (await r.json()).pages.track;
    if (hashPage() !== id) return; // moved on while it loaded
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
  // The chosen channel tab in view on a phone's sideways row, without scrolling the window.
  const tab = root.querySelector('.cctabs .on');
  if (tab) { const row = tab.closest('.cctabs'); row.scrollLeft += tab.getBoundingClientRect().left - row.getBoundingClientRect().left - 16; }
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
  const osel = e.target.closest('[data-osel]'); // Content: select an outlier for production, or unselect it
  if (osel) {
    if (osel.disabled) return;
    osel.disabled = true;
    const on = osel.dataset.on !== '1';
    todayPost(osel.dataset.osel, { selected: on }, on ? 'Selected for production' : 'Unselected', osel);
    return;
  }
  const sort = e.target.closest('[data-tsort]'); // Track: sort a table by this column
  if (sort) { setSort(sort.dataset.tsort); go(hashPage()); return; }
  const copy = e.target.closest('[data-copy]'); // Track: copy a video's link
  if (copy) { navigator.clipboard.writeText(copy.dataset.copy).then(() => say('Link copied'), () => say('Could not copy')); return; }
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
  if (e.target.closest('#sideToggle')) { toggleSide(); return; }
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
// Every other page (Calendar, Content, ...) asks only for the build, so an open tab still reloads to new code.
async function checkBuild() {
  const r = await fetch(`${PREFIX}/api/build`).catch(() => null);
  const j = r?.ok ? await r.json().catch(() => null) : null;
  if (j && stale(j)) location.reload();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkBuild(); }); // a phone tab coming back
setInterval(() => {
  const id = hashPage();
  if (document.hidden) return;
  if (!['today', 'monthly', 'todo', 'projects', 'webinar'].includes(id.split('/')[0])) { checkBuild(); return; }
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
