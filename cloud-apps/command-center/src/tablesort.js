// Click-to-sort for the server-rendered /track tables (Jon, 2026-11-26, card t_b5f61b3767414d44).
// Pure client side: the page embeds these functions (toString) so the browser and the tests run the same code.
// A cell sorts by its data-sort attribute if set, else its text. Numbers as numbers ($ , % stripped), dates as dates,
// text case-insensitive, blanks and dashes last in both directions.

export function cellKey(raw) {
  const s = String(raw ?? '').trim();
  if (s === '' || /^[-–—]$/.test(s)) return { t: 0, v: null };
  const n = s.replace(/[$,%\s]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(n)) return { t: 1, v: Number(n) };
  const d = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(s);
  if (d) return { t: 2, v: Date.parse(`${d[1]}T${d[2] || '00:00'}:00Z`) };
  return { t: 3, v: s.toLowerCase() };
}

// dir 1 = ascending, -1 = descending. Blanks always sort after everything else.
export function compareCells(a, b, dir) {
  const x = cellKey(a), y = cellKey(b);
  if (!x.t || !y.t) return (!x.t) - (!y.t);
  if (x.t === y.t && x.t < 3) return (x.v - y.v) * dir;
  return String(x.v).localeCompare(String(y.v), undefined, { numeric: true }) * dir;
}

// Stable sort of rows (arrays of cell values) by column col.
export function sortRows(rows, col, dir) {
  return [...rows].sort((a, b) => compareCells(a[col], b[col], dir));
}

// Browser part: every th in table.sortable sorts on click/tap, again flips; arrow shows the column; kept across reloads.
function wireSort() {
  document.querySelectorAll('table.sortable').forEach((tbl) => {
    const ths = [...tbl.tHead.rows[0].cells], body = tbl.tBodies[0], store = 'tsort:' + tbl.id;
    const val = (tr, i) => { const c = tr.cells[i]; return c ? (c.dataset.sort ?? c.textContent) : ''; };
    const apply = (col, dir) => {
      const rows = [...body.rows];
      if (rows.length < 2 || rows.some((r) => r.cells.length < ths.length)) return;
      rows.sort((a, b) => compareCells(val(a, col), val(b, col), dir)).forEach((r) => body.appendChild(r));
      ths.forEach((th, i) => { th.dataset.arrow = i === col ? (dir > 0 ? ' ▲' : ' ▼') : ''; th.setAttribute('aria-sort', i === col ? (dir > 0 ? 'ascending' : 'descending') : 'none'); });
      try { localStorage.setItem(store, JSON.stringify([col, dir])); } catch (e) { /* private mode */ }
    };
    let cur = [Number(tbl.dataset.col || 0), Number(tbl.dataset.dir || -1)];
    try { const s = JSON.parse(localStorage.getItem(store)); if (Array.isArray(s) && ths[s[0]]) cur = s; } catch (e) { /* none */ }
    ths.forEach((th, i) => {
      th.tabIndex = 0;
      const go = () => { cur = [i, cur[0] === i ? -cur[1] : (th.classList.contains('n') ? -1 : 1)]; apply(cur[0], cur[1]); };
      th.onclick = go;
      th.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    apply(cur[0], cur[1]);
  });
}

export const SORT_CSS = 'table.sortable th{cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;white-space:nowrap}table.sortable th::after{content:attr(data-arrow)}';
export const SORT_JS = `${cellKey}\n${compareCells}\n(${wireSort})();`;
