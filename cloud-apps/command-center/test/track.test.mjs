import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { handleApi } from '../src/api.js';
import { sha256Hex, CHANNEL_WRITERS } from '../src/bots.js';
import { buildChannelPages, channelData, pacific, YOUTUBE_CHANNELS } from '../src/channels.js';
import { buildTrackPage, stageOf, trackData } from '../src/track.js';
import { calendar } from '../public/js/pages/channels.js';
import { setSort, track } from '../public/js/pages/track.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TOK = Object.fromEntries([...CHANNEL_WRITERS, 'qc'].map((b) => [b, `ccb_${b.padEnd(43, 'x')}`]));
const NOW = Date.parse('2026-10-30T19:00:00Z');
const YT = 'abcdefghijk';

async function setup() {
  const db = sqliteD1();
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
async function call(env, method, path, { bot, body, jon } = {}) {
  const h = new Headers();
  if (bot) h.set('Authorization', `Bearer ${TOK[bot]}`);
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}
async function visit(env, path, method = 'GET') {
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, { method, redirect: 'manual' }), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
const importCsv = (env, slug, videos) => call(env, 'PUT', `/v1/calendar/${slug}`, { bot: 'developer', body: { videos } });
const postStats = (env, stats, bot = 'developer') => call(env, 'POST', '/v1/links/stats', { bot, body: { stats } });
const linkOf = async (db, title) => (await db.prepare('SELECT l.code, l.clicks FROM yt_links l JOIN yt_calendar v ON v.id = l.video_id WHERE v.title = ?').bind(title).first());
async function trackPage(db) {
  const out = { pages: { track: {} } };
  buildTrackPage(out, await trackData(db, 'https://jonmac.ai', NOW));
  return out.pages.track;
}
async function calendarPage(db) {
  const out = { pages: { calendar: {} } };
  buildChannelPages(out, await channelData(db, NOW), NOW);
  return out.pages.calendar;
}
const calendarRow = (page, slug, title) => page.channels.find((c) => c.slug === slug).upcoming.find((v) => v.title === title);

const PLANNED = { date: '2026-11-03', time: '09:00', title: 'Tiny houses', status: 'scheduled', youtube_id: YT };

test('a tracked link counts one click and lands on the page with the UTMs', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'peter-collins', [{ date: '2026-11-03', title: 'Road test', status: 'planned' }]);
  const { code } = await linkOf(db, 'Road test');
  assert.match(code, /^[0-9a-f]{10}$/);
  const r = await visit(env, `/v/${code}`);
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://homeguidepress.com/drivers-bundle');
  assert.deepEqual(Object.fromEntries(to.searchParams), { utm_source: 'youtube', utm_campaign: 'peter-collins', utm_content: code });
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.equal((await linkOf(db, 'Road test')).clicks, 1);
  const columns = db.sqlite.prepare('PRAGMA table_info(yt_links)').all().map((c) => c.name).join();
  assert.doesNotMatch(columns, /ip|agent|referr|country/i, 'nothing about the visitor is kept');
});

test('an unknown link is a 404 and counts nothing, and only a stored landing page is ever a target', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'peter-collins', [{ date: '2026-11-03', title: 'Road test', status: 'planned' }]);
  const { code } = await linkOf(db, 'Road test');
  for (const path of ['/v/0000000000', '/v/nope', '/v/', `/v/${code}/x`]) assert.equal((await visit(env, path)).status, 404, path);
  assert.equal((await visit(env, `/v/${code}`, 'HEAD')).status, 302);
  assert.equal((await visit(env, `/v/${code}`, 'POST')).status, 404);
  assert.equal((await linkOf(db, 'Road test')).clicks, 0, 'not by a 404, a HEAD or a POST');
  const to = (await visit(env, `/v/${code}?url=https://evil.example&to=https://evil.example`)).headers.get('Location');
  assert.match(to, /^https:\/\/homeguidepress\.com\/drivers-bundle\?/);
  assert.doesNotMatch(to, /evil/);
});

test('a link with no landing page is a 404, counts nothing and has no url to copy, until a channel owner sets one', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'jon-mac', [{ date: '2026-11-03', title: 'Topview', status: 'planned' }]);
  const { code } = await linkOf(db, 'Topview');
  assert.equal((await visit(env, `/v/${code}`)).status, 404);
  assert.equal((await linkOf(db, 'Topview')).clicks, 0);
  assert.equal((await call(env, 'GET', '/v1/links?channel=jon-mac', { bot: 'qc' })).body.links[0].url, null);
  assert.equal((await call(env, 'PUT', '/v1/channels/jon-mac', { bot: 'qc', body: { landing: 'https://jonmac.ai/clone' } })).status, 403);
  assert.equal((await call(env, 'PUT', '/v1/channels/jon-mac', { bot: 'ana', body: { landing: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/channels/jon-mac', { bot: 'ana', body: { schedule: 'Tue' } })).body.channel.landing, null);
  const set = await call(env, 'PUT', '/v1/channels/jon-mac', { bot: 'ana', body: { landing: 'https://jonmac.ai/clone' } });
  assert.deepEqual([set.body.channel.schedule, set.body.channel.landing], ['Tue', 'https://jonmac.ai/clone'], 'one field leaves the other');
  assert.match((await visit(env, `/v/${code}`)).headers.get('Location'), /^https:\/\/jonmac\.ai\/clone\?/);
  await call(env, 'PUT', `/v1/links/${code}`, { bot: 'ana', body: { landing: 'https://jonmac.ai/other' } });
  assert.match((await visit(env, `/v/${code}`)).headers.get('Location'), /^https:\/\/jonmac\.ai\/other\?/, "the video's own beats the channel's");
  assert.equal((await call(env, 'PUT', '/v1/links/0000000000', { bot: 'ana', body: { landing: '' } })).status, 404);
});

test('the page lists every channel with correct counts, one row per video, filtered by channel', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'aria-creates', [
    { date: '2026-11-01', title: 'Not made yet', status: 'idea', link: 'https://www.youtube.com/watch?v=sourcevideo' },
    { date: '2026-11-02', title: 'Finished', status: 'qc' },
    { date: '2026-11-03', title: 'Uploaded', status: 'review', link: 'https://studio.youtube.com/video/abcdefghijk/edit' },
    { date: '2026-11-04', title: 'Queued', status: 'scheduled' },
    { date: '2026-10-01', title: 'Out', status: 'published' },
  ]);
  await call(env, 'POST', '/v1/calendar', { bot: 'developer', body: { channel: 'jon-mac', title: 'Added by hand', date: '2026-11-05', status: 'published' } });
  const page = await trackPage(db);
  assert.equal(page.channels.length, YOUTUBE_CHANNELS.length + 1);
  assert.deepEqual(page.channels.slice(1).map((c) => c.slug), YOUTUBE_CHANNELS.map((c) => c.slug));
  assert.deepEqual(page.channels.find((c) => c.slug === 'aria-creates').counts, { created: 4, posted: 3, scheduled: 1, live: 1 }, 'cumulative');
  assert.deepEqual(page.channels.find((c) => c.slug === 'jon-mac').counts, { created: 1, posted: 1, scheduled: 0, live: 1 });
  assert.deepEqual(page.channels.find((c) => c.slug === 'rosa-cooks').counts, { created: 0, posted: 0, scheduled: 0, live: 0 });
  assert.equal(page.videos.length, 6);
  assert.ok(page.videos.every((v) => v.code), 'every video has its own link');
  assert.equal(new Set(page.videos.map((v) => v.code)).size, 6);

  const all = track(page, {}, '');
  for (const c of YOUTUBE_CHANNELS) assert.ok(all.includes(`<tr data-page="track/${c.slug}">`), c.slug);
  assert.doesNotMatch(all, /Not made yet|Added by hand|data-copy/, 'All lists channels, not videos');
  assert.deepEqual(allRow(all, 'aria-creates'), [labelOf('aria-creates'), 'Yes', '3', '1', '1', '-', '—', '—', '—', '—'], 'on YouTube, scheduled, public; no Studio data is blank, AVD a dash');
  assert.deepEqual(allRow(all, 'rosa-cooks'), [labelOf('rosa-cooks'), 'No', '0', '0', '0', '-', '—', '—', '—', '—']);
  assert.match(all, /as in Studio. (Views and subs updated|No YouTube data yet)/, 'a space before the data note');
  setSort('all:onAir');
  const live = track(page, {}, '').match(/<tr data-page="track\/[^"]+">.*?<\/tr>/gs).map((r) => /Yes/.test(r));
  assert.ok(live[0] && live.indexOf(false) > live.lastIndexOf(true), 'first click on Live puts Yes first');
  setSort('all:label');
  const aria = track(page, {}, 'aria-creates');
  assert.match(aria, /Posted to YouTube/);
  assert.match(aria, /<span[^>]*>Idea<\/span>/, 'a video not made yet shows its Calendar status');
  assert.match(aria, /data-copy="https:\/\/jonmac\.ai\/v\/[0-9a-f]{10}"/);
  const one = track(page, {}, 'jon-mac');
  assert.match(one, /Added by hand/);
  assert.match(one, /No landing page/);
  assert.doesNotMatch(one, /Finished/);
});

const labelOf = (slug) => YOUTUBE_CHANNELS.find((c) => c.slug === slug).label;
const allRow = (html, slug) => html.match(new RegExp(`<tr data-page="track/${slug}">(.*?)</tr>`, 's'))[1].split(/<[^>]+>/).map((s) => s.trim()).filter(Boolean);

test('All sums Studio impressions, views and net subscribers per channel', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'First', status: 'published', youtube_id: YT },
    { date: '2026-11-04', title: 'Second', status: 'scheduled', youtube_id: 'lmnopqrstuv' },
  ]);
  assert.equal((await postStats(env, [{ youtube_id: YT, impressions: 1200, views: 30, subs: 3 }, { youtube_id: 'lmnopqrstuv', subs: -1 }])).status, 200);
  assert.equal((await postStats(env, [{ youtube_id: YT, subs: 1.5 }])).status, 400);
  const page = await trackPage(db);
  assert.deepEqual(allRow(track(page, {}, ''), 'theo-creates'), [labelOf('theo-creates'), 'Yes', '2', '1', '1', '1,200', '-', '30', '2', '—', '—', '—', '—']);
});

