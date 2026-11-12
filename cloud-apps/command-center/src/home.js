// Dashboard 3 Home: Jon's saved schedule (migration 0026_home_tasks.sql) and his Google Calendar week.
// GET /dashboard/api/home reads it; the writes below are Jon's only (session + X-CC, checked by the caller).
import { TZ, ymd } from './life.js';
import { upsertHabit } from './db.js';

const CATS = ['factory', 'sponsors', 'personal', 'pnl'];
const REPS = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];
const MISS = ['next', 'retry', 'makeup', 'none'];
const REMS = ['none', '0', '10', '30', '60'];
const PERS = ['today', 'week', 'month'];
const TYPES = ['count', 'money', 'pile', 'spend', 'once', 'checklist', 'percent', 'habit'];
const HABIT = { workout: 'workout', date_night: 'date_night' };
const WINDOW = 21; // days each side of today, the same span as the calendar pull
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (s) => typeof s === 'string' && YMD.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const shift = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const mins = (v) => (Number.isInteger(v) && v >= 0 && v <= 1440 ? v : null);
const bad = (error, status = 400) => ({ status, body: { ok: false, error } });
const good = (body = {}) => ({ status: 200, body: { ok: true, ...body } });

const taskOut = (r) => ({
  id: r.id, title: r.title, cat: r.cat, start: r.start_min, end: r.end_min, rep: r.rep,
  days: String(r.days || '').split('').map(Number).filter((n) => n >= 0 && n <= 6), day: r.day || null, from: r.from_day,
  miss: r.miss, retry: r.retry_min ?? null, rem: r.rem, text: !!r.text_me, note: r.note || '', kind: r.kind || '',
});
const dayOut = (r) => ({ id: r.task_id, day: r.day, done: !!r.done, doneOn: r.done_on || null, skip: !!r.skip, moveDay: r.move_day || null, start: r.start_min ?? null, end: r.end_min ?? null });

const goalOut = (r) => {
  let steps = [];
  try { steps = JSON.parse(r.steps || '[]'); } catch { steps = []; }
  return {
    id: r.id, name: r.name, cat: r.cat, sub: r.sub || '', per: r.per, type: r.type, target: r.target ?? null, due: r.due || null, steps,
    time: r.time_min ?? null, days: String(r.days || '').split('').map(Number).filter((n) => n >= 0 && n <= 6), track: r.track,
  };
};

// A timed Google event as { title, start, end } (ISO); all-day events carry a bare date and are left out.
const timed = (e) => typeof e?.start === 'string' && e.start.includes('T') && Number.isFinite(Date.parse(e.start));

export async function homeData(env, nowMs = Date.now()) {
  const today = ymd(nowMs);
  const from = shift(today, -WINDOW);
  const to = shift(today, WINDOW);
  const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
  const [tasks, days, habits, cal, goals, logs] = await Promise.all([
    all('SELECT * FROM home_tasks WHERE deleted = 0 ORDER BY start_min, id'),
    all('SELECT * FROM home_task_days WHERE (day >= ? AND day <= ?) OR (move_day >= ? AND move_day <= ?) OR (done_on >= ? AND done_on <= ?)', from, to, from, to, from, to),
    all("SELECT day, kind, done FROM habits WHERE kind IN ('workout', 'date_night') AND day >= ? AND day <= ?", from, to),
    all("SELECT data, received_at FROM snapshots WHERE source = 'calendar'"),
    all('SELECT * FROM home_goals WHERE deleted = 0 ORDER BY created_at, id'),
    // the last 40 days cover this week and this month; "do once" and checklist marks never reset
    all("SELECT l.goal_id, l.day, l.step, l.value FROM home_goal_logs l JOIN home_goals g ON g.id = l.goal_id WHERE g.deleted = 0 AND (l.day >= ? OR l.day = '0000-00-00')", shift(today, -40)),
  ]);
  let snap = null;
  try { snap = cal[0] ? JSON.parse(cal[0].data) : null; } catch { snap = null; }
  return {
    today, tz: TZ,
    tasks: tasks.map(taskOut),
    days: days.map(dayOut),
    goals: goals.map(goalOut),
    logs: logs.map((l) => ({ id: l.goal_id, day: l.day, step: l.step, value: l.value })),
    habits: habits.filter((h) => Number(h.done)).map((h) => ({ day: h.day, kind: h.kind })),
    calendar: {
      connected: !!snap?.connected,
      // Connecting needs the Google sign-in key on the Worker; without it the link would only answer 501.
      canConnect: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET),
      at: cal[0]?.received_at || null,
      events: (snap?.events || []).filter(timed).map((e) => ({ title: String(e.title || 'Busy').slice(0, 200), start: e.start, end: e.end || e.start })),
    },
  };
}

