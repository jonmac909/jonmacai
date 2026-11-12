// Dashboard 3 Track page (docs/dashboard-3.md): the old Track page (/dashboard/#track), drawn by its own code. The shell
// (app.js) imports the old renderer from /dashboard/js/pages/track.js and hands it in as `draw`, with the same data the
// old page reads (GET /dashboard/api/snapshot?pages=track -> pages.track). Nothing is rewritten here: this only wraps the
// old markup in .tkpage, which d3.css styles for Dashboard 3's light and dark themes, and covers the states before data.
const note = (text) => `<div class="tkpage"><div class="wrap"><div class="head"><div><h1>Track</h1></div></div><section class="card"><p class="mut">${text}</p></section></div></div>`;

// The channel in the route: "#track/peter-collins" -> "peter-collins"; "#track" -> "" (All channels).
export function trackSub(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/');
  if (parts[0].toLowerCase() !== 'track') return '';
  try { return decodeURIComponent(parts.slice(1).join('/')); } catch { return ''; }
}

// page: pages.track from the snapshot; null while it loads; { failed: true } when it could not be read.
export function renderTrack(page, sub, draw) {
  if (!page) return note('Loading Track');
  if (page.failed || typeof draw !== 'function') return note('Could not load Track. It tries again when you open this page.');
  return `<div class="tkpage">${draw(page, null, sub || '')}</div>`;
}
