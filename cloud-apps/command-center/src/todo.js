// Todo (Jon, 2026-10-30): only Jon's things for today, each actionable in place: his own open tasks
// due today, overdue or with no due date (Done), open questions (Answer), pending approvals
// (Approve/Reject) and tasks in Review (Approve, Send back). Overdue first, then the quickest.
import { ymd } from './life.js';
import { PROJECTS } from './projects.js';
import { approvalItem, questionItem } from './today.js';

const OPEN = ['todo', 'doing', 'waiting_on_jon'];
const label = (slug) => PROJECTS.find((p) => p.slug === slug)?.label || '';

export function buildTodo(out, extra = {}, nowMs = Date.now()) {
  if (!out.pages?.todo) return;
  const t = extra.today || {};
  const today = ymd(nowMs);
  const items = [];
  for (const task of t.tasks || []) {
    const mine = task.owner === 'jon' && OPEN.includes(task.status) && (!task.due || task.due <= today);
    if (!mine && task.status !== 'review') continue;
    const url = `/dashboard/api/v1/tasks/${task.id}`;
    items.push({
      kind: 'task', id: task.id, title: task.title, from: mine ? task.createdBy : task.owner, project: label(task.project), minutes: task.minutes,
      due: task.due, at: task.createdAt, overdue: mine && !!task.due && task.due < today,
      ...(mine ? { tickUrl: url } : { reviewUrl: url, deliverable: task.deliverable ?? null }),
    });
  }
  for (const a of t.approvals || []) items.push({ ...approvalItem(a), project: label(a.project), minutes: a.minutes, overdue: false });
  for (const q of t.questions || []) items.push({ ...questionItem(q), project: label(q.project), minutes: q.minutes, overdue: false });
  const mins = (x) => x.minutes ?? 1e9; // no estimate goes last
  items.sort((a, b) => b.overdue - a.overdue || mins(a) - mins(b) || String(a.at).localeCompare(String(b.at)));
  out.pages.todo = {
    title: 'Todo',
    available: !!(t.tasks && t.questions && t.approvals),
    items,
    minutes: items.reduce((n, x) => n + (x.minutes || 0), 0),
  };
}
