import { render as home } from './pages/home.js';
import { render as sponsors } from './pages/sponsors.js';
import { render as viral } from './pages/viral.js';
import { render as youtube } from './pages/youtube.js';
import { render as content } from './pages/content.js';
import { render as outreach } from './pages/outreach.js';
import { render as support } from './pages/support.js';
import { render as video } from './pages/video.js';
import { render as money } from './pages/money.js';
import { render as markets } from './pages/markets.js';
import { render as life } from './pages/life.js';
import { render as mastermind } from './pages/mastermind.js';
import { render as agents } from './pages/agents.js';

const PREFIX = '/dashboard';
const pages = { home, sponsors, viral, youtube, content, outreach, support, video, money, markets, life, mastermind, agents };
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
  const res = await fetch(`${PREFIX}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
    body: JSON.stringify({ kind, payload, idemKey }),
  });
  const row = await res.json().catch(() => ({}));
  if (row.result) { say(row.result); return row; }
  for (let i = 0; i < 75; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const s = await fetch(`${PREFIX}/api/actions/${row.id}`);
    const j = await s.json().catch(() => ({}));
    if (j.status === 'done' || j.status === 'failed') {
      say(j.status === 'done' ? (j.result || 'Done') : `Failed: ${j.result || 'unknown'}`);
      return j;
    }
  }
  say('Still working…');
  return row;
}

function hashPage() {
  const id = (location.hash || '#home').replace(/^#/, '') || 'home';
  return pages[id] ? id : 'home';
}

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

function recount() {
  const s = document.querySelectorAll('.steps .step');
  if (!s.length) return;
  let n = 0;
  s.forEach((x) => { if (x.getAttribute('aria-pressed') === 'true') n++; });
  const count = document.getElementById('runcount');
  const bar = document.getElementById('runbar');
  if (count) count.textContent = `${n} of ${s.length} done`;
  if (bar) bar.style.width = `${Math.round(n / s.length * 100)}%`;
}

function go(id) {
  if (!pages[id]) id = 'home';
  if (location.hash !== `#${id}`) history.replaceState(null, '', `${PREFIX}/#${id}`);
  document.querySelectorAll('.nav').forEach((n) => {
    if (n.dataset.page === id) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  });
  const page = data.pages[id];
  document.getElementById('page').innerHTML = pages[id](page, data);
  window.scrollTo(0, 0);
  try { localStorage.setItem('cc-page', id); } catch {}
  bindKanban();
  recount();
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'nwbtn') {
    const el = document.getElementById('nw');
    const hid = el.textContent.indexOf('•') > -1;
    el.textContent = hid ? data.pages.money.netWorth.shown : data.pages.money.netWorth.hidden;
    e.target.textContent = hid ? 'Hide' : 'Show';
    return;
  }
  const th = e.target.closest('[data-theme-set]');
  if (th) { setTheme(th.dataset.themeSet); return; }
  const st = e.target.closest('.step');
  if (st) {
    st.setAttribute('aria-pressed', st.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    recount();
    return;
  }
  const href = e.target.closest('[data-href]');
  if (href) { window.open(href.dataset.href, '_blank', 'noopener'); return; }
  const actBtn = e.target.closest('[data-kind]');
  if (actBtn) {
    let payload = {};
    try { payload = JSON.parse(actBtn.dataset.payload || '{}'); } catch { payload = {}; }
    if (actBtn.dataset.edit) {
      const body = prompt('Edit draft', payload.body || '');
      if (body == null) return;
      payload = { ...payload, body, status: 'edited' };
    }
    const kind = actBtn.dataset.kind;
    act(kind, payload).then(async () => {
      if (actBtn.hasAttribute('data-done')) {
        const r = actBtn.closest('.r, .job');
        if (r) r.classList.add('done');
      }
      if (kind.startsWith('mastermind.') || kind.startsWith('support.') || kind === 'agent.restart' || kind === 'ping') {
        const snap = await fetch(`${PREFIX}/api/snapshot`);
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

document.getElementById('startMorning').addEventListener('click', () => {
  go('home');
  act('ui.toast', { msg: data.nav.startMorningMsg });
});

window.addEventListener('hashchange', () => go(hashPage()));

const snap = await fetch(`${PREFIX}/api/snapshot`);
if (snap.status === 401) { location.href = `${PREFIX}/`; throw new Error('auth'); }
data = await snap.json();
document.getElementById('navs').innerHTML = navHtml();
document.getElementById('donutpct').textContent = `${data.goal.pct}%`;
document.getElementById('donut').style.background = `conic-gradient(var(--accent) 0 ${data.goal.pct}%,var(--line) ${data.goal.pct}% 100%)`;
document.getElementById('goallabel').textContent = data.goal.label;
document.getElementById('goalsub').textContent = data.goal.sub;
let last = hashPage();
try { if (!location.hash) last = localStorage.getItem('cc-page') || last; } catch {}
go(last);
