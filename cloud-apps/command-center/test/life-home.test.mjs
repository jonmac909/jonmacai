import test from 'node:test';
import assert from 'node:assert/strict';
import snapshot from '../fixtures/snapshot.json' with { type: 'json' };
import { mergeSnapshot } from '../src/snapshot.js';
import { handleCron } from '../src/cron.js';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { overlayLife, suggestDateNight } from '../src/life.js';
import { criticalAlerts, nextMorningStep, unsentCritical } from '../src/home.js';
import { memD1 } from './memd1.mjs';

const NOW = Date.parse('2026-09-18T20:00:00-07:00');
const SECRET = 'test-session-secret-32-bytes-ok!';
const TODAY = '2026-09-18';

function row(source, data, collected_at = '2026-09-18T18:00:00-07:00') {
  return { source, collected_at, data: JSON.stringify(data) };
}

function envWith(db, extra = {}) {
  return {
    SESSION_SECRET: SECRET,
    DASHBOARD_PASSWORD: '909090',
    GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'gsecret',
    GOOGLE_REFRESH_TOKEN: 'refresh-token',
    TELEGRAM_BOT_TOKEN: 'bot-token',
    TELEGRAM_CHAT_ID: '911215697',
    DB: db,
    ...extra,
  };
}

function req(path, { method = 'GET', cookie, headers = {}, body } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  return new Request(`https://jonmac.ai${path}`, { method, headers: h, body });
}

async function cookie() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${COOKIE}=${await signSession(SECRET, exp)}`;
}

function cleanSponsors() {
  return {
    collections: {
      currentIncomeMonth: 'September',
      incomeTotals: { September: 5000 },
      completedIncomeMonths: [],
      items: [],
    },
    cards: [],
  };
}

function lateSponsors(days) {
  const last = new Date(NOW - days * 86400000).toISOString();
  return {
    collections: {
      currentIncomeMonth: 'September',
      incomeTotals: { September: 5000 },
      completedIncomeMonths: [],
      items: [{
        sponsor: 'TopView', contact: 'Dorothy', owed: 750, total: 1500, paid: 750,
        bucket: 'collect-now', bucketLabel: 'Collect now', blocker: 'Wire not in',
        action: 'Chase deposit', lastEmail: last,
      }],
    },
    cards: [{
      id: 'tv', sponsor: 'TopView', stage: 'invoice-sent', amount: 1500,
      subject: 'Deposit', latestDate: last, status: 'waiting',
    }],
  };
}

test('Life today rows come from calendar events', () => {
  const page = JSON.parse(JSON.stringify(snapshot.pages.life));
  overlayLife(page, {
    connected: true,
    nowMs: NOW,
    events: [
      { id: '1', title: 'Morning run-through', start: '2026-09-18T09:00:00-07:00', end: '2026-09-18T09:30:00-07:00' },
      { id: '2', title: 'Workout with your wife', start: '2026-09-18T11:00:00-07:00', end: '2026-09-18T12:15:00-07:00' },
    ],
    habits: [],
  });
  assert.equal(page.today.rows[0].title.includes('Morning run-through'), true);
  assert.equal(page.today.rows[1].title.includes('Workout'), true);
  assert.equal(page.today.meta, 'From your calendar');
});

test('workout dots and tiles follow habits this week', () => {
  const page = JSON.parse(JSON.stringify(snapshot.pages.life));
  overlayLife(page, {
    connected: true,
    nowMs: NOW,
    events: [
      { id: 'w', title: 'Workout', start: '2026-09-18T11:00:00-07:00', end: '2026-09-18T12:15:00-07:00' },
    ],
    habits: [
      { day: '2026-09-14', kind: 'workout', done: 1 },
      { day: '2026-09-16', kind: 'workout', done: 1 },
    ],
  });
  assert.equal(page.tiles[0].value, '2');
  assert.equal(page.workouts.weeks[0].dots.join(' '), 'on:M on:W next:F');
});

test('date night suggests the first free evening 18:00–21:00', () => {
  const suggestion = suggestDateNight([
    { title: 'Call', start: '2026-09-18T14:00:00-07:00', end: '2026-09-18T15:00:00-07:00' },
  ], NOW);
  assert.equal(suggestion.day, 'Saturday');
  assert.equal(suggestion.start.endsWith('T18:00:00'), true);
});

test('morning run-through ticks itself from live sources', () => {
  const posts = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`, platform: 'X', posted_at: '2026-09-18T12:00:00-07:00', first_line: 'hi', source: 'agent',
  }));
  const out = mergeSnapshot(snapshot, [
    row('sponsors', cleanSponsors()),
    row('bank_scan', { accounts: [
      { name: 'RBC', status: 'scanned', scannedAt: '2026-09-18T08:12:00-07:00' },
      { name: 'Personal', status: 'scanned', scannedAt: '2026-09-18T08:12:00-07:00' },
    ] }),
    row('mastermind', { picks: [], scanned: 41 }),
    row('support', { tickets: [], answeredToday: 3, inboundToday: 3 }),
  ], NOW, {}, [], posts, [], {
    habits: [{ day: TODAY, kind: 'workout', done: 1 }],
    checklist: [{ day: TODAY, item: 'market_check', how: 'auto' }],
  });
  const steps = Object.fromEntries(out.pages.home.runThrough.steps.map((s) => [s.label, s.done]));
  assert.equal(steps['Sponsor emails'], true);
  assert.equal(steps['Bank scan'], true);
  assert.equal(steps['Market check'], true);
  assert.equal(steps['Mastermind digest'], true);
  assert.equal(steps['Support replies'], true);
  assert.equal(steps['Posts out'], true);
  assert.equal(steps['Workout 11:00'], true);
  assert.equal(out.pages.home.runThrough.done, 7);
});