test('stage: a YouTube link only means posted on a finished video', () => {
  assert.equal(stageOf('idea', 'https://www.youtube.com/watch?v=source00000'), null);
  assert.equal(stageOf('editing', 'https://youtu.be/source00000'), null);
  assert.equal(stageOf('qc', null), 'created');
  assert.equal(stageOf('review', 'https://docs.google.com/x'), 'created');
  assert.equal(stageOf('review', 'https://youtu.be/abcdefghijk'), 'posted');
  assert.equal(stageOf('review', null, YT), 'posted', 'an ID counts like a link');
  assert.equal(stageOf('idea', null, YT), null);
});

test('stats are checked, all or none, and shown once posted', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'rosa-cooks', [PLANNED, { date: '2026-11-04', title: 'Other', status: 'planned' }]);
  assert.equal((await postStats(env, [{ youtube_id: YT, impressions: 12000, ctr: 4.7, views: 900 }], 'qc')).status, 403);
  assert.equal((await call(env, 'POST', '/v1/links/stats', { body: { stats: [] } })).status, 401);
  const bad = await postStats(env, [{ youtube_id: YT, views: 1 }, { youtube_id: YT, ctr: 101 }]);
  assert.equal(bad.status, 400);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM yt_stats').get().n, 0, 'all or none');
  for (const s of [{ youtube_id: 'short', views: 1 }, { youtube_id: YT }, { youtube_id: YT, status: 'deleted' }, { youtube_id: YT, scheduled_at: '2026-11-03 09:00' }, { youtube_id: YT, views: 1.5 }]) {
    assert.equal((await postStats(env, [s])).status, 400, JSON.stringify(s));
  }
  const ok = await postStats(env, [{ youtube_id: YT, impressions: 12000, ctr: 4.7, views: 900 }, { youtube_id: 'zzzzzzzzzzz', views: 3 }]);
  assert.deepEqual([ok.status, ok.body.saved, ok.body.notOnCalendar], [200, 2, ['zzzzzzzzzzz']]);
  await postStats(env, [{ youtube_id: YT, views: 950 }]);
  const html = track(await trackPage(db), {}, 'rosa-cooks');
  assert.match(html, /12,000/);
  assert.match(html, /4\.7%/);
  assert.match(html, /950/, 'a field left out keeps its value');
});

test('Kelowna time: UTC-7 on both sides of Nov 1 2026, when BC stopped falling back', () => {
  assert.deepEqual(pacific('2026-10-31T16:00:00Z'), { day: '2026-10-31', time: '09:00' }, 'UTC-7');
  assert.deepEqual(pacific('2026-11-01T08:30:00Z'), { day: '2026-11-01', time: '01:30' }, 'before 2 am Nov 1');
  assert.deepEqual(pacific('2026-11-01T09:30:00Z'), { day: '2026-11-01', time: '02:30' }, 'no fall back: not 01:30 again');
  assert.deepEqual(pacific('2026-11-02T17:00:00Z'), { day: '2026-11-02', time: '10:00' }, 'still UTC-7, an hour ahead of US Pacific');
  assert.deepEqual(pacific('2026-11-03T02:00:00Z'), { day: '2026-11-02', time: '19:00' }, 'the Kelowna day, not the UTC one');
});

test("YouTube's date, time and status win over the CSV and the disagreement is flagged, with no CSV column rewritten", async () => {
  const { db, env } = await setup();
  await importCsv(env, 'jon-mac', [
    PLANNED,
    { date: '2026-11-04', time: '10:00', title: 'No ID', status: 'scheduled' },
    { date: '2026-11-05', time: '12:00', title: 'Agrees', status: 'scheduled', youtube_id: 'lmnopqrstuv' },
  ]);
  await postStats(env, [
    { youtube_id: YT, scheduled_at: '2026-11-06T21:30:00Z', status: 'live' },
    { youtube_id: 'lmnopqrstuv', scheduled_at: '2026-11-05T19:00:00Z', status: 'scheduled' },
  ]);
  const page = await calendarPage(db);
  const won = calendarRow(page, 'jon-mac', 'Tiny houses');
  assert.deepEqual([won.date, won.timeLabel, won.status, won.differs], ['2026-11-06', '2:30 PM PT', 'published', ['date', 'time', 'status']]);
  const planned = calendarRow(page, 'jon-mac', 'No ID');
  assert.deepEqual([planned.date, planned.timeLabel, planned.status, planned.differs], ['2026-11-04', '10:00 AM PT', 'scheduled', []], 'no YouTube ID: as planned');
  assert.deepEqual(calendarRow(page, 'jon-mac', 'Agrees').differs, [], 'same date, time and status');
  assert.deepEqual(page.channels.find((c) => c.slug === 'jon-mac').upcoming.map((v) => v.title), ['No ID', 'Agrees', 'Tiny houses'], "in YouTube's date order");

  const html = calendar(page, {}, 'jon-mac');
  assert.equal(html.match(/Differs from YouTube/g).length, 1, 'flagged on that row alone');
  assert.match(html, /Calendar says Tue, Nov 3, 9:00 AM PT, Scheduled/);

  const tracked = await trackPage(db);
  const row = tracked.videos.find((v) => v.title === 'Tiny houses');
  assert.equal(row.status, 'live');
  assert.equal(tracked.channels.find((c) => c.slug === 'jon-mac').counts.live, 1);
  assert.match(track(tracked, {}, 'jon-mac'), /Differs from YouTube/);

  const raw = db.sqlite.prepare("SELECT day, time_pt, status FROM yt_calendar WHERE title = 'Tiny houses'").get();
  assert.deepEqual({ ...raw }, { day: '2026-11-03', time_pt: '09:00', status: 'scheduled' });
});

