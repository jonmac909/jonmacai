// Dashboard 3 Home: what is on the schedule on a given day, from Jon's saved tasks (GET /dashboard/api/home, src/home.js).
// Pure functions, so tests run them without a browser. The handover's rules (section 5):
//   a repeating task shows on its days; "just this one" moves one day's occurrence (the usual slot stays, faded);
//   missed + "retry" -> a second slot later the same day; missed + "next" or "retry" -> the next day, marked Late,
//   but only inside the same week (weekly goals reset on Monday) and never next to the task's own slot that day;
//   "makeup" and "none" stay on their day as Missed.
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const wdOf = (ymd) => (new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
const HABITS = ['workout', 'date_night'];

export function occursOn(t, ymd) {
  if (t.rep === 'none') return t.day === ymd;
  if (ymd < t.from) return false;
  const wd = wdOf(ymd);
  if (t.rep === 'daily') return true;
  if (t.rep === 'weekdays') return wd < 5;
  if (t.rep === 'weekly') return t.days.includes(wd);
  if (t.rep === 'monthly') return !!t.day && t.day.slice(8) === ymd.slice(8);
  return false;
}

// One Google event's Vancouver date and hours: { ymd, s, e } (e past midnight is cut at 24).
export function zoned(startIso, endIso, tz = 'America/Vancouver') {
  const at = (iso) => {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return null;
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
    return { ymd: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour) + Number(p.minute) / 60 };
  };
  const a = at(startIso);
  const b = at(endIso) || a;
  if (!a) return null;
  return { ymd: a.ymd, s: a.h, e: b.ymd > a.ymd ? 24 : Math.max(b.h, a.h + 0.25) };
}

// The saved tasks' items on the date X. `today` is today's date and nowH the hour now (both Vancouver).
// Item: { k, id, day (the occurrence's own date), on (X), s, e (hours), w, c, key, rep, done?, missed?, late?, ghost? }.
// A ghost is the faded usual slot of something moved, retried or done later: it has no tick box.
export function dayItems(home, X, today, nowH) {
  const tasks = home?.tasks || [];
  const ov = new Map((home?.days || []).map((d) => [`${d.id}|${d.day}`, d]));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const logged = new Set((home?.habits || []).map((h) => `${h.kind}|${h.day}`));
  const habit = (t, d) => HABITS.includes(t.kind) && logged.has(`${t.kind}|${d}`);
  const out = [];
  const mk = (t, D, s, e, more = {}) => {
    const it = { id: t.id, day: D, on: X, s: s / 60, e: e / 60, w: t.title, c: t.cat, key: t.kind, rep: t.rep, ...more };
    it.k = `${t.id}|${D}|${X}|${it.retry ? 'r' : it.ghost ? 'g' : ''}`;
    out.push(it);
  };
  const monday = addDays(today, -wdOf(today));

  for (const t of tasks) {
    if (occursOn(t, X)) {
      const o = ov.get(`${t.id}|${X}`) || {};
      const s = o.start ?? t.start;
      const e = o.end ?? t.end;
      if (o.skip) { /* removed for this day */ }
      else if (o.moveDay && o.moveDay !== X) mk(t, X, t.start, t.end, { ghost: true, missed: true, tag: 'Moved' });
      else if (o.done && o.doneOn && o.doneOn !== X) mk(t, X, s, e, { ghost: true, missed: true, tag: 'Missed' });
      else if (o.done || habit(t, X)) mk(t, X, s, e, { done: true });
      else {
        const retry = t.miss === 'retry' && t.retry != null && t.retry > s;
        const past = X < today;
        if (retry && (past || (X === today && nowH * 60 >= e))) {
          mk(t, X, s, e, { ghost: true, missed: true, tag: 'Missed' });
          mk(t, X, t.retry, t.retry + (e - s), { w: `${t.title} · retry`, retry: true, missed: past, tag: past ? 'Missed' : '' });
        } else mk(t, X, s, e, past ? { missed: true, tag: 'Missed' } : {});
      }
    }
    // Carried over to today: the newest earlier occurrence, when it was missed and the task has no slot of its own today.
    if (X === today && (t.miss === 'next' || t.miss === 'retry') && !occursOn(t, today)) {
      const floor = t.rep === 'none' ? addDays(today, -14) : monday;
      for (let D = addDays(today, -1); D >= floor; D = addDays(D, -1)) {
        if (!occursOn(t, D)) continue;
        const o = ov.get(`${t.id}|${D}`) || {};
        if (!o.skip && !o.moveDay && !o.done && !habit(t, D)) mk(t, D, o.start ?? t.start, o.end ?? t.end, { w: `${t.title} · from ${DAYS[wdOf(D)]}`, late: true, tag: 'Late', done: habit(t, today) });
        break;
      }
    }
  }
  for (const o of home?.days || []) {
    const t = byId.get(o.id);
    if (!t || o.skip || o.day === X || !occursOn(t, o.day)) continue;
    if (o.moveDay === X) { // "just this one", moved here
      const done = o.done || habit(t, X);
      mk(t, o.day, o.start ?? t.start, o.end ?? t.end, { w: `${t.title} · make-up`, done, missed: !done && X < today, tag: !done && X < today ? 'Missed' : '' });
    } else if (!o.moveDay && o.done && o.doneOn === X) { // carried over and ticked on this day
      mk(t, o.day, o.start ?? t.start, o.end ?? t.end, { w: `${t.title} · from ${DAYS[wdOf(o.day)]}`, late: true, tag: 'Late', done: true });
    }
  }
  return out.sort((a, b) => a.s - b.s || a.e - b.e);
}