test('Needs you ranks overdue money, then blocked, then oldest drafts', () => {
  const last = new Date(NOW - 8 * 86400000).toISOString();
  const out = mergeSnapshot(snapshot, [
    row('sponsors', lateSponsors(8)),
    row('bank_scan', { accounts: [
      { name: 'Business card', status: 'needs_code', since: '2026-09-18T08:12:00-07:00' },
      { name: 'Personal', status: 'scanned', scannedAt: '2026-09-18T08:12:00-07:00' },
    ] }),
    row('agents_mac', { agents: [{
      name: 'Planner', status: 'needs_you', now: 'Pick a model',
      waiting: { title: 'Pick a model', lines: ['Waiting on you'], waitLabel: 'Needs you' },
    }] }),
    row('support', { tickets: [
      { id: 'old', uid: '1', subject: 'Old', money: false, waitedMs: 5 * 3600000, body: 'draft' },
      { id: 'new', uid: '2', subject: 'New', money: false, waitedMs: 10 * 60000, body: 'draft' },
    ] }),
  ], NOW, {}, [], [], [], {});
  const titles = out.pages.home.needsYou.all.map((j) => j.title);
  assert.match(titles[0], /TopView/);
  assert.match(titles[1], /bank text code|Enter bank/i);
  assert.equal(titles[2].includes('Planner') || titles[2].includes('model'), true);
  assert.equal(out.pages.home.needsYou.jobs.length, 3);
  assert.ok(out.pages.home.needsYou.all.length > 3);
  const draftIx = titles.findIndex((t) => t.includes('Old') || t.includes('Export') || t.includes('Approve') || t.toLowerCase().includes('old'));
  const newIx = titles.findIndex((t) => t.includes('New'));
  assert.ok(draftIx >= 0 && newIx >= 0 && draftIx < newIx);
});

test('Start my morning walks the first undone run-through step', () => {
  const run = {
    steps: [
      { label: 'Sponsor emails', done: true, page: 'sponsors' },
      { label: 'Bank scan', done: false, page: 'money' },
      { label: 'Market check', done: false, page: 'markets' },
    ],
  };
  assert.deepEqual(nextMorningStep(run), { label: 'Bank scan', done: false, page: 'money' });
  run.steps.forEach((s) => { s.done = true; });
  assert.equal(nextMorningStep(run), null);
});