test('a row with an ID but no YouTube data stays as planned', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'jon-mac', [PLANNED]);
  const row = calendarRow(await calendarPage(db), 'jon-mac', 'Tiny houses');
  assert.deepEqual([row.date, row.timeLabel, row.status, row.differs], ['2026-11-03', '9:00 AM PT', 'scheduled', []]);
});

test('a row with no planned time takes YouTube\'s time and is not a time disagreement', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'jon-mac', [{ date: '2026-11-03', title: 'Tiny houses', status: 'scheduled', youtube_id: YT }]);
  await postStats(env, [{ youtube_id: YT, scheduled_at: '2026-11-03T16:00:00Z', status: 'scheduled' }]);
  const row = calendarRow(await calendarPage(db), 'jon-mac', 'Tiny houses');
  assert.deepEqual([row.timeLabel, row.differs], ['9:00 AM PT', []]);
});

test("Studio's date with no time moves a scheduled row, flags it and keeps the planned time, until the video goes live", async () => {
  const { db, env } = await setup();
  await importCsv(env, 'jon-mac', [{ date: '2026-11-03', time: '07:00', title: 'Tiny houses', status: 'scheduled', youtube_id: YT }]);
  await postStats(env, [{ youtube_id: YT, scheduled_date: '2026-11-05', status: 'scheduled' }]);
  let row = calendarRow(await calendarPage(db), 'jon-mac', 'Tiny houses');
  assert.deepEqual([row.date, row.timeLabel, row.status, row.differs], ['2026-11-05', '7:00 AM PT', 'scheduled', ['date']]);
  await postStats(env, [{ youtube_id: YT, status: 'live' }]);
  row = calendarRow(await calendarPage(db), 'jon-mac', 'Tiny houses');
  assert.deepEqual([row.date, row.status, row.differs], ['2026-11-03', 'published', ['status']]);
  for (const day of ['Nov 5', '2026-02-30']) assert.equal((await postStats(env, [{ youtube_id: YT, scheduled_date: day }])).status, 400, day);

  // An old exact time loses to a newer Studio date.
  await postStats(env, [{ youtube_id: YT, scheduled_at: '2026-11-03T15:00:00Z', scheduled_date: '2026-11-05', status: 'scheduled' }]);
  row = calendarRow(await calendarPage(db), 'jon-mac', 'Tiny houses');
  assert.deepEqual([row.date, row.timeLabel, row.differs], ['2026-11-05', '7:00 AM PT', ['date']]);
});

test("a calendar import after a stats post keeps YouTube's values, the link and its clicks", async () => {
  const { db, env } = await setup();
  await importCsv(env, 'rosa-cooks', [PLANNED, { date: '2026-11-04', title: 'No ID', status: 'planned' }]);
  await postStats(env, [{ youtube_id: YT, scheduled_at: '2026-11-07T16:00:00Z', status: 'scheduled', views: 5 }]);
  const before = await linkOf(db, 'Tiny houses');
  await visit(env, `/v/${before.code}`);

  // The CSV moved the date, dropped the ID column and re-ordered its rows.
  await importCsv(env, 'rosa-cooks', [
    { date: '2026-11-04', title: 'No ID', status: 'planned' },
    { date: '2026-11-05', time: '11:00', title: 'tiny houses', status: 'scheduled' },
  ]);
  const row = calendarRow(await calendarPage(db), 'rosa-cooks', 'tiny houses');
  assert.deepEqual([row.date, row.timeLabel, row.differs], ['2026-11-07', '9:00 AM PT', ['date', 'time']]);
  const after = await linkOf(db, 'tiny houses');
  assert.deepEqual({ ...after }, { code: before.code, clicks: 1 });

  // A new title with the same ID is the same video too.
  await importCsv(env, 'rosa-cooks', [{ date: '2026-11-05', title: 'Tiny homes', status: 'scheduled', youtube_id: YT }]);
  assert.equal((await linkOf(db, 'Tiny homes')).code, before.code);

  // Gone from the CSV: the published link still works.
  await importCsv(env, 'rosa-cooks', []);
  assert.equal((await visit(env, `/v/${before.code}`)).status, 302);
  assert.equal(db.sqlite.prepare('SELECT clicks FROM yt_links WHERE code = ?').get(before.code).clicks, 2);
});

test('a YouTube ID comes from the CSV column, else a finished video\'s link, never a source link', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'jon-mac', [
    { date: '2026-11-03', title: 'Source', status: 'idea', link: `https://www.youtube.com/watch?v=${YT}` },
    { date: '2026-11-03', title: 'Studio', status: 'review', link: `https://studio.youtube.com/video/${YT}/edit` },
    { date: '2026-11-03', title: 'Column', status: 'editing', youtube_id: 'lmnopqrstuv' },
  ]);
  const rows = Object.fromEntries(db.sqlite.prepare('SELECT title, youtube_id FROM yt_calendar').all().map((r) => [r.title, r.youtube_id]));
  assert.deepEqual(rows, { Source: null, Studio: YT, Column: 'lmnopqrstuv' });
  assert.equal((await importCsv(env, 'jon-mac', [{ date: '2026-11-03', title: 'Bad', status: 'idea', youtube_id: 'x' }])).status, 400);

  const add = await call(env, 'POST', '/v1/calendar', { bot: 'developer', body: { channel: 'jon-mac', title: 'Added', date: '2026-11-05', status: 'planned' } });
  assert.equal(add.body.video.youtubeId, null);
  const found = await call(env, 'PATCH', `/v1/calendar/${add.body.video.id}`, { bot: 'developer', body: { status: 'scheduled', link: 'https://youtu.be/zzzzzzzzzzz' } });
  assert.equal(found.body.video.youtubeId, 'zzzzzzzzzzz');
  const cleared = await call(env, 'PATCH', `/v1/calendar/${add.body.video.id}`, { bot: 'developer', body: { youtube_id: '' } });
  assert.equal(cleared.body.video.youtubeId, null);
});

test('the link list needs a sign-in and gives each video its link', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Road test', status: 'planned' }]);
  await importCsv(env, 'aria-creates', [{ date: '2026-11-03', title: 'Storm kit', status: 'planned' }]);
  assert.equal((await call(env, 'GET', '/v1/links')).status, 401);
  assert.equal((await call(env, 'GET', '/v1/links?channel=nope', { bot: 'qc' })).status, 400);
  assert.equal((await call(env, 'GET', '/v1/links', { jon: true })).body.links.length, 2);
  const { links } = (await call(env, 'GET', '/v1/links?channel=theo-creates', { bot: 'qc' })).body;
  const { code } = await linkOf(db, 'Road test');
  assert.deepEqual([links.length, links[0].url, links[0].title], [1, `https://jonmac.ai/v/${code}`, 'Road test']);
});

test('the migration gives existing Calendar videos a link and keeps their rows', async () => {
  const { db, env } = await setup();
  db.sqlite.prepare(`INSERT INTO yt_calendar (id, channel, title, day, status, created_by, updated_by, idem_key, created_at, updated_at)
    VALUES ('v_old', 'ash-creates', 'Old', '2026-11-03', 'planned', 'x', 'x', 'k', 'x', 'x')`).run();
  await call(env, 'POST', '/v1/calendar', { bot: 'developer', body: { channel: 'ash-creates', title: 'New', date: '2026-11-05', status: 'planned' } });
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM yt_links WHERE channel = 'ash-creates'").get().n, 2);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM yt_channels WHERE landing IS NOT NULL").get().n, 20);
});

test('the snapshot serves the Track page and says so when its tables are missing', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Hooks', status: 'planned' }]);
  const snap = (await call(env, 'GET', '/snapshot?pages=track', { jon: true })).body;
  assert.equal(snap.pages.track.available, true);
  assert.equal(snap.pages.track.videos[0].title, 'Hooks');
  db.sqlite.exec('DROP TABLE yt_stats');
  const gone = (await call(env, 'GET', '/snapshot?pages=track', { jon: true })).body.pages.track;
  assert.equal(gone.available, false);
  assert.match(track(gone, {}, ''), /could not be read/);
});

