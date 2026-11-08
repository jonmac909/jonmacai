import { esc, pill, pg, pgrow, tile, tiles } from '/dashboard/js/ui.js';
import { cashCard } from '/dashboard/js/cash.js';
import { render as moneyPage } from '/dashboard/js/pages/money.js';
import { age, top } from './month.js';

// Money: the d2 tiles, then /dashboard's Money page, the sponsor collections and Viral View revenue.
// Reused renderers expect their full page object; one that can't draw says so instead of blanking the page.
const safe = (title, draw) => {
  try { return draw(); } catch { return `<div class="card pad"><p class="muted">${esc(title)} could not be drawn.</p></div>`; }
};

function collections(s) {
  const rows = (s.collect?.rows || []).map((r) => `<tr><td>${esc(r.sponsor)}<small>${pill(r.pill, r.pillCls)}</small></td><td class="num">${esc(r.total)}</td><td class="num">${esc(r.owed)}</td>
    <td><div class="cellpg">${pg(r.paidPct, r.pg)}<span>${esc(r.paid)}</span></div></td><td>${esc(r.block)}</td><td>${esc(r.next)}</td></tr>`).join('');
  return `${cashCard(s.cash)}
  <div class="card pad"><div class="cardhead"><h2>${esc(s.collect?.title || 'Money to collect')}</h2><span class="meta">${esc(s.collect?.meta || '')}</span></div>
    ${rows ? `<div class="tblwrap"><table><thead><tr><th>Sponsor</th><th class="num">Total</th><th class="num">Owed</th><th>Paid so far</th><th>What's blocking it</th><th>Next step</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Nothing to collect.</p>'}</div>
  <div class="card pad"><div class="cardhead"><h2>${esc(s.byMonth?.title || 'Collected by month')}</h2><span class="meta">${esc(s.byMonth?.meta || '')}</span></div>
    <div class="pgs">${(s.byMonth?.rows || []).map(pgrow).join('')}</div></div>`;
}

const viral = (v) => `<div class="sec"><div class="bar"><h2>Viral View revenue</h2><span class="kmeta">${esc(v.sub || '')}</span></div>${tiles(v.tiles || [])}</div>`;

export function render(data) {
  const d2 = data?.d2 || {};
  const p = data?.pages || {};
  const own = (d2.money?.tiles || []).map((t) => tile({ icon: 'dollar', label: t.label, value: t.value, subHtml: `${esc(t.sub || '')}${t.source ? `<br>${age(t.source)}` : ''}` })).join('');
  return `<div class="wrap">
  ${top('Money', d2.period?.month?.label || '', d2)}
  ${own ? `<div class="tiles d2tiles">${own}</div>` : ''}
  <div class="d2sub">${p.money ? safe('Money', () => moneyPage(p.money)) : ''}</div>
  ${p.sponsors ? `<div class="sec"><div class="bar"><h2>Sponsor collections</h2></div>${safe('Sponsor collections', () => collections(p.sponsors))}</div>` : ''}
  ${p.viral ? safe('Viral View revenue', () => viral(p.viral)) : ''}
</div>`;
}
