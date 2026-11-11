// Dashboard 3 shell (docs/dashboard-3.md): theme switch, hash routes, data load every 60 s, and the Goals, Team,
// Blockers, Review, Money, Bluesky and System pages (the last two are fixed text and need only the date).
// Data: GET /dashboard/api/d2 and /dashboard/api/d3 (session cookie). Writes: "+ Log" on Workouts and Date nights
// (POST /dashboard/api/habits) and the Review page's buttons (existing writes only, see review.js).
import { esc } from './util.js';
import { statHtml, railCounts } from './rail.js';
import { renderGoals, headerOnly } from './goals.js';
import { renderTeam } from './team.js';
import { renderBlockers } from './blockers.js';
import { needsClick } from './needs.js';
import { renderReview, reviewClick } from './review.js';
import { renderMoney } from './money.js';
import { threadClick } from './thread.js';
import { renderScripts } from './scripts.js';
import { renderBluesky } from './bluesky.js';
import { renderSystem } from './system.js';

const PAGES = { goals: 'Goals', team: 'Team', blockers: 'Blockers', review: 'Review', scripts: 'Scripts', money: 'Money', bluesky: 'Bluesky', system: 'System' };
const SIGNIN = 'd3-signin';
const main = document.getElementById('main');
// Review state that belongs to one item: cleared when the item or the page changes.
const RV_CLEAR = { rvBack: null, rvEdit: null, rvDraft: {}, rvPick: null, rvText: '', rvErr: '' };
const S = { d2: null, d3: null, error: '', signedOut: false, ui: { openKr: null, hgpOpen: false, busy: false, openBot: null, openBl: null, blFilter: 'all', rvSel: null, rvDone: {}, rvKept: {}, rvBack: null, rvEdit: null, rvDraft: {}, rvPick: null, rvText: '', rvErr: '', bsTab: 'vision', syTab: 'map', sySel: 'sponsors', syCat: 'card' } };

// ---- theme (the inline script in index.html applies the saved one before paint) ----
function setTheme(t) {
  const theme = t === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('d3-theme', theme); } catch { /* private mode */ }
  for (const b of document.querySelectorAll('[data-theme-set]')) b.setAttribute('aria-pressed', String(b.dataset.themeSet === theme));
}
for (const b of document.querySelectorAll('[data-theme-set]')) b.addEventListener('click', () => setTheme(b.dataset.themeSet));
setTheme(document.documentElement.getAttribute('data-theme'));

// ---- narrow screens: the Menu button opens and closes the rail; picking a page closes it ----
const railEl = document.getElementById('nav')?.closest?.('.rail') || null;
const menuBtn = document.getElementById('menuBtn');
function setMenu(open) {
  railEl?.classList.toggle('open', open);
  menuBtn?.setAttribute('aria-expanded', String(open));
}
menuBtn?.addEventListener?.('click', () => setMenu(!railEl?.classList.contains('open')));
document.getElementById('nav')?.addEventListener?.('click', (e) => { if (e.target.closest('a')) setMenu(false); });
// Escape closes the open menu; widening past the narrow layout (760 px, d3.css) resets it.
document.addEventListener?.('keydown', (e) => { if (e.key === 'Escape' && railEl?.classList.contains('open')) { setMenu(false); menuBtn?.focus?.(); } });
window.addEventListener?.('resize', () => { if (window.innerWidth > 760 && railEl?.classList.contains('open')) setMenu(false); });

