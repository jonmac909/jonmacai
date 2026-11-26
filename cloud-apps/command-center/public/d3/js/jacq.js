// jonmac.ai/jacq (card t_9f5156f3507742d6): the detailed Budget page. Personal and Business for one month: the month total
// against its budget and % used (the 09:00 brief's numbers), then every category with its budget, spent, % used and the
// brief's label (fixed, cap, yearly). Tapping a category lists all its transactions for the month (the #budget page's
// panel, budget.js drawer). A month picker shows past months; the Travel switch is the #budget page's (same memory).
// Data: GET /dashboard/api/v1/budget[?month=YYYY-MM] (src/budget.js), MoneyClaw's own numbers.
import { esc } from './util.js';
import { drawer, shown, budgetTravel, budgetClick } from './budget.js';

const money = (n) => (n == null ? '-' : `${n < 0 ? '-' : ''}$${Math.abs(Math.round(Number(n))).toLocaleString('en-CA')}`);
const GROUPS = ['personal', 'business'];

// Whole percent, rounded down, as the brief prints it (int(spent / budget * 100)).
export const pct = (spent, budget) => Math.floor((Number(spent) / Number(budget)) * 100 + 1e-9);

function monthName(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  if (!y) return '';
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function short(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return y ? new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
}

// A category's label as the brief prints it: MoneyClaw's type, else what its budget basis says.
const label = (c) => c.type || (c.basis === 'yearly' || c.basis === 'fixed' ? c.basis : '');
function used(c) {
  if (c.budget == null) return { text: 'no budget', tone: c.spent > 0 ? 'bad' : 'none', bar: c.spent > 0 ? 100 : 0 };
  if (!c.budget) return { text: c.spent > 0 ? 'over' : '0%', tone: c.spent > 0 ? 'bad' : 'ok', bar: c.spent > 0 ? 100 : 0 };
  const p = pct(c.spent, c.budget);
  return { text: `${p}%`, tone: c.over ? 'bad' : p >= 90 ? 'warn' : 'ok', bar: Math.min(100, p) };
}

function group(b, g, travel) {
  const grp = b.groups[g];
  const p = shown(grp.periods.month, travel);
  const left = p.budget - p.spent;
  const cats = Array.isArray(p.categories) ? p.categories : [];
  const n = Array.isArray(p.transactions) ? p.transactions.length : p.count;
  const rows = cats.map((c) => {
    const u = used(c);
    const tag = label(c);
    const bud = c.budget == null ? 'no budget' : `${money(c.budget)}${c.basis === 'yearly' ? ` a year${c.due ? `, due ${c.due}` : ''}` : ''}`;
    return `<button type="button" class="jqrow ${u.tone}" data-jqcat="${g}" data-line="${esc(c.name)}">
<span class="jqn"><b>${esc(c.name)}</b>${tag ? `<em>${esc(tag)}</em>` : ''}<i>${c.count} transaction${c.count === 1 ? '' : 's'}</i></span>
<span class="jqv"><strong>${money(c.spent)}</strong><i>of ${esc(bud)}</i></span><span class="jqp">${esc(u.text)}</span>
<span class="jqbar" aria-hidden="true"><u style="width:${u.bar}%"></u></span></button>`;
  }).join('');
  return `<section class="card jqg"><header class="jqh"><h2>${esc(grp.label)}</h2><span class="jqt ${p.over ? 'bad' : 'ok'}">${money(p.spent)} / ${money(p.budget)} · ${pct(p.spent, p.budget)}%</span></header>
<p class="mut">${left >= 0 ? `${money(left)} left` : `${money(-left)} over the month budget`} · ${esc(short(p.from))} - ${esc(short(p.to))}${travel ? ' · travel counted' : ''}</p>
<button type="button" class="bgall" data-jqall="${g}"><span>All ${n} transaction${n === 1 ? '' : 's'}</span><span aria-hidden="true">›</span></button>
<div class="jqrows">${rows || '<p class="mut">No categories.</p>'}</div></section>`;
}

// data: the API body ({ ok, budget }), null while loading, or { error }. ui: { month, bgOpen, bgTravel }.
export function renderJacq(data, ui = {}) {
  const b = data?.budget;
  const months = b?.months?.length ? b.months : ui.month ? [ui.month] : [];
  const cur = b?.month || ui.month || months[0] || '';
  const pick = months.length
    ? `<select class="jqm" id="jqMonth" aria-label="Month">${months.map((m) => `<option value="${esc(m)}"${m === cur ? ' selected' : ''}>${esc(monthName(m))}</option>`).join('')}</select>`
    : '';
  const sub = b ? `CAD · data through ${short(b.latestPostedDate || b.groups?.personal?.periods?.month?.to)} · tap a category for its transactions` : 'Personal and business, every category';
  const head = `<header class="hd jqhd"><div><h1>Budget</h1><p class="mut">${esc(sub)}</p></div>${pick}</header>`;
  if (!data) return `${head}<section class="card"><p class="mut">Loading</p></section>`;
  if (data.error || !b) return `${head}<section class="card"><p class="mut">${esc(data.error || 'Budget could not be read.')}</p></section>`;
  const travel = !!ui.bgTravel;
  const sw = `<div class="bgtools"><button type="button" class="bgsw${travel ? ' on' : ''}" role="switch" aria-checked="${travel}" data-bgtravel="1"><span>Travel</span><i aria-hidden="true"><u></u></i></button><span class="mut">${travel ? 'Travel counted' : 'Travel not counted'}</span></div>`;
  return `${head}${sw}${GROUPS.filter((g) => b.groups?.[g]).map((g) => group(b, g, travel)).join('')}${ui.bgOpen ? drawer(b, ui.bgOpen, travel) : ''}`;
}

// Clicks: a category row opens its transactions, "All" opens the month's list; the rest is the #budget panel's.
export function jacqClick(e, ui) {
  const t = e.target;
  const row = t.closest?.('[data-jqcat]');
  if (row) { ui.bgOpen = { g: row.dataset.jqcat, k: 'month', view: 'line', line: row.dataset.line }; return true; }
  const all = t.closest?.('[data-jqall]');
  if (all) { ui.bgOpen = { g: all.dataset.jqall, k: 'month', view: 'all', line: null }; return true; }
  return budgetClick(e, ui);
}

function boot(root) {
  const ui = { month: new URLSearchParams(location.search).get('month') || '', bgOpen: null, bgTravel: budgetTravel() };
  let data = null;
  const draw = () => { root.innerHTML = renderJacq(data, ui); };
  async function load() {
    data = null; ui.bgOpen = null; draw();
    try {
      const res = await fetch(`/dashboard/api/v1/budget${ui.month ? `?month=${encodeURIComponent(ui.month)}` : ''}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (res.status === 401) { location.reload(); return; }
      const body = await res.json().catch(() => ({}));
      data = body.ok ? body : { error: body.error || 'Budget could not be read.' };
    } catch (err) { data = { error: err.message }; }
    draw();
  }
  document.addEventListener('click', (e) => { if (jacqClick(e, ui)) draw(); });
  document.addEventListener('change', (e) => {
    if (e.target?.id !== 'jqMonth') return;
    ui.month = e.target.value === (data?.budget?.months || [])[0] ? '' : e.target.value;
    history.replaceState(null, '', ui.month ? `?month=${ui.month}` : location.pathname);
    load();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.bgOpen) { ui.bgOpen = null; draw(); } });
  load();
}

if (typeof document !== 'undefined' && document.getElementById('jacq')) boot(document.getElementById('jacq'));
