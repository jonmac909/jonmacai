// Dashboard 2 Pending (docs/dashboard-2-pending.md): every card marked as Jon's ask, grouped Done / In progress /
// Blocked. View only: it reads bot_tasks and bot_questions and writes nothing.
import { nameOf, plain } from './d2.js';
import { vanYmd } from './periods.js';
import { agoLabel } from './today.js';

// A card is Jon's ask when its title says so ("Jon's ask: ...", "... (Jon's ask via Ana)"), straight or curly apostrophe.
const MARK = /\bjon['’]s ask\b/i;
const STAGE = { todo: 'Not started', doing: 'In production', qc: 'In QC', review: 'In Review', waiting_on_jon: 'Waiting on you', done: 'Done' };
const FIRST_NAMES = ['Ana', 'Florence', 'Olivia', 'Scarlett', 'Sydney', 'Elle', 'Samantha', 'Elizabeth', 'Lucy', 'Jessica', 'Zendaya', 'Daisy', 'Mila', 'Emma', 'Indy', 'Ivy', 'Jon'];

export async function pendingData(db) {
  if (!db) return null;
  try {
    const [cards, questions] = await Promise.all([
      // Cancelled cards are not pending. Newest update first, so a cap drops the oldest.
      db.prepare("SELECT id, title, owner, status, note, due, updated_at, done_at FROM bot_tasks WHERE status != 'cancelled' AND title LIKE '%Jon_s ask%' ORDER BY updated_at DESC LIMIT 501").all(),
      db.prepare("SELECT task_id, asked_by, question FROM bot_questions WHERE status = 'open' AND task_id IS NOT NULL").all(),
    ]);
    return { cards: cards.results || [], questions: questions.results || [] };
  } catch (err) {
    console.error('pending', err);
    return null;
  }
}

const realDay = (ymd) => /^\d{4}-\d{2}-\d{2}$/.test(ymd) && Number.isFinite(Date.parse(`${ymd}T12:00:00Z`)) && new Date(`${ymd}T12:00:00Z`).toISOString().slice(0, 10) === ymd; // 2026-02-30 is no day
const day = (ymd) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`));
const clock = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));

// Due is a day (YYYY-MM-DD) or a full time; no due time is said out loud, never hidden.
function dueOf(due, closed, nowMs) {
  if (!due) return { label: 'No due time set', on: null, late: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(due) && !realDay(due)) return { label: 'No due time set', on: null, late: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return { label: `Due ${day(due)}`, on: due, late: !closed && due < vanYmd(nowMs) };
  const at = Date.parse(due);
  return Number.isFinite(at) ? { label: `Due ${clock(at)}`, on: new Date(at).toISOString(), late: !closed && at < nowMs } : { label: 'No due time set', on: null, late: false };
}

// Who a "Blocked ..." line in a card note is waiting on: the first team first name it mentions.
const fromLine = (line) => FIRST_NAMES.find((n) => new RegExp(`\\b${n}\\b`).test(line)) || (/\b(needs?|waiting (on|for)|from) you\b/i.test(line) ? 'You' : 'Not named on the card');

function blockOf(card, asked) {
  if (asked) return { needs: `Your answer to "${plain(asked.question)}"`, from: 'You' };
  if (card.status === 'waiting_on_jon') return { needs: plain(card.note) || 'Waiting on you', from: 'You' };
  const line = String(card.note || '').split('\n').map((l) => l.replace(/^[\s\-*•]+/, '')).find((l) => /^blocked\b/i.test(l));
  return line ? { needs: plain(line.replace(/^blocked\s*(on|by)?:?\s*/i, '')) || 'Blocked', from: fromLine(line) } : null;
}

// Newest cards first by update; each group then sorted for reading: done newest first, the rest by due day then longest quiet.
export function buildPending(data, nowMs) {
  if (!data) return null;
  const open = new Map();
  for (const q of data.questions) if (!open.has(q.task_id)) open.set(q.task_id, q);
  const groups = { done: [], progress: [], blocked: [] };
  for (const c of data.cards.slice(0, 500)) {
    if (!MARK.test(c.title)) continue;
    const closed = c.status === 'done';
    const block = closed ? null : blockOf(c, open.get(c.id));
    const at = Date.parse(closed ? c.done_at || c.updated_at : c.updated_at);
    const row = {
      id: c.id, title: c.title, owner: nameOf(c.owner),
      status: closed ? { text: 'Done', cls: 'ok' } : block ? { text: 'Blocked', cls: 'risk' } : { text: STAGE[c.status] || c.status, cls: 'idle' },
      due: dueOf(c.due, closed, nowMs),
      updated: { label: Number.isFinite(at) ? `${closed ? 'Done' : 'Updated'} ${agoLabel(Math.max(0, nowMs - at))}` : 'Never updated', at: Number.isFinite(at) ? new Date(at).toISOString() : null },
      ...(block || {}),
    };
    groups[closed ? 'done' : block ? 'blocked' : 'progress'].push(row);
  }
  const byUpdate = (a, b) => String(a.updated.at).localeCompare(String(b.updated.at));
  const byDue = (a, b) => String(a.due.on || '9').localeCompare(String(b.due.on || '9')) || byUpdate(a, b);
  groups.done.sort((a, b) => byUpdate(b, a));
  groups.progress.sort(byDue);
  groups.blocked.sort(byDue);
  return { asOf: new Date(nowMs).toISOString(), ...(data.cards.length > 500 ? { capped: true } : {}), ...groups };
}