// ---- routes ----
const route = () => (location.hash || '').replace(/^#\/?/, '').split('/');
const page = () => {
  const k = route()[0].toLowerCase();
  return PAGES[k] ? k : 'goals';
};
// One Money deal's own view: #money/<deal id> (the browser's Back closes it).
const dealRoute = () => {
  if (page() !== 'money') return '';
  try { return decodeURIComponent(route().slice(1).join('/')); } catch { return ''; }
};

function render() {
  const p = page();
  const deal = dealRoute();
  if (deal !== (S.ui.deal || '')) {
    S.ui.deal = deal;
    if (deal) {
      window.scrollTo(0, 0);
      // Fresh threads each time a deal opens (GPU1 refreshes the snapshot; the 60 s poll doesn't re-read them).
      if (!S.signedOut) loadThreads().then(() => { if (S.ui.deal === deal) render(); });
    }
  }
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === p) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.title = `${PAGES[p]} · Jon Mac`;
  main.dataset.page = p;
  const note = S.signedOut
    ? '<section class="card"><p>You are signed out. <a href="/dash/">Sign in</a></p></section>'
    : S.error ? `<section class="card"><p class="mut">${esc(S.error)}</p></section>` : '';
  if (p !== 'money' && S.ui.lastPage === 'money') S.ui.dealSel = null; // leaving Money clears the picked deal's outline
  S.ui.lastPage = p;
  const live = { team: renderTeam, blockers: renderBlockers, review: renderReview, scripts: renderScripts, money: renderMoney }[p];
  if (live) {
    main.innerHTML = S.d3 ? `${note}${live(S.d2, S.d3, S.ui)}` : `${headerOnly(S.d2, PAGES[p])}${note || '<section class="card"><p class="mut">Loading</p></section>'}`;
    if (p === 'money' && S.d3 && S.ui.dealSel && !S.ui.dealDone) { // a deal opened from Pipeline revenue: bring it into view once
      document.getElementById(`deal-${S.ui.dealSel}`)?.scrollIntoView({ block: 'center' });
      S.ui.dealDone = true;
    }
    return;
  }
  const fixed = { bluesky: renderBluesky, system: renderSystem }[p];
  if (fixed) { main.innerHTML = `${note}${fixed(S.d2, S.ui)}`; return; }
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

// The Gmail threads above the sponsor drafts: only the Review page asks, so other pages skip the extra read.
async function loadThreads() {
  try {
    const t = await getJson('/dashboard/api/sponsor-threads');
    if (!t.signedOut) S.ui.rvThreads = t.body;
  } catch (err) {
    if (!S.ui.rvThreads?.threads) S.ui.rvThreads = { error: err.message };
  }
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
  if (page() === 'review' && !S.signedOut) await loadThreads();
  rail();
  // Don't redraw under Jon's typing (a Review answer, send-back note or draft edit); the next load or click redraws.
  if (document.activeElement?.closest?.('#main textarea, #main input')) return;
  render();
}

// ---- clicks: open a key result's trend, show channel names, open a bot or blocker row, filter blockers, log a workout or date night ----
main.addEventListener('click', async (e) => {
  if (page() === 'review' && await reviewClick(e, S, render, load)) return;
  if (page() === 'blockers' && await needsClick(e, S, render, load)) return;
  if (threadClick(e, S.ui, render)) return; // open or fold one message of a Money deal's email thread
  const more = e.target.closest('[data-dealmore]'); // Money: show every deal in a stage, or the first 8 again
  if (more) { S.ui.dealsAll = { ...(S.ui.dealsAll || {}), [more.dataset.dealmore]: !S.ui.dealsAll?.[more.dataset.dealmore] }; render(); return; }
  const bst = e.target.closest('[data-bstab]');
  if (bst) { S.ui.bsTab = bst.dataset.bstab; render(); return; }
  const syt = e.target.closest('[data-sytab]');
  if (syt) { S.ui.syTab = syt.dataset.sytab; render(); return; }
  const sys = e.target.closest('[data-sysel]');
  if (sys) { S.ui.sySel = sys.dataset.sysel; S.ui.syCat = sys.dataset.sycat || 'card'; render(); return; }
  const rvgo = e.target.closest('[data-rvgo]'); // Blockers "Open in Review": the link changes the page, this picks the item
  if (rvgo) { Object.assign(S.ui, RV_CLEAR, { rvSel: rvgo.dataset.rvgo }); return; }
  const deal = e.target.closest('[data-deal]'); // Pipeline revenue row: the link opens Money, this picks the deal
  if (deal) { Object.assign(S.ui, { dealSel: deal.dataset.deal, dealDone: false }); return; }
  const tm = e.target.closest('[data-tm]'); // Team: a bot chip (or All)
  if (tm) { S.ui.teamBot = tm.dataset.tm === 'all' ? null : tm.dataset.tm; S.ui.teamCol = null; render(); return; }
  const tmc = e.target.closest('[data-tmcol]'); // Team All view: a count opens that bot's column
  if (tmc) {
    const [slug, col] = tmc.dataset.tmcol.split('|');
    Object.assign(S.ui, { teamBot: slug, teamCol: col });
    render();
    main.querySelector(`[data-tmk="${col}"]`)?.scrollIntoView({ block: 'nearest', inline: 'start' });
    return;
  }
  const bot = e.target.closest('[data-bot]');
  if (bot) { S.ui.openBot = S.ui.openBot === bot.dataset.bot ? null : bot.dataset.bot; render(); return; }
  const bl = e.target.closest('[data-bl]');
  if (bl) { S.ui.openBl = S.ui.openBl === bl.dataset.bl ? null : bl.dataset.bl; render(); return; }
  const blf = e.target.closest('[data-blf]');
  if (blf) { S.ui.blFilter = blf.dataset.blf; S.ui.openBl = null; render(); return; }
  const kr = e.target.closest('[data-kr]');
  if (kr) { S.ui.openKr = S.ui.openKr === kr.dataset.kr ? null : kr.dataset.kr; render(); return; }
  if (e.target.closest('[data-hgp]')) { S.ui.hgpOpen = !S.ui.hgpOpen; render(); return; }
  const log = e.target.closest('[data-log]');
  if (log && !log.disabled && !S.ui.busy) {
    const day = S.d2?.d2?.period?.today?.ymd;
    if (!day) return;
    // Two steps: the first click turns the button into "Confirm log?" for 4 s; only a second click posts.
    const kind = log.dataset.log;
    if (S.ui.confirmLog !== kind) {
      S.ui.confirmLog = kind;
      S.armedAt = Date.now();
      clearTimeout(S.confirmTimer);
      S.confirmTimer = setTimeout(() => { S.ui.confirmLog = null; render(); }, 4000);
      render();
      main.querySelector(`[data-log="${kind}"]`)?.focus?.(); // render() replaced the button: keep keyboard focus on it
      return;
    }
    if (Date.now() - (S.armedAt || 0) < 400) return; // a double-tap is not a confirm
    clearTimeout(S.confirmTimer);
    S.ui.confirmLog = null;
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

// Typed Review text lives in S.ui, so a redraw keeps it.
main.addEventListener('input', (e) => {
  if (e.target.matches('.rvtext')) S.ui.rvText = e.target.value;
  else if (e.target.matches('.rvin')) S.ui.rvDraft = { ...S.ui.rvDraft, [e.target.name]: e.target.value };
});

window.addEventListener('hashchange', () => {
  Object.assign(S.ui, { openKr: null, openBot: null, openBl: null, teamBot: null, teamCol: null, ...RV_CLEAR, rvDone: {}, rvKept: {} });
  render();
  if (page() === 'review' && !S.ui.rvThreads?.threads) loadThreads().then(() => { if (page() === 'review') render(); });
});
setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
render();
load();