test('columns sort both ways with blanks last', () => {
  const channels = [{ slug: 'all', label: 'All', group: 'All', all: true }, { slug: 'x', label: 'X', group: 'X', counts: {} }];
  const videos = [['A', 5], ['B', null], ['C', 9]].map(([title, views]) => ({ title, views, channel: 'x', channelLabel: 'X', clicks: 0, status: 'live', calendarStatus: 'published' }));
  const order = () => [...track({ available: true, channels, videos }, {}, 'x').matchAll(/<td>X<\/td><td>(\w)<\/td>/g)].map((m) => m[1]).join('');
  assert.equal(order(), 'ABC');
  setSort('videos:views');
  assert.equal(order(), 'CAB');
  assert.match(track({ available: true, channels, videos }, {}, 'x'), /aria-sort="descending"/);
  setSort('videos:views');
  assert.equal(order(), 'ACB');
  setSort('videos:title');
  assert.equal(order(), 'ABC');
});

test('hostile text stays text everywhere on the page', async () => {
  const H = '"><img src=x onerror=alert(1)>';
  const video = { linked: true, code: 'abc', url: `https://x/${H}`, channel: H, channelLabel: H, title: H, status: 'live', calendarStatus: H, landing: `https://x/${H}`, clicks: 1, impressions: 1, ctr: H, views: 1, differs: ['date', 'status'], planned: { date: H, status: H }, updatedAt: 'z', updated: H };
  const page = { available: true, channels: [{ slug: 'all', label: H, group: 'All', all: true, count: 1 }, { slug: H, label: H, group: H, count: 1, counts: { created: 1, posted: 1, scheduled: 0, live: 1 } }], videos: [video, { ...video, status: null }] };
  for (const sub of ['', H]) assert.doesNotMatch(track(page, {}, sub), /<img/, sub);

  // And from the real routes: a title and a landing page saved by a bot.
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: H, status: 'qc' }]);
  assert.doesNotMatch(track(await trackPage(db), {}, ''), /<img/);
  const { code } = await linkOf(db, H);
  await call(env, 'PUT', `/v1/links/${code}`, { bot: 'ana', body: { landing: `https://viralview.io/${H}` } });
  assert.doesNotMatch((await visit(env, `/v/${code}`)).headers.get('Location'), /[<>"]/);
});

test('an import matches on YouTube ID across every row first, whatever the row order', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'First', status: 'scheduled', youtube_id: YT },
    { date: '2026-11-04', title: 'Second', status: 'scheduled', youtube_id: 'lmnopqrstuv' },
  ]);
  const first = await linkOf(db, 'First');
  const second = await linkOf(db, 'Second');
  // The first ID's new title is the second video's old one, and it comes first.
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Second', status: 'scheduled', youtube_id: YT },
    { date: '2026-11-04', title: 'Third', status: 'scheduled', youtube_id: 'lmnopqrstuv' },
  ]);
  assert.equal((await linkOf(db, 'Second')).code, first.code);
  assert.equal((await linkOf(db, 'Third')).code, second.code);
});

test('a retitle plus a new idea row with the old title gives one row the ID and the link', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Hooks', status: 'scheduled', youtube_id: YT }]);
  const { code } = await linkOf(db, 'Hooks');
  await importCsv(env, 'theo-creates', [
    { date: '2026-12-01', title: 'Hooks', status: 'idea' },
    { date: '2026-11-03', title: 'Better hooks', status: 'scheduled', youtube_id: YT },
  ]);
  const rows = Object.fromEntries(db.sqlite.prepare('SELECT title, youtube_id FROM yt_calendar').all().map((r) => [r.title, r.youtube_id]));
  assert.deepEqual(rows, { Hooks: null, 'Better hooks': YT });
  assert.equal((await linkOf(db, 'Better hooks')).code, code);
  assert.notEqual((await linkOf(db, 'Hooks')).code, code);
});

test('the same title with a different YouTube ID is a different video, so it gets its own link', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Hooks', status: 'scheduled', youtube_id: YT }]);
  const { code } = await linkOf(db, 'Hooks');
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Hooks', status: 'scheduled', youtube_id: 'lmnopqrstuv' }]);
  const now = db.sqlite.prepare("SELECT l.code FROM yt_links l JOIN yt_calendar v ON v.id = l.video_id WHERE v.youtube_id = 'lmnopqrstuv'").get();
  assert.notEqual(now.code, code);
});

test('two imported rows never claim the one earlier row', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Recap', status: 'qc' }]);
  const r = await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Recap', status: 'qc', youtube_id: YT },
    { date: '2026-11-03', title: 'recap', status: 'qc' },
  ]);
  assert.equal(r.status, 200);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM yt_calendar').get().n, 2);
});

test('two rows with one title keep their own links when the CSV order changes', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Recap', status: 'qc' },
    { date: '2026-11-10', title: 'Recap', status: 'qc' },
  ]);
  const codes = () => Object.fromEntries(db.sqlite.prepare('SELECT v.day, l.code FROM yt_calendar v JOIN yt_links l ON l.video_id = v.id').all().map((r) => [r.day, r.code]));
  const before = codes();
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-10', title: 'Recap', status: 'qc' },
    { date: '2026-11-03', title: 'Recap', status: 'qc' },
  ]);
  assert.deepEqual(codes(), before);
});

const idsByDay = (db) => Object.fromEntries(db.sqlite.prepare('SELECT day, youtube_id FROM yt_calendar').all().map((r) => [r.day, r.youtube_id]));

test('a repeated title on different dates keeps each row\'s ID when the CSV leaves it blank', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Q&A', status: 'scheduled', youtube_id: YT },
    { date: '2026-11-10', title: 'Q&A', status: 'scheduled', youtube_id: 'lmnopqrstuv' },
  ]);
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Q&A', status: 'scheduled' },
    { date: '2026-11-10', title: 'Q&A', status: 'scheduled' },
  ]);
  assert.deepEqual(idsByDay(db), { '2026-11-03': YT, '2026-11-10': 'lmnopqrstuv' });
});

test('a second row with a title keeps the first row\'s ID, and a new date takes none', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Series', status: 'scheduled', youtube_id: YT }]);
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Series', status: 'scheduled' },
    { date: '2026-11-10', title: 'Series', status: 'scheduled' },
  ]);
  assert.deepEqual(idsByDay(db), { '2026-11-03': YT, '2026-11-10': null });
});

test('when title and date both repeat, a blank row is not given an ID', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Recap', status: 'scheduled', youtube_id: YT },
    { date: '2026-11-03', title: 'Recap', status: 'scheduled', youtube_id: 'lmnopqrstuv' },
  ]);
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Recap', status: 'scheduled', youtube_id: YT },
    { date: '2026-11-03', title: 'Recap', status: 'scheduled' },
  ]);
  assert.deepEqual(db.sqlite.prepare('SELECT youtube_id FROM yt_calendar ORDER BY youtube_id').all().map((r) => r.youtube_id), [null, YT]);

  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Recap', status: 'scheduled', youtube_id: YT },
    { date: '2026-11-03', title: 'Recap', status: 'scheduled', youtube_id: 'lmnopqrstuv' },
  ]);
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Recap', status: 'scheduled' }]);
  assert.deepEqual(idsByDay(db), { '2026-11-03': null }, 'one row left, and it could be either video');
});

test('a new idea using a renamed video\'s old title takes neither its ID nor its link', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Hooks', status: 'scheduled', youtube_id: YT }]);
  const { code } = await linkOf(db, 'Hooks');
  await importCsv(env, 'theo-creates', [
    { date: '2026-12-01', title: 'Hooks', status: 'idea' },
    { date: '2026-11-03', title: 'Better hooks', status: 'scheduled' },
  ]);
  const rows = Object.fromEntries(db.sqlite.prepare('SELECT title, youtube_id FROM yt_calendar').all().map((r) => [r.title, r.youtube_id]));
  assert.deepEqual(rows, { Hooks: null, 'Better hooks': null });
  assert.equal((await linkOf(db, 'Better hooks')).code, code, 'the retitled row keeps the link');
  assert.notEqual((await linkOf(db, 'Hooks')).code, code);
});

