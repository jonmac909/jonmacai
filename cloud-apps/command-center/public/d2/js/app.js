import { render as month } from './pages/month.js';
import { render as week } from './pages/week.js';
import { render as today } from './pages/today.js';
import { render as pipeline } from './pages/pipeline.js';
import { render as money } from './pages/money.js';
import { render as funnels } from './pages/funnels.js';
import { mount as mountFactory } from '/dashboard/js/pages/factory.js';
import { noLoneWords } from '/dashboard/js/ui.js';
import { setSort } from '/dashboard/js/pages/track.js';
import { bindModals, openCard, restoreAnswers, typedAnswers } from '/dashboard/js/modals.js';

// Dashboard 2 shell (docs/dashboard-2.md): its own copy of the /dashboard shell bits it needs, never
// /dashboard/js/app.js (that one runs on import). Data from GET /dashboard/api/d2; writes go to the URL the
// server put on each button.
const API = '/dashboard/api';
const pages = { month, week, today, pipeline, money, funnels };
let data = null;

const root = document.documentElement;
const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
const curTheme = () => root.getAttribute('data-theme') || (mq && mq.matches ? 'dark' : 'light');
function syncTheme() {
  const c = curTheme();
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === c)));
}
function setTheme(t) { root.setAttribute('data-theme', t); try { localStorage.setItem('cc-theme', t); } catch {} syncTheme(); }
let savedTheme = null; try { savedTheme = localStorage.getItem('cc-theme'); } catch {}
if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme); else syncTheme();
if (mq && mq.addEventListener) mq.addEventListener('change', syncTheme);

