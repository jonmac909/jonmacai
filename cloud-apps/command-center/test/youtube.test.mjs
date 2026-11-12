// Track from the YouTube APIs (2026-11-04): connect, sync, reach reports and status, with Google faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { parseReach, statsOf, syncReach, syncStats } from '../src/youtube.js';
import { track } from '../public/js/pages/track.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const BOT = `ccb_${'developer'.padEnd(43, 'x')}`;
const KEY = Buffer.alloc(32, 7).toString('base64');
const PETER = 'UC4ElbvMXjotuSot1rMhRx5A';
const REFRESH = 'refresh-token-never-stored-plain';
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly';
const VID = 'abcdefghijk';
const SOON = 'abcdefghijl';

async function setup(secrets = true) {
  const db = sqliteD1();
  await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(BOT), 'developer', 'x').run();
  const env = { DB: db, SESSION_SECRET: SECRET, ...(secrets ? { YT_CLIENT_ID: 'cid', YT_CLIENT_SECRET: 'csecret', YT_TOKEN_KEY: KEY } : {}) };
  return { db, env };
}

async function call(env, path, { jon = true, bot = false, method = 'GET', body } = {}) {
  const h = new Headers();
  if (jon) h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`);
  if (bot) h.set('Authorization', `Bearer ${BOT}`);
  if (body !== undefined) { h.set('Content-Type', 'application/json'); h.set('X-CC', '1'); }
  const waits = [];
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}

// A fake Google: answers by URL and counts every call. `over` replaces one route's answer.
function google(over = {}) {
  const calls = [];
  const reply = (data, status = 200) => new Response(typeof data === 'string' ? data : JSON.stringify(data), { status });
  const routes = {
    token: (init) => {
      const p = new URLSearchParams(init.body);
      if (p.get('grant_type') === 'authorization_code') return reply({ access_token: 'at', refresh_token: REFRESH, scope: SCOPE });
      return p.get('refresh_token') === REFRESH ? reply({ access_token: 'at2' }) : reply({ error: 'invalid_grant' }, 400);
    },
    me: () => reply({ items: [{ id: PETER, snippet: { title: 'Peter Collins' } }] }),
    channel: () => reply({ items: [{ id: PETER, contentDetails: { relatedPlaylists: { uploads: 'UU1' } }, statistics: { subscriberCount: '120', viewCount: '1100', videoCount: '2' } }] }),
    playlist: () => reply({ items: [{ contentDetails: { videoId: VID } }, { contentDetails: { videoId: SOON } }] }),
    videos: () => reply({ items: [
      { id: VID, status: { privacyStatus: 'public' }, statistics: { viewCount: '950' } },
      { id: SOON, status: { privacyStatus: 'private', publishAt: '2099-01-02T17:00:00Z' }, statistics: { viewCount: '0' } },
    ] }),
    analytics: (_init, url) => reply({ rows: url.includes('dimensions=video') ? [[VID, '900', '205', '9', '2']] : [['1000', '200.4', '10', '2']] }),
    jobs: (init) => (init.method === 'POST' ? reply({ id: 'job1' }) : reply({ jobs: [] })),
    reports: () => reply({ reports: [
      { id: 'r2', createTime: '2026-11-04T10:00:00Z', downloadUrl: 'https://youtubereporting.googleapis.com/v1/media/r2' },
      { id: 'r1', createTime: '2026-11-03T10:00:00Z', downloadUrl: 'https://youtubereporting.googleapis.com/v1/media/r1' },
    ] }),
    media: (_init, url) => reply(url.endsWith('r1')
      ? `date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n20261101,${PETER},${VID},100,0.05\n`
      : `date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n20261102,${PETER},${VID},300,0.01\n`),
    ...over,
  };
  const fetchFn = async (input, init = {}) => {
    const url = String(input);
    const name = url.startsWith('https://oauth2.googleapis.com/token') ? 'token'
      : url.includes('/channels?part=id%2Csnippet') || url.includes('/channels?part=id,snippet') ? 'me'
        : url.includes('/channels?') ? 'channel' : url.includes('/playlistItems?') ? 'playlist' : url.includes('/videos?') ? 'videos'
          : url.includes('youtubeanalytics') ? 'analytics' : url.includes('/reports') ? 'reports' : url.includes('/media/') ? 'media' : url.endsWith('/jobs') ? 'jobs' : null;
    if (!name) throw new Error(`unexpected fetch ${url}`);
    calls.push({ name, url, init });
    return routes[name](init, url);
  };
  return { fetchFn, calls };
}

async function connect(env, g) {
  const r = await call(env, '/youtube/connect?channel=peter-collins');
  const state = new URL(r.headers.get('Location')).searchParams.get('state');
  const prev = globalThis.fetch;
  globalThis.fetch = g.fetchFn;
  try {
    return await call(env, `/youtube/callback?state=${state}&code=c1`, { jon: false });
  } finally {
    globalThis.fetch = prev;
  }
}

test('connect needs Jon, says plainly when not set up, and sends him to read-only consent', async () => {
  const bare = await setup(false);
  assert.equal((await call(bare.env, '/youtube/connect?channel=peter-collins', { jon: false })).status, 401);
  const off = await call(bare.env, '/youtube/connect?channel=peter-collins');
  assert.equal(off.status, 501);
  assert.match(await off.text(), /not set up yet/);

  const { db, env } = await setup();
  assert.equal((await call(env, '/youtube/connect?channel=nope')).status, 400);
  assert.equal((await call(env, '/youtube/connect?channel=complete-histories')).status, 400, 'Spotify only');
  const r = await call(env, '/youtube/connect?channel=peter-collins');
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get('Location'));
  const q = to.searchParams;
  assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(q.get('redirect_uri'), 'https://jonmac.ai/dashboard/api/youtube/callback');
  assert.equal(q.get('scope'), SCOPE);
  assert.deepEqual([q.get('access_type'), q.get('include_granted_scopes'), q.get('client_id')], ['offline', 'false', 'cid']);
  assert.match(q.get('prompt'), /consent/);
  assert.match(q.get('prompt'), /select_account/);
  assert.equal(q.get('login_hint'), 'partners@thejonmac.com');
  const hint = async (slug) => new URL((await call(env, `/youtube/connect?channel=${slug}`)).headers.get('Location')).searchParams.get('login_hint');
  assert.deepEqual([await hint('jon-mac'), await hint('jonmacai')], ['jon@jonmac.co', 'jon@thejonmac.com'], 'each channel hints its owner account');
  const row = await db.prepare('SELECT channel, expires_at FROM yt_oauth_states WHERE state = ?').bind(q.get('state')).first();
  assert.equal(row.channel, 'peter-collins');
});

test('the callback stores the channel with its token sealed, makes the reach job, and its state works once', async () => {
  const { db, env } = await setup();
  const g = google();
  const r = await connect(env, g);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Connected Peter Collins\./);
  assert.doesNotMatch(html, /refresh-token|"at"/);
  const row = await db.prepare('SELECT * FROM yt_api').first();
  assert.deepEqual([row.channel, row.channel_id, row.reach_job], ['peter-collins', PETER, 'job1']);
  assert.doesNotMatch(row.token, /refresh-token/, 'never plain');
  assert.equal(g.calls.filter((c) => c.name === 'jobs').map((c) => c.init.method || 'GET').join(), 'GET,POST');
  const create = JSON.parse(g.calls.find((c) => c.init.method === 'POST' && c.name === 'jobs').init.body);
  assert.equal(create.reportTypeId, 'channel_reach_basic_a1');

  const used = new URL(g.calls[0].url); // token exchange went to Google, not the state
  assert.equal(used.hostname, 'oauth2.googleapis.com');
  const again = await call(env, '/youtube/callback?state=whatever&code=c1', { jon: false });
  assert.equal(again.status, 400);
});

test('the callback refuses the wrong channel and missing permissions', async () => {
  const { db, env } = await setup();
  const wrong = await connect(env, google({ me: () => new Response(JSON.stringify({ items: [{ id: 'UC21BTzNwbWbQF4d22iq950w', snippet: { title: 'Jon Mac' } }] })) }));
  assert.equal(wrong.status, 400);
  assert.match(await wrong.text(), /That is Jon Mac, not Peter Collins/);
  const narrow = await connect(env, google({ token: () => new Response(JSON.stringify({ access_token: 'at', refresh_token: REFRESH, scope: SCOPE.split(' ')[0] })) }));
  assert.equal(narrow.status, 400);
  assert.match(await narrow.text(), /Both read-only permissions/);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM yt_api').first().then((x) => x.n), 0);
});

test('opening or refreshing Track syncs views, status and subs, with a 15 s floor, and status shows it', async () => {
  const { db, env } = await setup();
  await connect(env, google());
  await call(env, '/v1/calendar/peter-collins', { jon: false, bot: true, method: 'PUT', body: { videos: [{ date: '2026-11-01', title: 'Road test', status: 'published', youtube_id: VID }] } });
  const g = google();
  const prev = globalThis.fetch;
  globalThis.fetch = g.fetchFn;
  try {
    const snap = await (await call(env, '/snapshot?pages=track')).json();
    const v = snap.pages.track.videos.find((x) => x.title === 'Road test');
    assert.deepEqual([v.views, v.subs, v.avd, v.status], [950, 7, 205, 'live'], 'the larger of Analytics 900 and public 950 (Jon, 2026-11-04)');
    const soon = await db.prepare('SELECT status, scheduled_at, scheduled_date FROM yt_stats WHERE youtube_id = ?').bind(SOON).first();
    assert.deepEqual({ ...soon }, { status: 'scheduled', scheduled_at: '2099-01-02T17:00:00.000Z', scheduled_date: '2099-01-02' });
    const dataCalls = g.calls.filter((c) => ['channel', 'playlist', 'videos'].includes(c.name)).length;
    assert.equal(dataCalls, 3, 'about 3 Data API units a channel');
    const before = g.calls.length;
    await call(env, '/snapshot?pages=track');
    assert.equal(g.calls.length, before, 'a double-open within 15 s does not sync twice');
    await call(env, '/snapshot?pages=today');
    assert.equal(g.calls.length, before, 'other pages never sync');
    await db.prepare("UPDATE yt_api SET sync_tried_at = ?").bind(new Date(Date.now() - 16000).toISOString()).run();
    await call(env, '/snapshot?pages=track');
    assert.ok(g.calls.length > before, 'a refresh after 15 s syncs again, not every 20 minutes');
  } finally {
    globalThis.fetch = prev;
  }
  assert.equal((await call(env, '/youtube/status', { jon: false })).status, 401);
  const st = await (await call(env, '/youtube/status', { jon: false, bot: true })).json();
  const peter = st.channels.find((c) => c.channel === 'peter-collins');
  assert.equal(st.channels.length, 32);
  assert.deepEqual([peter.connected, peter.subscribers, peter.lastError, peter.reachJob], [true, 120, null, true]);
  assert.deepEqual(peter.studio, { views: 1000, subs: 8, avdSeconds: 200.4 });
  assert.ok(peter.lastSync);
  assert.equal(st.channels.find((c) => c.channel === 'eleanor-whitfield').connected, false);
  assert.doesNotMatch(JSON.stringify(st), /token|refresh/i);
});

test('a removed Google access is recorded and the stored numbers stay', async () => {
  const { db, env } = await setup();
  await connect(env, google());
  await db.prepare("INSERT INTO yt_stats (youtube_id, views, updated_at) VALUES (?, 5, 'x')").bind(VID).run();
  const prev = globalThis.fetch;
  globalThis.fetch = google({ token: () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }) }).fetchFn;
  try {
    assert.equal((await call(env, '/snapshot?pages=track')).status, 200);
  } finally {
    globalThis.fetch = prev;
  }
  assert.match((await db.prepare('SELECT sync_error FROM yt_api').first()).sync_error, /connect this channel again/);
  assert.equal((await db.prepare('SELECT views FROM yt_stats').first()).views, 5);
});

test('reach reports become impressions and impression-weighted CTR, with their as-of date on the page', async () => {
  const { db, env } = await setup();
  await connect(env, google());
  await call(env, '/v1/calendar/peter-collins', { jon: false, bot: true, method: 'PUT', body: { videos: [{ date: '2026-11-01', title: 'Road test', status: 'published', youtube_id: VID }] } });
  const g = google();
  await syncReach(env, g.fetchFn, Date.parse('2026-11-04T20:00:00Z'));
  const s = await db.prepare('SELECT impressions, ctr, reach_as_of FROM yt_stats WHERE youtube_id = ?').bind(VID).first();
  assert.deepEqual({ ...s }, { impressions: 400, ctr: 2, reach_as_of: '2026-11-02' }, '(100 x 5% + 300 x 1%) / 400 = 2%');
  const row = await db.prepare('SELECT reach_after, reach_as_of, reach_error FROM yt_api').first();
  assert.deepEqual({ ...row }, { reach_after: '2026-11-04T10:00:00Z', reach_as_of: '2026-11-02', reach_error: null });

  const n = g.calls.length;
  await syncReach(env, g.fetchFn, Date.parse('2026-11-04T21:00:00Z'));
  assert.equal(g.calls.length, n, 'at most every 6 hours a channel');
  await syncReach(env, g.fetchFn, Date.parse('2026-11-05T03:00:00Z'));
  assert.match(g.calls.findLast((c) => c.name === 'reports').url, /createdAfter=2026-11-04T10%3A00%3A00Z/, 'only reports not stored yet');

  const snap = await (await call(env, '/snapshot?pages=track')).json();
  const html = track(snap.pages.track, {}, 'peter-collins');
  assert.match(html, /Impressions and CTR as of Nov 2\./);
  assert.match(html, /<td class="num">2%<\/td>/);
});

test('a 429 on the second reach report keeps the first, ends the run, and both channels are due again in 15 minutes', async () => {
  const { db, env } = await setup();
  await connect(env, google());
  await db.prepare("INSERT INTO yt_api (channel, channel_id, token, reach_job, connected_at) VALUES ('second-channel', 'UCsecond', 'never-opened', 'job2', 'x')").run();
  const t = Date.parse('2026-11-04T20:00:00Z');
  const limited = google({ media: (_init, url) => (url.endsWith('r1')
    ? new Response(`date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n20261101,${PETER},${VID},100,0.05\n`)
    : new Response('slow down', { status: 429 })) });
  await syncReach(env, limited.fetchFn, t);
  assert.deepEqual((await db.prepare('SELECT youtube_id, day, impressions FROM yt_reach').all()).results.map((r) => ({ ...r })), [{ youtube_id: VID, day: '2026-11-01', impressions: 100 }], 'the first report is saved');
  const rows = Object.fromEntries((await db.prepare('SELECT channel, reach_after, reach_error, reach_tried_at FROM yt_api').all()).results.map((r) => [r.channel, { ...r }]));
  const retryAt = new Date(t - 6 * 3600 * 1000 + 15 * 60 * 1000).toISOString().replace('.000Z', 'Z');
  assert.equal(rows['peter-collins'].reach_after, '2026-11-03T10:00:00Z', 'moves past the report that was read');
  assert.equal(rows['peter-collins'].reach_error, 'Reach report download answered 429');
  assert.equal(rows['peter-collins'].reach_tried_at.slice(0, 19), retryAt.slice(0, 19), 'due again in 15 minutes, not 6 hours');
  assert.deepEqual([rows['second-channel'].reach_error, rows['second-channel'].reach_tried_at.slice(0, 19)], [null, retryAt.slice(0, 19)], 'skipped after the 429, due in 15 minutes');
  assert.equal(limited.calls.filter((c) => c.name === 'reports').length, 1, 'the second channel was not called');

  const n = limited.calls.length;
  await syncReach(env, limited.fetchFn, t + 14 * 60 * 1000);
  assert.equal(limited.calls.length, n, 'not before 15 minutes');
  const ok = google({ reports: () => new Response(JSON.stringify({ reports: [{ id: 'r2', createTime: '2026-11-04T10:00:00Z', downloadUrl: 'https://youtubereporting.googleapis.com/v1/media/r2' }] })) });
  await syncReach(env, ok.fetchFn, t + 16 * 60 * 1000);
  assert.match(ok.calls.find((c) => c.name === 'reports').url, /createdAfter=2026-11-03T10%3A00%3A00Z/, 'asks only for the rest');
  assert.deepEqual(ok.calls.filter((c) => c.name === 'media').map((c) => c.url.slice(-2)), ['r2']);
  const peter = await db.prepare("SELECT reach_after, reach_error FROM yt_api WHERE channel = 'peter-collins'").first();
  assert.deepEqual({ ...peter }, { reach_after: '2026-11-04T10:00:00Z', reach_error: null });
});

test('statsOf and parseReach read YouTube the way studio_read posted', () => {
  const now = Date.parse('2026-11-04T00:00:00Z');
  assert.deepEqual(statsOf({ status: { privacyStatus: 'unlisted' }, statistics: { viewCount: '3' } }, now), { status: 'unlisted', scheduled_at: null, scheduled_date: null, views: 3 });
  assert.deepEqual(statsOf({ status: { privacyStatus: 'private', publishAt: '2026-11-01T00:00:00Z' } }, now), { status: 'private', scheduled_at: null, scheduled_date: null }, 'a past publishAt is just private');
  // 2026-11-05T05:00Z is Nov 4 in Kelowna
  assert.equal(statsOf({ status: { privacyStatus: 'private', publishAt: '2026-11-05T05:00:00Z' } }, now).scheduled_date, '2026-11-04');
  const head = 'date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr';
  assert.deepEqual(parseReach(`${head}\n20261101,UCx,${VID},200,0.045\n`), [{ youtube_id: VID, day: '2026-11-01', impressions: 200, ctr: 4.5 }], 'fraction to percent');
  assert.deepEqual(parseReach(`${head}\n20261101,UCx,${VID},200,0.8\n`)[0].ctr, 80, 'one report under 1 is never guessed as percent');
  assert.throws(() => parseReach(`${head}\n20261101,UCx,${VID},200,4.5\n`), /not a fraction/);
  assert.deepEqual(parseReach(`${head}\n20261101,UCx,${VID},0,0\n`), [{ youtube_id: VID, day: '2026-11-01', impressions: 0, ctr: null }]);
  assert.throws(() => parseReach('a,b\n1,2'), /unexpected columns/);
});

test('a lifetime count from Studio larger than the reports sum stays', async () => {
  const { db, env } = await setup();
  await connect(env, google());
  await db.prepare("INSERT INTO yt_stats (youtube_id, impressions, ctr, updated_at) VALUES (?, 5000, 3.1, 'x')").bind(VID).run();
  await syncReach(env, google().fetchFn, Date.parse('2026-11-04T20:00:00Z'));
  const s = await db.prepare('SELECT impressions, ctr, reach_as_of FROM yt_stats WHERE youtube_id = ?').bind(VID).first();
  assert.deepEqual({ ...s }, { impressions: 5000, ctr: 3.1, reach_as_of: '2026-11-02' });
});

test('the cron syncs views, status and subs hourly with nobody opening Track', async () => {
  const { db, env } = await setup();
  await connect(env, google());
  const g = google();
  const t = Date.parse('2026-11-04T14:00:00Z');
  await syncStats(env, g.fetchFn, t);
  assert.equal((await db.prepare('SELECT views FROM yt_stats WHERE youtube_id = ?').bind(VID).first()).views, 950, 'the larger of Analytics 900 and public 950');
  const n = g.calls.length;
  await syncStats(env, g.fetchFn, t + 30 * 60 * 1000);
  assert.equal(g.calls.length, n, 'not again within the hour');
  await syncStats(env, g.fetchFn, t + 61 * 60 * 1000);
  assert.ok(g.calls.length > n);
});

test('a failed connect shows Google\'s reason, never the token', async () => {
  const { db, env } = await setup();
  const off = await connect(env, google({ me: () => new Response(JSON.stringify({ error: { message: 'YouTube Data API v3 has not been used in project 1 before or it is disabled.' } }), { status: 403 }) }));
  assert.equal(off.status, 502);
  const html = await off.text();
  assert.match(html, /YouTube did not answer \(www channels answered 403: YouTube Data API v3 has not been used/);
  assert.doesNotMatch(html, /refresh-token|"at"/);
  const bad = await connect(env, google({ token: () => new Response(JSON.stringify({ error: 'redirect_uri_mismatch' }), { status: 400 }) }));
  assert.match(await bad.text(), /Google did not give lasting access \(400 redirect_uri_mismatch\)/);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM yt_api').first().then((x) => x.n), 0);
});

const allRow = (html, slug) => html.match(new RegExp(`<tr data-page="track/${slug}">(.*?)</tr>`, 's'))[1].split(/<[^>]+>/).map((s) => s.trim()).filter(Boolean);

test('All shows Studio\'s lifetime views, AVD and subs, with impressions and CTR from the videos', async () => {
  const { db, env } = await setup();
  await connect(env, google());
  await call(env, '/v1/calendar/peter-collins', { jon: false, bot: true, method: 'PUT', body: { videos: [{ date: '2026-11-01', title: 'Road test', status: 'published', youtube_id: VID }] } });
  await syncReach(env, google().fetchFn, Date.parse('2026-11-04T20:00:00Z'));
  await syncStats(env, google().fetchFn); // now, so opening Track doesn't sync again
  const snap = await (await call(env, '/snapshot?pages=track')).json();
  // Live, Videos, Scheduled, Posted, Impressions, CTR, AVD, Views, Subs
  assert.deepEqual(allRow(track(snap.pages.track, {}, ''), 'peter-collins').slice(1), ['Yes', '1', '0', '1', '400', '2%', '3:20', '1,100', '8', '—', '—', '—', '—']);
  assert.match(track(snap.pages.track, {}, 'peter-collins'), /<td class="num">3:25<\/td>/, 'the video\'s own AVD');
});

test('with no Analytics rows yet, views fall back to the public count and subs to the subscriber count, never blank', async () => {
  const { db, env } = await setup();
  await connect(env, google());
  await call(env, '/v1/calendar/peter-collins', { jon: false, bot: true, method: 'PUT', body: { videos: [{ date: '2026-11-01', title: 'Road test', status: 'published', youtube_id: VID }] } });
  await syncStats(env, google({ analytics: (_i, url) => new Response(JSON.stringify({ rows: url.includes('dimensions=video') ? [] : [['0', '0', '0', '0']] })) }).fetchFn);
  const snap = await (await call(env, '/snapshot?pages=track')).json();
  const row = allRow(track(snap.pages.track, {}, ''), 'peter-collins');
  assert.deepEqual(row.slice(-6, -4), ['1,100', '120']); // the channel's public count
  assert.equal((await db.prepare('SELECT sync_error FROM yt_api').first()).sync_error, null);
});

test('Analytics far behind the public count (a new channel) keeps the public views and shows no AVD', async () => {
  const { env } = await setup();
  await connect(env, google());
  await call(env, '/v1/calendar/peter-collins', { jon: false, bot: true, method: 'PUT', body: { videos: [{ date: '2026-11-01', title: 'Road test', status: 'published', youtube_id: VID }] } });
  await syncStats(env, google({ analytics: (_i, url) => new Response(JSON.stringify({ rows: url.includes('dimensions=video') ? [[VID, '1', '55', '0', '0']] : [['1', '55', '0', '0']] })) }).fetchFn);
  const snap = await (await call(env, '/snapshot?pages=track')).json();
  const v = snap.pages.track.videos.find((x) => x.title === 'Road test');
  assert.deepEqual([v.views, v.avd], [950, null]);
  await env.DB.prepare('UPDATE yt_api SET sync_tried_at = NULL, synced_at = NULL').run();
  // YouTube's channel count still at 0 (Giovanni, 2026-11-04): the videos' 950 public views count instead
  const zero = google({ channel: () => new Response(JSON.stringify({ items: [{ id: PETER, contentDetails: { relatedPlaylists: { uploads: 'UU1' } }, statistics: { subscriberCount: '120', viewCount: '0', videoCount: '2' } }] })),
    analytics: (_i, url) => new Response(JSON.stringify({ rows: url.includes('dimensions=video') ? [[VID, '1', '55', '0', '0']] : [['1', '55', '0', '0']] })) });
  await syncStats(env, zero.fetchFn);
  const z = await env.DB.prepare('SELECT views, studio_views FROM yt_api').first();
  assert.deepEqual({ ...z }, { views: 950, studio_views: null });
  assert.deepEqual(allRow(track(snap.pages.track, {}, ''), 'peter-collins').slice(-6, -4), ['1,100', '120']);
});

test('while Analytics lags, the Studio reader\'s views, AVD and subs stay (Giovanni: 71 views, 3:25)', async () => {
  const { env } = await setup();
  await connect(env, google());
  await call(env, '/v1/calendar/peter-collins', { jon: false, bot: true, method: 'PUT', body: { videos: [{ date: '2026-11-01', title: 'Road test', status: 'published', youtube_id: VID }] } });
  const posted = await call(env, '/v1/links/stats', { jon: false, bot: true, method: 'POST', body: { stats: [{ youtube_id: VID, views: 71, avd: 205, subs: 1 }] } });
  assert.equal(posted.status, 200);
  await syncStats(env, google({ analytics: (_i, url) => new Response(JSON.stringify({ rows: url.includes('dimensions=video') ? [[VID, '1', '55', '0', '0']] : [['1', '55', '0', '0']] })) }).fetchFn);
  const snap = await (await call(env, '/snapshot?pages=track')).json();
  const v = snap.pages.track.videos.find((x) => x.title === 'Road test');
  assert.deepEqual([v.views, v.avd, v.subs], [950, 205, 1], 'views: the larger of Studio 71 and public 950');
  assert.deepEqual(allRow(track(snap.pages.track, {}, ''), 'peter-collins').slice(-7, -4), ['3:25', '1,100', '120']);
});

test('a channel\'s Views are the larger of Analytics and public, and a failed sync shows on its row', async () => {
  const { env } = await setup();
  await connect(env, google());
  const views = async () => {
    const snap = await (await call(env, '/snapshot?pages=track')).json();
    return track(snap.pages.track, {}, '');
  };
  const set = (studio, pub, err) => env.DB.prepare('UPDATE yt_api SET studio_views = ?, views = ?, sync_error = ?, sync_tried_at = ?').bind(studio, pub, err, new Date().toISOString()).run();
  await set(40, 89, null);
  assert.equal(allRow(await views(), 'peter-collins').at(-5), '89', 'Analytics lagging at 40: public 89 wins (Giovanni, 2026-11-04)');
  await set(100, 89, null);
  assert.equal(allRow(await views(), 'peter-collins').at(-5), '100', 'Analytics ahead: Analytics wins');
  assert.doesNotMatch(await views(), /YouTube API error/);
  await set(100, 89, 'quotaExceeded');
  assert.match(await views(), /YouTube API error[\s\S]*quotaExceeded/);
});

test('a channel with no public views yet still shows its videos\' Studio views, not 0', async () => {
  const { env } = await setup();
  await connect(env, google());
  await call(env, '/v1/calendar/peter-collins', { jon: false, bot: true, method: 'PUT', body: { videos: [{ date: '2026-11-01', title: 'Road test', status: 'published', youtube_id: VID }] } });
  await call(env, '/v1/links/stats', { jon: false, bot: true, method: 'POST', body: { stats: [{ youtube_id: VID, views: 71 }] } });
  await env.DB.prepare('UPDATE yt_api SET studio_views = NULL, views = 0, subscribers = 5, sync_tried_at = ?').bind(new Date().toISOString()).run();
  const snap = await (await call(env, '/snapshot?pages=track')).json();
  assert.equal(allRow(track(snap.pages.track, {}, ''), 'peter-collins').at(-6), '71', 'Giovanni: public 0, Studio 71');
});

test('Track opens stop syncing after 100 a day, and the hourly cron still runs', async () => {
  const { env } = await setup();
  await connect(env, google());
  const day = new Date(Date.now() - 8 * 3600 * 1000).toISOString().slice(0, 10); // Google's quota day: UTC-8
  const g = google();
  const prev = globalThis.fetch;
  globalThis.fetch = g.fetchFn;
  try {
    await env.DB.prepare('INSERT INTO yt_sync_budget (day, syncs) VALUES (?, 100)').bind(day).run();
    await call(env, '/snapshot?pages=track');
    assert.equal(g.calls.length, 0, 'over the daily budget: Track shows what is stored');
    await syncStats(env, g.fetchFn);
    assert.ok(g.calls.length > 0, 'the cron is not capped');
    await env.DB.prepare('UPDATE yt_sync_budget SET syncs = 99').run();
    await env.DB.prepare('UPDATE yt_api SET sync_tried_at = NULL').run();
    const before = g.calls.length;
    await call(env, '/snapshot?pages=track');
    assert.ok(g.calls.length > before, 'under the budget it syncs');
    assert.equal((await env.DB.prepare('SELECT syncs FROM yt_sync_budget').first()).syncs, 100);
  } finally {
    globalThis.fetch = prev;
  }
});

test('Track shows channels with no Google login as Not connected with a Connect link, registered ones too, and connected ones without', async () => {
  const { db, env } = await setup();
  await db.prepare("INSERT INTO yt_channels (slug, label, grp, updated_by, updated_at) VALUES ('edna-haynes', 'Edna Haynes', 'Home Guide Press', 'x', 'x')").run();
  await db.prepare("INSERT INTO yt_api (channel, channel_id, name, token, connected_at) VALUES ('peter-collins', ?, 'Peter', 'x', 'x')").bind(PETER).run();
  await db.prepare("INSERT INTO yt_api (channel, channel_id, name, token, connected_at, sync_error) VALUES ('jack-mercer', 'UCP4LZ2M-dz3tLaSDohBp5yw', 'Jack', 'x', 'x', 'Google access was removed: connect this channel again')").run();
  const { trackData, buildTrackPage } = await import('../src/track.js');
  const out = { pages: { track: {} } };
  buildTrackPage(out, await trackData(db, 'https://jonmac.ai', Date.now()));
  const by = Object.fromEntries(out.pages.track.channels.map((c) => [c.slug, c.connect]));
  assert.equal(by['peter-collins'].state, 'connected');
  assert.equal(by['jack-mercer'].state, 'reconnect');
  assert.equal(by['claudine-marchand'].state, 'none');
  assert.equal(by['edna-haynes'].state, 'none', 'registered channel with no id yet shows too');
  assert.equal(by['edna-haynes'].url, '/dashboard/api/youtube/connect?channel=edna-haynes');
  assert.ok(!out.pages.track.channels.some((c) => c.slug === 'complete-histories'));
  const html = track(out.pages.track, null, 'all');
  assert.match(html, /data-connect="edna-haynes"[^>]*href="\/dashboard\/api\/youtube\/connect\?channel=edna-haynes"/);
  assert.doesNotMatch(html, /data-connect="peter-collins"/);
  assert.match(html, /Login out/);
  // the connect link itself accepts a registered channel and goes to Google's consent (Jon approves there)
  const r = await call(env, '/youtube/connect?channel=edna-haynes');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('Location'), /^https:\/\/accounts\.google\.com\//);
});

test('calendar connect reuses the YouTube Google client and sends Jon to Google', async () => {
  const bare = await setup(false);
  assert.equal((await call(bare.env, '/google/start')).status, 501);
  const { env } = await setup();
  const r = await call(env, '/google/start');
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(to.searchParams.get('client_id'), 'cid');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://jonmac.ai/dashboard/api/google/callback');
});
