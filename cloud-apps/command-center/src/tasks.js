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

// Section order on the Tasks page (Ana, 2026-10-22). A task whose project is
// missing or new sorts after these, in the order it appears in tasks.json.
export const PROJECT_ORDER = [
  'YouTube & video',
  'Funnels & webinar',
  'Viral View',
  'Sponsors',
  'Short form',
  'Dashboard & tasks',
  'Money & finance',
  'Email & calendar',
  'Team & systems',
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
