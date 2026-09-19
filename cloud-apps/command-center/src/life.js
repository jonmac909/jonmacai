import { hmacHex, timingSafeEqualString } from './auth.js';
import { listSnapshots, upsertHabit, upsertSnapshot } from './db.js';

export const TZ = 'America/Vancouver';
const CAL = 'https://www.googleapis.com/calendar/v3';
const TOKEN = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

export function ymd(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function weekday(ms, which = 'short') {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: which }).format(new Date(ms));
}

function addDays(day, n) {
  return ymd(Date.parse(`${day}T12:00:00-07:00`) + n * 86400000);
}

export function weekStartYmd(ms) {
  const day = ymd(ms);
  const off = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday(Date.parse(`${day}T12:00:00-07:00`))] || 0;
  return addDays(day, -off);
}

function clock(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${Number(p.hour)}:${p.minute}`;
}

function isWorkout(title) {
  return /workout/i.test(title || '');
}

function isDateNight(title) {
  return /date night/i.test(title || '');
}

function overlaps(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

export function suggestDateNight(events = [], nowMs = Date.now()) {
  const today = ymd(nowMs);
  const startMon = weekStartYmd(nowMs);
  const sunday = addDays(startMon, 6);
  for (let d = today; d <= sunday; d = addDays(d, 1)) {
    const slot0 = Date.parse(`${d}T18:00:00-07:00`);
    const slot1 = Date.parse(`${d}T21:00:00-07:00`);
    if (nowMs >= slot0) continue;
    const busy = events.some((e) => {
      const s = Date.parse(e.start);
      const t = Date.parse(e.end || e.start);
      return Number.isFinite(s) && Number.isFinite(t) && overlaps(s, t, slot0, slot1);
    });
    if (busy) continue;
    return { day: weekday(slot0, 'long'), start: `${d}T18:00:00`, end: `${d}T21:00:00` };
  }
  return null;
}

function dotsFor(weekStart, habits, nowMs) {
  const today = ymd(nowMs);
  const letters = [['M', 0], ['W', 2], ['F', 4]];
  const done = new Set(habits.filter((h) => h.kind === 'workout' && Number(h.done)).map((h) => h.day));
  return letters.map(([ch, off]) => {
    const day = addDays(weekStart, off);
    if (done.has(day)) return `on:${ch}`;
    if (day === today) return `next:${ch}`;
    if (day < today) return `miss:${ch}`;
    return `:${ch}`;
  });
}

function monthDays(nowMs) {
  const [y, m] = ymd(nowMs).split('-').map(Number);
  const last = ymd(nowMs).slice(8);
  let n = 0;
  for (let d = 1; d <= Number(last); d++) {
    const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const wd = weekday(Date.parse(`${day}T12:00:00-07:00`));
    if (wd === 'Mon' || wd === 'Wed' || wd === 'Fri') n++;
  }
  return n;
}

export function overlayLife(page, { connected = false, events = [], habits = [], nowMs = Date.now() } = {}) {
  if (!page) return page;
  if (!connected && !events.length) return page;
  const today = ymd(nowMs);
  const week = weekStartYmd(nowMs);
  const month = today.slice(0, 7);
  const todays = events.filter((e) => ymd(Date.parse(e.start)) === today)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  page.today = {
    title: 'Today',
    meta: 'From your calendar',
    rows: todays.map((e, i) => ({
      title: `${clock(e.start)} · ${e.title}`,
      sub: e.end ? `Until ${clock(e.end)}` : '',
      pill: i === 0 ? 'Now' : i === 1 ? 'Next' : '',
      pillCls: i === 0 ? 'blue' : '',
    })),
  };
  const thisDots = dotsFor(week, habits, nowMs);
  const lastDots = dotsFor(addDays(week, -7), habits, nowMs);
  const twoDots = dotsFor(addDays(week, -14), habits, nowMs);
  const weekN = thisDots.filter((d) => d.startsWith('on:')).length;
  const monthN = habits.filter((h) => h.kind === 'workout' && Number(h.done) && String(h.day).startsWith(month)).length;
  const goal = monthDays(nowMs) || 1;
  const nights = events.filter((e) => isDateNight(e.title) && ymd(Date.parse(e.start)).startsWith(month)).length
    + habits.filter((h) => h.kind === 'date_night' && Number(h.done) && String(h.day).startsWith(month)).length;
  page.tiles[0] = { ...page.tiles[0], value: String(weekN), goal: '/ 3', pct: Math.round(weekN / 3 * 100), pg: weekN >= 2 ? 'ok' : 'risk' };
  page.tiles[1] = { ...page.tiles[1], value: String(monthN), goal: `/ ${goal} so far`, pct: Math.round(monthN / goal * 100) };
  page.tiles[2] = { ...page.tiles[2], value: String(nights), goal: '/ 4', pct: Math.round(nights / 4 * 100), pg: nights >= 4 ? 'ok' : 'risk' };
  page.workouts.weeks = [
    { title: 'This week', sub: `${week}–${addDays(week, 6)}`, dots: thisDots },
    { title: 'Last week', sub: `${addDays(week, -7)}–${addDays(week, -1)}`, dots: lastDots },
    { title: 'Two weeks ago', sub: `${addDays(week, -14)}–${addDays(week, -8)}`, dots: twoDots },
  ];
  const hasSeries = events.some((e) => isWorkout(e.title));
  if (hasSeries) {
    page.workouts.btn = 'Mark today done';
    page.workouts.kind = 'life.mark_workout';
    page.workouts.payload = { day: today };
    page.workouts.msg = `${weekday(nowMs, 'long')} workout marked done`;
  } else {
    page.workouts.btn = 'Add Mon/Wed/Fri 11:00';
    page.workouts.kind = 'life.create_workout';
    page.workouts.confirm = 'Add a repeating Workout at 11:00 Mon/Wed/Fri?';
    page.workouts.msg = 'Workout added to your calendar';
  }
  const thisNight = events.find((e) => isDateNight(e.title) && ymd(Date.parse(e.start)) >= week && ymd(Date.parse(e.start)) <= addDays(week, 6));
  const idea = suggestDateNight(events, nowMs);
  if (thisNight) {
    page.dateNight.pill = 'Booked';
    page.dateNight.pillCls = 'ok';
    page.dateNight.rows[0] = { title: 'This week', sub: `${weekday(Date.parse(thisNight.start), 'long')} · ${clock(thisNight.start)}`, pill: 'Done', pillCls: 'ok' };
  } else if (idea) {
    page.dateNight.pill = 'Not booked';
    page.dateNight.pillCls = 'risk';
    page.dateNight.rows[0] = {
      title: 'This week',
      sub: `${idea.day} evening is free`,
      btn: `Book ${idea.day} 6:00`,
      kind: 'life.book_date_night',
      confirm: `Book ${idea.day} 6:00 PM on your calendar?`,
      payload: { start: idea.start, end: idea.end, title: 'Date night' },
      msg: `${idea.day} 6:00 PM added to your calendar`,
    };
  }
  page.actions = (page.actions || []).filter((a) => a.label !== 'Connect calendar');
  page.sub = 'The things that matter outside work';
  return page;
}

async function refreshToken(env) {
  if (env.GOOGLE_REFRESH_TOKEN) return env.GOOGLE_REFRESH_TOKEN;
  if (!env.DB) return '';
  const row = (await listSnapshots(env.DB)).find((r) => r.source === 'google_oauth');
  if (!row) return '';
  try { return JSON.parse(row.data).refreshToken || ''; } catch { return ''; }
}

async function accessToken(env, fetchFn, refresh) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !refresh) return '';
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refresh,
    grant_type: 'refresh_token',
  });
  const res = await fetchFn(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) return '';
  const data = await res.json().catch(() => ({}));
  return data.access_token || '';
}

function normEvent(e) {
  return {
    id: e.id,
    title: e.summary || e.title || '',
    start: e.start?.dateTime || e.start?.date || e.start,
    end: e.end?.dateTime || e.end?.date || e.end,
  };
}

export async function pullCalendar(env, fetchFn = globalThis.fetch, nowMs = Date.now()) {
  if (!env?.DB) return;
  const refresh = await refreshToken(env);
  if (!refresh) return;
  const token = await accessToken(env, fetchFn, refresh);
  if (!token) return;
  const headers = { authorization: `Bearer ${token}` };
  const min = new Date(nowMs - 21 * 86400000).toISOString();
  const max = new Date(nowMs + 21 * 86400000).toISOString();
  const cals = await fetchFn(`${CAL}/users/me/calendarList`, { headers }).then((r) => r.ok ? r.json() : { items: [{ id: 'primary' }] }).catch(() => ({ items: [{ id: 'primary' }] }));
  const ids = (cals.items || []).map((c) => c.id).filter(Boolean);
  if (!ids.length) ids.push('primary');
  const events = [];
  for (const id of ids) {
    const url = `${CAL}/calendars/${encodeURIComponent(id)}/events?timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}&singleEvents=true&orderBy=startTime&maxResults=100`;
    const data = await fetchFn(url, { headers }).then((r) => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] }));
    for (const e of data.items || []) events.push(normEvent(e));
  }
  const now = new Date(nowMs).toISOString();
  await upsertSnapshot(env.DB, 'calendar', JSON.stringify({ connected: true, events }), now, now);
}

export async function googleAuthUrl(env, origin) {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const state = `${exp}.${await hmacHex(env.SESSION_SECRET, `gcal.${exp}`)}`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/dashboard/api/google/callback`,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(env, origin, code, state, fetchFn = globalThis.fetch) {
  const [exp, sig] = String(state || '').split('.');
  const want = await hmacHex(env.SESSION_SECRET, `gcal.${exp}`);
  if (!exp || Number(exp) * 1000 < Date.now() || !timingSafeEqualString(sig, want) || !code) return false;
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: `${origin}/dashboard/api/google/callback`,
    grant_type: 'authorization_code',
  });
  const res = await fetchFn(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await res.json().catch(() => ({}));
  if (!data.refresh_token) return false;
  const now = new Date().toISOString();
  await upsertSnapshot(env.DB, 'google_oauth', JSON.stringify({ refreshToken: data.refresh_token }), now, now);
  return true;
}

