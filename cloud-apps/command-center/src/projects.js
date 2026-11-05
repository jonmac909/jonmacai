// Projects page (2026-10-29): one entry per project with its goal cards, a board of its bot tasks,
// questions and approvals, and its own daily checklist (the daily_checklists feed, ticked by its bot).
import { ymd } from './life.js';
import { agoLabel, approvalItem, goalCards, questionItem, summaryCard } from './today.js';

// The one list of projects, in page order. bots/dash.py keeps a copy for its local check.
export const PROJECTS = [
  { slug: 'sponsors', label: 'Sponsors' },
  { slug: 'jon-mac', label: 'YT-JM' },
  { slug: 'jonmacai', label: 'YT-AI UGC' },
  { slug: 'viral-view', label: 'Viral View' },
  { slug: 'home-guide-press', label: 'Home Guide Press' },
  { slug: 'short-form', label: 'Short-form' },
  { slug: 'accounting', label: 'Accounting' },
  { slug: 'coding', label: 'Coding' },
];
// Today's goal cards (by key) that each project shows; the webinar funnel is part of Viral View.
const GOALS = { sponsors: ['sponsors'], 'viral-view': ['viral', 'webinar'], 'home-guide-press': ['ebooks'] };
const COLUMNS = [['todo', 'To do'], ['doing', 'Doing'], ['waiting_on_jon', 'Waiting on Jon'], ['qc', 'QC'], ['review', 'Review'], ['done', 'Done']];
const OPEN = ['todo', 'doing', 'waiting_on_jon'];

export function buildProjects(out, by, cash, extra = {}, nowMs = Date.now()) {
  if (!out.pages?.projects) return;
  const t = extra.today || {};
  const feeds = t.feeds || {};
  const goals = goalCards(by, cash, feeds, nowMs);
  const today = ymd(nowMs);
  const weekAgo = new Date(nowMs - 7 * 86400000).toISOString();
  const age = (at) => (Number.isFinite(Date.parse(at)) ? agoLabel(Math.max(0, nowMs - Date.parse(at))) : '');
  const lists = feeds.daily_checklists?.data?.projects || {};
  const ticks = new Map((t.dailyTicks || []).map((x) => [`${x.project}\n${x.item}`, x])); // today's only (todayData)
  const checklist = (slug) => {
    const items = (lists[slug] || []).map((text) => {
      const tick = ticks.get(`${slug}\n${text}`);
      return tick ? { text, done: true, by: tick.bot, ageLabel: age(tick.createdAt), link: tick.link } : { text, done: false };
    });
    return items.length ? { items, done: items.filter((i) => i.done).length, total: items.length }
      : { missing: 'Ana syncs the daily checklist with dash.py daily-sync' };
  };
  const lanes = [...PROJECTS.map((p) => ({ ...p, checklist: checklist(p.slug) })), { slug: 'unsorted', label: 'Unsorted' }].map((p) => ({
    ...p, waiting: 0, goals: goals.filter((g) => (GOALS[p.slug] || []).includes(g.key)),
    columns: COLUMNS.map(([key, label]) => ({ key, label, items: [] })),
  }));
  const laneOf = (slug) => lanes.find((l) => l.slug === slug) || lanes.at(-1);
  const column = (lane, key) => lane.columns.find((c) => c.key === key).items;

  for (const task of t.tasks || []) {
    if (task.status === 'cancelled' || (task.status === 'done' && !(task.doneAt >= weekAgo))) continue;
    const lane = laneOf(task.project);
    const jon = task.owner === 'jon' && OPEN.includes(task.status);
    const review = task.status === 'review'; // QC passed it; Jon approves it or sends it back
    column(lane, task.status).push({
      kind: 'task', id: task.id, title: task.title, from: task.owner === 'jon' ? 'Jon' : task.owner,
      ageLabel: age(task.createdAt), proof: /^https?:\/\//i.test(task.proofLink || '') ? task.proofLink : '',
      deliverable: task.deliverable ?? null,
      ...(jon ? { tickUrl: `/dashboard/api/v1/tasks/${task.id}` } : {}),
      ...(review ? { reviewUrl: `/dashboard/api/v1/tasks/${task.id}` } : {}),
    });
    if (jon || review || task.status === 'waiting_on_jon') lane.waiting++;
  }
  const asks = [...(t.approvals || []).map((a) => [a, approvalItem(a)]), ...(t.questions || []).map((q) => [q, questionItem(q)])];
  for (const [row, base] of asks) {
    const lane = laneOf(row.project);
    column(lane, 'waiting_on_jon').push({ ...base, ageLabel: age(row.createdAt) });
    lane.waiting++;
  }

  const cal = feeds.calendar_today;
  out.pages.projects = {
    title: 'Projects',
    available: !!(t.tasks && t.questions && t.approvals),
    projects: lanes.filter((l) => l.slug !== 'unsorted' || l.columns.some((c) => c.items.length)),
    summary: summaryCard(feeds.morning_summary, nowMs),
    calendar: cal?.data?.date === today
      ? { events: (cal.data.events || []).map((e) => ({ time: `${e.start}-${e.end}`, title: e.title })) }
      : { missing: "Ana posts today's calendar each morning." },
  };
}
