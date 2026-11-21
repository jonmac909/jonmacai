// Dashboard 3 shell (docs/dashboard-3.md): theme switch, hash routes, data load every 60 s (the Factory page reads its board every 3 s), and the Home (the default page, home.js), Goals,
// Factory, Track, Review, Money and Bluesky pages (Bluesky is fixed text and needs only the date),
// and the Hyper page, which frames the HyperFrames app (hyper.js).
// Data: GET /dashboard/api/d2 and /dashboard/api/d3 (session cookie). Writes: "+ Log" on Workouts and Date nights
// (POST /dashboard/api/habits) and the Review page's buttons (existing writes only, see review.js).
import { esc } from './util.js';
import { statHtml, railCounts } from './rail.js';
import { renderGoals, headerOnly } from './goals.js';
import { renderReview, reviewClick } from './review.js';
import { renderMoney } from './money.js';
import { threadClick } from './thread.js';
import { renderHyper, openHyper } from './hyper.js';
import { MC_ORIGIN, isMcPage, renderMc, mcTheme } from './moneyclaw.js';
import { renderBluesky } from './bluesky.js';
import { renderCards, cardsClick, cardsToggle } from './cards.js';
import { applyOrder, cachedOrder, cacheOrder, navDrag } from './navorder.js';
import { dealDrag, dealDragging } from './dealdrag.js';
import { renderPersonal, mnavHtml, moneyBizHtml, personalClick, personalChange, personalInput, personalSubmit, personalPaste, personalKey, personalPopOpen, personalDrag, personalAfter, nowParts } from './personal.js';
import { renderFactory, syncFactory } from './factory.js';
import { renderTrack, trackSub } from './track.js';
import { renderEos, eosKeep, eosAfter } from './eos.js';
import { renderHome, homeClick, homeChange, homeInput, homeSubmit, homeKeep, homeAfter, homeHints, setColour, savedColours, nowOf } from './home.js';
// The old Track page's own renderer and sort state, loaded from /dashboard (as Dashboard 2 does) the first time Track opens.
const OLD_TRACK = '/dashboard/js/pages/track.js';
let oldTrack = null;

// Home is the Goals page (Jacqueline's handover): #goals and any unknown hash draw it.
// Team, Blockers, Scripts and System were removed from the menu and the routes (Jon, 2026-11-16): their hashes now draw Home. Their data and APIs are untouched.
// Budget, Expenses and P&L frame MoneyClaw's own pages (moneyclaw.js).
const PAGES = { home: 'Goals', factory: 'Factory', track: 'Track', review: 'Review', hyper: 'Hyper', personal: 'Personal', money: 'Money', budget: 'Budget', expenses: 'Expenses', pnl: 'P&L', bluesky: 'Bluesky', cards: 'Cards', eos: 'EOS' };
const SIGNIN = 'd3-signin';
const main = document.getElementById('main');
// Review state that belongs to one item: cleared when the item or the page changes.
const RV_CLEAR = { rvBack: null, rvEdit: null, rvDraft: {}, rvPick: null, rvText: '', rvErr: '' };
const S = { d2: null, d3: null, track: null, cards: undefined, error: '', signedOut: false, ui: { openKr: null, hgpOpen: false, busy: false, openBot: null, openBl: null, blFilter: 'all', rvSel: null, rvDone: {}, rvKept: {}, rvBack: null, rvEdit: null, rvDraft: {}, rvPick: null, rvText: '', rvErr: '', bsTab: 'vision', syTab: 'map', sySel: 'sponsors', syCat: 'card', hmView: 'list', hmPer: 'today', hmOpen: null, hmMore: false, hmCols: savedColours() } };

