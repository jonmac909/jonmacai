import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { handleApi } from '../src/api.js';
import { sha256Hex, CHANNEL_WRITERS } from '../src/bots.js';
import { buildChannelPages, channelData, CHANNELS, pacific } from '../src/channels.js';
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
  assert.equal(page.channels.length, CHANNELS.length + 1);
  assert.deepEqual(page.channels.slice(1).map((c) => c.slug), CHANNELS.map((c) => c.slug));
  assert.deepEqual(page.channels.find((c) => c.slug === 'aria-creates').counts, { created: 1, posted: 1, scheduled: 1, live: 1 });
  assert.deepEqual(page.channels.find((c) => c.slug === 'jon-mac').counts, { created: 0, posted: 0, scheduled: 0, live: 1 });
  assert.deepEqual(page.channels.find((c) => c.slug === 'rosa-cooks').counts, { created: 0, posted: 0, scheduled: 0, live: 0 });
  assert.equal(page.videos.length, 6);
  assert.ok(page.videos.every((v) => v.code), 'every video has its own link');
  assert.equal(new Set(page.videos.map((v) => v.code)).size, 6);

  const all = track(page, {}, '');
  for (const c of CHANNELS) assert.ok(all.includes(`<tr data-page="track/${c.slug}">`), c.slug);
  assert.match(all, /Posted to YouTube/);
  assert.match(all, /<span[^>]*>Idea<\/span>/, 'a video not made yet shows its Calendar status');
  assert.match(all, /data-copy="https:\/\/jonmac\.ai\/v\/[0-9a-f]{10}"/);
  assert.match(all, /No landing page/);
  const one = track(page, {}, 'jon-mac');
  assert.match(one, /Added by hand/);
  assert.doesNotMatch(one, /Finished/);
});

test('stage: a YouTube link only means posted on a finished video', () => {
  assert.equal(stageOf('idea', 'https://www.youtube.com/watch?v=source00000'), null);
  assert.equal(stageOf('editing', 'https://youtu.be/source00000'), null);
  assert.equal(stageOf('qc', null), 'created');
  assert.equal(stageOf('review', 'https://docs.google.com/x'), 'created');
  assert.equal(stageOf('review', 'https://youtu.be/abcdefghijk'), 'posted');
});

test('stats show "not connected" with no data, and the figures once posted', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'rosa-cooks', [PLANNED, { date: '2026-11-04', title: 'Other', status: 'planned' }]);
  const none = await trackPage(db);
  assert.deepEqual([none.videos[0].impressions, none.videos[0].ctr, none.videos[0].views], [null, null, null]);
  assert.equal(track(none, {}, '').match(/not connected/g).length, 6);

  assert.equal((await postStats(env, [{ youtube_id: YT, impressions: 12000, ctr: 4.7, views: 900 }], 'qc')).status, 403);
  assert.equal((await call(env, 'POST', '/v1/links/stats', { body: { stats: [] } })).status, 401);
  const bad = await postStats(env, [{ youtube_id: YT, views: 1 }, { youtube_id: YT, ctr: 101 }]);
  assert.equal(bad.status, 400);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM yt_stats').get().n, 0, 'all or none');
  for (const s of [{ youtube_id: 'short', views: 1 }, { youtube_id: YT }, { youtube_id: YT, status: 'private' }, { youtube_id: YT, scheduled_at: '2026-11-03 09:00' }, { youtube_id: YT, views: 1.5 }]) {
    assert.equal((await postStats(env, [s])).status, 400, JSON.stringify(s));
  }
  const ok = await postStats(env, [{ youtube_id: YT, impressions: 12000, ctr: 4.7, views: 900 }, { youtube_id: 'zzzzzzzzzzz', views: 3 }]);
  assert.deepEqual([ok.status, ok.body.saved, ok.body.notOnCalendar], [200, 2, ['zzzzzzzzzzz']]);
  await postStats(env, [{ youtube_id: YT, views: 950 }]);
  const html = track(await trackPage(db), {}, 'rosa-cooks');
  assert.match(html, /12,000/);
  assert.match(html, /4\.7%/);
  assert.match(html, /950/, 'a field left out keeps its value');
  assert.doesNotMatch(html, /not connected/, 'the channel is connected, so a video with no figures shows a dash');
});