test('a video set back to an idea on its own date keeps its ID', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Hooks', status: 'scheduled', youtube_id: YT }]);
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Hooks', status: 'idea' }]);
  assert.deepEqual(idsByDay(db), { '2026-11-03': YT });
});

test('a video moved in the CSV keeps its ID by title once the row is at QC or later', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Hooks', status: 'scheduled', youtube_id: YT }]);
  await importCsv(env, 'theo-creates', [{ date: '2026-11-20', title: 'Hooks', status: 'scheduled' }]);
  assert.deepEqual(idsByDay(db), { '2026-11-20': YT });
});

test('a retitled row with a blank ID keeps its link but no ID, only when the match is the only one', async () => {
  const { db, env } = await setup();
  const seed = [
    { date: '2026-11-03', title: 'Hooks', status: 'scheduled', youtube_id: YT },
    { date: '2026-11-05', title: 'Links', status: 'scheduled', youtube_id: 'lmnopqrstuv' },
    { date: '2026-11-05', title: 'Thumbs', status: 'scheduled', youtube_id: 'zzzzzzzzzzz' },
    { date: '2026-11-07', title: 'Dropped', status: 'scheduled', youtube_id: 'yyyyyyyyyyy' },
    { date: '2026-11-09', title: 'Own ID', status: 'scheduled', youtube_id: 'xxxxxxxxxxx' },
    { date: '2026-11-11', title: 'Two ways', status: 'scheduled', youtube_id: 'wwwwwwwwwww' },
  ];
  await importCsv(env, 'theo-creates', seed);
  const { code } = await linkOf(db, 'Hooks');
  const dropped = await linkOf(db, 'Dropped');
  const other = await linkOf(db, 'Links');
  await postStats(env, [{ youtube_id: YT, views: 7, status: 'scheduled', scheduled_at: '2026-11-03T17:00:00Z' }]);
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Hooks, retitled', status: 'scheduled' }, // the one match
    { date: '2026-11-05', title: 'Two leftovers', status: 'scheduled' }, // which of two?
    { date: '2026-11-07', title: 'New idea', status: 'idea' }, // not made, so not that video
    { date: '2026-11-09', title: 'Own ID, retitled', status: 'scheduled', youtube_id: 'vvvvvvvvvvv' }, // says it's another video
    { date: '2026-11-11', title: 'One', status: 'scheduled' }, // which of two?
    { date: '2026-11-11', title: 'Other', status: 'scheduled' },
  ]);
  const rows = Object.fromEntries(db.sqlite.prepare('SELECT title, youtube_id FROM yt_calendar').all().map((r) => [r.title, r.youtube_id]));
  assert.deepEqual(rows, { 'Hooks, retitled': null, 'Two leftovers': null, 'New idea': null, 'Own ID, retitled': 'vvvvvvvvvvv', One: null, Other: null });
  assert.equal((await linkOf(db, 'Hooks, retitled')).code, code);
  assert.equal((await trackPage(db)).videos.find((v) => v.title === 'Hooks, retitled').views, null, 'blank, not a guess');
  assert.notEqual((await linkOf(db, 'New idea')).code, dropped.code);
  assert.notEqual((await linkOf(db, 'Two leftovers')).code, other.code);
});

test('a retitle that keeps its YouTube link in the CSV keeps its ID and stats', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Hooks', status: 'scheduled', youtube_id: YT }]);
  const { code } = await linkOf(db, 'Hooks');
  await postStats(env, [{ youtube_id: YT, views: 7 }]);
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Hooks, retitled', status: 'scheduled', link: `https://youtu.be/${YT}` }]);
  assert.deepEqual(idsByDay(db), { '2026-11-03': YT });
  assert.equal((await linkOf(db, 'Hooks, retitled')).code, code);
  assert.equal((await trackPage(db)).videos[0].views, 7);
});

test('two rows with one title on one date are told apart by time', async () => {
  const { db, env } = await setup();
  const at = (time, youtube_id) => ({ date: '2026-11-03', time, title: 'Recap', status: 'scheduled', youtube_id });
  assert.equal((await importCsv(env, 'theo-creates', [at('09:00', YT), at('15:00', 'lmnopqrstuv')])).status, 200);
  const before = db.sqlite.prepare('SELECT id, time_pt FROM yt_calendar ORDER BY time_pt').all();
  assert.equal((await importCsv(env, 'theo-creates', [at('15:00'), at('09:00')])).status, 200, 'no ID, in the other order');
  const ids = db.sqlite.prepare('SELECT id, time_pt, youtube_id FROM yt_calendar ORDER BY time_pt').all();
  assert.deepEqual(ids.map((r) => r.youtube_id), [YT, 'lmnopqrstuv'], 'each time keeps its own video');
  assert.deepEqual(ids.map((r) => r.id), before.map((r) => r.id));
  assert.equal((await importCsv(env, 'theo-creates', [at('09:00'), at('09:00')])).status, 400, 'the same time is still one video');
});

test('a YouTube ID sits on one Calendar row', async () => {
  const { db, env } = await setup();
  const add = (body) => call(env, 'POST', '/v1/calendar', { bot: 'developer', body: { title: 'Added', date: '2026-11-05', status: 'planned', ...body } });
  const dupe = await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'One', status: 'scheduled', youtube_id: YT },
    { date: '2026-11-04', title: 'Two', status: 'scheduled', link: `https://youtu.be/${YT}` },
  ]);
  assert.equal(dupe.status, 400);
  assert.match(dupe.body.error, /videos\[1\].*abcdefghijk/);

  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'One', status: 'scheduled', youtube_id: YT }]);
  assert.equal((await importCsv(env, 'aria-creates', [{ date: '2026-11-03', title: 'Other', status: 'qc' }])).status, 200);
  const other = await importCsv(env, 'aria-creates', [{ date: '2026-11-04', title: 'Clash', status: 'scheduled', youtube_id: YT }]);
  assert.equal(other.status, 409, 'another channel');
  assert.equal(other.body.error, `YouTube ID ${YT} is already on "One" (2026-11-03) in channel theo-creates. Take it off one of the two rows, then import again.`);
  assert.deepEqual(db.sqlite.prepare("SELECT title FROM yt_calendar WHERE channel = 'aria-creates'").all().map((r) => r.title), ['Other'], 'and the import did nothing');
  const first = await add({ channel: 'jon-mac', youtube_id: 'lmnopqrstuv', key: 'k1' });
  assert.equal(first.status, 201);
  assert.equal((await add({ channel: 'jon-mac', youtube_id: 'lmnopqrstuv', key: 'k1' })).body.duplicate, true, 'a retry is still a retry');
  assert.equal((await add({ channel: 'jon-mac', youtube_id: YT })).status, 409, 'POST onto a CSV row');
  const onPost = await importCsv(env, 'jon-mac', [{ date: '2026-11-03', title: 'x', status: 'review', youtube_id: 'lmnopqrstuv' }]);
  assert.equal(onPost.status, 409, 'CSV onto a POST row in its own channel');
  assert.match(onPost.body.error, /"Added" \(2026-11-05\) in channel jon-mac/);
  await add({ channel: 'ash-creates', youtube_id: 'zzzzzzzzzzz' });
  const noKey = await importCsv(env, 'ash-creates', [{ date: '2026-11-03', title: 'x', status: 'review', youtube_id: 'zzzzzzzzzzz' }]);
  assert.match(noKey.body.error, /"Added" \(2026-11-05\) in channel ash-creates/, 'a row added with no key is named too');
  assert.equal((await call(env, 'PATCH', `/v1/calendar/${first.body.video.id}`, { bot: 'developer', body: { youtube_id: YT } })).status, 409);
});

