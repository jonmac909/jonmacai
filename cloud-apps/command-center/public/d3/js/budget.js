// Budget page (card t_13a6d327341447f0): Business and Personal rows, each with Yesterday, Last 7 days and This month cards
// (green under budget or on track, red over). Tapping a card lists that period's transactions, biggest first.
// Data: GET /dashboard/api/v1/budget (src/budget.js), the same numbers the 09:00 brief shows.
import { esc } from './util.js';
import { headerOnly } from './goals.js';

const money = (n) => (n == null ? '-' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
const money2 = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PERIODS = ['yesterday', 'week', 'month'];

function card(g, k, p, open) {
  const tone = p.green == null ? '' : p.green ? ' ok' : ' bad';
  const track = k === 'month' && p.onTrack != null ? `<span>On track for month: ${p.onTrack ? 'yes' : 'no'}</span>` : '';
  return `<button type="button" class="bgc${tone}" data-bgopen="${g}/${k}" aria-pressed="${open ? 'true' : 'false'}">
<small>${esc(p.label)}</small><b>${money(p.spent)}</b><span>of ${money(p.budget)}${p.over ? ' · over' : ''}</span>${track}</button>`;
}

function list(b, g, k) {
  const p = b.groups[g].periods[k];
  const head = `<h2>${esc(b.groups[g].label)} · ${esc(p.label)}</h2>`;
  if (!Array.isArray(p.transactions)) return `<section class="card bgl">${head}<p class="mut">Transactions not loaded yet.</p></section>`;
  if (!p.transactions.length) return `<section class="card bgl">${head}<p class="mut">No transactions.</p></section>`;
  const rows = p.transactions.map((t) => `<tr><td>${esc(t.date.slice(5))}</td><td>${esc(t.merchant)}${t.pending ? ' <i>pending</i>' : ''}</td><td class="bgn">${money2(t.amount)}</td><td>${esc(t.category)}</td></tr>`).join('');
  return `<section class="card bgl">${head}<table><thead><tr><th>Date</th><th>Merchant</th><th class="bgn">Amount</th><th>Category</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

// data: the API body ({ ok, budget }), null while loading, or { error }. open: 'business/week' or null.
export function renderBudget(d2resp, data, open) {
  const head = headerOnly(d2resp, 'Budget', 'Business and personal: yesterday, last 7 days, this month. Travel not counted.');
  if (!data) return `${head}<section class="card"><p class="mut">Loading</p></section>`;
  if (data.error || !data.budget) return `${head}<section class="card"><p class="mut">${esc(data.error || 'Budget could not be read.')}</p></section>`;
  const b = data.budget;
  const rows = ['business', 'personal'].map((g) => `<section class="bgrow"><h2>${esc(b.groups[g].label)}</h2><div class="bgcards">${PERIODS.map((k) => card(g, k, b.groups[g].periods[k], open === `${g}/${k}`)).join('')}</div></section>`).join('');
  const note = b.transactionsLoaded ? '' : '<p class="mut bgnote">Transactions not loaded yet: totals are MoneyClaw\'s own and include Travel.</p>';
  const [og, ok] = String(open || '').split('/');
  const opened = b.groups[og]?.periods[ok] ? list(b, og, ok) : '';
  return `${head}<div class="bg">${rows}${note}${opened}</div>`;
}