test('Pacific time is right on both sides of the Nov 1 2026 clock change', () => {
  assert.deepEqual(pacific('2026-10-31T16:00:00Z'), { day: '2026-10-31', time: '09:00' }, 'PDT, UTC-7');
  assert.deepEqual(pacific('2026-11-01T08:30:00Z'), { day: '2026-11-01', time: '01:30' }, 'the last minutes of PDT');
  assert.deepEqual(pacific('2026-11-01T09:30:00Z'), { day: '2026-11-01', time: '01:30' }, 'the first minutes of PST');
  assert.deepEqual(pacific('2026-11-02T17:00:00Z'), { day: '2026-11-02', time: '09:00' }, 'PST, UTC-8');
  assert.deepEqual(pacific('2026-11-03T02:00:00Z'), { day: '2026-11-02', time: '18:00' }, 'the Pacific day, not the UTC one');
});

test("YouTube's date, time and status win over the CSV and the disagreement is flagged, with no CSV column rewritten", async () => {
  const { db, env } = await setup();
  await importCsv(env, 'jon-mac', [
    PLANNED,
    { date: '2026-11-04', time: '10:00', title: 'No ID', status: 'scheduled' },
    { date: '2026-11-05', time: '12:00', title: 'Agrees', status: 'scheduled', youtube_id: 'lmnopqrstuv' },
  ]);
  await postStats(env, [
    { youtube_id: YT, scheduled_at: '2026-11-06T22:30:00Z', status: 'live' },
    { youtube_id: 'lmnopqrstuv', scheduled_at: '2026-11-05T20:00:00Z', status: 'scheduled' },
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
  await postStats(env, [{ youtube_id: YT, scheduled_at: '2026-11-03T17:00:00Z', status: 'scheduled' }]);
  const row = calendarRow(await calendarPage(db), 'jon-mac', 'Tiny houses');
  assert.deepEqual([row.timeLabel, row.differs], ['9:00 AM PT', []]);
});

test("a calendar import after a stats post keeps YouTube's values, the link and its clicks", async () => {
  const { db, env } = await setup();
  await importCsv(env, 'rosa-cooks', [PLANNED, { date: '2026-11-04', title: 'No ID', status: 'planned' }]);
  await postStats(env, [{ youtube_id: YT, scheduled_at: '2026-11-07T17:00:00Z', status: 'scheduled', views: 5 }]);
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
  const found = await call(env, 'PATCH', `/v1/calendar/${add.body.video.id}`, { bot: 'developer', body: { status: 'scheduled', link: `https://youtu.be/${YT}` } });
  assert.equal(found.body.video.youtubeId, YT);
  const cleared = await call(env, 'PATCH', `/v1/calendar/${add.body.video.id}`, { bot: 'developer', body: { youtube_id: '' } });
  assert.equal(cleared.body.video.youtubeId, null);
});

test('the link list needs a sign-in and gives each video its link', async () => {
  const { db, env } = await setup();
  await importCsv(env, 'peter-collins', [{ date: '2026-11-03', title: 'Road test', status: 'planned' }]);
  await importCsv(env, 'jack-mercer', [{ date: '2026-11-03', title: 'Storm kit', status: 'planned' }]);
  assert.equal((await call(env, 'GET', '/v1/links')).status, 401);
  assert.equal((await call(env, 'GET', '/v1/links?channel=nope', { bot: 'qc' })).status, 400);
  assert.equal((await call(env, 'GET', '/v1/links', { jon: true })).body.links.length, 2);
  const { links } = (await call(env, 'GET', '/v1/links?channel=peter-collins', { bot: 'qc' })).body;
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
  const channels = [{ slug: 'all', label: 'All', group: 'All', all: true }];
  const videos = [['A', 5], ['B', null], ['C', 9]].map(([title, views]) => ({ title, views, channel: 'x', channelLabel: 'X', clicks: 0, status: 'live', calendarStatus: 'published', connected: true }));
  const order = () => [...track({ available: true, channels, videos }, {}, '').matchAll(/<td>X<\/td><td>(\w)<\/td>/g)].map((m) => m[1]).join('');
  assert.equal(order(), 'ABC');
  setSort('videos:views');
  assert.equal(order(), 'CAB');
  assert.match(track({ available: true, channels, videos }, {}, ''), /aria-sort="descending"/);
  setSort('videos:views');
  assert.equal(order(), 'ACB');
  setSort('videos:title');
  assert.equal(order(), 'ABC');
});
