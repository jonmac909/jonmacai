// Pulling Jon's Google calendars: a meeting on two of his calendars shows once (2026-11-12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pullCalendar } from '../src/life.js';
import { sqliteD1 } from './sqlited1.mjs';

test('the same meeting on two calendars is kept once; different times stay apart', async () => {
  const db = sqliteD1();
  const env = { DB: db, YT_CLIENT_ID: 'cid', YT_CLIENT_SECRET: 'cs', GOOGLE_REFRESH_TOKEN: 'r' };
  const ev = (id, summary, s, e) => ({ id, summary, start: { dateTime: s }, end: { dateTime: e } });
  const fetchFn = async (input) => {
    const url = String(input);
    const reply = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return reply({ access_token: 'at' });
    if (url.includes('/calendarList')) return reply({ items: [{ id: 'primary' }, { id: 'work@x' }] });
    if (url.includes('/calendars/primary/')) return reply({ items: [ev('a', 'Webinar', '2026-11-09T18:00:00-07:00', '2026-11-09T19:00:00-07:00'), ev('b', 'Haircut', '2026-11-11T11:30:00-07:00', '2026-11-11T12:30:00-07:00')] });
    return reply({ items: [ev('c', 'Webinar', '2026-11-09T18:00:00-07:00', '2026-11-09T19:00:00-07:00'), ev('d', 'Webinar', '2026-11-10T18:00:00-07:00', '2026-11-10T19:00:00-07:00')] });
  };
  await pullCalendar(env, fetchFn, Date.parse('2026-11-12T12:00:00Z'));
  const row = await db.prepare("SELECT data FROM snapshots WHERE source = 'calendar'").first();
  const { events } = JSON.parse(row.data);
  assert.deepEqual(events.map((e) => [e.title, e.start.slice(0, 10)]), [['Webinar', '2026-11-09'], ['Haircut', '2026-11-11'], ['Webinar', '2026-11-10']]);
});
