// Weekly and Monthly pages (Jon, 2026-11-05). Week = Monday to Sunday, month = calendar month, both in
// Vancouver time. The counts are one snapshot row ('periods') posted by tools/factory_publish.py (a plain script,
// no model, no bot wakes); Jon's habit ticks are rows in `habits` (day = week's Monday or YYYY-MM, kind = wk:/mo:).
const TZ = 'America/Vancouver';

export const WEEK_HABITS = [
  { key: 'recording', label: 'Monday recording' },
  { key: 'webinar', label: 'Wednesday webinar' },
  { key: 'expenses', label: 'Friday expenses' },
];
export const MONTH_HABITS = [
  { key: 'networth', label: 'Net worth (on the 1st)' },
  { key: 'close', label: 'Month close' },
  { key: 'budget', label: 'Budget vs spend' },
  { key: 'gst', label: 'GST (quarterly)' },
];

// The Vancouver calendar day of an instant, as YYYY-MM-DD.
export function vanYmd(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

// The Monday of that Vancouver day's week, as YYYY-MM-DD.
export function weekStart(ms) {
  const day = vanYmd(ms);
  const dow = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.parse(`${day}T12:00:00Z`) - dow * 86400000).toISOString().slice(0, 10);
}

export const monthKey = (ms) => vanYmd(ms).slice(0, 7);
