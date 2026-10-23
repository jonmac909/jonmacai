import { ymd, TZ } from './life.js';

// Jon's tasks panel (DESIGN.md, 2026-10-22): two tabs, Active and Up next.
// Active is waiting_on_jon, then doing, then blocked; Up next is todo; done is a
// collapsed "Done today" list at the bottom of Active.
const STATUS = {
  waiting_on_jon: { label: 'Needs you', tone: 'ok', tab: 'active' },
  doing: { label: 'In progress', tone: 'blue', tab: 'active' },
  blocked: { label: 'Blocked', tone: 'crit', tab: 'active' },
  todo: { label: 'To do', tone: 'idle', tab: 'next' },
  done: { label: 'Done', tone: 'idle', tab: 'done' },
};

const ACTIVE_ORDER = ['waiting_on_jon', 'doing', 'blocked'];

// Section order on the Tasks page (Ana, 2026-10-22; names match tasks.json). A task whose project is
// missing or new sorts after these, in the order it appears in tasks.json.
export const PROJECT_ORDER = [
  'YouTube & Video',
  'Funnels & Webinar',
  'Viral View',
  'Sponsors',
  'Short form',
  'Dashboard',
  'Money & Alerts',
  'Email & Calendar',
  'Team & Setup',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clockTime(hh, mm) {
  const h = Number(hh);
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

// tasks.json times are Vancouver wall-clock strings ("2026-10-22 15:25").
export function askedLabel(asked, todayYmd) {
  const m = String(asked || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(asked || '');
  const [, y, mo, d, hh, mm] = m;
  const time = clockTime(hh, mm);
  const day = `${y}-${mo}-${d}`;
  if (day === todayYmd) return time;
  return `${MONTHS[Number(mo) - 1] || mo} ${Number(d)} · ${time}`;
}

// "Updated 12 min ago", from the tasks.json `updated` stamp.
export function updatedLabel(iso, nowMs = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor(Math.max(0, nowMs - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(new Date(t));
  } catch {
    return '';
  }
}

// The small grey tag under a task: "Ana / Paul" becomes "#ana / #paul".
export function ownerTag(owner) {
  return String(owner || '')
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `#${s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`)
    .filter((s) => s !== '#')
    .join(' / ');
}

function httpLink(value) {
  const s = String(value || '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

export function buildTasks(payload, nowMs = Date.now(), collectedAt = '') {
  const data = payload && typeof payload === 'object' ? payload : {};
  const raw = Array.isArray(data.tasks) ? data.tasks : [];
  const today = ymd(nowMs);
  const tasks = raw.slice(0, 300).map((t) => {
    const status = STATUS[t && t.status] ? t.status : 'todo';
    return {
      id: String((t && t.id) || ''),
      task: String((t && t.task) || '').trim(),
      owner: String((t && t.owner) || '').trim(),
      ownerTag: ownerTag(t && t.owner),
      status,
      statusLabel: STATUS[status].label,
      tone: STATUS[status].tone,
      tab: STATUS[status].tab,
      project: String((t && t.project) || '').trim() || 'Other',
      needs: status === 'waiting_on_jon',
      done: status === 'done',
      asked: askedLabel(t && t.asked, today),
      note: String((t && t.note) || '').trim(),
      link: httpLink(t && t.link),
    };
  }).filter((t) => t.task);
  const active = ACTIVE_ORDER.flatMap((key) => tasks.filter((t) => t.status === key));
  const upNext = tasks.filter((t) => t.status === 'todo');
  const doneToday = tasks.filter((t) => t.status === 'done');
  const seen = [...new Set(tasks.map((t) => t.project))];
  const names = [
    ...PROJECT_ORDER.filter((p) => seen.includes(p)),
    ...seen.filter((p) => !PROJECT_ORDER.includes(p)),
  ];
  const projects = names.map((name) => {
    const mine = tasks.filter((t) => t.project === name);
    const pActive = ACTIVE_ORDER.flatMap((key) => mine.filter((t) => t.status === key));
    const pNext = mine.filter((t) => t.status === 'todo');
    const pDone = mine.filter((t) => t.status === 'done');
    return {
      name,
      active: pActive,
      upNext: pNext,
      done: pDone,
      activeCount: pActive.length,
      upNextCount: pNext.length,
      doneCount: pDone.length,
      needsYou: pActive.filter((t) => t.needs).length,
    };
  });
  const updated = String(data.updated || collectedAt || '');
  return {
    available: tasks.length > 0,
    updated,
    updatedLabel: updatedLabel(updated, nowMs),
    total: tasks.length,
    needsYou: tasks.filter((t) => t.status === 'waiting_on_jon').length,
    done: doneToday.length,
    active,
    upNext,
    doneToday,
    projects,
  };
}

// Deliverables tab (2026-10-23): everything still waiting on Jon's approval,
// however old, plus a collapsed list of what he approved in the last 24 hours.
// Approving only records a row here; it publishes or sends nothing.
const TYPE_LABELS = {
  video: 'Video',
  page: 'Landing page',
  email: 'Email',
  clip: 'X clip',
  post: 'Post',
  doc: 'Document',
  report: 'Report',
  design: 'Design',
  image: 'Image',
};

export function typeLabel(kind) {
  const k = String(kind || '').trim().toLowerCase();
  if (!k) return 'File';
  return TYPE_LABELS[k] || k.charAt(0).toUpperCase() + k.slice(1);
}

function slugId(title, owner, finished) {
  const base = `${owner || ''} ${title || ''} ${finished || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || '';
}

function stamp(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

// Shapes one pushed deliverable for storage. Bad rows (no title) are dropped.
export function normalizeDeliverables(list, source, collectedAt) {
  return (Array.isArray(list) ? list : []).slice(0, 200).map((raw) => {
    const r = raw && typeof raw === 'object' ? raw : {};
    const title = String(r.title || '').trim();
    const finished = stamp(r.finished || r.finishedAt || r.finished_at || r.at || collectedAt);
    return {
      id: String(r.id || '').trim() || slugId(title, r.owner, finished),
      title,
      owner: String(r.owner || '').trim(),
      kind: String(r.type || r.kind || '').trim().toLowerCase(),
      url: httpLink(r.url || r.link),
      finished_at: finished,
      task_id: String(r.task || r.task_id || '').trim(),
      source: source || '',
      updated_at: new Date().toISOString(),
    };
  }).filter((r) => r.id && r.title);
}

function finishedLabel(ms, nowMs) {
  if (!Number.isFinite(ms)) return '';
  let time = '';
  let day = '';
  try {
    time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
    day = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(new Date(ms));
  } catch {
    return '';
  }
  return ymd(ms) === ymd(nowMs) ? time : `${day} · ${time}`;
}

// A deliverable naming a tasks.json task that is still doing (or queued or
// blocked) is in progress, not ready for review: status comes from Ana's list.
const NOT_READY = ['doing', 'todo', 'blocked'];

export function buildDeliverables(rows, nowMs = Date.now(), tasksPayload = null) {
  const taskStatus = new Map((tasksPayload && Array.isArray(tasksPayload.tasks) ? tasksPayload.tasks : [])
    .map((t) => [String((t && t.id) || ''), String((t && t.status) || '')]));
  const all = (Array.isArray(rows) ? rows : []).map((r) => {
    const finishedMs = Date.parse(String(r.finished_at || r.finishedAt || ''));
    const approvedMs = Date.parse(String(r.approved_at || ''));
    const taskId = String(r.task_id || '').trim();
    return {
      id: String(r.id || ''),
      title: String(r.title || '').trim(),
      owner: String(r.owner || '').trim(),
      type: String(r.kind || r.type || '').trim(),
      typeLabel: typeLabel(r.kind || r.type),
      url: httpLink(r.url || r.link),
      finished: finishedLabel(finishedMs, nowMs),
      finishedAt: Number.isFinite(finishedMs) ? new Date(finishedMs).toISOString() : '',
      finishedMs,
      approved: Number.isFinite(approvedMs),
      approvedBy: String(r.approved_by || (Number.isFinite(approvedMs) ? 'Jon' : '')).trim(),
      approvedWhen: Number.isFinite(approvedMs) ? finishedLabel(approvedMs, nowMs) : '',
      taskId,
      inProgress: !Number.isFinite(approvedMs) && NOT_READY.includes(taskStatus.get(taskId)),
    };
  }).filter((r) => r.id && r.title);
  // Unapproved work stays pending until Jon approves it, however old (Ana,
  // 2026-10-23); only approved rows keep the 24 h window, applied in the query.
  const pending = all
    .filter((r) => !r.approved && !r.inProgress && Number.isFinite(r.finishedMs))
    .sort((a, b) => b.finishedMs - a.finishedMs);
  const working = all.filter((r) => r.inProgress).sort((a, b) => b.finishedMs - a.finishedMs);
  const approved = all.filter((r) => r.approved).sort((a, b) => b.finishedMs - a.finishedMs);
  return {
    available: all.length > 0,
    pending,
    working,
    approved,
    pendingCount: pending.length,
    approvedCount: approved.length,
  };
}

// Daily checklist (2026-10-23): three fixed rows that reset each Pacific day.
// Ana pushes only the items done so far; targets live here. Jon approves a row
// per day (approval id `daily:<day>:<key>`). A file dated for another day counts
// as nothing delivered today.
export const DAILY_ROWS = [
  { key: 'paul', label: 'Paul videos', target: 6, hint: 'Affiliate or Viral View' },
  { key: 'heston', label: 'Heston X posts', target: 3, hint: 'Review link and post text' },
  { key: 'inbox', label: 'partners@ inbox report', target: 1, hint: 'Leads, deals, what you must do to get paid' },
];

export function dailyApprovalId(day, key) {
  return `daily:${day}:${key}`;
}

export function isDailyApprovalId(id) {
  const m = String(id || '').match(/^daily:(\d{4}-\d{2}-\d{2}):(\w+)$/);
  return !!m && DAILY_ROWS.some((r) => r.key === m[2]);
}

export function buildDaily(payload, approvalRows = [], nowMs = Date.now()) {
  const day = ymd(nowMs);
  const fresh = !!payload && typeof payload === 'object' && String(payload.day || '') === day;
  const data = fresh ? payload : {};
  const approvals = new Map((Array.isArray(approvalRows) ? approvalRows : [])
    .map((a) => [String(a.deliverable_id || a.id || ''), a]));
  const rows = DAILY_ROWS.map((def) => {
    const items = (Array.isArray(data[def.key]) ? data[def.key] : []).slice(0, 30).map((it) => {
      const r = it && typeof it === 'object' ? it : { title: it };
      return {
        title: String(r.title || r.name || '').trim(),
        url: httpLink(r.url || r.link),
        text: String(r.text || '').trim().slice(0, 600),
      };
    }).filter((it) => it.title || it.url);
    const id = dailyApprovalId(day, def.key);
    const ap = approvals.get(id);
    const approvedMs = Date.parse(String((ap && ap.approved_at) || ''));
    return {
      id,
      key: def.key,
      label: def.label,
      hint: def.hint,
      target: def.target,
      count: items.length,
      met: items.length >= def.target,
      items,
      approved: Number.isFinite(approvedMs),
      approvedBy: String((ap && ap.approved_by) || '').trim() || (Number.isFinite(approvedMs) ? 'Jon' : ''),
      approvedWhen: Number.isFinite(approvedMs) ? finishedLabel(approvedMs, nowMs) : '',
    };
  });
  return { day, rows, stale: !fresh };
}
