import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex, CHANNEL_WRITERS } from '../src/bots.js';
import { buildChannelPages, CHANNELS, dayLabel, ageLabel } from '../src/channels.js';
import { calendar, content, linkLabel } from '../public/js/pages/channels.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const BOTS = [...CHANNEL_WRITERS, 'sponsors', 'qc', 'video-editor'];
const TOK = Object.fromEntries(BOTS.map((b) => [b, `ccb_${b.padEnd(43, 'x')}`]));
const NOW = Date.parse('2026-10-30T19:00:00Z'); // Fri Oct 30, 12:00 PT

async function setup() {
  const db = sqliteD1();
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
async function call(env, method, path, { bot, body, jon, cc = true } = {}) {
  const h = new Headers();
  if (bot) h.set('Authorization', `Bearer ${TOK[bot]}`);
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); if (cc) h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}
const VIDEO = { channel: 'jon-mac', title: 'Topview video 1', date: '2026-11-03', status: 'scheduled', link: 'https://youtu.be/abc' };
const OUTLIER = { channel: 'theo-creates', title: 'AI UGC in 10 min', link: 'https://www.youtube.com/watch?v=x', views: 42000, avg: 10000, published: '2026-10-27' };

test('the channel list is the 23 channels in channels.md, Jon\'s own first', () => {
  assert.equal(CHANNELS.length, 24);
  assert.deepEqual(CHANNELS.slice(0, 3).map((c) => c.label), ['Jon Mac', '@JonMacAI', 'Complete Histories']);
  assert.deepEqual(['Jon\'s own', 'Viral View', 'Home Guide Press'].map((g) => CHANNELS.filter((c) => c.group === g).length), [3, 7, 14]);
  assert.equal(new Set(CHANNELS.map((c) => c.slug)).size, 24);
});

test('only the channel bots, Developer and Ana write; Jon only toggles selected, with X-CC', async () => {
  const { env } = await setup();
  for (const bot of ['sponsors', 'qc', 'video-editor']) {
    assert.equal((await call(env, 'POST', '/v1/calendar', { bot, body: VIDEO })).status, 403, bot);
    assert.equal((await call(env, 'POST', '/v1/outliers', { bot, body: OUTLIER })).status, 403, bot);
    assert.equal((await call(env, 'PUT', '/v1/channels/jon-mac', { bot, body: { schedule: 'x' } })).status, 403, bot);
  }
  for (const bot of CHANNEL_WRITERS) assert.equal((await call(env, 'POST', '/v1/calendar', { bot, body: VIDEO })).status, 201, bot);
  assert.equal((await call(env, 'POST', '/v1/calendar', { jon: true, body: VIDEO })).status, 403, 'Jon does not add videos');
  assert.equal((await call(env, 'PUT', '/v1/channels/jon-mac', { jon: true, body: { schedule: 'x' } })).status, 403);
  assert.equal((await call(env, 'POST', '/v1/outliers', { body: OUTLIER })).status, 401);

  const o = (await call(env, 'POST', '/v1/outliers', { bot: 'viral-view', body: OUTLIER })).body.outlier;
  assert.equal((await call(env, 'POST', `/v1/outliers/${o.id}/select`, { bot: 'sponsors', body: { selected: true } })).status, 403);
  assert.equal((await call(env, 'POST', `/v1/outliers/${o.id}/select`, { jon: true, cc: false, body: { selected: true } })).status, 403, 'X-CC required');
  const jon = await call(env, 'POST', `/v1/outliers/${o.id}/select`, { jon: true, body: { selected: true } });
  assert.deepEqual([jon.status, jon.body.outlier.selected, jon.body.outlier.selectedBy], [200, true, 'jon']);
  const again = await call(env, 'POST', `/v1/outliers/${o.id}/select`, { bot: 'viral-view', body: { selected: true } });
  assert.deepEqual([again.body.outlier.selected, again.body.outlier.selectedBy], [true, 'jon'], 'the same value again changes nothing');
  const off = await call(env, 'POST', `/v1/outliers/${o.id}/select`, { bot: 'viral-view', body: { selected: false } });
  assert.deepEqual([off.body.outlier.selected, off.body.outlier.selectedBy], [false, 'viral-view']);
  assert.equal((await call(env, 'POST', `/v1/outliers/${o.id}/select`, { jon: true, body: { selected: 'yes' } })).status, 400);
  assert.equal((await call(env, 'POST', '/v1/outliers/o_0000000000000000/select', { jon: true, body: { selected: true } })).status, 404);
  assert.equal((await call(env, 'GET', '/v1/outliers?selected=1', { bot: 'qc' })).body.outliers.length, 0, 'any bot reads');
});