async function insertEvent(env, fetchFn, event) {
  const refresh = await refreshToken(env);
  const token = await accessToken(env, fetchFn, refresh);
  if (!token) throw new Error('Connect Google Calendar first');
  const res = await fetchFn(`${CAL}/calendars/primary/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error('Calendar update failed');
}

export async function runLife(env, kind, payload = {}, fetchFn = globalThis.fetch) {
  const now = Date.now();
  const day = payload.day || ymd(now);
  if (kind === 'life.mark_workout') {
    if (env.DB) await upsertHabit(env.DB, day, 'workout', 1, '');
    return `${weekday(now, 'long')} workout marked done`;
  }
  if (kind === 'life.create_workout') {
    const start = `${weekStartYmd(now)}T11:00:00`;
    await insertEvent(env, fetchFn, {
      summary: 'Workout',
      start: { dateTime: `${start}-07:00`, timeZone: TZ },
      end: { dateTime: `${weekStartYmd(now)}T12:15:00-07:00`, timeZone: TZ },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'],
    });
    return 'Workout added to your calendar';
  }
  if (kind === 'life.book_date_night') {
    const start = payload.start || suggestDateNight([], now)?.start;
    const end = payload.end || (start ? start.replace('T18:00:00', 'T21:00:00') : '');
    if (!start) throw new Error('No free evening this week');
    await insertEvent(env, fetchFn, {
      summary: payload.title || 'Date night',
      start: { dateTime: `${start}-07:00`, timeZone: TZ },
      end: { dateTime: `${end}-07:00`, timeZone: TZ },
    });
    if (env.DB) await upsertHabit(env.DB, start.slice(0, 10), 'date_night', 1, '');
    return payload.msg || 'Date night added to your calendar';
  }
  return payload.msg || 'Done';
}