test('a CSV can\'t hold the same title on the same date twice with no ID', async () => {
  const { db, env } = await setup();
  const twice = await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Recap', status: 'planned' },
    { date: '2026-11-03', title: 'recap', status: 'qc' },
  ]);
  assert.equal(twice.status, 400);
  assert.match(twice.body.error, /videos\[1\]/);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM yt_calendar').get().n, 0);
  assert.equal((await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Recap', status: 'qc', youtube_id: YT },
    { date: '2026-11-03', title: 'Recap', status: 'qc' },
    { date: '2026-11-04', title: 'Recap', status: 'qc' },
  ])).status, 200, 'an ID or a date tells them apart');
});

test('a review row with a YouTube ID counts as posted', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Hooks', status: 'review', youtube_id: YT }]);
  const page = await trackPage(db);
  assert.equal(page.videos[0].status, 'posted');
  assert.equal(page.channels.find((c) => c.slug === 'theo-creates').counts.posted, 1);
});

test('stats refuse a date before YouTube or one that doesn\'t exist', async () => {
  const { db, env } = await setup();
  for (const at of ['0001-01-01T00:00:00Z', '1999-12-31T00:00:00Z', '2004-12-31T23:59:59Z', '2026-02-30T12:00:00Z', '2026-04-31T12:00:00Z', '2026-11-03T24:00:00Z', '2026-13-01T00:00:00Z']) {
    assert.equal((await postStats(env, [{ youtube_id: YT, scheduled_at: at }])).status, 400, at);
  }
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM yt_stats').get().n, 0);
  for (const at of ['2005-01-01T00:00:00Z', '2028-02-29T12:00:00Z']) assert.equal((await postStats(env, [{ youtube_id: YT, scheduled_at: at }])).status, 200, at);
});

test('a bad stored date is ignored, so the snapshot still answers', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', ['0001-01-01T00:00:00.000Z', 'garbage', '2026-02-30T12:00:00.000Z'].map((at, i) => {
    db.sqlite.prepare('INSERT INTO yt_stats (youtube_id, scheduled_at, updated_at) VALUES (?, ?, ?)').run(`bad${i}aaaaaaa`, at, at);
    return { date: `2026-11-0${i + 3}`, time: '09:00', title: `Row ${i}`, status: 'scheduled', youtube_id: `bad${i}aaaaaaa` };
  }));
  assert.equal((await call(env, 'GET', '/snapshot', { jon: true })).status, 200);
  assert.equal((await call(env, 'GET', '/snapshot?pages=track', { jon: true })).status, 200);
  const page = await calendarPage(db);
  for (const i of [0, 1, 2]) {
    const row = calendarRow(page, 'theo-creates', `Row ${i}`);
    assert.equal(row.date, `2026-11-0${i + 3}`, 'as planned');
    assert.deepEqual(row.differs, []);
  }
  assert.equal((await trackPage(db)).videos.length, 3);
});

test('an import only matches rows on its own channel', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [{ date: '2026-11-03', title: 'Hooks', status: 'scheduled', youtube_id: YT }]);
  const theirs = db.sqlite.prepare('SELECT id FROM yt_calendar').get().id;
  const r = await importCsv(env, 'aria-creates', [{ date: '2026-11-03', title: 'Hooks', status: 'scheduled' }]);
  assert.equal(r.status, 200);
  const rows = db.sqlite.prepare('SELECT id, channel, youtube_id FROM yt_calendar ORDER BY channel').all();
  assert.deepEqual(rows.map((x) => [x.channel, x.youtube_id]), [['aria-creates', null], ['theo-creates', YT]]);
  assert.notEqual(rows[0].id, theirs);
});

test('a link landing page needs a channel writer, an http(s) address and a known code', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'jon-mac', [{ date: '2026-11-03', title: 'Topview', status: 'planned' }]);
  const { code } = await linkOf(db, 'Topview');
  const put = (who, landing) => call(env, 'PUT', `/v1/links/${code}`, { ...who, body: { landing } });
  assert.equal((await put({}, 'https://jonmac.ai/x')).status, 401);
  assert.equal((await put({ bot: 'qc' }, 'https://jonmac.ai/x')).status, 403);
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'jonmac.ai/x']) {
    assert.equal((await put({ bot: 'ana' }, bad)).status, 400, bad);
    assert.equal((await call(env, 'PUT', '/v1/channels/jon-mac', { bot: 'ana', body: { landing: bad } })).status, 400, bad);
  }
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM yt_links WHERE landing IS NOT NULL').get().n, 0);
});

test('a badly formed link code is answered without touching the database', async () => {
  const boom = { prepare() { throw new Error('should not query'); } };
  for (const path of ['/v/nope', '/v/ABCDEF0123', '/v/0123456789a']) assert.equal((await visit({ DB: boom }, path)).status, 404, path);
  assert.equal((await visit({ DB: boom }, '/v/0123456789')).status, 503, 'a good code with the database down');
});

test('a bad stored landing page is answered, not thrown, and counts no click', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'jon-mac', [{ date: '2026-11-03', title: 'Topview', status: 'planned' }]);
  const { code } = await linkOf(db, 'Topview');
  db.sqlite.prepare('UPDATE yt_links SET landing = ? WHERE code = ?').run('not a url', code);
  assert.equal((await visit(env, `/v/${code}`)).status, 503);
  assert.equal((await linkOf(db, 'Topview')).clicks, 0);
});

test('before the migration: Calendar and Content stay up, writes answer 503 and nothing half lands', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Hooks', status: 'planned' },
    { date: '2026-11-04', time: '09:00', title: 'Links', status: 'planned' },
  ]);
  const id = db.sqlite.prepare("SELECT id FROM yt_calendar WHERE title = 'Hooks'").get().id;
  db.sqlite.exec(`DROP TABLE yt_stats; DROP TABLE yt_links; DROP INDEX yt_calendar_youtube;
    ALTER TABLE yt_calendar DROP COLUMN youtube_id; ALTER TABLE yt_channels DROP COLUMN landing;`);

  const out = { pages: { calendar: {}, content: {} } };
  buildChannelPages(out, await channelData(db, NOW), NOW);
  assert.equal(out.pages.calendar.available, true);
  assert.equal(out.pages.content.available, true);
  assert.deepEqual(calendarRow(out.pages.calendar, 'theo-creates', 'Hooks').differs, []);

  const schedule = await call(env, 'PUT', '/v1/channels/theo-creates', { bot: 'ana', body: { schedule: 'Tue' } });
  assert.deepEqual([schedule.status, schedule.body.channel.schedule, schedule.body.channel.landing], [200, 'Tue', null]);
  assert.equal((await call(env, 'GET', '/v1/channels', { bot: 'qc' })).status, 200);

  assert.equal((await call(env, 'PUT', '/v1/channels/theo-creates', { bot: 'ana', body: { landing: 'https://viralview.io' } })).status, 503);
  assert.equal((await call(env, 'POST', '/v1/calendar', { bot: 'developer', body: { channel: 'theo-creates', title: 'New', date: '2026-11-05', status: 'planned' } })).status, 503);
  assert.equal((await importCsv(env, 'theo-creates', [{ date: '2026-11-05', title: 'Hooks', status: 'planned' }])).status, 503);
  const patched = await call(env, 'PATCH', `/v1/calendar/${id}`, { bot: 'developer', body: { status: 'scheduled', link: `https://youtu.be/${YT}` } });
  assert.equal(patched.status, 503);
  assert.deepEqual(db.sqlite.prepare('SELECT title, status, link FROM yt_calendar ORDER BY day').all().map((r) => ({ ...r })), [
    { title: 'Hooks', status: 'planned', link: null }, { title: 'Links', status: 'planned', link: null }], 'nothing changed');
});

test('a calendar update on a missing video is a 404', async () => {
  const { env } = await setup();
  assert.equal((await call(env, 'PATCH', '/v1/calendar/v_nope', { bot: 'developer', body: { status: 'qc' } })).status, 404);
});