// The task fields Jon can set, checked. `prev` is the saved task on an edit (missing fields keep their value).
function fields(b, prev) {
  const v = { ...(prev || { rep: 'none', days: [], day: null, miss: 'next', retry: null, rem: 'none', text: false, note: '' }), ...b };
  const title = String(v.title ?? '').trim();
  if (!title || title.length > 120) return { error: 'Give it a name (up to 120 characters)' };
  if (!CATS.includes(v.cat)) return { error: 'Pick a category' };
  const start = mins(v.start);
  const end = mins(v.end);
  if (start == null || end == null || end <= start) return { error: 'End time has to be after the start time' };
  if (!REPS.includes(v.rep)) return { error: 'Unknown repeat' };
  const days = Array.isArray(v.days) ? [...new Set(v.days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [];
  if (v.rep === 'weekly' && !days.length) return { error: 'Pick at least one day of the week' };
  if ((v.rep === 'none' || v.rep === 'monthly') && !isYmd(v.day)) return { error: 'Pick a day' };
  if (!MISS.includes(v.miss)) return { error: 'Unknown "if missed" choice' };
  const retry = v.miss === 'retry' ? mins(v.retry) : null;
  if (v.miss === 'retry' && (retry == null || retry <= start)) return { error: 'The retry time has to be later than the start time' };
  if (!REMS.includes(String(v.rem))) return { error: 'Unknown reminder' };
  const note = String(v.note ?? '');
  if (note.length > 1000) return { error: 'The note is too long (1000 characters at most)' };
  return { title, cat: v.cat, start, end, rep: v.rep, days: v.rep === 'weekly' ? days : [], day: isYmd(v.day) ? v.day : null, miss: v.miss, retry, rem: String(v.rem), text: !!v.text, note };
}

const getTask = (db, id) => db.prepare('SELECT * FROM home_tasks WHERE id = ? AND deleted = 0').bind(id).first();
const getDay = (db, id, day) => db.prepare('SELECT * FROM home_task_days WHERE task_id = ? AND day = ?').bind(id, day).first();
async function putDay(db, id, day, patch, now) {
  const cur = (await getDay(db, id, day)) || { done: 0, done_on: null, skip: 0, move_day: null, start_min: null, end_min: null };
  const r = { ...cur, ...patch };
  await db.prepare('INSERT OR REPLACE INTO home_task_days (task_id, day, done, done_on, skip, move_day, start_min, end_min, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, day, r.done ? 1 : 0, r.done_on || null, r.skip ? 1 : 0, r.move_day || null, r.start_min ?? null, r.end_min ?? null, now).run();
}

// Jon's writes. Returns { status, body } for the route.
//   POST   /home/tasks                  a new task
//   PATCH  /home/tasks/:id              change it: every time, or { scope: 'once', occ } for one day (the usual time stays)
//   DELETE /home/tasks/:id              remove it: every time, or ?scope=once&occ=YYYY-MM-DD for one day
//   POST   /home/tasks/:id/day          { day, done, on? }: tick or untick one day's occurrence
//   POST   /home/goals                  a goal of Jon's own ("+ Add goal")
//   DELETE /home/goals/:id              remove it
//   POST   /home/goals/:id/log          log against it
export async function homeWrite(env, method, rest, body, query, nowMs = Date.now()) {
  const db = env.DB;
  const now = new Date(nowMs).toISOString();
  const today = ymd(nowMs);
  if (rest === '/tasks' && method === 'POST') {
    const f = fields(body, null);
    if (f.error) return bad(f.error);
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO home_tasks (id, title, cat, start_min, end_min, rep, days, day, from_day, miss, retry_min, rem, text_me, note, kind, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .bind(id, f.title, f.cat, f.start, f.end, f.rep, f.days.join(''), f.day, f.rep === 'none' ? f.day : today, f.miss, f.retry, f.rem, f.text ? 1 : 0, f.note, '', now, now).run();
    return good({ task: taskOut(await getTask(db, id)) });
  }
  if (rest === '/goals' && method === 'POST') {
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 80) return bad('Give the goal a name (up to 80 characters)');
    if (!CATS.includes(body.cat)) return bad('Pick a category');
    if (!PERS.includes(body.per)) return bad('Pick how often');
    if (!TYPES.includes(body.type)) return bad('Pick a type');
    const t = body.type;
    const target = ['count', 'money', 'spend', 'percent'].includes(t) ? Number(body.target) : null;
    if (target != null && !(target > 0 && target <= 1e9)) return bad('Add a target above 0');
    if (t === 'percent' && target > 100) return bad('A rate goes up to 100%');
    const steps = t === 'checklist' ? (Array.isArray(body.steps) ? body.steps : []).map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 20) : [];
    if (t === 'checklist' && !steps.length) return bad('Add at least one step');
    const days = Array.isArray(body.days) ? [...new Set(body.days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [];
    if (t === 'habit' && !days.length) return bad('Pick at least one day');
    const due = (t === 'once' || t === 'checklist') && isYmd(body.due) ? body.due : null;
    const time = t === 'habit' ? mins(body.time) : null;
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO home_goals (id, name, cat, sub, per, type, target, due, steps, time_min, days, track, deleted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .bind(id, name, body.cat, String(body.sub ?? '').trim().slice(0, 40), body.per, t, target, due, JSON.stringify(steps), time, days.join(''), body.track === 'auto' ? 'auto' : 'log', now).run();
    return good({ id });
  }
  const g = /^\/goals\/([A-Za-z0-9-]{1,64})(\/log)?$/.exec(rest);
  if (g) {
    const goal = await db.prepare('SELECT * FROM home_goals WHERE id = ? AND deleted = 0').bind(g[1]).first();
    if (!goal) return bad('That goal is gone', 404);
    if (!g[2] && method === 'DELETE') {
      await db.prepare('UPDATE home_goals SET deleted = 1 WHERE id = ?').bind(goal.id).run();
      return good();
    }
    if (!g[2] || method !== 'POST') return bad('Not found', 404);
    // { step, done } ticks a checklist step; { done } marks a once or habit goal; { add } adds to today's count; { value } sets today's number.
    let step = -1;
    let value;
    if (goal.type === 'checklist') {
      step = Number(body.step);
      let n = 0;
      try { n = JSON.parse(goal.steps || '[]').length; } catch { n = 0; }
      if (!Number.isInteger(step) || step < 0 || step >= n || typeof body.done !== 'boolean') return bad('Needs the step and done');
      value = body.done ? 1 : 0;
    } else if (goal.type === 'once' || goal.type === 'habit') {
      if (typeof body.done !== 'boolean') return bad('Needs done');
      value = body.done ? 1 : 0;
    } else if (goal.type === 'count') {
      const cur = await db.prepare('SELECT value FROM home_goal_logs WHERE goal_id = ? AND day = ? AND step = -1').bind(goal.id, today).first();
      const add = Number(body.add);
      if (!Number.isInteger(add) || add === 0 || Math.abs(add) > 1000) return bad('Needs a whole number to add');
      value = Math.max(0, (cur?.value || 0) + add);
    } else {
      value = Number(body.value);
      if (body.value === '' || body.value == null || !Number.isFinite(value) || value < 0 || value > 1e9) return bad('Needs a number, 0 or more');
    }
    const day = goal.type === 'once' || goal.type === 'checklist' ? '0000-00-00' : today;
    await db.prepare('INSERT OR REPLACE INTO home_goal_logs (goal_id, day, step, value, at) VALUES (?, ?, ?, ?, ?)').bind(goal.id, day, step, value, now).run();
    return good();
  }
  const m = /^\/tasks\/([A-Za-z0-9-]{1,64})(\/day)?$/.exec(rest);
  if (!m) return bad('Not found', 404);
  const row = await getTask(db, m[1]);
  if (!row) return bad('That task is gone', 404);
  const prev = taskOut(row);

  if (m[2]) { // tick or untick one occurrence
    if (method !== 'POST') return bad('Not found', 404);
    if (!isYmd(body.day) || typeof body.done !== 'boolean') return bad('Needs the day and done');
    const on = isYmd(body.on) ? body.on : body.day; // the date it was shown on (later than day for a carried-over task)
    const before = await getDay(db, prev.id, body.day);
    await putDay(db, prev.id, body.day, { done: body.done ? 1 : 0, done_on: body.done ? on : null }, now);
    if (HABIT[prev.kind]) { // workouts and date nights count from the habit log, so a tick is a log
      if (body.done) await upsertHabit(db, on, HABIT[prev.kind], 1, '');
      else for (const d of new Set([on, before?.done_on || on])) await upsertHabit(db, d, HABIT[prev.kind], 0, '');
    }
    return good();
  }

  if (method === 'DELETE') {
    if (query.get('scope') === 'once' && prev.rep !== 'none') {
      const occ = query.get('occ');
      if (!isYmd(occ)) return bad('Needs the day to remove');
      await putDay(db, prev.id, occ, { skip: 1 }, now);
      return good();
    }
    await db.prepare('UPDATE home_tasks SET deleted = 1, updated_at = ? WHERE id = ?').bind(now, prev.id).run();
    return good();
  }
  if (method !== 'PATCH') return bad('Not found', 404);

  const once = body.scope === 'once' && prev.rep !== 'none';
  // "Just this one" keeps the series' own time, days and repeat; only the name, category and the other settings change.
  const f = fields(once ? { ...body, start: prev.start, end: prev.end, rep: prev.rep, days: prev.days, day: prev.day } : body, prev);
  if (f.error) return bad(f.error);
  if (once) {
    const start = mins(body.start);
    const end = mins(body.end);
    if (!isYmd(body.occ) || !isYmd(body.day)) return bad('Pick a day');
    if (start == null || end == null || end <= start) return bad('End time has to be after the start time');
    await putDay(db, prev.id, body.occ, { skip: 0, move_day: body.day === body.occ ? null : body.day, start_min: start, end_min: end }, now);
  }
  await db.prepare('UPDATE home_tasks SET title = ?, cat = ?, start_min = ?, end_min = ?, rep = ?, days = ?, day = ?, from_day = ?, miss = ?, retry_min = ?, rem = ?, text_me = ?, note = ?, updated_at = ? WHERE id = ?')
    .bind(f.title, f.cat, f.start, f.end, f.rep, f.days.join(''), f.day, f.rep === 'none' ? f.day : (prev.rep === 'none' ? today : row.from_day), f.miss, f.retry, f.rem, f.text ? 1 : 0, f.note, now, prev.id).run();
  return good({ task: taskOut(await getTask(db, prev.id)) });
}