// ---- Jon's own goals ("+ Add goal") as numbers for one period ----
// -> { v (text), st (off | risk | on | none), word?, pct, pace, cur (the number), doneToday, steps? }
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
export function goalState(g, logs, P) {
  const mine = logs.filter((l) => l.id === g.id);
  const monday = addDays(P.ymd, -P.weekday);
  const inPer = (d) => (g.per === 'today' ? d === P.ymd : g.per === 'week' ? d >= monday && d <= addDays(monday, 6) : d.slice(0, 7) === P.ymd.slice(0, 7));
  const days = mine.filter((l) => l.step === -1 && inPer(l.day)).sort((a, b) => (a.day < b.day ? -1 : 1));
  const sum = days.reduce((a, l) => a + l.value, 0);
  const last = days.length ? days[days.length - 1].value : null;
  const T = g.per === 'week' ? P.weekT : g.per === 'month' ? P.monthT : null; // how far through the period we are, 0 to 1
  const pct = (a, b) => Math.max(0, Math.min(100, Math.round((a / b) * 100)));
  const paced = (cur, target, near) => (cur >= target ? 'on' : T == null ? 'risk' : cur >= target * T ? 'on' : cur >= near ? 'risk' : 'off');
  const doneToday = mine.some((l) => l.step === -1 && l.day === P.ymd && l.value > 0);
  const base = { cur: sum, doneToday, pct: null, pace: null };
  if (g.track === 'auto') return { ...base, v: 'No feed', st: 'none', word: 'No feed', nf: true };
  if (g.type === 'count' || g.type === 'money') {
    const f = g.type === 'money' ? money : String;
    return { ...base, v: `${f(sum)} / ${f(g.target)}`, st: paced(sum, g.target, g.type === 'money' ? g.target * T * 0.7 : g.target * T - 1), pct: pct(sum, g.target), pace: T == null ? null : pct(T, 1) };
  }
  if (g.type === 'habit') {
    const n = days.filter((l) => l.value > 0).length;
    const per = g.per === 'today' ? 1 : g.per === 'week' ? g.days.length : Array.from({ length: P.daysInMonth }, (_, i) => `${P.ymd.slice(0, 8)}${String(i + 1).padStart(2, '0')}`).filter((d) => g.days.includes(wdOf(d))).length;
    const target = Math.max(1, per);
    return { ...base, cur: n, v: `${n} / ${target}`, st: paced(n, target, target * T - 1), pct: pct(n, target), pace: T == null ? null : pct(T, 1) };
  }
  if (g.type === 'spend') {
    const proj = T != null && T >= 0.1 ? sum / T : null;
    return { ...base, v: `${money(sum)} / max ${money(g.target)}`, st: sum > g.target ? 'off' : proj != null && proj > g.target ? 'risk' : 'on', pct: pct(sum, g.target), pace: T == null ? null : pct(T, 1) };
  }
  if (g.type === 'percent') {
    if (last == null) return { ...base, cur: null, v: `No data / ${g.target}%`, st: 'none', nf: true };
    return { ...base, cur: last, v: `${last}% / ${g.target}%`, st: last >= g.target ? 'on' : last >= g.target * 0.8 ? 'risk' : 'off', pct: pct(last, 100) };
  }
  if (g.type === 'pile') {
    if (last == null) return { ...base, cur: null, v: 'No data', st: 'none', nf: true };
    return { ...base, cur: last, v: `${last} open`, st: last > 0 ? 'risk' : 'on' };
  }
  const late = !!g.due && g.due < P.ymd;
  if (g.type === 'once') {
    const done = mine.some((l) => l.step === -1 && l.day === '0000-00-00' && l.value > 0);
    return { ...base, cur: done ? 1 : 0, doneToday: done, v: done ? 'Done' : 'Not done', st: done ? 'on' : late ? 'off' : 'none', word: done ? 'Done' : late ? 'Late' : 'To do', pct: done ? 100 : 0 };
  }
  const steps = g.steps.map((name, i) => ({ name, done: mine.some((l) => l.step === i && l.value > 0) })); // checklist
  const n = steps.filter((s) => s.done).length;
  return { ...base, cur: n, steps, v: `${n} / ${steps.length}`, st: n === steps.length ? 'on' : late ? 'off' : 'none', word: n === steps.length ? 'Done' : late ? 'Late' : 'In progress', pct: pct(n, steps.length) };
}
