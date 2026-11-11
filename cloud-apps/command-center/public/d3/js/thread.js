// A sponsor's Gmail thread, oldest first: the Money page's deal view, and the Review page's sponsor drafts can import it.
// Data: ui.rvThreads = GET /dashboard/api/sponsor-threads ({ at, threads: { <threadId>: { subject, messages } } }),
// filled by bots/sponsor_threads.py on GPU1 (partners@, read only). Every message starts open;
// a click on a summary (data-rvmsg) folds or opens one, kept in ui.rvOpen so the 60 s refresh keeps it.
import { esc } from './util.js';

export const when = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
};

export function threadHtml(threadId, ui) {
  const T = ui?.rvThreads;
  const box = (inner) => `<div class="inner rvthread" style="gap: 8px">${inner}</div>`;
  if (!threadId) return box('<span class="mut">Email thread</span><span class="nf">No thread found</span>');
  if (!T) return box('<span class="mut">Email thread</span><span class="nf">Loading the thread</span>');
  if (T.error) return box(`<span class="mut">Email thread</span><span class="nf">Could not load the thread (${esc(T.error)})</span>`);
  const msgs = T.threads?.[threadId]?.messages || [];
  if (!msgs.length) return box('<span class="mut">Email thread</span><span class="nf">No thread found</span>');
  const rows = msgs.map((m, j) => {
    const key = `${threadId}:${j}`;
    const open = ui.rvOpen?.[key] ?? true;
    return `<details class="rvmsg"${open ? ' open' : ''}><summary data-rvmsg="${esc(key)}"><b class="ell">${esc(m.from || 'Unknown sender')}</b><span class="mut" style="flex: none">${esc(when(m.date))}</span></summary>
<p class="sub" style="white-space: pre-wrap; overflow-wrap: anywhere">${m.body ? esc(m.body) : '<span class="nf">No text</span>'}${m.quoted ? '\n<span class="mut">(earlier quoted text hidden)</span>' : ''}</p></details>`;
  }).join('\n');
  return box(`<span class="mut">Email thread · ${msgs.length} message${msgs.length === 1 ? '' : 's'}, oldest first</span>\n${rows}`);
}

// A click on a message's summary: flip it in ui.rvOpen and redraw (true when the click was one).
export function threadClick(e, ui, render) {
  const msg = e.target.closest('[data-rvmsg]');
  if (!msg) return false;
  e.preventDefault(); // the page draws open or folded from ui.rvOpen, so a refresh keeps Jon's choice
  ui.rvOpen = { ...(ui.rvOpen || {}), [msg.dataset.rvmsg]: !msg.parentElement.open };
  render();
  return true;
}
