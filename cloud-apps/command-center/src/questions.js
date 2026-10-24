import { TZ } from './life.js';

// Questions page (2026-10-24): what Ana and the team still need from Jon. Pushed from
// questions.json; Jon's typed answer is stored in D1 and handed back through /api/answers.
const MAX_ANSWER = 4000;

function clip(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function stamp(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

export function normalizeQuestions(list, source) {
  const now = new Date().toISOString();
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, 200).map((raw) => {
    const r = raw && typeof raw === 'object' ? raw : {};
    const options = (Array.isArray(r.options) ? r.options : [])
      .map((o) => clip(o, 200)).filter(Boolean).slice(0, 6);
    return {
      id: clip(r.id, 120),
      asked_at: stamp(r.asked_at || r.askedAt || r.asked) || now,
      asker: clip(r.from || r.asker, 80),
      project: clip(r.project, 80),
      question: clip(r.question, 1000),
      context: clip(r.context, 2000),
      options: JSON.stringify(options),
      status: String(r.status || '').toLowerCase() === 'answered' ? 'answered' : 'open',
      source: source || '',
      updated_at: now,
    };
  }).filter((q) => q.id && q.question && !seen.has(q.id) && seen.add(q.id));
}

export function cleanAnswer(value) {
  return clip(value, MAX_ANSWER);
}

const DAY = { year: 'numeric', month: 'numeric', day: 'numeric' };

function label(iso, nowMs) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const fmt = (o) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...o }).format(new Date(ms));
  const today = new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...DAY }).format(new Date(nowMs));
  const time = fmt({ hour: 'numeric', minute: '2-digit' });
  return fmt(DAY) === today ? time : `${fmt({ month: 'short', day: 'numeric' })} ${time}`;
}

function parseOptions(text) {
  try {
    const list = JSON.parse(text || '[]');
    return Array.isArray(list) ? list.filter((o) => typeof o === 'string' && o) : [];
  } catch {
    return [];
  }
}

export function buildQuestions(rows, nowMs = Date.now()) {
  const all = (Array.isArray(rows) ? rows : []).map((r) => ({
    id: r.id,
    from: r.asker || 'Ana',
    project: r.project || '',
    question: r.question,
    context: r.context || '',
    options: parseOptions(r.options),
    askedAt: r.asked_at || '',
    askedLabel: label(r.asked_at, nowMs),
    answered: r.status === 'answered' || !!r.answer,
    answer: r.answer || '',
    answeredAt: r.answered_at || '',
    answeredLabel: label(r.answered_at, nowMs),
  }));
  const open = all.filter((q) => !q.answered).sort((a, b) => String(b.askedAt).localeCompare(String(a.askedAt)));
  const answered = all.filter((q) => q.answered)
    .sort((a, b) => String(b.answeredAt || b.askedAt).localeCompare(String(a.answeredAt || a.askedAt)))
    .slice(0, 50);
  return { openCount: open.length, open, answered };
}
