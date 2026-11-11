// Small helpers shared by the Dashboard 3 pages (plain ES modules, no build step).
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

// A d2 status ({ text, cls }) as the design's tone letter: g, y, r, or n (grey, no data).
export function toneOf(status) {
  if (!status) return 'n';
  if (status.cls === 'ok') return 'g';
  if (status.cls === 'risk') return 'y';
  if (status.cls === 'crit') return 'r';
  return status.text === 'On pace' ? 'g' : 'n';
}

// Hours into the day in Vancouver, as a share of the day (0 to 1), for the "today" marker.
export function dayShare(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0.5;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(t)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Math.min(1, ((p.hour || 0) * 60 + (p.minute || 0)) / 1440);
}

export const ICON = {
  goals: '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1"></circle>',
  money: '<path d="M12 2v20"></path><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>',
  blockers: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
  review: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><path d="M22 4 12 14.01l-3-3"></path>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"></path>',
  open: '<path d="M7 17 17 7"></path><path d="M8 7h9v9"></path>',
  film: '<rect x="3" y="5" width="18" height="14" rx="3"></rect><path d="m10 9 5 3-5 3z"></path>',
  video: '<path d="M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM10 9l5 3-5 3z"></path>',
  bot: '<path d="M8 8h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3zM12 4v4M9 13h.01M15 13h.01"></path>',
  heart: '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1z"></path>',
};
export const icon = (k) => `<svg class="ic" aria-hidden="true" viewBox="0 0 24 24">${ICON[k]}</svg>`;
