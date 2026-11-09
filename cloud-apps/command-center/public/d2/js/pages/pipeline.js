import { esc, kanban, botName } from '/dashboard/js/ui.js';
import { render as projects } from '/dashboard/js/pages/projects.js';
import { calendar, content } from '/dashboard/js/pages/channels.js';
import { track } from '/dashboard/js/pages/track.js';
import { render as factory } from '/dashboard/js/pages/factory.js';
import { top } from './month.js';
import { stageBoard, weekCalendar } from './stages.js';

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
// Morning summary leaves every Pipeline page (summary: null; /dashboard always has one).
const named = (p) => ({ ...p, summary: null, projects: p.projects.map((l) => ({ ...l, columns: l.columns.map((c) => ({ ...c, items: c.items.map((it) => (it.kind === 'task' ? it : { ...it, from: botName(it.from) })) })) })) });

// A renderer's channel list cut to the one channel, so its own tabs and fallbacks stay out of the way.
const one = (page, slug) => ({ ...page, channels: (page?.channels || []).filter((c) => c.slug === slug) });

function channelView(data, slug, view) {
  if (view === 'track' && !data.pages?.track) return '<p class="muted">Loading Track…</p>';
  const draw = { calendar, content, track }[view];
  return draw(one(data.pages?.[view], slug), data, slug);
}

// Tabs beside a goal's Board (Jon, 2026-11-09): HGP gets the old Factory table and Track, Jon Mac the old Content page.
const GOAL_TABS = { hgp: { factory: 'Factory table', track: 'Track' }, jonmac: { content: 'Content' } };
const VIDEO_GOALS = ['hgp', 'jonmac', 'jonmacai'];

export function render(data, sub = '') {
  const d2 = data?.d2 || {};
  const boards = d2.pipeline?.boards || [];
  const [goal, a, v] = sub.split('/');
  const wk = goal === 'week';
  const b = wk ? undefined : boards.find((x) => x.goal === goal) || boards[0];
  if (!b && !wk) return `<div class="wrap">${top('Pipeline', '', d2)}<div class="card pad"><p class="muted">Pipeline has no data yet.</p></div></div>`;
  const extra = b ? GOAL_TABS[b.goal] || {} : {};
  const gv = Object.hasOwn(extra, a) ? a : null;
  const ch = !gv && (b?.channels || []).find((c) => c.slug === a);
  const view = VIEWS[v] ? v : 'calendar';
  const tabs = `<nav class="chips d2tabs" aria-label="Goals">${boards.map((x) => chip(x.title, `pipeline/${x.goal}`, x === b)).join('')}${chip('This week', 'pipeline/week', wk)}</nav>`;
  const chans = b && (b.channels?.length || gv || Object.keys(extra).length)
    ? `<nav class="chips d2tabs" aria-label="Channels">${chip('Board', `pipeline/${b.goal}`, !ch && !gv)}${Object.entries(extra).map(([k, label]) => chip(label, `pipeline/${b.goal}/${k}`, k === gv)).join('')}${(b.channels || []).map((c) => chip(c.label, `pipeline/${b.goal}/${c.slug}/calendar`, c === ch)).join('')}</nav>` : '';
  const views = ch ? `<nav class="chips d2tabs" aria-label="${esc(ch.label)}">${Object.entries(VIEWS).map(([k, label]) => chip(label, `pipeline/${b.goal}/${ch.slug}/${k}`, k === view)).join('')}</nav>` : '';
  const known = (data.pages?.projects?.projects || []).some((p) => p.slug === b?.project);
  let body;
  if (wk) body = weekCalendar(data);
  else if (gv === 'factory') body = factory(null, null, v || '');
  else if (gv === 'track') body = channelView(data, 'all', 'track');
  else if (gv === 'content') body = channelView(data, b.channels[0].slug, 'content');
  else if (ch) body = channelView(data, ch.slug, view);
  else body = `${VIDEO_GOALS.includes(b.goal) ? stageBoard(data.factory, b.channels || []) : ''}${known ? projects(named(data.pages.projects), data, b.project) : '<div class="card pad"><p class="muted">This goal has no work board yet.</p></div>'}${b.sponsors ? deals(b.sponsors) : ''}`;
  const where = wk ? 'This week' : ch ? `${b.title} · ${ch.label}` : gv ? `${b.title} · ${extra[gv]}` : b.title;
  return `<div class="wrap d2pipe">
  ${top('Pipeline', where, d2)}
  <div class="d2nav">${tabs}${chans}${views}</div>
  <div class="d2sub">${body}</div>
</div>`;
}
