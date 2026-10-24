import { TZ } from './life.js';
import { PROJECT_ORDER, DAILY_ROWS, askedLabel, updatedLabel, ownerTag } from './tasks.js';

// Projects page (2026-10-24): one Kanban board per project, built only from tasks.json
// (published by push.py) and deliverables-today.json. Nothing here writes to either file.
// tasks.json statuses map onto the five columns:
//   todo                      -> Up next
//   doing                     -> In progress
//   blocked                   -> Waiting / Blocked
//   waiting_on_jon, no link   -> Waiting / Blocked (waiting on Jon for an answer)
//   waiting_on_jon, with link -> Review (a proof or review link is ready for Jon)
//   done                      -> Done
export const COLUMNS = [
  { key: 'upnext', label: 'Up next' },
  { key: 'doing', label: 'In progress' },
  { key: 'waiting', label: 'Waiting / Blocked' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
];

function httpLink(value) {
  const s = String(value || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

export function columnOf(status, link) {
  if (status === 'doing') return 'doing';
  if (status === 'blocked') return 'waiting';
  if (status === 'waiting_on_jon') return link ? 'review' : 'waiting';
  if (status === 'done') return 'done';
  return 'upnext';
}

// tasks.json times are Vancouver wall-clock strings; compare them with "now" read as Vancouver wall-clock.
function wallMs(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute);
}

function nowWallMs(nowMs) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(nowMs))) {
    if (x.type !== 'literal') p[x.type] = Number(x.value);
  }
  return wallMs(p);
}

// "3d", "5h", "20m": how long ago the task was asked. Blank when the stamp is unreadable.
export function ageLabel(asked, nowMs = Date.now()) {
  const m = String(asked || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return '';
  const then = wallMs({ year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] });
  const mins = Math.max(0, Math.floor((nowWallMs(nowMs) - then) / 60000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

export function buildProjects(payload, nowMs = Date.now(), collectedAt = '', daily = null, deliverables = []) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const raw = Array.isArray(data.tasks) ? data.tasks : [];
  const cards = raw.slice(0, 300).map((t) => {
    const link = httpLink(t && t.link);
    const status = String((t && t.status) || '');
    const column = columnOf(status, link);
    return {
      id: String((t && t.id) || ''),
      task: String((t && t.task) || '').trim(),
      owner: ownerTag(t && t.owner),
      project: String((t && t.project) || '').trim() || 'Other',
      column,
      needs: status === 'waiting_on_jon',
      asked: String((t && t.asked) || ''),
      age: ageLabel(t && t.asked, nowMs),
      askedLabel: askedLabel(t && t.asked, ''),
      note: String((t && t.note) || '').trim(),
      link,
    };
  }).filter((c) => c.task);
  const seen = [...new Set(cards.map((c) => c.project))];
  const names = [...PROJECT_ORDER.filter((p) => seen.includes(p)), ...seen.filter((p) => !PROJECT_ORDER.includes(p))];
  const projects = names.map((name) => {
    const mine = cards.filter((c) => c.project === name);
    const columns = COLUMNS.map((col) => {
      const list = mine.filter((c) => c.column === col.key);
      // newest first inside each column
      list.sort((a, b) => String(b.asked).localeCompare(String(a.asked)));
      return { key: col.key, label: col.label, count: list.length, cards: list };
    });
    const done = mine.filter((c) => c.column === 'done').length;
    return {
      name,
      total: mine.length,
      done,
      pct: mine.length ? Math.round(done / mine.length * 100) : 0,
      needsYou: mine.filter((c) => c.needs).length,
      columns,
      checklist: projectChecklist(name, daily, mine, deliverables, nowMs),
    };
  });
  const updated = String(data.updated || collectedAt || '');
  return {
    available: cards.length > 0,
    updated,
    updatedLabel: updatedLabel(updated, nowMs),
    total: cards.length,
    done: cards.filter((c) => c.column === 'done').length,
    projects,
  };
}

// Daily checklist sidebar: one line per slot of today's targets (6 Paul videos, 3 Heston X clips,
// the partners@ report), done when something was delivered for it. A file dated for another day
// counts as nothing delivered, same as the Tasks page.
const SLOT_TITLES = { paul: 'Paul video', heston: 'Heston X clip', inbox: 'partners@ report' };

export function buildChecklist(daily) {
  const rows = (daily && Array.isArray(daily.rows) ? daily.rows : []).filter((r) => DAILY_ROWS.some((d) => d.key === r.key));
  const groups = rows.map((r) => {
    const slots = Math.max(r.target || 0, r.items.length);
    const base = SLOT_TITLES[r.key] || r.label;
    const items = Array.from({ length: slots }, (_, i) => {
      const it = r.items[i];
      if (it) return { done: true, title: it.title || it.url || `${base} ${i + 1}`, url: it.url || '' };
      return { done: false, title: slots > 1 ? `${base} ${i + 1}` : base, url: '' };
    });
    return { key: r.key, label: r.label, done: r.items.length, target: slots, items };
  });
  const total = groups.reduce((n, g) => n + g.target, 0);
  const done = groups.reduce((n, g) => n + Math.min(g.done, g.target), 0);
  return { day: (daily && daily.day) || '', stale: !!(daily && daily.stale), done, total, groups };
}

// Each project's sidebar (2026-10-24): today's slots that belong to it, what was delivered today
// for its tasks, and its open tasks. Daily rows are claimed by project name; a delivery joins a
// project through its task id (deliverables.json "task" field).
const DAILY_PROJECT = { paul: 'YouTube & Video', heston: 'YouTube & Video', inbox: 'Sponsors' };
const OPEN_SHOWN = 8;

function dayOf(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms))) {
    if (x.type !== 'literal') p[x.type] = x.value;
  }
  return `${p.year}-${p.month}-${p.day}`;
}

export function projectChecklist(name, daily, cards, deliverables, nowMs = Date.now()) {
  const base = buildChecklist(daily);
  const groups = base.groups.filter((g) => DAILY_PROJECT[g.key] === name);
  const hasDaily = groups.length > 0;
  const seen = new Set(groups.flatMap((g) => g.items.map((i) => i.url).filter(Boolean)));
  const ids = new Set(cards.map((c) => c.id).filter(Boolean));
  const today = dayOf(nowMs);
  const items = (Array.isArray(deliverables) ? deliverables : [])
    .filter((d) => d && ids.has(String(d.task_id || '')) && !seen.has(httpLink(d.url)))
    .filter((d) => { const t = Date.parse(d.finished_at || ''); return Number.isFinite(t) && dayOf(t) === today; })
    .map((d) => ({ done: true, title: String(d.title || '').trim(), url: httpLink(d.url) }))
    .filter((i) => i.title);
  if (items.length) groups.push({ key: 'delivered', label: 'Delivered today', done: items.length, target: items.length, items });
  const open = cards.filter((c) => c.column !== 'done');
  const total = groups.reduce((n, g) => n + g.target, 0);
  const done = groups.reduce((n, g) => n + Math.min(g.done, g.target), 0);
  return {
    stale: base.stale && hasDaily,
    done,
    total,
    groups,
    open: {
      count: open.length,
      more: Math.max(0, open.length - OPEN_SHOWN),
      items: open.slice(0, OPEN_SHOWN).map((c) => ({ done: false, title: c.task, url: c.link })),
    },
  };
}
