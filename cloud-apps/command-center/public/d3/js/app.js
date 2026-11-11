// Dashboard 3 shell (docs/dashboard-3.md): theme switch, hash routes, data load every 60 s, and the Goals page.
// Data: GET /dashboard/api/d2 and /dashboard/api/d3 (session cookie). The only write is "+ Log" on Workouts and
// Date nights, through the existing POST /dashboard/api/habits.
import { esc } from './util.js';
import { statHtml, railCounts } from './rail.js';
import { renderGoals, headerOnly } from './goals.js';

const PAGES = { goals: 'Goals', team: 'Team', blockers: 'Blockers', review: 'Review', money: 'Money' };
const SIGNIN = 'd3-signin';
const main = document.getElementById('main');
const S = { d2: null, d3: null, error: '', signedOut: false, ui: { openKr: null, hgpOpen: false, busy: false } };

// ---- theme (the inline script in index.html applies the saved one before paint) ----
function setTheme(t) {
  const theme = t === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('d3-theme', theme); } catch { /* private mode */ }
  for (const b of document.querySelectorAll('[data-theme-set]')) b.setAttribute('aria-pressed', String(b.dataset.themeSet === theme));
}
for (const b of document.querySelectorAll('[data-theme-set]')) b.addEventListener('click', () => setTheme(b.dataset.themeSet));
setTheme(document.documentElement.getAttribute('data-theme'));

// ---- routes ----
const page = () => {
  const k = (location.hash || '').replace(/^#\/?/, '').toLowerCase();
  return PAGES[k] ? k : 'goals';
};

function render() {
  const p = page();
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === p) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.title = `${PAGES[p]} · Jon Mac`;
  const note = S.signedOut
    ? '<section class="card"><p>You are signed out. <a href="/dash/">Sign in</a></p></section>'
    : S.error ? `<section class="card"><p class="mut">${esc(S.error)}</p></section>` : '';
  if (p !== 'goals') {
    main.innerHTML = `${headerOnly(S.d2, PAGES[p])}${note}<section class="card"><p class="mut">This page is in the next build.</p></section>`;
    return;
  }
  if (!S.d2) {
    main.innerHTML = `${headerOnly(null, 'Goals')}${note || '<section class="card"><p class="mut">Loading</p></section>'}`;
    return;
  }
  main.innerHTML = `${note}${renderGoals(S.d2, S.d3, S.ui)}`;
}

function rail() {
  document.getElementById('stat').innerHTML = statHtml(S.d3);
  const c = railCounts(S.d2, S.d3);
  for (const [id, n] of [['nBlockers', c.blockers], ['nReview', c.review]]) {
    const el = document.getElementById(id);
    el.textContent = n ? String(n) : '';
    el.hidden = !n;
  }
}

// ---- data ----
async function getJson(path) {
  const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  if (res.status === 401) return { signedOut: true };
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return { body: await res.json() };
}

async function load() {
  try {
    const [a, b] = await Promise.all([getJson('/dashboard/api/d2'), getJson('/dashboard/api/d3')]);
    if (a.signedOut || b.signedOut) {
      // Signed out: open the sign-in page once; if that lands back here still signed out, stop and show a link.
      let tried = false;
      try { tried = sessionStorage.getItem(SIGNIN) === '1'; sessionStorage.setItem(SIGNIN, '1'); } catch { tried = true; }
      if (!tried) { location.replace('/dash/'); return; }
      S.signedOut = true;
    } else {
      try { sessionStorage.removeItem(SIGNIN); } catch { /* ignore */ }
      S.signedOut = false;
      S.d2 = a.body;
      S.d3 = b.body;
      S.error = '';
    }
  } catch (err) {
    S.error = `Could not load the numbers (${err.message}). Showing the last ones loaded.`;
  }
  rail();
  render();
}

// ---- clicks: open a key result's trend, show channel names, log a workout or date night ----
main.addEventListener('click', async (e) => {
  const kr = e.target.closest('[data-kr]');
  if (kr) { S.ui.openKr = S.ui.openKr === kr.dataset.kr ? null : kr.dataset.kr; render(); return; }
  if (e.target.closest('[data-hgp]')) { S.ui.hgpOpen = !S.ui.hgpOpen; render(); return; }
  const log = e.target.closest('[data-log]');
  if (log && !log.disabled && !S.ui.busy) {
    const day = S.d2?.d2?.period?.today?.ymd;
    if (!day) return;
    S.ui.busy = true;
    render();
    try {
      const res = await fetch('/dashboard/api/habits', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
        body: JSON.stringify({ day, kind: log.dataset.log, done: true }),
      });
      if (!res.ok) S.error = `Could not save the log (answered ${res.status}).`;
    } catch (err) {
      S.error = `Could not save the log (${err.message}).`;
    }
    S.ui.busy = false;
    await load();
  }
});

window.addEventListener('hashchange', () => { S.ui.openKr = null; render(); });
setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
render();
load();
