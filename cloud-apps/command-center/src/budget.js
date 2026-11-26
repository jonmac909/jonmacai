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

// MoneyClaw's own Budget page view (summary.budgetSimple = its /api/budget-simple, card t_9a6930f719354c07): the same
// numbers, Travel switch block (withTravel) and per-category rows its /budget page shows, so #budget needs no MoneyClaw
// sign-in. Its windows: Yesterday, the 7 days ending yesterday, the 1st to yesterday. Card colour = over budget or not.
const LABELS = { yesterday: 'Yesterday', week: 'Last 7 days', month: 'This month' };
const txns = (list) => (Array.isArray(list) ? list : []).map(({ date, merchant, amount, category, line, pending, currency, account }) => ({ date, merchant, amount, category, line, pending: !!pending, currency, ...(account ? { account } : {}) }));
// Past months (budgetMonths) store one list, withTravel.txns; the no-Travel list is that list without the Travel line.
const noTravel = (list) => (Array.isArray(list) ? list : []).filter((t) => t?.line !== 'Travel');
function fromSimple(simple, summary) {
  const groups = {};
  for (const g of simple.groups || []) {
    if (!BUDGETS[g?.key]) continue;
    const periods = {};
    for (const key of ['yesterday', 'week', 'month']) {
      const s = g.periods?.[key] || {};
      const w = s.withTravel || {};
      const p = {
        label: LABELS[key], from: s.startDate, to: s.endDate, budget: s.budget, spent: s.spent, over: !!s.over, green: !s.over,
        count: s.count, transactions: txns(Array.isArray(s.txns) ? s.txns : noTravel(w.txns)), categories: Array.isArray(s.categories) ? s.categories : [], excludedTravel: s.excludedTravel ?? 0,
        withTravel: { spent: w.spent, over: !!w.over, green: !w.over, count: w.count, transactions: txns(w.txns), categories: Array.isArray(w.categories) ? w.categories : [] },
      };
      if (key === 'month') {
        Object.assign(p, { onTrack: !!s.onTrack, paceBudget: s.paceBudget, daysGone: s.daysGone, daysInMonth: s.daysInMonth });
        p.withTravel.onTrack = !!w.onTrack;
      }
      periods[key] = p;
    }
    groups[g.key] = { label: g.label || (g.key === 'business' ? 'Business' : 'Personal'), periods };
  }
  if (!groups.business || !groups.personal) return null;
  const m = groups.business.periods.month;
  return {
    source: 'moneyclaw', today: simple.today, month: simple.month, tz: 'America/Vancouver', daysElapsed: m.daysGone, daysInMonth: m.daysInMonth,
    transactionsLoaded: true, note: '', asOf: summary?.asOf || null, latestPostedDate: simple.latestPostedDate || null, excluded: TRAVEL, groups,
  };
}

// Months the summary holds, newest first: this month (budgetSimple) and the past ones (budgetMonths, card t_9f5156f3507742d6).
const YM = /^\d{4}-\d{2}$/;
export function budgetMonths(summary) {
  const all = [summary?.budgetSimple?.month, ...Object.keys(summary?.budgetMonths || {})].filter((m) => YM.test(m || ''));
  return [...new Set(all)].sort().reverse();
}
const monthName = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// summary: the stored MoneyClaw dashboard summary (parsed JSON). nowMs: the instant to count from.
// month: 'YYYY-MM' of a past month (jonmac.ai/jacq's month picker): MoneyClaw's own view of that whole month from
// summary.budgetMonths, null when the summary does not hold it. No month (or this month): the view below.
// Every view lists the months it can show (months).
export function budgetView(summary, nowMs = Date.now(), month = null) {
  if (month && month !== summary?.budgetSimple?.month) {
    const past = summary?.budgetMonths?.[month];
    const v = past && typeof past === 'object' && past.month === month ? fromSimple(past, summary) : null;
    if (!v) return null;
    for (const g of Object.values(v.groups)) g.periods.month.label = monthName(month);
    return { ...v, months: budgetMonths(summary) };
  }
  return { ...currentView(summary, nowMs), months: budgetMonths(summary) };
}

function currentView(summary, nowMs) {
  if (summary?.budgetSimple && typeof summary.budgetSimple === 'object') {
    const v = fromSimple(summary.budgetSimple, summary);
    if (v) return v;
  }
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