test('validation: channel, title, date, status, numbers', async () => {
  const { env } = await setup();
  const bad = async (path, body) => (await call(env, 'POST', path, { bot: 'developer', body })).status;
  for (const change of [{ channel: 'nope' }, { channel: undefined }, { title: ' ' }, { title: 'x'.repeat(301) }, { date: '2026-11-31x' },
    { date: 'Tuesday' }, { date: undefined }, { status: 'live' }]) {
    assert.equal(await bad('/v1/calendar', { ...VIDEO, ...change }), 400, JSON.stringify(change));
  }
  for (const change of [{ views: -1 }, { views: 1.5 }, { views: undefined }, { avg: 0 }, { avg: 'lots' }, { published: '27/10/2026' }, { link: undefined }]) {
    assert.equal(await bad('/v1/outliers', { ...OUTLIER, ...change }), 400, JSON.stringify(change));
  }
  const made = await call(env, 'POST', '/v1/calendar', { bot: 'developer', body: { ...VIDEO, status: undefined, link: '' } });
  assert.deepEqual([made.status, made.body.video.status, made.body.video.link], [201, 'planned', null], 'status defaults to planned');
  const id = made.body.video.id;
  const upd = await call(env, 'PATCH', `/v1/calendar/${id}`, { bot: 'jon-mac-youtube', body: { status: 'published', link: 'https://youtu.be/new' } });
  assert.deepEqual([upd.status, upd.body.video.status, upd.body.video.link, upd.body.video.updatedBy], [200, 'published', 'https://youtu.be/new', 'jon-mac-youtube']);
  assert.equal((await call(env, 'PATCH', `/v1/calendar/${id}`, { bot: 'developer', body: {} })).status, 400);
  assert.equal((await call(env, 'PATCH', `/v1/calendar/${id}`, { bot: 'developer', body: { status: 'gone' } })).status, 400);
  assert.equal((await call(env, 'PATCH', `/v1/calendar/${id}`, { bot: 'sponsors', body: { status: 'planned' } })).status, 403);
  assert.equal((await call(env, 'PATCH', '/v1/calendar/v_0000000000000000', { bot: 'developer', body: { status: 'planned' } })).status, 404);
  assert.equal((await call(env, 'PUT', '/v1/channels/nope', { bot: 'developer', body: { schedule: 'x' } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/channels/jon-mac', { bot: 'developer', body: {} })).status, 400);
  assert.equal((await call(env, 'GET', '/v1/calendar?from=soon', { bot: 'developer' })).status, 400);
});

test('keys make adds safe to retry; schedules and selects are safe to repeat', async () => {
  const { env } = await setup();
  const first = await call(env, 'POST', '/v1/calendar', { bot: 'viral-view', body: { ...VIDEO, channel: 'mina-creates', key: 'mina-1' } });
  const again = await call(env, 'POST', '/v1/calendar', { bot: 'viral-view', body: { ...VIDEO, channel: 'mina-creates', title: 'retry', key: 'mina-1' } });
  assert.deepEqual([first.status, again.status, again.body.duplicate, again.body.video.id, again.body.video.title], [201, 200, true, first.body.video.id, VIDEO.title]);
  assert.equal((await call(env, 'POST', '/v1/calendar', { bot: 'ana', body: { ...VIDEO, key: 'mina-1' } })).status, 201, 'keys are per bot');
  const o1 = await call(env, 'POST', '/v1/outliers', { bot: 'home-guide-press', body: { ...OUTLIER, key: 'yt:x' } });
  const o2 = await call(env, 'POST', '/v1/outliers', { bot: 'home-guide-press', body: { ...OUTLIER, views: 1, key: 'yt:x' } });
  assert.deepEqual([o1.status, o2.status, o2.body.duplicate, o2.body.outlier.id, o2.body.outlier.views], [201, 200, true, o1.body.outlier.id, 42000]);
  assert.equal((await call(env, 'GET', '/v1/outliers', { bot: 'qc' })).body.outliers.length, 1);

  for (let i = 0; i < 2; i++) {
    const r = await call(env, 'PUT', '/v1/channels/Jon-Mac', { bot: 'jon-mac-youtube', body: { schedule: ' Tue and Fri 9 am PT ' } });
    assert.deepEqual([r.status, r.body.channel.slug, r.body.channel.schedule], [200, 'jon-mac', 'Tue and Fri 9 am PT']);
  }
  const list = (await call(env, 'GET', '/v1/channels', { jon: true })).body.channels;
  assert.deepEqual([list.length, list[0].schedule, list[1].schedule], [24, 'Tue and Fri 9 am PT', null]);
  await call(env, 'PUT', '/v1/channels/jon-mac', { bot: 'ana', body: { schedule: '' } });
  assert.equal((await call(env, 'GET', '/v1/channels', { bot: 'qc' })).body.channels[0].schedule, null, '"" clears it');
});

test('links and thumbnails must be http(s); the pages escape everything', async () => {
  const { env } = await setup();
  for (const url of ['javascript:alert(1)', 'data:image/png;base64,AA', '//evil.example/x', 'ftp://x/y', 'D:\\thumbs\\a.jpg', 'https://a b', 'https://\nx', 'https://']) {
    assert.equal((await call(env, 'POST', '/v1/outliers', { bot: 'developer', body: { ...OUTLIER, link: url } })).status, 400, `link ${url}`);
    assert.equal((await call(env, 'POST', '/v1/outliers', { bot: 'developer', body: { ...OUTLIER, thumb: url } })).status, 400, `thumb ${url}`);
    assert.equal((await call(env, 'POST', '/v1/calendar', { bot: 'developer', body: { ...VIDEO, link: url } })).status, 400, `calendar ${url}`);
  }
  const evil = '<img src=x onerror=alert(1)>"\'&';
  await call(env, 'POST', '/v1/outliers', { bot: 'developer', body: { ...OUTLIER, title: evil, link: 'https://x.y/?a="><script>', thumb: 'https://i.ytimg.com/vi/x/hq.jpg?a="b' } });
  await call(env, 'POST', '/v1/calendar', { bot: 'developer', body: { ...VIDEO, title: evil } });
  await call(env, 'PUT', '/v1/channels/jon-mac', { bot: 'developer', body: { schedule: evil } });
  const snap = (await call(env, 'GET', '/snapshot?pages=calendar,content', { jon: true })).body;
  const cal = calendar(snap.pages.calendar, snap, 'jon-mac');
  const con = content(snap.pages.content, snap, 'theo-creates');
  for (const html of [cal, con]) {
    assert.doesNotMatch(html, /<img src=x|<script>|onerror=alert\(1\)>/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/);
  }
  assert.match(con, /href="https:\/\/x\.y\/\?a=&quot;&gt;&lt;script&gt;"/);
  assert.match(con, /<img class="octhumb" src="https:\/\/i\.ytimg\.com\/vi\/x\/hq\.jpg\?a=&quot;b"/);
  // Rows from before validation (or a bad hand edit) never become links or images.
  const page = { available: true, channels: [{ slug: 'jon-mac', label: 'Jon Mac', group: 'g', count: 1, outliers: [{ id: 'o_1', title: 't', link: 'javascript:alert(1)', thumb: 'data:x', multipleLabel: '2× avg', viewsLabel: 'v', ageLabel: 'a', selected: false, selectUrl: '/dashboard/api/v1/outliers/o_1/select' }] }] };
  assert.doesNotMatch(content(page, {}, ''), /javascript:|data:x|<img/);
  assert.deepEqual(['https://youtu.be/a', 'https://studio.youtube.com/x', 'https://docs.google.com/d', 'https://x.y', 'nope'].map(linkLabel),
    ['Watch on YouTube', 'Open in Studio', 'Open doc', 'Open link', 'Open link']);
});

test('outliers sort by views over their channel average, best first', async () => {
  const { env } = await setup();
  for (const [title, views, avg] of [['2x', 100000, 50000], ['9x', 9000, 1000], ['6x', 30000, 5000], ['also 6x, more views', 60000, 10000]]) {
    await call(env, 'POST', '/v1/outliers', { bot: 'viral-view', body: { ...OUTLIER, title, views, avg } });
  }
  await call(env, 'POST', '/v1/outliers', { bot: 'viral-view', body: { ...OUTLIER, channel: 'max-creates', title: 'other channel', views: 1e6, avg: 1 } });
  const want = ['9x', 'also 6x, more views', '6x', '2x'];
  const api = (await call(env, 'GET', '/v1/outliers?channel=theo-creates', { bot: 'qc' })).body.outliers;
  assert.deepEqual(api.map((o) => o.title), want);
  assert.deepEqual(api.map((o) => o.multiple), [9, 6, 6, 2]);
  const snap = (await call(env, 'GET', '/snapshot?pages=content', { jon: true })).body.pages.content;
  const theo = snap.channels.find((c) => c.slug === 'theo-creates');
  assert.deepEqual([theo.count, theo.outliers.map((o) => o.title), theo.outliers[0].multipleLabel], [4, want, '9.0× avg']);

  // The builder sorts whatever order the rows arrive in.
  const out = { pages: { content: {} } };
  const rows = [['a', 10, 10], ['b', 300, 10], ['c', 25, 10]].map(([id, views, avg]) => ({ id, channel: 'jon-mac', title: id, link: 'https://x.y', views, avg_views: avg, published: '2026-10-01' }));
  buildChannelPages(out, { channels: [], calendar: [], outliers: rows }, NOW);
  const jm = out.pages.content.channels[0];
  assert.deepEqual(jm.outliers.map((o) => [o.title, o.multipleLabel, o.ageLabel]), [['b', '30× avg', '4 weeks ago'], ['c', '2.5× avg', '4 weeks ago'], ['a', '1.0× avg', '4 weeks ago']]);
});

test('the pages: schedule or "not set", friendly dates, coming up then the last 60 days', () => {
  const out = { pages: { calendar: {}, content: {} } };
  const v = (id, day, status, link = null) => ({ id, channel: 'aria-creates', title: id, day, status, link });
  buildChannelPages(out, {
    channels: [{ slug: 'aria-creates', schedule: 'Mon, Wed and Fri 9 am PT' }],
    calendar: [v('past', '2026-10-20', 'published', 'https://youtu.be/p'), v('yday', '2026-10-29', 'published'), v('today', '2026-10-30', 'scheduled'),
      v('next', '2026-10-31', 'planned'), v('later', '2026-11-03', 'planned'), v('next year', '2027-01-05', 'planned')],
    outliers: [],
  }, NOW);
  const aria = out.pages.calendar.channels.find((c) => c.slug === 'aria-creates');
  assert.equal(aria.schedule, 'Mon, Wed and Fri 9 am PT');
  assert.deepEqual(aria.upcoming.map((x) => x.dateLabel), ['Today', 'Tomorrow', 'Tue, Nov 3', 'Tue, Jan 5, 2027']);
  assert.deepEqual(aria.earlier.map((x) => x.dateLabel), ['Yesterday', 'Tue, Oct 20']);
  assert.equal(aria.count, 4);
  const html = calendar(out.pages.calendar, {}, 'aria-creates');
  assert.match(html, /Posting days: <b>Mon, Wed and Fri 9 am PT<\/b>/);
  assert.match(html, /<a class="btn sm line" href="https:\/\/youtu\.be\/p" target="_blank" rel="noopener">Watch on YouTube<\/a>/);
  assert.doesNotMatch(html.replace(/href="[^"]*"/g, ''), /https?:/, 'no raw URLs on the page');
  assert.match(html, /class="chip on" data-page="calendar\/aria-creates" aria-current="page">Aria Creates<span class="ccn">4<\/span>/);
  assert.match(calendar(out.pages.calendar, {}, 'theo-creates'), /Posting days: not set[\s\S]*No videos on the calendar yet/);
  assert.match(calendar(out.pages.calendar, {}, 'unknown'), /<h2>All channels<\/h2>/, 'an unknown tab opens the first, All channels');
  assert.match(calendar({ available: false, channels: out.pages.calendar.channels }, {}, ''), /could not be read/);
  assert.deepEqual([ageLabel('2026-10-30', '2026-10-30'), ageLabel('2026-10-29', '2026-10-30'), ageLabel('2026-06-01', '2026-10-30'), ageLabel('2023-10-01', '2026-10-30')],
    ['today', '1 day ago', '4 months ago', '3 years ago']);
  assert.equal(dayLabel('2026-12-25', '2026-10-30'), 'Fri, Dec 25');
});

test('snapshot: Calendar and Content are in the nav, served from D1, never the old content mockup', async () => {
  const { env } = await setup();
  const snap = (await call(env, 'GET', '/snapshot', { jon: true })).body;
  const ids = snap.nav.groups.flatMap((g) => g.items.map((i) => i.id));
  assert.deepEqual(ids.slice(4, 6), ['calendar', 'content']);
  assert.equal(snap.pages.content.tiles, undefined, 'no mockup tiles');
  assert.deepEqual([snap.pages.calendar.available, snap.pages.calendar.channels.length, snap.pages.content.channels.length], [true, 25, 24], 'Calendar has All channels first');
  const bare = (await handleApi(new Request('https://jonmac.ai/dashboard/api/snapshot?pages=content', { headers: { Cookie: `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}` } }), { SESSION_SECRET: SECRET })).json();
  assert.deepEqual((await bare).pages, { content: {} }, 'without D1 too');
  // Before migration 0014 is applied the pages still load and say the tables could not be read.
  const old = { prepare: (sql) => (/yt_/.test(sql) ? { bind() { return this; }, all: async () => { throw new Error('no such table: yt_channels'); } } : env.DB.prepare(sql)) };
  const r = (await call({ ...env, DB: old }, 'GET', '/snapshot?pages=calendar', { jon: true })).body.pages.calendar;
  assert.deepEqual([r.available, r.channels.length], [false, 25]);
});

test('calendar CSV import: PUT calendar/<channel> replaces only that channel\'s CSV rows; new statuses and a posting time', async () => {
  const { env } = await setup();
  const put = (bot, channel, videos) => call(env, 'PUT', `/v1/calendar/${channel}`, { bot, body: { videos } });
  const one = (await call(env, 'POST', '/v1/calendar', { bot: 'developer', body: { ...VIDEO, channel: 'jonmacai', time: '09:00', status: 'scripted' } })).body.video;
  assert.deepEqual([one.time, one.status], ['09:00', 'scripted']);
  const first = await put('jon-mac-youtube', 'jonmacai', [
    { date: '2026-11-02', time: '09:00', title: 'A', status: 'editing', link: 'https://jonmac.ai/review/a' },
    { date: '2026-11-04', title: 'B', status: 'idea' },
  ]);
  assert.deepEqual([first.status, first.body.videos, first.body.replaced], [200, 2, 0]);
  await put('developer', 'theo-creates', [{ date: '2026-11-03', title: 'T', status: 'scheduled' }]);
  const again = await put('developer', 'jonmacai', [{ date: '2026-11-05', time: '18:30', title: 'C', status: 'published' }]);
  assert.deepEqual([again.body.videos, again.body.replaced], [1, 2], 'the last import replaces the first, whoever ran it');
  const rows = (await call(env, 'GET', '/v1/calendar', { bot: 'developer' })).body.videos;
  assert.deepEqual(rows.map((v) => [v.channel, v.title, v.time, v.status]).sort(),
    [['jonmacai', 'C', '18:30', 'published'], ['jonmacai', VIDEO.title, '09:00', 'scripted'], ['theo-creates', 'T', null, 'scheduled']].sort(),
    'a video added on its own and other channels stay');

  for (const [videos, why] of [[[{ date: '2026-11-02', title: 'x', status: 'drafting' }], 'status'], [[{ date: '2026-11-02', time: '9am', title: 'x', status: 'idea' }], 'time'],
    [[{ date: '11/2/2026', title: 'x', status: 'idea' }], 'date'], [[{ date: '2026-11-02', title: 'x', status: 'idea', link: 'D:\\x.mp4' }], 'link'], ['nope', 'list']]) {
    const r = await put('developer', 'jonmacai', videos);
    assert.equal(r.status, 400, why);
  }
  assert.match((await put('developer', 'jonmacai', [{ date: '2026-11-02', title: 'ok', status: 'idea' }, { date: '2026-11-02', title: '', status: 'idea' }])).body.error, /^videos\[1\]: /);
  assert.equal((await call(env, 'GET', '/v1/calendar?channel=jonmacai', { bot: 'developer' })).body.videos.length, 2, 'a refused import changes nothing');
  assert.equal((await put('sponsors', 'jonmacai', [])).status, 403);
  assert.equal((await put('developer', 'not-a-channel', [])).status, 400);
});

test('Calendar page: All channels first with each video\'s channel, times in PT, a colour per status, posting days from the videos', () => {
  const out = { pages: { calendar: {} } };
  const v = (id, channel, day, status, time = null) => ({ id, channel, title: id, day, time_pt: time, status, link: null });
  buildChannelPages(out, { channels: [], outliers: [], calendar: [v('a', 'jonmacai', '2026-11-03', 'editing', '09:00'), v('c', 'jonmacai', '2026-11-05', 'review'),
    v('b', 'theo-creates', '2026-11-06', 'scheduled', '18:30'), v('old', 'jonmacai', '2026-10-20', 'published'), v('x', 'gone-channel', '2026-11-03', 'idea')] }, NOW);
  const [all, ...rest] = out.pages.calendar.channels;
  assert.deepEqual([all.slug, all.count, all.upcoming.map((x) => x.title)], ['all', 3, ['a', 'c', 'b']], 'an unknown channel is left out');
  assert.equal(rest.find((c) => c.slug === 'jonmacai').schedule, 'Tue, Thu', 'posting days from its coming videos');
  const html = calendar(out.pages.calendar, {}, '');
  assert.match(html, /<h2>All channels<\/h2><span class="meta">3 coming up<\/span>/);
  assert.match(html, /<span class="ccdate">Tue, Nov 3<small>9:00 AM PT<\/small><\/span><span class="cct"><span class="ccch">@JonMacAI<\/span>a<\/span><span class="ccend"><span class="pill violet">Editing<\/span>/);
  assert.match(html, /Theo Creates<\/span>b<\/span><span class="ccend"><span class="pill teal">Scheduled</);
  assert.match(html, /<span class="pill risk">Ready for review<\/span>/);
  assert.match(calendar(out.pages.calendar, {}, 'jonmacai'), /Posting days: <b>Tue, Thu<\/b>/);
  assert.doesNotMatch(calendar(out.pages.calendar, {}, 'jonmacai'), /ccch/, 'one channel: no channel names');
});
