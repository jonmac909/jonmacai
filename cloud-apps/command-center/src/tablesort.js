// Click-to-sort for the server-rendered /track tables (Jon, 2026-11-26, card t_b5f61b3767414d44).
// The browser code is a plain string, never Function.prototype.toString: wrangler's bundler (keep_names) rewrites
// function source with __name(...) calls that do not exist in the browser and kill every script on the page.
// Tests evaluate this same string, so the browser and the tests run the same code.
// A cell sorts by its data-sort attribute if set, else its text. Numbers as numbers ($ , % stripped), dates as dates,
// text case-insensitive, blanks and dashes last in both directions.

// cellKey(raw) -> {t, v}; compareCells(a, b, dir): dir 1 = ascending, -1 = descending, blanks always last.
// sortRows(rows, col, dir): stable sort of rows (arrays of cell values) by column col.
export const SORT_LIB = String.raw`function cellKey(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (s === '' || /^[-–—]$/.test(s)) return { t: 0, v: null };
  var n = s.replace(/[$,%\s]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(n)) return { t: 1, v: Number(n) };
  var d = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(s);
  if (d) return { t: 2, v: Date.parse(d[1] + 'T' + (d[2] || '00:00') + ':00Z') };
  return { t: 3, v: s.toLowerCase() };
}
function compareCells(a, b, dir) {
  var x = cellKey(a), y = cellKey(b);
  if (!x.t || !y.t) return (!x.t) - (!y.t);
  if (x.t === y.t && x.t < 3) return (x.v - y.v) * dir;
  return String(x.v).localeCompare(String(y.v), undefined, { numeric: true }) * dir;
}
function sortRows(rows, col, dir) {
  return rows.slice().sort(function (a, b) { return compareCells(a[col], b[col], dir); });
}
`;

// Browser part: every th in table.sortable sorts on click/tap, again flips; arrow shows the column; kept across reloads.
const WIRE = String.raw`(function () {
  document.querySelectorAll('table.sortable').forEach(function (tbl) {
    var ths = Array.prototype.slice.call(tbl.tHead.rows[0].cells), body = tbl.tBodies[0], store = 'tsort:' + tbl.id;
    var val = function (tr, i) { var c = tr.cells[i]; return c ? (c.dataset.sort != null ? c.dataset.sort : c.textContent) : ''; };
    var apply = function (col, dir) {
      var rows = Array.prototype.slice.call(body.rows);
      if (rows.length < 2 || rows.some(function (r) { return r.cells.length < ths.length; })) return;
      rows.sort(function (a, b) { return compareCells(val(a, col), val(b, col), dir); }).forEach(function (r) { body.appendChild(r); });
      ths.forEach(function (th, i) {
        th.dataset.arrow = i === col ? (dir > 0 ? ' ▲' : ' ▼') : '';
        th.setAttribute('aria-sort', i === col ? (dir > 0 ? 'ascending' : 'descending') : 'none');
      });
      try { localStorage.setItem(store, JSON.stringify([col, dir])); } catch (e) { /* private mode */ }
    };
    var okDir = function (d) { return d === 1 || d === -1; };
    var defDir = Number(tbl.dataset.dir);
    var cur = [Number(tbl.dataset.col) || 0, okDir(defDir) ? defDir : -1];
    if (!ths[cur[0]]) cur[0] = 0;
    try {
      var s = JSON.parse(localStorage.getItem(store));
      if (Array.isArray(s) && s.length === 2 && Number.isInteger(s[0]) && ths[s[0]] && okDir(s[1])) cur = s;
    } catch (e) { /* none or bad */ }
    ths.forEach(function (th, i) {
      th.tabIndex = 0;
      var go = function () { cur = [i, cur[0] === i ? -cur[1] : (th.classList.contains('n') ? -1 : 1)]; apply(cur[0], cur[1]); };
      th.onclick = go;
      th.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    apply(cur[0], cur[1]);
  });
})();
`;

export const SORT_CSS = 'table.sortable th{cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;white-space:nowrap}table.sortable th::after{content:attr(data-arrow)}';
export const SORT_JS = SORT_LIB + WIRE;
