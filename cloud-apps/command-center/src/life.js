import { hmacHex, timingSafeEqualString } from './auth.js';
import { listSnapshots, upsertHabit, upsertSnapshot } from './db.js';

export const TZ = 'America/Vancouver';
export const DATE_NIGHT_BOOK_HREF = 'https://www.opentable.com/s?covers=2&term=Kelowna%2C%20British%20Columbia';
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

function timeOf(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(t));
}

export function suggestDateNight(events, nowMs) {
  const startDay = ymd(nowMs);
  for (let i = 0; i < 14; i++) {
    const day = addDays(startDay, i);
    const ms = Date.parse(`${day}T12:00:00-07:00`);
    const wd = weekday(ms);
    if (wd !== 'Fri' && wd !== 'Sat') continue;
    const eve0 = Date.parse(`${day}T18:00:00-07:00`);
    const eve1 = Date.parse(`${day}T21:00:00-07:00`);
    if (eve0 < nowMs) continue;
    const hit = (events || []).some((e) => {
      const a = Date.parse(e.start);
      const b = Date.parse(e.end || e.start);
      return Number.isFinite(a) && overlaps(a, Number.isFinite(b) ? b : a + 3600000, eve0, eve1);
    });
    if (!hit) return { day: weekday(ms, 'long'), ymd: day, start: `${day}T18:00:00`, end: `${day}T21:00:00` };
  }
  return null;
}

export function overlayLife(page, { connected = false, events = [], habits = [], nowMs = Date.now() } = {}) {
  if (!page) return page;
  const today = ymd(nowMs);
  const start = weekStartYmd(nowMs);
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const dots = [];
  let habitDone = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const letter = letters[i];
    const habit = (habits || []).some((h) => h.kind === 'workout' && Number(h.done) && h.day === day);
    if (habit) {
      dots.push(`on:${letter}`);
      habitDone += 1;
    } else if (day === today) dots.push(`next:${letter}`);
  }
  const todayEvents = events.filter((e) => Number.isFinite(Date.parse(e.start)) && ymd(Date.parse(e.start)) === today);
  if (connected || events.length) {
    page.today = {
      title: 'Today',
      meta: 'From your calendar',
      rows: todayEvents.map((e) => ({
        time: timeOf(e.start),
        title: e.summary || e.title,
        sub: e.location || 'Calendar',
        pill: /workout|gym/i.test(e.summary || e.title || '') ? 'Workout' : '',
      })),
    };
    page.workouts = {
      ...page.workouts,
      weeks: [{ label: 'This week', sub: `${habitDone} of 7 days`, dots }],
    };
    if (page.tiles?.[0]) {
      page.tiles[0].value = String(habitDone);
      page.tiles[0].pct = Math.round(habitDone / 7 * 100);
      page.tiles[0].sub = habitDone ? `${habitDone} day${habitDone === 1 ? '' : 's'} this week` : 'Not yet this week';
    }
    page.actions = (page.actions || []).filter((a) => a.label !== 'Connect calendar');
  } else {
    page.today = { title: 'Today', meta: 'Calendar not connected', rows: [] };
    page.actions = [{ label: 'Connect calendar', href: '/dashboard/api/google/start' }, ...(page.actions || []).filter((a) => a.label !== 'Connect calendar')];
  }
  applyDateNightBooking(page, events, nowMs);
  return page;
}

function applyDateNightBooking(page, events, nowMs) {
  if (!page.dateNight) page.dateNight = { title: 'Date night', rows: [{}] };
  if (!page.dateNight.rows?.length) page.dateNight.rows = [{}];
  const idea = suggestDateNight(events, nowMs);
  const row0 = page.dateNight.rows[0] || {};
  page.dateNight.rows[0] = {
    title: row0.title || 'This week',
    sub: idea ? `${idea.day} evening looks free` : (row0.sub || 'OpenTable · Kelowna'),
    btn: idea ? `Book ${idea.day} in Kelowna` : 'Book a table in Kelowna',
    href: DATE_NIGHT_BOOK_HREF,
  };
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