test('a row YouTube moved past the 60 days stays on the Calendar, and only rows on show are overlaid', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'jon-mac', [
    { date: '2026-06-01', time: '09:00', title: 'Moved', status: 'scheduled', youtube_id: YT },
    { date: '2026-06-02', title: 'Old', status: 'published', youtube_id: 'lmnopqrstuv' },
    { date: '2026-11-03', title: 'Plain', status: 'planned' },
  ]);
  await postStats(env, [{ youtube_id: YT, scheduled_at: '2026-11-06T17:00:00Z', status: 'scheduled' }, { youtube_id: 'lmnopqrstuv', scheduled_at: '2026-06-02T17:00:00Z', status: 'live' }]);
  const page = await calendarPage(db);
  assert.deepEqual(page.channels.find((c) => c.slug === 'jon-mac').upcoming.map((v) => [v.title, v.date]), [['Plain', '2026-11-03'], ['Moved', '2026-11-06']]);
  assert.equal(page.channels.find((c) => c.slug === 'jon-mac').earlier.length, 0, 'older than the window, even with data');
});

test('the Calendar and Track use Kelowna time for today, not Los Angeles', async () => {
  const { db, env } = await setup();
  const late = Date.parse('2026-11-03T07:30:00Z'); // 12:30 AM Nov 3 in Kelowna, still 11:30 PM Nov 2 in Los Angeles
  await importCsv(env, 'jon-mac', [
    { date: '2026-11-03', title: 'Midnight', status: 'scheduled', youtube_id: YT },
    { date: '2026-11-04', title: 'Tomorrow', status: 'planned' },
  ]);
  await postStats(env, [{ youtube_id: YT, status: 'scheduled', scheduled_at: '2026-11-03T07:00:00Z' }]);
  const out = { pages: { calendar: {} } };
  buildChannelPages(out, await channelData(db, late), late);
  const row = calendarRow(out.pages.calendar, 'jon-mac', 'Midnight');
  assert.deepEqual([row.date, row.timeLabel, row.differs], ['2026-11-03', '12:00 AM PT', []]);
  assert.equal(row.dateLabel.split(',')[0], 'Today');
  db.sqlite.exec("UPDATE yt_stats SET updated_at = '2026-11-03T07:00:00.000Z'");
  const tracked = await trackData(db, 'https://jonmac.ai', late);
  assert.equal(tracked.videos.find((v) => v.title === 'Midnight').updated, 'Today, 12:00 AM PT');
});

test('the 60-day window starts on the Kelowna day', async () => {
  const { db, env } = await setup();
  const late = Date.parse('2027-01-05T07:30:00Z'); // 60 days back: Nov 6 in Kelowna, Nov 5 in Los Angeles
  await importCsv(env, 'jon-mac', [{ date: '2026-11-05', title: 'Before', status: 'published' }, { date: '2026-11-06', title: 'Edge', status: 'published' }]);
  assert.deepEqual((await channelData(db, late)).calendar.map((r) => r.title), ['Edge']);
});

test('only youtube.com and youtu.be links give a YouTube ID', async () => {
  const { db, env } = await setup();
  const yes = [(id) => `https://www.youtube.com/watch?v=${id}`, (id) => `https://m.youtube.com/watch?t=3&v=${id}`, (id) => `https://youtu.be/${id}?si=1`, (id) => `https://www.youtube.com/shorts/${id}`, (id) => `https://www.youtube.com/embed/${id}`,
    (id) => `https://www.youtube-nocookie.com/embed/${id}`, (id) => `https://www.youtube.com/live/${id}?feature=share`, (id) => `https://studio.youtube.com/video/${id}/edit`].map((link, i) => [link(`abcdefghij${i}`), `abcdefghij${i}`]);
  const no = [`https://evil.example/watch?v=${YT}`, `https://notyoutube.com/shorts/${YT}`, `https://youtube.com.evil.example/shorts/${YT}`, `https://evil.example/?x=youtu.be/${YT}`, `https://evil.example/youtube.com/watch?v=${YT}`, `https://youtu.be/${YT}extra`];
  await importCsv(env, 'jon-mac', [...yes.map(([link]) => link), ...no].map((link, i) => ({ date: '2026-11-03', title: `r${i}`, status: 'review', link })));
  const ids = db.sqlite.prepare('SELECT title, youtube_id FROM yt_calendar').all();
  for (let i = 0; i < yes.length + no.length; i++) {
    assert.equal(ids.find((r) => r.title === `r${i}`).youtube_id, yes[i]?.[1] ?? null, String(yes[i]?.[0] ?? no[i - yes.length]));
  }
});

test('stats: a field left out keeps its value and an explicit null clears it', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [PLANNED]);
  await postStats(env, [{ youtube_id: YT, impressions: 100, ctr: 4.7, views: 9, scheduled_at: '2026-11-03T17:00:00Z', status: 'scheduled' }]);
  await postStats(env, [{ youtube_id: YT, views: 12 }]);
  const row = () => { const { impressions, ctr, views, scheduled_at, status } = db.sqlite.prepare('SELECT * FROM yt_stats').get(); return [impressions, ctr, views, scheduled_at, status]; };
  assert.deepEqual(row(), [100, 4.7, 12, '2026-11-03T17:00:00.000Z', 'scheduled']);
  await postStats(env, [{ youtube_id: YT, impressions: null, ctr: null, scheduled_at: null, status: null }]);
  assert.deepEqual(row(), [null, null, 12, null, null]);
  await postStats(env, [{ youtube_id: 'lmnopqrstuv', views: null }]);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM yt_stats').get().n, 2, 'a first post of just a null is fine');
  const [v] = (await trackPage(db)).videos;
  assert.deepEqual([v.impressions, v.ctr, v.views, v.status], [null, null, 12, 'scheduled'], 'cleared: back to the plan');
});

test('a video pulled back to private or unlisted reads as posted, and flags only a date it broke', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [
    { date: '2026-11-03', title: 'Pulled', status: 'published', youtube_id: YT },
    { date: '2026-11-04', title: 'Uploaded', status: 'review', youtube_id: 'lmnopqrstuv' },
  ]);
  await postStats(env, [{ youtube_id: YT, status: 'private' }, { youtube_id: 'lmnopqrstuv', status: 'unlisted' }]);
  const page = await calendarPage(db);
  const pulled = calendarRow(page, 'theo-creates', 'Pulled');
  assert.deepEqual([pulled.status, pulled.differs], ['private', ['status']]);
  const uploaded = calendarRow(page, 'theo-creates', 'Uploaded');
  assert.deepEqual([uploaded.status, uploaded.differs], ['unlisted', []], 'not out yet, as the Calendar expects');
  const html = calendar(page, {}, 'theo-creates');
  assert.match(html, /Private on YouTube/);
  assert.match(html, /Unlisted on YouTube/);

  const tracked = await trackPage(db);
  assert.deepEqual(tracked.videos.map((v) => v.status), ['posted', 'posted']);
  assert.deepEqual(tracked.channels.find((c) => c.slug === 'theo-creates').counts, { created: 2, posted: 2, scheduled: 0, live: 0 });
});

test('Complete Histories is left out of Track and YouTube data never touches its Calendar rows', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'complete-histories', [{ date: '2026-11-03', time: '09:00', title: 'Rome', status: 'scheduled', youtube_id: YT }]);
  await postStats(env, [{ youtube_id: YT, scheduled_at: '2026-11-09T17:00:00Z', status: 'live' }]);
  const page = await trackPage(db);
  assert.equal(page.videos.length, 0);
  assert.ok(!page.channels.some((c) => c.slug === 'complete-histories'));
  assert.equal(page.channels[0].count, 0);
  assert.equal((await call(env, 'GET', '/v1/links', { bot: 'qc' })).body.links.length, 0);
  const row = calendarRow(await calendarPage(db), 'complete-histories', 'Rome');
  assert.deepEqual([row.date, row.timeLabel, row.status, row.differs], ['2026-11-03', '9:00 AM PT', 'scheduled', []]);
});

