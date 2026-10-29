import { render as today } from './pages/today.js';
import { render as projects } from './pages/projects.js';
import { render as sponsors } from './pages/sponsors.js';
import { render as viral } from './pages/viral.js';
import { render as webinar } from './pages/webinar.js';
import { render as money } from './pages/money.js';
import { render as life } from './pages/life.js';
import { formatJobResult } from './ui.js';
import { bindModals, openDraft } from './modals.js';
const PREFIX = '/dashboard';
// Any other #page (old bookmarks to removed pages) falls back to Today. A page may have a
// sub-path, like #projects/sponsors; the page itself decides what an unknown one shows.
const pages = { today, projects, sponsors, viral, webinar, money, life };
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
  return pages[id.split('/')[0]] ? id : 'today';
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
      go(hashPage(), { refetch: true });
    })
    .catch(() => { failed(); say('Could not send'); });
}

// Half-typed answers survive a re-render of the same page (refresh, or after another item is sent).
function typedAnswers() {
  const out = {};
  document.querySelectorAll('#page .qcard').forEach((c) => {
    const box = c.querySelector('.qtext');
    const key = c.querySelector('[data-tsend]');
    if (box && box.value && key) out[key.dataset.tsend] = box.value;
  });
  return out;
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

export async function go(id, { refetch = false } = {}) {
  if (!pages[id.split('/')[0]]) id = 'today';
  const [name, sub] = id.split('/');
  if (location.hash !== `#${id}`) history.replaceState(null, '', `${PREFIX}/#${id}`);
  if (refetch || name === 'today') {
    const snap = await fetch(`${PREFIX}/api/snapshot?v=${Date.now()}`);
    if (snap.ok) data = await snap.json();
    document.getElementById('navs').innerHTML = navHtml();
  }
  document.querySelectorAll('.nav').forEach((n) => {
    if (n.dataset.page === name) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  });
  const page = data.pages[name];
  const same = shownPage === id;
  const typed = same ? typedAnswers() : {};
  document.getElementById('page').innerHTML = pages[name](page, data, sub);
  shownPage = id;
  document.querySelectorAll('#page .qcard').forEach((c) => {
    const key = c.querySelector('[data-tsend]');
    const box = c.querySelector('.qtext');
    const text = key && typed[key.dataset.tsend];
    if (box && text) box.value = text;
  });
  if (!same) window.scrollTo(0, 0);
  try { localStorage.setItem('cc-page', id); } catch {}
  bindKanban();
}

document.addEventListener('click', (e) => {
  const tsend = e.target.closest('[data-tsend]');
  if (tsend) {
    const answer = tsend.closest('.qcard').querySelector('.qtext').value.trim();
    if (!answer) { say('Type an answer first'); return; }
    if (tsend.disabled) return;
    tsend.disabled = true;
    todayPost(tsend.dataset.tsend, { answer }, 'Sent', tsend);
    return;
  }
  const tick = e.target.closest('[data-ttick]');
  if (tick) {
    if (tick.disabled) return;
    tick.disabled = true;
    todayPost(tick.dataset.ttick, { status: 'done' }, 'Done', tick, 'PATCH');
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
  if (nav) {
    // A Projects checklist entry opens its project and scrolls to the card with that answer/decide URL.
    const url = nav.dataset.card;
    go(nav.dataset.page).then(() => {
      if (url) document.querySelector(`#page .pjkan [data-tsend="${url}"], #page .pjkan [data-tdecide="${url}"]`)?.closest('li')?.scrollIntoView({ block: 'center' });
    });
    return;
  }
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

const snap = await fetch(`${PREFIX}/api/snapshot?v=${Date.now()}`);
if (snap.status === 401) { location.href = `${PREFIX}/`; throw new Error('auth'); }
data = await snap.json();
document.getElementById('navs').innerHTML = navHtml();
// Today and Webinar refresh every 60 s while visible.
setInterval(() => {
  const id = hashPage();
  if (document.hidden || !['today', 'webinar'].includes(id)) return;
  if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  const y = window.scrollY;
  go(id, { refetch: true }).then(() => window.scrollTo(0, y)).catch(() => {});
}, 60000);
let last = hashPage();
try { if (!location.hash) last = localStorage.getItem('cc-page') || last; } catch {}
go(last);
