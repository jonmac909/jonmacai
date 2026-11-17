// The sidebar's order (Jon, 2026-11-17): drag a menu item up or down; the order is saved on the server for the signed-in user
// (POST /dashboard/api/home/nav-order, read back with GET /dashboard/api/home as navOrder) so it holds on every device.
// The menu's HTML in index.html stays the built-in order; this only rearranges those links. Pure functions first (tests run them
// without a browser), then the DOM and pointer parts.

// The page ids to show, in order: the saved ones that still exist first (each once), then any page the saved list does not
// mention, in its built-in place. Unknown ids in the saved list (a page that was removed) are dropped.
export function orderOf(builtIn, saved) {
  const have = new Set(builtIn);
  const out = [];
  for (const id of Array.isArray(saved) ? saved : []) if (have.has(id) && !out.includes(id)) out.push(id);
  for (const id of builtIn) if (!out.includes(id)) out.push(id);
  return out;
}

// Moves the id at index `from` so it sits at index `to`. Returns a new list.
export function moveTo(list, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return list.slice();
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const CACHE = 'd3-nav-order';

// The links in the menu, by page id.
const links = (nav) => [...nav.querySelectorAll('a[data-nav]')];
export const currentOrder = (nav) => links(nav).map((a) => a.dataset.nav);

// Puts the menu's links in `saved` order (the built-in order is whatever index.html had, remembered the first time).
// Badges live inside their link, so they move with it.
export function applyOrder(nav, saved) {
  if (!nav.dataset.navBuiltin) nav.dataset.navBuiltin = currentOrder(nav).join(',');
  const builtIn = nav.dataset.navBuiltin.split(',');
  const want = orderOf(builtIn, saved);
  const byId = new Map(links(nav).map((a) => [a.dataset.nav, a]));
  if (!same(currentOrder(nav), want)) for (const id of want) nav.appendChild(byId.get(id));
  const reset = nav.ownerDocument?.getElementById('navReset');
  if (reset) reset.hidden = same(want, builtIn);
  return want;
}

// A saved order remembered in this browser only so the menu does not flash the built-in order before the server answers.
export function cachedOrder() {
  try { const v = JSON.parse(localStorage.getItem(CACHE) || 'null'); return Array.isArray(v) ? v : null; } catch { return null; }
}
export function cacheOrder(order) {
  try { if (order) localStorage.setItem(CACHE, JSON.stringify(order)); else localStorage.removeItem(CACHE); } catch { /* private mode */ }
}

const HOLD = 450; // ms a finger rests on an item before it lifts (a tap still opens the page)
const SLOP = 8; // px a finger may wander during the hold (it is scrolling, not holding)
const GRAB = 5; // px a mouse must move before it is a drag and not a click

// Drag to reorder. save(order) is called with the new page-id list when the drop changed something.
// Mouse: press and drag. Touch: press and hold, then drag. A tap or click that did not drag opens the page as before.
export function navDrag(nav, save, isOn = () => true) {
  let d = null; // { el, id, x, y, pointerId, timer, live, type }
  let swallow = 0;
  const unlift = () => { nav.querySelectorAll('.navdrag').forEach((x) => x.classList.remove('navdrag')); nav.classList.remove('navdragging'); };
  const begin = () => { // the item is now being dragged
    if (!d) return;
    clearTimeout(d.timer);
    d.live = true;
    d.el.classList.add('navdrag');
    nav.classList.add('navdragging');
    try { d.el.setPointerCapture(d.pointerId); } catch { /* the pointer is gone */ }
    navigator.vibrate?.(8);
  };
  const end = (cancel) => {
    if (!d) return;
    const cur = d;
    d = null;
    clearTimeout(cur.timer);
    unlift();
    if (!cur.live) return;
    swallow = Date.now(); // the click that follows a drag must not open the page
    if (cancel) { applyOrder(nav, cur.before); return; }
    const now = currentOrder(nav);
    if (!same(now, cur.before)) save(now);
  };

  nav.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('a[data-nav]');
    if (!el || !isOn() || (e.pointerType === 'mouse' && e.button !== 0) || d) return;
    d = { el, id: el.dataset.nav, x: e.clientX, y: e.clientY, pointerId: e.pointerId, type: e.pointerType, live: false, before: currentOrder(nav), timer: 0 };
    if (e.pointerType !== 'mouse') d.timer = setTimeout(begin, HOLD);
  });
  nav.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.pointerId) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (!d.live) {
      if (d.type === 'mouse') { if (moved > GRAB) begin(); else return; } else { if (moved > SLOP) { clearTimeout(d.timer); d = null; } return; } // a finger that moved first is scrolling
    }
    if (!d) return;
    e.preventDefault?.();
    // Walk the item past each neighbour whose middle the pointer has crossed.
    const all = links(nav);
    const at = all.indexOf(d.el);
    for (let i = 0; i < all.length; i++) {
      if (i === at) continue;
      const r = all[i].getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom) continue;
      const mid = r.top + r.height / 2;
      if (i < at && e.clientY < mid) nav.insertBefore(d.el, all[i]);
      else if (i > at && e.clientY > mid) nav.insertBefore(d.el, all[i].nextSibling);
      break;
    }
  });
  nav.addEventListener('pointerup', () => end(false));
  nav.addEventListener('pointercancel', () => end(true));
  // While a finger drags an item the menu must not scroll: iOS only honours this on a non-passive touchmove.
  nav.addEventListener('touchmove', (e) => { if (d?.live) e.preventDefault(); }, { passive: false });
  // A press-and-hold must not open the browser's own link menu or text selection.
  nav.addEventListener('contextmenu', (e) => { if (d || Date.now() - swallow < 600) e.preventDefault(); });
  nav.addEventListener('dragstart', (e) => e.preventDefault()); // a link's native drag is not this one
  // The click after a drag lands on the item that was dragged: stop it before the router sees it.
  nav.addEventListener('click', (e) => { if (Date.now() - swallow < 400) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  nav.ownerDocument?.addEventListener?.('keydown', (e) => { if (e.key === 'Escape' && d?.live) end(true); });
  for (const a of links(nav)) a.draggable = false;
}