test('Telegram critical list is only bank code or payment more than 7 days late', () => {
  const out = mergeSnapshot(snapshot, [
    row('sponsors', lateSponsors(8)),
    row('bank_scan', { accounts: [{ name: 'Business card', status: 'needs_code', since: lastNow() }] }),
    row('support', { tickets: [{ id: 'd', uid: '1', subject: 'Help', money: false, waitedMs: 1000, body: 'hi' }] }),
  ], NOW);
  const keys = criticalAlerts(out).map((a) => a.key);
  assert.ok(keys.some((k) => k.startsWith('bank_code:')));
  assert.ok(keys.some((k) => k.startsWith('late:')));
  assert.equal(keys.some((k) => k.includes('support') || k.includes('draft')), false);
  const seven = mergeSnapshot(snapshot, [row('sponsors', lateSponsors(7))], NOW);
  assert.equal(criticalAlerts(seven).some((a) => a.key.startsWith('late:')), false);
});

test('already-sent critical alerts are not sent again', () => {
  const alerts = [
    { key: 'bank_code:Business card', text: 'Bank code needed' },
    { key: 'late:tv', text: 'TopView 8 days late' },
  ];
  const next = unsentCritical(alerts, { 'bank_code:Business card': '2026-09-18T08:00:00Z' });
  assert.deepEqual(next.map((a) => a.key), ['late:tv']);
});

test('cron pulls Google Calendar when a refresh token is set', async () => {
  const db = memD1();
  const prev = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'ya29.a' }), { status: 200 });
    }
    if (String(url).includes('www.googleapis.com/calendar')) {
      return new Response(JSON.stringify({
        items: [{ id: 'e1', summary: 'Workout', start: { dateTime: '2026-09-18T11:00:00-07:00' }, end: { dateTime: '2026-09-18T12:15:00-07:00' } }],
      }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    await handleCron(envWith(db));
  } finally {
    globalThis.fetch = prev;
  }
  assert.ok(seen.some((u) => u.includes('oauth2.googleapis.com/token')));
  assert.ok(seen.some((u) => u.includes('www.googleapis.com/calendar')));
  assert.ok(db.snapshots.get('calendar')?.data.includes('Workout'));
});

test('merge overlays Life from the calendar snapshot and strips oauth', () => {
  const out = mergeSnapshot(snapshot, [
    row('calendar', {
      connected: true,
      events: [{ id: 'e1', title: 'Workout with your wife', start: '2026-09-18T11:00:00-07:00', end: '2026-09-18T12:15:00-07:00' }],
    }),
    row('google_oauth', { refreshToken: 'secret-refresh' }),
  ], NOW, {}, [], [], [], { habits: [] });
  assert.equal(out.pages.life.today.rows.some((r) => r.title.includes('Workout')), true);
  assert.equal(out.sources.google_oauth, undefined);
  assert.equal(JSON.stringify(out).includes('secret-refresh'), false);
});

test('Mark today done writes a workout habit', async () => {
  const db = memD1();
  const res = await handleApi(req('/dashboard/api/actions', {
    method: 'POST',
    cookie: await cookie(),
    headers: { 'X-CC': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'life.mark_workout', payload: { day: TODAY }, idemKey: 'habit-1' }),
  }), envWith(db));
  assert.equal(res.status, 200);
  const row = [...db.habits.values()].find((h) => h.kind === 'workout' && h.day === TODAY);
  assert.equal(row?.done, 1);
});

test('Telegram push sends only new critical items', async () => {
  const db = memD1();
  db.snapshots.set('sponsors', row('sponsors', lateSponsors(8)));
  db.snapshots.set('bank_scan', row('bank_scan', { accounts: [{ name: 'Business card', status: 'needs_code' }] }));
  const prev = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('api.telegram.org')) {
      sent.push(JSON.parse(opts.body).text);
      return new Response('{}', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    await handleCron(envWith(db, { GOOGLE_REFRESH_TOKEN: '' }));
  } finally {
    globalThis.fetch = prev;
  }
  assert.equal(sent.length, 2);
  assert.ok(sent.some((t) => /bank/i.test(t)));
  assert.ok(sent.some((t) => /late/i.test(t)));
  assert.equal(sent.some((t) => /support/i.test(t)), false);
});

function lastNow() {
  return '2026-09-18T08:12:00-07:00';
}
