// Projects page (2026-10-29): one entry per project with its goal cards and a board of its bot
// tasks, questions and approvals, plus one Today checklist: what needs Jon, then each bot's work for the day.
import { agoLabel, approvalItem, goalCards, questionItem, summaryCard, vanMidnight } from './today.js';

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
const COLUMNS = [['todo', 'To do'], ['doing', 'Doing'], ['waiting_on_jon', 'Waiting on Jon'], ['qc', 'QC'], ['done', 'Done']];
const OPEN = ['todo', 'doing', 'waiting_on_jon'];
const IN_PROGRESS = ['doing', 'waiting_on_jon', 'qc'];
const TZ = 'America/Vancouver';

const minutesLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

export function buildProjects(out, by, cash, extra = {}, nowMs = Date.now()) {
  if (!out.pages?.projects) return;
  const t = extra.today || {};
  const feeds = t.feeds || {};
  const goals = goalCards(by, cash, feeds, nowMs);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(nowMs)); // YYYY-MM-DD
  const dayStart = new Date(vanMidnight(...today.split('-').map(Number))).toISOString();
  const weekAgo = new Date(nowMs - 7 * 86400000).toISOString();
  const age = (at) => (Number.isFinite(Date.parse(at)) ? agoLabel(Math.max(0, nowMs - Date.parse(at))) : '');
  const lanes = [...PROJECTS, { slug: 'unsorted', label: 'Unsorted' }].map((p) => ({
    ...p, waiting: 0, goals: goals.filter((g) => (GOALS[p.slug] || []).includes(g.key)),
    columns: COLUMNS.map(([key, label]) => ({ key, label, items: [] })),
  }));
  const laneOf = (slug) => lanes.find((l) => l.slug === slug) || lanes.at(-1);
  const column = (lane, key) => lane.columns.find((c) => c.key === key).items;
  // Checklist groups by owner, Jon's first. Only Jon's open tasks tick from here; a team task is
  // ticked when its bot moves it to done, which still needs a QC-passed proof.
  const groups = new Map([['jon', []]]);
  const check = (owner, lane, it, done = false) => {
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push({
      kind: it.kind, id: it.id, slug: lane.slug, project: lane.label, title: it.title, minutes: it.minutes ?? (it.kind === 'task' ? 15 : 2), done,
      ...(it.tickUrl ? { tickUrl: it.tickUrl } : it.kind === 'task' ? {} : { page: `projects/${lane.slug}`, card: it.answerUrl || it.decideUrl }),
    });
  };

  for (const task of t.tasks || []) {
    if (task.status === 'cancelled' || (task.status === 'done' && !(task.doneAt >= weekAgo))) continue;
    const lane = laneOf(task.project);
    const jon = task.owner === 'jon' && OPEN.includes(task.status);
    const item = {
      kind: 'task', id: task.id, title: task.title, from: task.owner === 'jon' ? 'Jon' : task.owner, minutes: task.minutes,
      ageLabel: age(task.createdAt), proof: /^https?:\/\//i.test(task.proofLink || '') ? task.proofLink : '',
      ...(jon ? { tickUrl: `/dashboard/api/v1/tasks/${task.id}` } : {}),
    };
    column(lane, task.status).push(item);
    if (jon || task.status === 'waiting_on_jon') lane.waiting++;
    const doneToday = task.status === 'done' && task.doneAt >= dayStart;
    const dueNow = task.owner === 'jon' ? jon && (!task.due || task.due <= today)
      : IN_PROGRESS.includes(task.status) || (task.status === 'todo' && !!task.due && task.due <= today);
    if (dueNow || doneToday) check(task.owner, lane, item, doneToday);
  }
  const asks = [...(t.approvals || []).map((a) => [a, approvalItem(a)]), ...(t.questions || []).map((q) => [q, questionItem(q)])];
  for (const [row, base] of asks) {
    const lane = laneOf(row.project);
    const item = { ...base, minutes: row.minutes, ageLabel: age(row.createdAt) };
    column(lane, 'waiting_on_jon').push(item);
    lane.waiting++;
    check('jon', lane, item);
  }

  const order = (it) => lanes.findIndex((l) => l.slug === it.slug);
  const owners = [...groups.keys()].sort((a, b) => (b === 'jon') - (a === 'jon') || a.localeCompare(b));
  const checklist = owners.map((owner) => {
    const items = groups.get(owner).sort((a, b) => order(a) - order(b));
    return { owner, label: owner === 'jon' ? 'Jon' : owner, done: items.filter((i) => i.done).length, total: items.length, items };
  }).filter((g) => g.total);
  const minutes = groups.get('jon').reduce((n, it) => n + (it.done ? 0 : it.minutes), 0);
  const cal = feeds.calendar_today;
  out.pages.projects = {
    title: 'Projects',
    available: !!(t.tasks && t.questions && t.approvals),
    projects: lanes.filter((l) => l.slug !== 'unsorted' || l.columns.some((c) => c.items.length)),
    today: { groups: checklist, minutes, total: minutesLabel(minutes) },
    summary: summaryCard(feeds.morning_summary, nowMs),
    calendar: cal?.data?.date === today
      ? { events: (cal.data.events || []).map((e) => ({ time: `${e.start}-${e.end}`, title: e.title })) }
      : { missing: "Ana posts today's calendar each morning." },
  };
}
