import { ymd, TZ } from './life.js';

const STATUS = {
  waiting_on_jon: { label: 'Needs you', cls: 'risk' },
  doing: { label: 'In progress', cls: '' },
  blocked: { label: 'Blocked', cls: 'crit' },
  todo: { label: 'To do', cls: '' },
  done: { label: 'Done today', cls: 'ok' },
};

const ORDER = ['waiting_on_jon', 'doing', 'blocked', 'todo', 'done'];

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

export function updatedLabel(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  } catch {
    return '';
  }
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
      status,
      asked: askedLabel(t && t.asked, today),
      note: String((t && t.note) || '').trim(),
      link: httpLink(t && t.link),
    };
  }).filter((t) => t.task);
  const groups = ORDER.map((key) => ({
    key,
    label: STATUS[key].label,
    cls: STATUS[key].cls,
    tasks: tasks.filter((t) => t.status === key),
  })).filter((g) => g.tasks.length);
  return {
    available: tasks.length > 0,
    updated: String(data.updated || collectedAt || ''),
    updatedLabel: updatedLabel(data.updated || collectedAt),
    total: tasks.length,
    done: tasks.filter((t) => t.status === 'done').length,
    groups,
  };
}