// ---- theme (the inline script in index.html applies the saved one before paint) ----
function setTheme(t) {
  const theme = t === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('d3-theme', theme); } catch { /* private mode */ }
  for (const b of document.querySelectorAll('[data-theme-set]')) b.setAttribute('aria-pressed', String(b.dataset.themeSet === theme));
  mcTheme(document.getElementById('main'), theme); // an open MoneyClaw page follows the switch
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
  return PAGES[k] ? k : 'home'; // Home is the page /dash/ opens on
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
  // Track: read on each open, as the old page does (GET /dashboard/api/snapshot?pages=track); tabs and sorting reuse it.
  if (p === 'track' && S.ui.lastPage !== 'track') {
    S.track = null;
    loadTrack().then(() => { if (page() === 'track') render(); });
  }
  if (p === 'cards' && S.ui.lastPage !== 'cards' && !S.signedOut) { // each open starts with a fresh read
    S.cards = undefined;
    S.ui.ckOpen = null; S.ui.ckDetail = null; S.ui.ckConfirm = null; // coming back lands on the list, not on a card opened last time
    loadCards().then(() => { if (page() === 'cards') render(); });
  }
  if (p === 'money' && S.ui.lastPage !== 'money' && !S.signedOut) { // Income this month: each open reads this month afresh
    S.ui.incMonth = null;
    loadIncome().then(() => { if (page() === 'money') render(); });
    loadSponsorMem().then(() => { if (page() === 'money') render(); });
  }
  if (p === 'eos' && S.ui.lastPage !== 'eos' && !S.signedOut) { // EOS (eos.js): each open starts with a fresh read of GET /dashboard/api/v1/eos
    S.eos = undefined;
    loadEos().then(() => { if (page() === 'eos') render(); });
  }
  if (p !== 'money' && S.ui.lastPage === 'money') S.ui.dealSel = null; // leaving Money clears the picked deal's outline
  S.ui.lastPage = p;
  // The Factory page counts "updated N s ago" on the server's clock: its time at the last load plus the time since.
  S.ui.now = S.d3 ? Date.parse(S.d3.asOf) + (Date.now() - (S.d3Got || Date.now())) : null;
  if (p === 'cards') { // Jon's tick box and Delete on every card write through cards.js
    main.innerHTML = `${note}${renderCards(S.d2, S.cards, S.ui)}`;
    return;
  }
  if (p === 'eos') { const keep = eosKeep(main); main.innerHTML = `${note}${renderEos(S.d2, S.eos, route()[1], Date.now())}`; eosAfter(main, keep); return; }
  if (p === 'track') { main.innerHTML = `${note}${renderTrack(S.track, trackSub(location.hash), oldTrack?.track)}`; return; }
  if (p === 'hyper') { // drawn once: a redraw would reload the app in its frame
    if (S.signedOut) { main.innerHTML = `${headerOnly(S.d2, 'Hyper')}${note}`; return; }
    if (!main.querySelector?.('#hyFrame')) { main.innerHTML = renderHyper(S.d2); openHyper(main, getJson); }
    return;
  }
  if (isMcPage(p)) { // MoneyClaw keeps its own sign-in, so the frame shows even when the dashboard is signed out; drawn once per page
    if (main.querySelector?.('#mcFrame')?.dataset?.mc !== p) main.innerHTML = renderMc(S.d2, p, document.documentElement.getAttribute('data-theme'));
    return;
  }
  if (p === 'factory') {
    if (!S.d3) { main.innerHTML = `<div class="fy"><header class="hd fyhead"><div><h1>Factory</h1></div></header>${note || '<section class="card"><p class="mut">Loading</p></section>'}</div>`; S.fyNote = null; return; }
    // A refresh rewrites only what changed (rows matched by video id), so the table does not jump.
    const html = renderFactory(S.d3, S.ui);
    if (S.fyNote !== note || !syncFactory(main, html)) main.innerHTML = `${note}${html}`;
    S.fyNote = note;
    return;
  }
  S.fyNote = null;
  if (p === 'personal') { main.innerHTML = `${note}${renderPersonal(S, route().slice(1), S.ui)}`; personalAfter(main, S, send, render, reloadPersonal); return; }
  const live = { review: renderReview, money: renderMoney }[p];
  if (live) {
    const top = p === 'money' ? mnavHtml('money') : '';
    main.innerHTML = S.d3 ? `${top}${note}${p === 'money' ? renderMoney(S.d2, S.d3, S.ui, S.ui.deal ? '' : moneyBizHtml(S.personal, S.ui, S.home?.today || nowParts().ymd)) : live(S.d2, S.d3, S.ui)}` : `${headerOnly(S.d2, PAGES[p])}${note || '<section class="card"><p class="mut">Loading</p></section>'}`;
    if (p === 'money' && S.d3 && S.ui.dealSel && !S.ui.dealDone) { // a deal opened from Pipeline revenue: bring it into view once
      document.getElementById(`deal-${S.ui.dealSel}`)?.scrollIntoView({ block: 'center' });
      S.ui.dealDone = true;
    }
    return;
  }
  if (p === 'bluesky') { main.innerHTML = `${note}${renderBluesky(S.d2, S.ui)}`; return; }
  if (!S.d2) {
    main.innerHTML = `${headerOnly(null, PAGES[p])}${note || '<section class="card"><p class="mut">Loading</p></section>'}`;
    return;
  }
  if (p === 'home') { // a redraw keeps the scroll boxes where they were; a fresh one opens at the current time
    const keep = homeKeep(main);
    main.innerHTML = `${mnavHtml('home')}${note}${renderHome(S.d2, S.d3, S.ui, S.ui.now ?? Date.now(), S.home)}`;
    homeAfter(main, keep);
    return;
  }
  main.innerHTML = `${note}${renderGoals(S.d2, S.d3, S.ui)}`;
}

