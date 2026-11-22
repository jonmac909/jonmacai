// Budget page and 09:00 brief (card t_13a6d327341447f0): Business and Personal spend for Yesterday, Last 7 days and This
// month against fixed budgets, with each period's transactions biggest first. One calculation for both readers, served at
// GET /dashboard/api/v1/budget. Rows come from MoneyClaw's dashboard summary (snapshot 'moneyclaw', key budgetTransactions:
// { date YYYY-MM-DD Vancouver, merchant, amount positive spend, category, group 'business'|'personal', pending }).
// Travel is left out. Days are America/Vancouver: Yesterday, the 7 days before today, the 1st of this month to today.
import { vanYmd } from './periods.js';

export const BUDGETS = {
  business: { yesterday: 99, week: 692, month: 3000 },
  personal: { yesterday: 247, week: 1731, month: 7500 },
};
export const TRAVEL = ['Business Travel', 'Hotel/Accommodation', 'Flights', 'Car Rental', 'Travel Activities', 'Travel Misc'];
const TRAVEL_SET = new Set(TRAVEL.map((c) => c.toLowerCase()));
export const isTravel = (category) => TRAVEL_SET.has(String(category || '').trim().toLowerCase());

const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysInMonth = (ymd) => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)).getUTCDate();
const cents = (n) => Math.round(n * 100) / 100;

export function windows(today) {
  return {
    yesterday: { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    week: { label: 'Last 7 days', from: addDays(today, -7), to: addDays(today, -1) },
    month: { label: 'This month', from: `${today.slice(0, 8)}01`, to: today },
  };
}

function clean(r) {
  if (!r || typeof r !== 'object') return null;
  const group = String(r.group || '').toLowerCase();
  const amount = Number(r.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) || !BUDGETS[group] || !Number.isFinite(amount)) return null;
  return { date: r.date, merchant: String(r.merchant || ''), amount, category: String(r.category || ''), group, pending: !!r.pending };
}

// Fallback when the summary has no budgetTransactions: MoneyClaw's own period totals (Travel included, its own windows).
function feedTotal(expenses, group, key) {
  const p = expenses?.[group]?.[key];
  if (!p) return null;
  const n = typeof p.total === 'number' ? p.total : Number.isFinite(Number(p.totalCents)) ? Number(p.totalCents) / 100 : null;
  return n == null ? null : cents(n);
}

// summary: the stored MoneyClaw dashboard summary (parsed JSON). nowMs: the instant to count from.
export function budgetView(summary, nowMs = Date.now()) {
  const today = vanYmd(nowMs);
  const win = windows(today);
  const raw = Array.isArray(summary?.budgetTransactions) ? summary.budgetTransactions : null;
  const rows = raw ? raw.map(clean).filter((r) => r && !isTravel(r.category)) : null;
  const elapsed = Number(today.slice(8, 10));
  const dim = daysInMonth(today);
  const groups = {};
  for (const g of ['business', 'personal']) {
    const periods = {};
    for (const [key, w] of Object.entries(win)) {
      const budget = BUDGETS[g][key];
      let spent;
      let transactions = null;
      if (rows) {
        transactions = rows.filter((r) => r.group === g && r.date >= w.from && r.date <= w.to)
          .sort((a, b) => b.amount - a.amount || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
          .map(({ date, merchant, amount, category, pending }) => ({ date, merchant, amount, category, pending }));
        spent = cents(transactions.reduce((s, r) => s + r.amount, 0));
      } else {
        spent = feedTotal(summary?.expenses, g, key);
      }
      const p = { label: w.label, from: w.from, to: w.to, budget, spent, over: spent == null ? null : spent > budget, transactions };
      if (key === 'month') {
        p.projected = spent == null ? null : cents((spent / elapsed) * dim);
        p.onTrack = spent == null ? null : p.projected <= budget;
        p.green = p.onTrack;
      } else {
        p.green = spent == null ? null : !p.over;
      }
      periods[key] = p;
    }
    groups[g] = { label: g === 'business' ? 'Business' : 'Personal', periods };
  }
  return {
    today, tz: 'America/Vancouver', daysElapsed: elapsed, daysInMonth: dim,
    transactionsLoaded: !!rows,
    note: rows ? '' : 'transactions not loaded yet',
    asOf: summary?.asOf || null,
    excluded: TRAVEL,
    groups,
  };
}
