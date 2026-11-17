// Drag a deal card to another stage on the Money page (Jon, 2026-11-17). Same gesture rules as the sidebar drag (navorder.js):
// mouse = press and drag; touch = press and hold, then drag; a tap or click that did not drag still opens the deal.
// A drop on another stage column moves the card there at once and calls move(id, stage) (the server save); if that fails the card
// goes back to where it was and the short error shows. Cards: `.dealcard[data-dealid]`; columns: `.stage[data-stage][data-drop]`.

const HOLD = 450; // ms a finger rests on a card before it lifts
const SLOP = 8; // px a finger may wander during the hold (it is scrolling, not holding)
const GRAB = 5; // px a mouse must move before it is a drag and not a click

let live = false;
export const dealDragging = () => live;

// The stage column under a point, or null.
function stageAt(root, x, y) {
  for (const s of root.querySelectorAll('.stage[data-drop]')) {
    const r = s.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return s;
  }
  return null;
}

// Keeps a column's count, its "None yet" line and its "+N more" button honest after a card left or arrived.
function recount(stage) {
  const n = stage.querySelectorAll('.dealcard').length;
  const c = stage.querySelector('[data-stagecount]');
  if (c) c.textContent = String(n);
  const none = stage.querySelector('.dealnone');
  if (none) none.hidden = n > 0;
}

// root: the element holding the board (its HTML is redrawn, so listeners sit on root). move(id, dropStage) returns a promise that
// rejects (or resolves false) when the save failed. isOn(): signed in and on the board. showErr(text) shows the short error.
export function dealDrag(root, move, isOn = () => true, showErr = () => {}) {
  let d = null; // { el, id, x, y, pointerId, timer, live, type, from, next }
  let swallow = 0;
  const unlift = (el) => {
    if (el) { el.classList.remove('dealdrag'); el.style.transform = ''; el.style.pointerEvents = ''; }
    root.querySelectorAll('.stagedrop').forEach((s) => s.classList.remove('stagedrop'));
    root.classList.remove('dealdragging');
  };
  const begin = () => {
    if (!d) return;
    clearTimeout(d.timer);
    d.live = true;
    live = true;
    d.el.classList.add('dealdrag');
    d.el.style.pointerEvents = 'none';
    root.classList.add('dealdragging');
    try { d.el.setPointerCapture(d.pointerId); } catch { /* the pointer is gone */ }
    navigator.vibrate?.(8);
  };
  const finish = async (cancel) => {
    if (!d) return;
    const cur = d;
    d = null;
    clearTimeout(cur.timer);
    if (!cur.live) return;
    live = false;
    swallow = Date.now(); // the click that follows a drag must not open the deal
    const target = cancel ? null : cur.over;
    unlift(cur.el);
    if (!target || target === cur.from || target.dataset.stage === cur.from.dataset.stage) return;
    // Move the card now; the server save follows and can put it back.
    const anchor = cur.el.nextSibling;
    const next = target.querySelector('.dealmore, .dealnone');
    target.insertBefore(cur.el, next);
    recount(cur.from); recount(target);
    let ok = false;
    let why = '';
    try { ok = (await move(cur.id, target.dataset.drop, target.dataset.stage)) !== false; } catch (err) { why = err?.message || ''; }
    if (ok) return;
    if (cur.el.isConnected !== false) { // still on this screen: snap it back
      cur.from.insertBefore(cur.el, anchor?.parentNode === cur.from ? anchor : cur.from.querySelector('.dealmore, .dealnone'));
      recount(cur.from); recount(target);
    }
    showErr(`Could not move ${cur.el.querySelector?.('span')?.textContent || 'the deal'} to ${target.dataset.stage}${why ? ` (${why})` : ''}. Put back.`);
  };

  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('.dealcard[data-dealid]');
    if (!el || !isOn() || (e.pointerType === 'mouse' && e.button !== 0) || d) return;
    const from = el.closest('.stage[data-drop]');
    if (!from) return;
    d = { el, id: el.dataset.dealid, x: e.clientX, y: e.clientY, pointerId: e.pointerId, type: e.pointerType, live: false, from, over: null, timer: 0 };
    if (e.pointerType !== 'mouse') d.timer = setTimeout(begin, HOLD);
  });
  root.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.live) {
      if (d.type === 'mouse') { if (Math.hypot(dx, dy) > GRAB) begin(); else return; } else { if (Math.hypot(dx, dy) > SLOP) { clearTimeout(d.timer); d = null; } return; } // a finger that moved first is scrolling
    }
    if (!d) return;
    e.preventDefault?.();
    d.el.style.transform = `translate(${dx}px, ${dy}px)`;
    const over = stageAt(root, e.clientX, e.clientY);
    if (over !== d.over) {
      root.querySelectorAll('.stagedrop').forEach((s) => s.classList.remove('stagedrop'));
      if (over) over.classList.add('stagedrop');
      d.over = over;
    }
  });
  root.addEventListener('pointerup', () => finish(false));
  root.addEventListener('pointercancel', () => finish(true));
  // While a finger drags a card the page must not scroll: iOS only honours this on a non-passive touchmove.
  root.addEventListener('touchmove', (e) => { if (d?.live) e.preventDefault(); }, { passive: false });
  // A press-and-hold must not open the browser's own link menu or text selection.
  root.addEventListener('contextmenu', (e) => { if (d || Date.now() - swallow < 600) e.preventDefault(); });
  root.addEventListener('dragstart', (e) => { if (e.target.closest?.('.dealcard')) e.preventDefault(); }); // a link's native drag is not this one
  // The click after a drag lands on the card that was dragged: stop it before the router opens the deal.
  root.addEventListener('click', (e) => { if (Date.now() - swallow < 400 && e.target.closest?.('.dealcard')) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  root.ownerDocument?.addEventListener?.('keydown', (e) => { if (e.key === 'Escape' && d?.live) finish(true); });
}
