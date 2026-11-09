import { esc, pill } from '/dashboard/js/ui.js';
import { top } from './month.js';

// Funnels: every Home Guide Press book page, its price and whether Buy reaches a checkout that has taken money.
// app.js fetches /dashboard/api/d2/funnels when the page opens (a live check of every page) and on "Check again".
const cell = (x) => `${pill(x.text, x.cls)}${x.note ? `<small>${esc(x.note)}</small>` : ''}`;
const again = '<button type="button" class="btn line" data-fcheck>Check again</button>';

export function render(data) {
  const f = data?.pages?.funnels;
  const head = (sub) => top('Funnels', sub, data?.d2);
  if (!f) return `<div class="wrap">${head('Home Guide Press book pages')}<div class="card pad"><p class="muted">Checking every book page and Buy link…</p></div></div>`;
  if (f.error) return `<div class="wrap">${head('Home Guide Press book pages')}<div class="card pad"><p class="muted">Could not check the pages.</p>${again}</div></div>`;
  const rows = f.rows.map((r) => `<tr><td><b>${esc(r.book)}</b><small>${esc(r.author)}</small></td><td>${esc(r.channel)}</td>
    <td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url.replace(/^https:\/\//, ''))}</a><small>${cell(r.page)}</small></td>
    <td>${cell(r.price)}</td><td>${cell(r.buy)}</td></tr>`).join('');
  const sub = `${f.total} pages · ${f.loads} load · ${f.working} with a working checkout${f.problems ? ` · ${f.problems} to fix` : ''}`;
  return `<div class="wrap">
  ${head(sub)}
  <div class="card pad"><div class="cardhead"><h2>Book pages</h2><span class="meta">Checked live at ${esc(f.checked)} ${again}</span></div>
    ${f.salesKnown ? '' : '<p class="muted">Sales could not be read, so no checkout is proven by a sale.</p>'}
    <p class="muted">Working means Buy goes to the Commas checkout and the book's last real sale was at the page's price.</p>
    <div class="tblwrap"><table><thead><tr><th>Book</th><th>Channel</th><th>Live page</th><th>Price</th><th>Buy</th></tr></thead><tbody>${rows}</tbody></table></div></div>
</div>`;
}
