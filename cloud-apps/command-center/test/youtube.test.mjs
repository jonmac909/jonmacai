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

test('opening Track syncs views, status and subs once per 20 minutes, and status shows it', async () => {
  const { db, env } = await setup();
  await connect(env, google());
  await call(env, '/v1/calendar/peter-collins', { jon: false, bot: true, method: 'PUT', body: { videos: [{ date: '2026-11-01', title: 'Road test', status: 'published', youtube_id: VID }] } });
  const g = google();
  const prev = globalThis.fetch;
  globalThis.fetch = g.fetchFn;
  try {
    const snap = await (await call(env, '/snapshot?pages=track')).json();
    const v = snap.pages.track.videos.find((x) => x.title === 'Road test');
    assert.deepEqual([v.views, v.subs, v.avd, v.status], [900, 7, 205, 'live'], 'Analytics views, not the public 950');
    const soon = await db.prepare('SELECT status, scheduled_at, scheduled_date FROM yt_stats WHERE youtube_id = ?').bind(SOON).first();
    assert.deepEqual({ ...soon }, { status: 'scheduled', scheduled_at: '2099-01-02T17:00:00.000Z', scheduled_date: '2099-01-02' });
    const dataCalls = g.calls.filter((c) => ['channel', 'playlist', 'videos'].includes(c.name)).length;
    assert.equal(dataCalls, 3, 'about 3 Data API units a channel');
    const before = g.calls.length;
    await call(env, '/snapshot?pages=track');
    assert.equal(g.calls.length, before, 'no second sync within 20 minutes');
    await call(env, '/snapshot?pages=today');
    assert.equal(g.calls.length, before, 'other pages never sync');
  } finally {
    globalThis.fetch = prev;
  }
  assert.equal((await call(env, '/youtube/status', { jon: false })).status, 401);
  const st = await (await call(env, '/youtube/status', { jon: false, bot: true })).json();
  const peter = st.channels.find((c) => c.channel === 'peter-collins');
  assert.equal(st.channels.length, 23);
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
  assert.equal((await db.prepare('SELECT views FROM yt_stats WHERE youtube_id = ?').bind(VID).first()).views, 900);
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
  assert.deepEqual(allRow(track(snap.pages.track, {}, ''), 'peter-collins').slice(1), ['Yes', '1', '0', '1', '400', '2%', '3:20', '1,000', '8']);
  assert.match(track(snap.pages.track, {}, 'peter-collins'), /<td class="num">3:25<\/td>/, 'the video\'s own AVD');
});

test('with no Analytics rows yet, views fall back to the public count and subs to the subscriber count, never blank', async () => {
  const { db, env } = await setup();
  await connect(env, google());
  await call(env, '/v1/calendar/peter-collins', { jon: false, bot: true, method: 'PUT', body: { videos: [{ date: '2026-11-01', title: 'Road test', status: 'published', youtube_id: VID }] } });
  await syncStats(env, google({ analytics: (_i, url) => new Response(JSON.stringify({ rows: url.includes('dimensions=video') ? [] : [['0', '0', '0', '0']] })) }).fetchFn);
  const snap = await (await call(env, '/snapshot?pages=track')).json();
  const row = allRow(track(snap.pages.track, {}, ''), 'peter-collins');
  assert.deepEqual(row.slice(-2), ['1,100', '120']);
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
  assert.deepEqual(allRow(track(snap.pages.track, {}, ''), 'peter-collins').slice(-2), ['1,100', '120']);
});
