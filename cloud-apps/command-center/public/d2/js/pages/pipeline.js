import { esc, kanban, botName } from '/dashboard/js/ui.js';
import { render as projects } from '/dashboard/js/pages/projects.js';
import { calendar, content } from '/dashboard/js/pages/channels.js';
import { track } from '/dashboard/js/pages/track.js';
import { top } from './month.js';

// Pipeline: one tab per goal with its Projects board (the /dashboard renderer, so cards, modals and
// buttons work the same). Sponsors adds the cleaned deal board, view only; video goals add channel
// tabs with Calendar, Content and Track. Route: #pipeline/<goal>[/<channel>/<calendar|content|track>].
const VIEWS = { calendar: 'Calendar', content: 'Content', track: 'Track' };
const chip = (label, page, on) => `<button type="button" class="chip${on ? ' on' : ''}" data-page="${esc(page)}"${on ? ' aria-current="page"' : ''}>${esc(label)}</button>`;
const usd = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The existing sponsor board without its buttons and drag (moves happen on /dashboard).
const board = (cols) => kanban(cols.map((c) => ({ ...c, stage: c.stage ?? c.title, cards: (c.cards || []).map((k) => ({ ...k, btn: '' })) })))
  .replace(/ draggable="true"/g, '').replace(' id="kan"', '');

function deals(s) {
  const cols = s.board?.columns || [];
  const archived = cols.filter((c) => c.archived);
  const n = archived.reduce((a, c) => a + (c.cards?.length || 0), 0);
  const v = s.value;
  const h = s.hidden;
  const meta = [
    v ? `Pipeline ${usd(v.usd)} from ${plural(v.priced, 'priced lead', 'priced leads')}${v.unpriced ? ` (${v.unpriced} not priced)` : ''}` : '',
    h ? `Hidden: ${plural(h.receipts || 0, 'receipt', 'receipts')}, ${plural(h.refunds || 0, 'refund', 'refunds')}, ${plural(h.newsletters || 0, 'newsletter', 'newsletters')}` : '',
  ].filter(Boolean).map(esc).join(' · ');
  return `<div class="sec d2deals"><div class="bar"><h2>Deal board</h2><span class="kmeta">${meta}</span></div>
    ${board(cols.filter((c) => !c.archived))}
    ${n ? `<details class="d2arch" data-keep="archived"><summary>Show archived (${n})</summary>${board(archived)}</details>` : ''}</div>`;
}

// The board's questions and approvals by the asker's name, as its task cards already are.
const named = (p) => ({ ...p, projects: p.projects.map((l) => ({ ...l, columns: l.columns.map((c) => ({ ...c, items: c.items.map((it) => (it.kind === 'task' ? it : { ...it, from: botName(it.from) })) })) })) });

// A renderer's channel list cut to the one channel, so its own tabs and fallbacks stay out of the way.
const one = (page, slug) => ({ ...page, channels: (page?.channels || []).filter((c) => c.slug === slug) });

function channelView(data, slug, view) {
  if (view === 'track' && !data.pages?.track) return '<p class="muted">Loading Track…</p>';
  const draw = { calendar, content, track }[view];
  return draw(one(data.pages?.[view], slug), data, slug);
}

export function render(data, sub = '') {
  const d2 = data?.d2 || {};
  const boards = d2.pipeline?.boards || [];
  const [goal, slug, v] = sub.split('/');
  const b = boards.find((x) => x.goal === goal) || boards[0];
  if (!b) return `<div class="wrap">${top('Pipeline', '')}<div class="card pad"><p class="muted">Pipeline has no data yet.</p></div></div>`;
  const ch = (b.channels || []).find((c) => c.slug === slug);
  const view = VIEWS[v] ? v : 'calendar';
  const tabs = `<nav class="chips d2tabs" aria-label="Goals">${boards.map((x) => chip(x.title, `pipeline/${x.goal}`, x === b)).join('')}</nav>`;
  const chans = b.channels?.length ? `<nav class="chips d2tabs" aria-label="Channels">${chip('Board', `pipeline/${b.goal}`, !ch)}${b.channels.map((c) => chip(c.label, `pipeline/${b.goal}/${c.slug}/calendar`, c === ch)).join('')}</nav>` : '';
  const views = ch ? `<nav class="chips d2tabs" aria-label="${esc(ch.label)}">${Object.entries(VIEWS).map(([k, label]) => chip(label, `pipeline/${b.goal}/${ch.slug}/${k}`, k === view)).join('')}</nav>` : '';
  const known = (data.pages?.projects?.projects || []).some((p) => p.slug === b.project);
  const body = ch ? channelView(data, ch.slug, view)
    : `${known ? projects(named(data.pages.projects), data, b.project) : '<div class="card pad"><p class="muted">This goal has no work board yet.</p></div>'}${b.sponsors ? deals(b.sponsors) : ''}`;
  return `<div class="wrap d2pipe">
  ${top('Pipeline', ch ? `${b.title} · ${ch.label}` : b.title)}
  <div class="d2nav">${tabs}${chans}${views}</div>
  <div class="d2sub">${body}</div>
</div>`;
}