// Sidebar: same button and localStorage key as /dashboard; index.html sets data-side before first paint.
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
function say(m) {
  toastEl.textContent = m;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

const route = () => {
  const id = location.hash.replace(/^#/, '');
  return Object.hasOwn(pages, id.split('/')[0]) ? id : 'today';
};
const typing = () => [...document.querySelectorAll('#page textarea, #page input:not([type]), #page input[type=text]')].some((el) => el.value.trim());
const isTrack = (id) => { const [name, , x, view] = id.split('/'); return name === 'pipeline' && (view === 'track' || (x === 'track' && !view)); };
// The video stage board reads the Factory feed: Jon Mac, @JonMacAI and Home Guide Press, board view only.
const needsFactory = (id) => { const [name, goal, slug] = id.split('/'); return name === 'pipeline' && ['hgp', 'jonmac', 'jonmacai'].includes(goal) && !slug; };

// Signed out: open /dashboard-2/ once (the Worker serves the sign-in page there). If the data still says signed
// out after that, stop instead of reloading in a loop; a good load clears the mark.
const SIGNIN = 'd2-signin';
function signIn() {
  let tried = false;
  try { tried = sessionStorage.getItem(SIGNIN) === '1'; sessionStorage.setItem(SIGNIN, '1'); } catch {}
  if (!tried) location.replace('/dashboard-2/');
}

// The deploy this tab's code came from. A newer one reloads the tab, unless a card is open or something is typed.
let build;
async function load() {
  const r = await fetch(`${API}/d2`).catch(() => null);
  if (r?.status === 401) { signIn(); return false; }
  const next = r?.ok ? await r.json().catch(() => null) : null;
  if (!next?.d2) return !!data;
  try { sessionStorage.removeItem(SIGNIN); } catch {}
  build ??= next.build;
  if (next.build && next.build !== build && !document.querySelector('dialog[open]') && !typing()) { location.reload(); return false; }
  if (data?.pages?.track && isTrack(route())) next.pages.track = data.pages.track; // kept only while a Track view stays open
  if (data?.pages?.funnels && route() === 'funnels') next.pages.funnels = data.pages.funnels; // the 60 s poll doesn't re-check every page
  data = next;
  return true;
}

// Sponsor board column counts, as /dashboard fills them in.
function counts(el) {
  el.querySelectorAll('.kcol').forEach((c) => {
    const cards = c.querySelectorAll('.kcard');
    const sum = [...cards].reduce((a, k) => a + Number(k.dataset.amt || 0), 0);
    c.querySelector('.kn').textContent = cards.length + (sum ? ` · $${sum.toLocaleString('en-US')}` : '');
    const e = c.querySelector('.kempty');
    if (e) e.hidden = cards.length > 0;
  });
}

let shown = null;
async function go(id, { refetch = false } = {}) {
  if ((refetch || !data) && !(await load())) {
    if (!data) document.getElementById('page').innerHTML = '<div class="wrap"><div class="card pad"><p class="muted">Could not load the dashboard. It tries again every minute.</p></div></div>';
    return;
  }
  const [name, ...rest] = id.split('/');
  if (!isTrack(id)) delete data.pages.track; // so each open of a Track tab pulls from YouTube again, as /dashboard does
  else if (!data.pages.track) {
    const r = await fetch(`${API}/snapshot?pages=track`).catch(() => null);
    data.pages.track = (r?.ok && (await r.json().catch(() => null))?.pages?.track) || {}; // {} shows "no data yet"
    if (route() !== id) return; // moved on while it loaded
  }
  if (needsFactory(id)) {
    const r = await fetch(`${API}/v1/factory`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    data.factory = (r?.ok && (await r.json().catch(() => null))) || data.factory || null; // a failed refetch keeps the last good answer; none shows "no data yet"
    if (route() !== id) return;
  }
  if (name !== 'funnels') delete data.pages.funnels; // each open checks every book page and Buy link again
  else if (!data.pages.funnels) {
    document.getElementById('page').innerHTML = funnels(data); // "Checking…" while it runs
    const r = await fetch(`${API}/d2/funnels`).catch(() => null);
    data.pages.funnels = (r?.ok && (await r.json().catch(() => null))?.funnels) || { error: true };
    if (route() !== id) return;
  }
  document.querySelectorAll('.nav[data-page]').forEach((n) => {
    if (n.dataset.page === name) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  });
  const el = document.getElementById('page');
  const same = shown === id;
  // Half-typed answers and open folds survive a re-render of the same page.
  const typed = same ? typedAnswers(el) : {};
  const open = same ? [...el.querySelectorAll('details[data-keep][open]')].map((d) => d.dataset.keep) : [];
  el.innerHTML = pages[name](data, rest.join('/'));
  restoreAnswers(el, typed);
  if (name === 'pipeline' && rest[1] === 'factory') mountFactory(el.querySelector('.d2sub > .wrap[data-sub]')); // the old Factory table polls itself
  open.forEach((k) => { const d = el.querySelector(`details[data-keep="${k}"]`); if (d) d.open = true; });
  counts(el);
  shown = id;
  if (!same) window.scrollTo(0, 0);
}

// A link from a reused renderer: its own Calendar/Content/Track tab stays inside the Pipeline; any other
// /dashboard page opens there.
function follow(page) {
  const [name] = page.split('/');
  const m = /^(calendar|content|track)\/(.+)$/.exec(page);
  const f = /^factory(?:\/(.+))?$/.exec(page); // a Factory channel tab stays in the Pipeline
  const cur = route().split('/');
  const id = Object.hasOwn(pages, name) ? page : m && cur[0] === 'pipeline' ? `pipeline/${cur[1]}/${m[2]}/${m[1]}` : f && cur[0] === 'pipeline' ? `pipeline/${cur[1]}/factory${f[1] ? `/${f[1]}` : ''}` : null;
  if (!id) { location.href = `/dashboard/#${page}`; return; }
  if (location.hash === `#${id}`) go(id); else location.hash = id;
}

// Answer, approve, Done, Send back, Close and Select send to the URL the server put on the button.
function post(url, body, okText, button, method = 'POST') {
  const failed = () => { button.disabled = false; };
  if (!String(url).startsWith(`${API}/`)) { failed(); say('Could not send'); return; }
  fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: JSON.stringify(body) })
    .then(async (res) => {
      const row = await res.json().catch(() => ({}));
      if (!res.ok) {
        failed();
        say(row.error || 'Could not send');
        if (res.status === 409) go(route(), { refetch: true });
        return;
      }
      say(okText);
      button.closest('dialog')?.close();
      go(route(), { refetch: true });
    })
    .catch(() => { failed(); say('Could not send'); });
}

const boardCard = (el) => el.closest?.('#page [data-open]');
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && boardCard(e.target) === e.target) {
    e.preventDefault();
    openCard(e.target.dataset.open, data.pages.projects);
  }
});