function rail() {
  document.getElementById('stat').innerHTML = statHtml(S.d3);
  const c = railCounts(S.d2, S.d3);
  for (const [id, n] of [['nReview', c.review]]) {
    const el = document.getElementById(id);
    if (!el) continue;
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

async function loadTrack() {
  try {
    oldTrack ||= await import(OLD_TRACK);
    const t = await getJson(`/dashboard/api/snapshot?pages=track&v=${Date.now()}`);
    S.track = t.signedOut ? { failed: true } : t.body?.pages?.track || {}; // {} reads "Track has no data yet"
  } catch {
    S.track = { failed: true };
  }
}

// Money's "Income this month" (GET /dashboard/api/money-income?month=YYYY-MM): this month, or the one picked with the switcher.
async function loadIncome() {
  try {
    const r = await getJson(`/dashboard/api/money-income${S.ui.incMonth ? `?month=${encodeURIComponent(S.ui.incMonth)}` : ''}`);
    if (!r.signedOut) S.ui.income = r.body?.income || { error: 'the income could not be read.' };
  } catch (err) {
    if (!S.ui.income?.month) S.ui.income = { error: err.message };
  }
}

// Money's sponsor cards (GET /dashboard/api/sponsor-memory): one per sponsor company, read on each open. A failed read says so.
async function loadSponsorMem() {
  try {
    const r = await getJson('/dashboard/api/sponsor-memory');
    if (!r.signedOut) S.ui.sponsorMem = r.body?.sponsors ? r.body : { error: 'the sponsor memory could not be read.' };
  } catch (err) {
    if (!S.ui.sponsorMem?.sponsors) S.ui.sponsorMem = { error: err.message };
  }
}

// The Cards page's list (GET /dashboard/api/cards): every open card and the last 7 days of done ones. A failed read says so.
async function loadCards() {
  try {
    const c = await getJson('/dashboard/api/cards');
    S.cards = c.signedOut ? null : c.body || null;
  } catch { S.cards = null; }
}

// The EOS page's tabs (GET /dashboard/api/v1/eos). A failed read keeps the last answer; with none the page says so.
async function loadEos() {
  try {
    const r = await getJson('/dashboard/api/v1/eos');
    if (!r.signedOut) S.eos = r.body?.ok === false ? (S.eos || null) : r.body || null;
  } catch { if (!S.eos) S.eos = null; }
}

// Home's saved tasks, Jon's own goals and his calendar week. A failed read keeps the last ones; the page says so when there are none.
async function loadHome() {
  try {
    const h = await getJson('/dashboard/api/home');
    if (!h.signedOut) S.home = h.body?.home || null;
  } catch { /* keep what is shown */ }
  showNavOrder();
}
// The menu in Jon's saved order (read with Home's data, so it is the same on every device). A drag in progress is left alone;
// when Home could not be read the menu keeps what it shows.
const navEl = document.getElementById('nav')?.querySelectorAll ? document.getElementById('nav') : null; // (a bare stand-in page in tests has no links to move)
function showNavOrder() {
  if (!navEl || !S.home || navEl.classList.contains('navdragging')) return;
  cacheOrder(S.home.navOrder || null);
  applyOrder(navEl, S.home.navOrder);
}
async function saveNavOrder(order) {
  const r = await send('POST', '/home/nav-order', order ? { order } : { reset: true });
  if (!r.ok) S.error = `Could not save the menu order (${r.error || 'no answer'}).`;
  else if (S.home) S.home.navOrder = order || null;
  cacheOrder(order || null);
  if (!r.ok) { await loadHome(); render(); } else if (!order) applyOrder(navEl, null);
}
if (navEl) {
  applyOrder(navEl, cachedOrder()); // no flash of the built-in order while the server answers
  navDrag(navEl, saveNavOrder, () => !S.signedOut);
  document.getElementById('navReset')?.addEventListener('click', () => saveNavOrder(null));
}
// A Home write (tick, task, goal): Jon's session plus the X-CC header. -> { ok, error }
async function send(method, path, body) {
  try {
    const res = await fetch(`/dashboard/api${path}`, {
      method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CC': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const b = await res.json().catch(() => null);
    return { ok: res.ok && b?.ok !== false, error: b?.error || (res.ok ? '' : `answered ${res.status}`) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
const reloadHome = async () => { await loadHome(); render(); };
const reloadCards = async () => { await loadCards(); render(); };
// Money: drag a deal card to another stage column (src/api.js POST /dashboard/api/deals/move). The card moves on the screen at
// once (dealdrag.js); a refused save puts it back and shows the error. After a save the numbers are read again, so the stage
// counts, Agreed tile and Home's Money owed / Deals to close follow the new stage.
async function moveDeal(id, stage) {
  const r = await send('POST', '/deals/move', { id, stage });
  if (!r.ok) throw new Error(r.error || 'no answer');
  await load();
  return true;
}
let dealErrTimer = 0;
function showDealErr(text) {
  const el = document.getElementById('dealErr');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(dealErrTimer);
  dealErrTimer = setTimeout(() => { el.hidden = true; }, 7000);
}
dealDrag(main, moveDeal, () => !S.signedOut && page() === 'money' && !S.ui.deal, showDealErr);
// The Personal page's saved meals, prices, trips, rules and expense tags, and MoneyClaw's spending (src/personal.js).
async function loadPersonal() {
  try {
    const h = await getJson('/dashboard/api/personal');
    if (!h.signedOut) { S.personal = h.body?.personal || null; S.personalErr = S.personal ? '' : 'The Personal page needs the database.'; }
  } catch (err) { if (!S.personal) S.personalErr = `Could not load the Personal page (${err.message}).`; }
}
const reloadPersonal = async () => { await loadPersonal(); render(); };
S.rerender = () => render();
S.reloadAll = async () => { await Promise.all([loadHome(), loadPersonal()]); render(); };
// a Home or Personal pop-up, or a drag: no redraw underneath it
const popOpen = () => !!(S.ui.hmEd || S.ui.hmGoal || personalPopOpen(S.ui));

async function load() {
  try {
    const [a, b] = await Promise.all([getJson('/dashboard/api/d2'), getJson('/dashboard/api/d3'), loadHome(), loadPersonal()]);
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
      S.d3Got = Date.now();
      S.error = '';
    }
  } catch (err) {
    S.error = `Could not load the numbers (${err.message}). Showing the last ones loaded.`;
  }
  if (page() === 'review' && !S.signedOut) await loadThreads();
  if (page() === 'cards' && !S.signedOut) await loadCards();
  if (page() === 'eos' && !S.signedOut && S.ui.lastPage === 'eos') await loadEos(); // the 60 s refresh; the first read is in render()
  if (page() === 'money' && !S.signedOut && S.ui.lastPage === 'money') await loadIncome(); // the 60 s refresh; the first read is in render()
  rail();
  // Don't redraw under Jon's typing (a Review answer, send-back note or draft edit); the next load or click redraws.
  if (document.activeElement?.closest?.('#main textarea, #main input') || popOpen() || dealDragging()) return;
  render();
}

// ---- clicks: open a key result's trend, show channel names, open a bot or blocker row, filter blockers, log a workout or date night ----
main.addEventListener('click', async (e) => {
  if (page() === 'track') { // the old Track page's own controls: sort a column, copy a video's link, open a channel
    const sort = e.target.closest('[data-tsort]');
    if (sort) { oldTrack?.setSort(sort.dataset.tsort); render(); return; }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const say = (text) => { copy.textContent = text; setTimeout(() => { if (copy.isConnected) copy.textContent = 'Copy'; }, 1500); };
      (navigator.clipboard ? navigator.clipboard.writeText(copy.dataset.copy) : Promise.reject(new Error('no clipboard'))).then(() => say('Copied'), () => say('Could not copy'));
      return;
    }
    if (e.target.closest('a')) return; // a Connect link opens on its own
    const go = e.target.closest('[data-page]');
    if (go && /^track(\/|$)/.test(go.dataset.page)) { location.hash = go.dataset.page; return; }
    return;
  }
  const incGo = page() === 'money' ? e.target.closest('[data-incmonth]') : null; // Money: the income month switcher
  if (incGo) {
    if (incGo.disabled || !incGo.dataset.incmonth) return;
    S.ui.incMonth = incGo.dataset.incmonth;
    await loadIncome();
    render();
    return;
  }
  if ((page() === 'personal' || page() === 'money') && personalClick(e, S, render, send, reloadPersonal, send)) return; // Personal page, and the Money page's expense list
  if (page() === 'home' && homeClick(e, S.ui, render, S, send, reloadHome)) return; // Home's switches and rows; its "+ Log" falls through to the log below
  if (page() === 'cards' && await cardsClick(e, S, render, reloadCards)) return; // tick box, Delete, Undo, a card's detail view
  if (page() === 'review' && await reviewClick(e, S, render, load)) return;
  if (threadClick(e, S.ui, render)) return; // open or fold one message of a Money deal's email thread
  const more = e.target.closest('[data-dealmore]'); // Money: show every deal in a stage, or the first 8 again
  if (more) { S.ui.dealsAll = { ...(S.ui.dealsAll || {}), [more.dataset.dealmore]: !S.ui.dealsAll?.[more.dataset.dealmore] }; render(); return; }
  const bst = e.target.closest('[data-bstab]');
  if (bst) { S.ui.bsTab = bst.dataset.bstab; render(); return; }
  const rvgo = e.target.closest('[data-rvgo]'); // a Today row's "Open in Review": the link changes the page, this picks the item
  if (rvgo) { Object.assign(S.ui, RV_CLEAR, { rvSel: rvgo.dataset.rvgo }); return; }
  const deal = e.target.closest('[data-deal]'); // Pipeline revenue row: the link opens Money, this picks the deal
  if (deal) { Object.assign(S.ui, { dealSel: deal.dataset.deal, dealDone: false }); return; }
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

main.addEventListener('toggle', (e) => {
  if (page() === 'cards') cardsToggle(e, S.ui);
  const sp = e.target?.dataset?.sponsor; // an opened sponsor card stays open across the 60 s redraw
  if (page() === 'money' && sp) (S.ui.spOpen ||= {})[sp] = !!e.target.open;
}, true); // a folded or opened Cards group stays so
// Typed Review text lives in S.ui, so a redraw keeps it.
main.addEventListener('input', (e) => {
  if (page() === 'home' && homeInput(e, S.ui)) return; // a Home pop-up's field
  if (page() === 'personal' && personalInput(e, S.ui)) return; // the meal pop-up's fields
  if (e.target.matches('.rvtext')) S.ui.rvText = e.target.value;
  else if (e.target.matches('.rvin')) S.ui.rvDraft = { ...S.ui.rvDraft, [e.target.name]: e.target.value };
  else if (e.target.matches('[data-hmcol]')) setColour(e.target, S.ui); // Home: a category's colour
});
// Home: a task's tick box, a goal's step and the pop-ups' fields; Save in a pop-up; Esc closes one.
main.addEventListener('change', (e) => {
  if (page() === 'home') homeChange(e, S, render, send, reloadHome);
  else if (page() === 'personal' || page() === 'money') personalChange(e, S, render, send, reloadPersonal, send);
});
main.addEventListener('submit', (e) => {
  if (page() === 'home') homeSubmit(e, S, render, send, reloadHome);
  else if (page() === 'personal') personalSubmit(e, S, render, send, reloadPersonal);
});
// Personal: pasting a recipe turns it into Ingredients and Method at once.
main.addEventListener('paste', (e) => { if (page() === 'personal') personalPaste(e, S.ui, render); });
document.addEventListener('keydown', (e) => {
  if (page() === 'personal' && personalKey(e, S.ui, render)) return;
  if (page() !== 'home') return;
  if (e.key === 'Escape' && (S.ui.hmEd || S.ui.hmGoal)) { S.ui.hmEd = null; S.ui.hmGoal = null; render(); }
});
personalDrag(main, S, () => page() === 'personal', send, render, reloadPersonal); // Trips: drag a stop by its handle
// Home: the "N more" hint under a category card follows its scroll.
main.addEventListener('scroll', (e) => { if (e.target.classList?.contains('hmpc')) homeHints(main); }, true);

// MoneyClaw's Budget page asks to open Expenses (its "budgets" link): only a message from MoneyClaw's own address counts.
window.addEventListener?.('message', (e) => {
  if (e.origin !== MC_ORIGIN || e.data?.type !== 'moneyclaw:open-tab') return;
  if (e.data.tab === 'reports') location.hash = 'expenses';
  else if (e.data.tab === 'pnl') location.hash = 'pnl';
});
window.addEventListener('hashchange', () => {
  Object.assign(S.ui, { psMeal: null, psPop: null, psErr: '', hmOpen: null, hmMore: false, hmEd: null, hmGoal: null, hmGDel: null, openKr: null, openBot: null, openBl: null, teamBot: null, teamCol: null, ...RV_CLEAR, rvDone: {}, rvKept: {} });
  render();
  if (page() === 'review' && !S.ui.rvThreads?.threads) loadThreads().then(() => { if (page() === 'review') render(); });
});
// The Factory page alone re-reads its own board (GET /dashboard/api/d3/factory, one query) every 3 s while it is open
// and the tab is visible, and redraws every second in between so its clocks and "Live · Ns ago" count up.
let fastBusy = false;
async function loadFactory() {
  if (fastBusy || S.signedOut || page() !== 'factory' || document.visibilityState !== 'visible') return;
  fastBusy = true;
  try {
    const b = await getJson('/dashboard/api/d3/factory');
    if (b.signedOut) { await load(); return; } // the full load handles signing in again
    if (!S.d3?.d3 || !b.body?.asOf) return; // the first full load has not landed yet
    S.d3 = { ...S.d3, asOf: b.body.asOf, d3: { ...S.d3.d3, factory: b.body.factory ?? null } };
    S.d3Got = Date.now();
    if (page() === 'factory') render();
  } catch { /* keep what is shown; the 60 s load reports errors */ } finally { fastBusy = false; }
}
// Home's clock, "now" line and current task: a redraw every 15 s while it is open (not under an open colour picker).
setInterval(() => {
  if (!S.d2 || S.signedOut || page() !== 'home' || document.visibilityState !== 'visible') return;
  // Midnight (Vancouver): Today is for one day, so read the new day's data at once instead of waiting for the next 60 s load.
  const ymd = S.d3?.d3?.today?.ymd;
  if (ymd && ymd !== nowOf(S.ui.now ?? undefined).ymd && !S.rolling) { S.rolling = true; load().finally(() => { S.rolling = false; }); }
  if (!document.activeElement?.closest?.('#main input') && !popOpen()) render();
}, 15000);
setInterval(loadFactory, 3000);
setInterval(() => { if (S.d3 && !S.signedOut && page() === 'factory' && document.visibilityState === 'visible') render(); }, 1000);
setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
render();
load();