test('Home Guide Press has tracked links that count viewers; ?qc=1 checks and HEAD do not', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'peter-collins', [{ date: '2026-11-03', title: 'Road test', status: 'scheduled', youtube_id: YT }]);
  const { code } = await linkOf(db, 'Road test');
  const hop = await visit(env, `/v/${code}`);
  assert.equal(hop.headers.get('Location'), 'https://homeguidepress.com/drivers-bundle?utm_source=youtube&utm_campaign=peter-collins&utm_content=' + code);
  await visit(env, `/v/${code}?qc=1`);
  await visit(env, `/v/${code}`, 'HEAD');
  assert.equal((await linkOf(db, 'Road test')).clicks, 1, 'only the viewer counted');

  const page = await trackPage(db);
  const v = page.videos.find((x) => x.title === 'Road test');
  assert.deepEqual([v.url, v.code, v.clicks, v.landing], [`https://jonmac.ai/v/${code}`, code, 1, 'https://homeguidepress.com/drivers-bundle']);
  assert.match(track(page, {}, 'peter-collins'), /data-copy/);
  const { links } = (await call(env, 'GET', '/v1/links?channel=peter-collins', { bot: 'qc' })).body;
  assert.deepEqual(links.map((l) => l.url), [`https://jonmac.ai/v/${code}`]);
});

test('a value Studio has not given is a blank cell, and the page says when data last arrived', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'theo-creates', [PLANNED, { date: '2026-11-04', title: 'Other', status: 'planned' }]);
  const empty = await trackPage(db);
  assert.deepEqual([empty.videos[0].impressions, empty.videos[0].ctr, empty.videos[0].views], [null, null, null]);
  const none = track(empty, {}, '');
  assert.match(none, /No YouTube data yet\./);
  assert.doesNotMatch(none, /not connected|–/);

  await postStats(env, [{ youtube_id: YT, views: 950 }]);
  const stamped = '2026-10-30T18:30:00.000Z';
  db.sqlite.prepare('UPDATE yt_stats SET updated_at = ?').run(stamped);
  const page = await trackPage(db);
  const html = track(page, {}, 'theo-creates');
  assert.match(html, /Views and subs updated Today, 11:30 AM PT\./);
  assert.match(html, /<td class="tkcell">Today, 11:30 AM PT<\/td>/, 'and on the row');
  assert.equal(html.match(/Today, 11:30 AM PT/g).length, 2, 'the row with no data has none');
  assert.match(html, /<td class="num"><\/td>/);
  assert.doesNotMatch(html, /not connected|–/);
});

test('the last updated time is the newest across the videos shown', () => {
  const channels = [{ slug: 'all', label: 'All', group: 'All', all: true }];
  const row = (title, updatedAt, updated) => ({ title, updatedAt, updated, channel: 'x', channelLabel: 'X', clicks: null, status: 'live', calendarStatus: 'published' });
  const html = track({ available: true, channels, videos: [row('A', '2026-10-01', 'Older'), row('B', '2026-10-02', 'Newest'), row('C', null, '')] }, {}, '');
  assert.match(html, /updated Newest\./);
});

test('the default snapshot and the poll never run the Track query; opening Track does', async () => {
  const { db, env } = await setup();
  const seen = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => { seen.push(sql); return prepare(sql); };
  const snap = (await call(env, 'GET', '/snapshot', { jon: true })).body;
  assert.deepEqual(snap.pages.track, {}, 'empty until opened');
  assert.equal(seen.filter((s) => /yt_links/.test(s)).length, 0);
  await call(env, 'GET', '/snapshot?pages=track', { jon: true });
  assert.equal(seen.filter((s) => /yt_links/.test(s)).length, 1);
});

test('Track rendered before its data arrives does not throw', () => {
  assert.match(track({}, {}, ''), /has no data yet/);
});

test('the /v route is on the Worker, and no migration uses a compound SELECT D1 refuses', () => {
  const root = new URL('..', import.meta.url);
  assert.match(readFileSync(new URL('wrangler.jsonc', root), 'utf8'), /"pattern":\s*"jonmac\.ai\/v\/\*",\s*"zone_name":\s*"jonmac\.ai"/);
  assert.doesNotMatch(readFileSync(new URL('migrations/0017_track_links.sql', root), 'utf8'), /UNION/);
  assert.match(readFileSync(new URL('public/css/components.css', root), 'utf8'), /^\.wrap \.wrap\{width:100%\}/m, 'a page fills #page, so a wide table scrolls inside its card');
});

test('All shows clicks, conversion, sales and revenue per book channel with a total, dashes elsewhere', async () => {
  const { db, env } = await setup();
  const hgp = sqliteD1();
  hgp.sqlite.exec(readFileSync(new URL('../../homeguidepress/migrations/0001_init.sql', import.meta.url), 'utf8')); // clicks here are not the source of Clicks
  await importCsv(env, 'peter-collins', [{ date: '2026-11-03', title: 'Road test', status: 'scheduled', youtube_id: YT }]);
  await importCsv(env, 'dale-whitaker-pitbulls', [{ date: '2026-11-03', title: 'Pit', status: 'scheduled' }]);
  const gary = (await linkOf(db, 'Road test')).code;
  const dale = (await linkOf(db, 'Pit')).code;
  for (const c of [gary, gary, gary, gary, dale, dale]) await visit(env, `/v/${c}`);
  await visit(env, `/v/${gary}?qc=1`); // our own check
  const order = (id, slug, cents, test = 0, revoked = null) => hgp.sqlite.prepare(
    "INSERT INTO orders (transaction_id, slug, email, amount_cents, is_test, revoked_at, created_at) VALUES (?, ?, 'a@b.c', ?, ?, ?, 'x')").run(id, slug, cents, test, revoked);
  order('t1', 'gary', 2700);
  order('t2', 'gary', 2700);
  order('t3', 'gary', 2700, 1); // sandbox order
  order('t4', 'gary', 2700, 0, 'x'); // refunded
  const out = { pages: { track: {} } };
  buildTrackPage(out, await trackData(db, 'https://jonmac.ai', NOW, hgp));
  const page = out.pages.track;
  assert.deepEqual(page.channels.find((c) => c.slug === 'peter-collins').book, { clicks: 4, sales: 2, revenue: 54 });
  assert.deepEqual(page.channels.find((c) => c.slug === 'dale-whitaker-pitbulls').book, { clicks: 2, sales: 0, revenue: 0 });
  assert.equal(page.channels.find((c) => c.slug === 'jon-mac').book, null, 'no book, no numbers');
  setSort('all:label');
  const html = track(page, {}, '');
  const cells = (slug) => allRow(html, slug).slice(-4);
  assert.deepEqual(cells('peter-collins'), ['4', '50%', '2', '$54.00']);
  assert.deepEqual(cells('dale-whitaker-pitbulls'), ['2', '0%', '0', '$0.00']);
  assert.deepEqual(cells('jon-mac'), ['—', '—', '—', '—']);
  assert.deepEqual(cells('rosa-cooks'), ['0', '—', '0', '$0.00'], 'a book nobody visited: conversion has nothing to divide');
  const totalRow = html.match(/<tr class="tktotal">(.*?)<\/tr>/s)[1].split(/<[^>]+>/).map((s) => s.trim()).filter(Boolean);
  assert.deepEqual([totalRow[0], ...totalRow.slice(-4)], ['Total', '6', '33.3%', '2', '$54.00']);
  setSort('all:clicks');
  const order1 = html.match(/<tr data-page="track\/[^"]+">/g);
  assert.ok(order1.length > 0);
  const byClicks = track(page, {}, '').match(/<tr data-page="track\/([^"]+)">/g).map((r) => r.match(/track\/([^"]+)/)[1]);
  assert.equal(byClicks[0], 'peter-collins', 'first click on Clicks puts the most first');

  const none = { pages: { track: {} } };
  buildTrackPage(none, await trackData(db, 'https://jonmac.ai', NOW)); // no HGP_DB bound
  setSort('all:label');
  const bare = track(none.pages.track, {}, '');
  assert.deepEqual(allRow(bare, 'peter-collins').slice(-4), ['—', '—', '—', '—'], 'unreadable sales show a dash, never a zero');
  assert.deepEqual(bare.match(/<tr class="tktotal">(.*?)<\/tr>/s)[1].split(/<[^>]+>/).map((s) => s.trim()).filter(Boolean).slice(-4), ['—', '—', '—', '—']);
});