const once = (b) => { if (b.disabled) return false; b.disabled = true; return true; };
document.addEventListener('click', (e) => {
  const t = e.target;
  const cardEl = boardCard(t);
  if (cardEl && !t.closest('a, button, input, textarea, select, summary, label')) { openCard(cardEl.dataset.open, data.pages.projects); return; }
  let b;
  if ((b = t.closest('[data-tsend]'))) {
    const answer = b.closest('.qcard').querySelector('.qtext').value.trim();
    if (!answer) { say('Type an answer first'); return; }
    if (once(b)) post(b.dataset.tsend, { answer }, 'Sent', b);
    return;
  }
  if ((b = t.closest('[data-tdecide]'))) {
    if (b.disabled || (b.dataset.confirm && !window.confirm(b.dataset.confirm))) return;
    if (once(b)) post(b.dataset.tdecide, { decision: b.dataset.decision }, b.dataset.decision === 'reject' ? 'Rejected' : 'Approved', b);
    return;
  }
  if ((b = t.closest('[data-ttick]'))) { // Done on Jon's own task, or Approve in Review
    if (b.disabled || (b.dataset.confirm && !window.confirm(b.dataset.confirm))) return;
    if (once(b)) post(b.dataset.ttick, { status: 'done' }, 'Done', b, 'PATCH');
    return;
  }
  if ((b = t.closest('[data-sendback]'))) { openCard(b.dataset.sendback, data.pages.projects); return; }
  if ((b = t.closest('[data-tback]'))) {
    const comment = b.closest('dialog')?.querySelector('.cmtext')?.value.trim();
    if (!comment) { say('Type what to change first'); return; }
    if (once(b)) post(b.dataset.tback, { status: 'doing', comment }, 'Sent back', b, 'PATCH');
    return;
  }
  if ((b = t.closest('[data-tclose]'))) {
    if (b.disabled) return;
    const comment = b.closest('dialog')?.querySelector('.cmtext')?.value.trim() || '';
    if (!window.confirm(`Close "${b.dataset.title}"? It leaves the board${comment ? ' and your comment goes to its owner' : ''}.`)) return;
    if (once(b)) post(b.dataset.tclose, comment ? { status: 'cancelled', comment } : { status: 'cancelled' }, 'Closed', b, 'PATCH');
    return;
  }
  if ((b = t.closest('[data-osel]'))) { // Content: select an outlier for production, or unselect it
    const on = b.dataset.on !== '1';
    if (once(b)) post(b.dataset.osel, { selected: on }, on ? 'Selected for production' : 'Unselected', b);
    return;
  }
  if ((b = t.closest('[data-qopt]'))) {
    const card = b.closest('.qcard');
    card.querySelectorAll('[data-qopt]').forEach((x) => x.classList.toggle('on', x === b));
    const box = card.querySelector('.qtext');
    box.value = b.dataset.qopt;
    box.focus();
    return;
  }
  if ((b = t.closest('[data-tsort]'))) { setSort(b.dataset.tsort); go(route()); return; }
  if (t.closest('[data-fcheck]')) { delete data.pages.funnels; go(route()); return; } // Funnels: check every page again
  if ((b = t.closest('[data-copy]'))) { navigator.clipboard.writeText(b.dataset.copy).then(() => say('Link copied'), () => say('Could not copy')); return; }
  if ((b = t.closest('[data-href]'))) { window.open(b.dataset.href, '_blank', 'noopener'); return; }
  if (t.id === 'nwbtn') { // Money: show or hide net worth
    const nw = document.getElementById('nw');
    const hid = nw.textContent.includes('•');
    nw.textContent = hid ? data.pages.money.netWorth.shown : data.pages.money.netWorth.hidden;
    t.textContent = hid ? 'Hide' : 'Show';
    return;
  }
  if (t.closest('#sideToggle')) { toggleSide(); return; }
  if ((b = t.closest('[data-theme-set]'))) { setTheme(b.dataset.themeSet); return; }
  if ((b = t.closest('[data-page]'))) follow(b.dataset.page);
});

bindModals({ say, go });
window.addEventListener('hashchange', () => go(route()));

// Jon: never one word alone on a line. Re-render after a resize so the joined pairs fit again.
new MutationObserver((ms) => noLoneWords(ms.flatMap((m) => [...m.addedNodes]))).observe(document.body, { childList: true, subtree: true });
let shownWidth = innerWidth, resizing;
window.addEventListener('resize', () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => { if (data && innerWidth !== shownWidth) { shownWidth = innerWidth; go(route()); } }, 300);
});

// Fresh numbers every 60 s while the tab is visible and Jon isn't typing, keeping the scroll and the board's sideways scroll.
function refresh() {
  if (document.hidden) return;
  const el = document.activeElement;
  if (el && (/^(TEXTAREA|SELECT)$/.test(el.tagName) || (el.tagName === 'INPUT' && el.type !== 'checkbox'))) return;
  const y = window.scrollY;
  const x = document.querySelector('#page .pjkan')?.scrollLeft || 0;
  go(route(), { refetch: true }).then(() => {
    window.scrollTo(0, y);
    const board = document.querySelector('#page .pjkan');
    if (board) board.scrollLeft = x;
  }).catch(() => {});
}
setInterval(refresh, 60000);
document.addEventListener('visibilitychange', refresh); // a phone tab coming back
go(route());
