// Dashboard 3 Budget, Expenses and P&L pages (Jon, 2026-11-21): MoneyClaw's own pages in a frame, the same pages its
// main app shows. MoneyClaw (moneyclaw.jonmac.ai) lets only itself and https://jonmac.ai frame /budget/ and /test/, and
// keeps its own sign-in: when it has expired, the frame says so and offers a sign-in on a new tab. Drawn once per visit
// (app.js), so the 60 s data reload never reloads the frame; the theme switch is passed in with postMessage.
import { headerOnly } from './goals.js';

export const MC_ORIGIN = 'https://moneyclaw.jonmac.ai';

// page -> title, sub line, the MoneyClaw page it frames, and the same tab in MoneyClaw's own app
export const MC_PAGES = {
  budget: { title: 'Budget', sub: 'Business and personal: month, week and day', path: '/budget/', app: 'budget' },
  expenses: { title: 'Expenses', sub: 'Budgets and subscriptions', path: '/test/?tab=budgets', app: 'reports' },
  pnl: { title: 'P&L', sub: 'Monthly profit and loss', path: '/test/?tab=matrix', app: 'pnl' },
};

export const isMcPage = (p) => Object.prototype.hasOwnProperty.call(MC_PAGES, p);

// The framed address: embed mode, shown inside /dash, in the dashboard's theme.
export function mcUrl(page, theme) {
  const m = MC_PAGES[page];
  if (!m) return '';
  const sep = m.path.includes('?') ? '&' : '?';
  return `${MC_ORIGIN}${m.path}${sep}embed=1&host=dash&theme=${theme === 'dark' ? 'dark' : 'light'}`;
}

export function renderMc(d2resp, page, theme) {
  const m = MC_PAGES[page];
  if (!m) return '';
  const open = `<a class="btn sm sp" href="${MC_ORIGIN}/?tab=${m.app}" target="_blank" rel="noopener">Open in MoneyClaw</a>`;
  return `${headerOnly(d2resp, m.title, m.sub, open)}
<section class="card hy mc">
<iframe id="mcFrame" data-mc="${page}" title="MoneyClaw ${m.title.replace('&', '&amp;')}" src="${mcUrl(page, theme)}" referrerpolicy="strict-origin-when-cross-origin"></iframe>
</section>`;
}

// The dashboard's Light/Dark switch: tell an open MoneyClaw frame (it accepts this from https://jonmac.ai only).
export function mcTheme(main, theme) {
  const frame = main?.querySelector?.('#mcFrame');
  if (!frame?.contentWindow) return;
  frame.contentWindow.postMessage({ type: 'moneyclaw:display', theme: theme === 'dark' ? 'dark' : 'light' }, MC_ORIGIN);
}
