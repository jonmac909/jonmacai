// Track page channel list (Jon, 2026-11-17): only Jon Mac, Jon Mac AI, Jon Mac IG, Jon Mac TT, in that order, from the same
// factory_channels table and flag as the Factory page (migration 0033). A hidden channel's rows stay in the database and are
// not shown or counted on the page. The Skool /track page is per video link, not per channel, so it is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { handleApi } from '../src/api.js';
import { sha256Hex, CHANNEL_WRITERS } from '../src/bots.js';
import { buildTrackPage, showTrackChannels, trackData, TRACK_TO_FACTORY } from '../src/track.js';
import { track } from '../public/js/pages/track.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TOK = Object.fromEntries([...CHANNEL_WRITERS, 'qc'].map((b) => [b, `ccb_${b.padEnd(43, 'x')}`]));
const NOW = Date.parse('2026-10-30T19:00:00Z');
const FOUR = ['Jon Mac', 'Jon Mac AI', 'Jon Mac IG', 'Jon Mac TT'];

async function call(env, method, path, { bot, body, jon } = {}) {
  const h = new Headers();
  if (bot) h.set('Authorization', `Bearer ${TOK[bot]}`);
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}
async function visit(env, path) {
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, { redirect: 'manual' }), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
const importCsv = (env, slug, videos) => call(env, 'PUT', `/v1/calendar/${slug}`, { bot: 'developer', body: { videos } });
const linkOf = (db, title) => db.prepare('SELECT l.code, l.clicks FROM yt_links l JOIN yt_calendar v ON v.id = l.video_id WHERE v.title = ?').bind(title).first();
const pageOf = async (db, hgp) => { const out = { pages: { track: {} } }; buildTrackPage(out, await trackData(db, 'https://jonmac.ai', NOW, hgp)); return out.pages.track; };
const totalRow = (html) => html.match(/<tr class="tktotal">(.*?)<\/tr>/s)[1].split(/<[^>]+>/).map((s) => s.trim()).filter(Boolean);
const order = (hgp, id, slug, cents) => hgp.sqlite.prepare("INSERT INTO orders (transaction_id, slug, email, amount_cents, is_test, revoked_at, created_at) VALUES (?, ?, 'a@b.c', ?, 0, NULL, 'x')").run(id, slug, cents);

// Visible and hidden channels each with a video, a tracked-link click, Studio numbers and (for the book channels) paid sales.
async function setup() {
  const db = sqliteD1(); // the real migrations, 0033 included: four channels visible, the rest hidden
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  const hgp = sqliteD1();
  hgp.sqlite.exec(readFileSync(new URL('../../homeguidepress/migrations/0001_init.sql', import.meta.url), 'utf8'));
  const env = { DB: db, HGP_DB: hgp, SESSION_SECRET: SECRET };
  await importCsv(env, 'jon-mac', [{ date: '2026-11-03', title: 'Jon video', status: 'published', youtube_id: 'jonvideo001' }]);
  await importCsv(env, 'jonmacai', [{ date: '2026-11-03', title: 'AI video', status: 'scheduled', youtube_id: 'aivideo0001' }]);
  await importCsv(env, 'naomi-takeda-japan', [{ date: '2026-11-03', title: 'Naomi hidden video', status: 'published', youtube_id: 'naomivideo1' }]);
  await importCsv(env, 'peter-collins', [{ date: '2026-11-03', title: 'Peter hidden video', status: 'published', youtube_id: 'petervideo1' }]);
  const stats = [{ youtube_id: 'jonvideo001', impressions: 1000, views: 10, subs: 1 }, { youtube_id: 'aivideo0001', impressions: 200, views: 5, subs: 0 },
    { youtube_id: 'naomivideo1', impressions: 90000, views: 7777, subs: 55 }, { youtube_id: 'petervideo1', impressions: 80000, views: 6666, subs: 44 }];
  assert.equal((await call(env, 'POST', '/v1/links/stats', { bot: 'developer', body: { stats } })).status, 200);
  for (const t of ['Naomi hidden video', 'Naomi hidden video', 'Peter hidden video', 'Jon video']) await visit(env, `/v/${(await linkOf(db, t)).code}`);
  order(hgp, 't1', 'naomi', 2700); order(hgp, 't2', 'gary', 2700); order(hgp, 't3', 'gary', 2700);
  return { db, hgp, env };
}

test('Track shows only Jon Mac, Jon Mac AI, Jon Mac IG, Jon Mac TT, in factory_channels order, and counts only them', async () => {
  const { db, hgp } = await setup();
  const page = await pageOf(db, hgp);
  assert.deepEqual(page.channels.map((c) => c.slug), ['all', 'jon-mac', 'jonmacai', 'jon-mac-ig', 'jon-mac-tt']);
  assert.deepEqual(page.channels.slice(1).map((c) => c.label), FOUR);
  assert.equal(page.channels[0].count, 2, 'All counts the two videos of the four channels');
  assert.deepEqual(page.videos.map((v) => v.title).sort(), ['AI video', 'Jon video']);
  assert.equal(page.channels.find((c) => c.slug === 'jon-mac-ig').connect, null, 'Jon Mac IG and TT have no YouTube login to connect');
  assert.equal(page.channels.find((c) => c.slug === 'jon-mac').connect.state, 'none');
  const html = track(page, {}, '');
  assert.doesNotMatch(html, /Naomi|Peter|Giovanni|Nora|Rosa|Theo|Aria|hidden video/, 'no hidden channel or its video on the page');
  const rows = html.match(/<tr data-page="track\/([^"]+)">/g).map((r) => r.match(/track\/([^"]+)/)[1]);
  assert.deepEqual(rows, ['jon-mac', 'jonmacai', 'jon-mac-ig', 'jon-mac-tt'], 'in factory_channels order');
  assert.doesNotMatch(html.match(/<tr data-page="track\/jon-mac-ig">.*?<\/tr>/s)[0], /Connect|Not connected/);
  // Totals: impressions 1,000 + 200 and views 10 + 5 only; the hidden channels' 90,000 / 80,000 and 7,777 / 6,666 are not in them,
  // and the hidden book sales and clicks are not either (the four sell no book here, so those totals are dashes).
  const t = totalRow(html);
  assert.deepEqual(t.slice(0, 4), ['Total', '2', '1', '1'], 'videos on YouTube, scheduled, posted: the four only (Naomi and Peter have one live each, not counted)');
  assert.equal(t[4], '1,200', 'impressions');
  assert.equal(t[5], '15', 'views');
  assert.equal(t[6], '1', 'subs (blank CTR and AVD cells are empty, so they drop out of this list)');
  assert.deepEqual(t.slice(-4), ['—', '—', '—', '—'], "hidden channels' clicks, sales and revenue are not counted");
  assert.equal(JSON.stringify(page).includes('naomi'), false);
  assert.equal(page.channels.every((c) => !c.book), true);
  const one = track(page, {}, 'jon-mac-ig');
  assert.match(one, /No videos on the calendar yet/);
});

test('a hidden channel keeps all its rows in the database; only the page leaves it out', async () => {
  const { db, hgp } = await setup();
  await pageOf(db, hgp);
  assert.equal((await linkOf(db, 'Naomi hidden video')).clicks, 2, 'its clicks stay');
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM yt_calendar WHERE channel IN ('naomi-takeda-japan', 'peter-collins')").get().n, 2, 'its videos stay');
  assert.equal(hgp.sqlite.prepare("SELECT COUNT(*) AS n FROM orders WHERE slug = 'naomi'").get().n, 1, 'its sales stay');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM factory_channels').get().n, 8, 'no row removed from factory_channels');
});

test('un-hiding a channel in factory_channels brings it back in its place, with its own numbers; hiding takes it away again', async () => {
  const { db, hgp } = await setup();
  db.sqlite.exec("UPDATE factory_channels SET visible = 1, sort = 5 WHERE id = 'naomi'"); // naomi is Track's naomi-takeda-japan
  assert.equal(TRACK_TO_FACTORY['naomi-takeda-japan'], 'naomi');
  const page = await pageOf(db, hgp);
  assert.deepEqual(page.channels.slice(1).map((c) => c.slug), ['jon-mac', 'jonmacai', 'jon-mac-ig', 'jon-mac-tt', 'naomi-takeda-japan']);
  assert.equal(page.channels[5].label, 'Naomi Takeda Japan');
  assert.deepEqual(page.channels[5].book, { clicks: 2, sales: 1, revenue: 27 });
  assert.deepEqual(page.videos.map((v) => v.title).sort(), ['AI video', 'Jon video', 'Naomi hidden video']);
  assert.doesNotMatch(track(page, {}, ''), /Peter/);
  db.sqlite.exec("UPDATE factory_channels SET visible = 0 WHERE id = 'naomi'");
  assert.equal((await pageOf(db, hgp)).channels.length, 5);
});

test("the order follows factory_channels.sort and the label is the row's label", async () => {
  const { db, hgp } = await setup();
  db.sqlite.exec("UPDATE factory_channels SET sort = 9 WHERE id = 'jon-mac'; UPDATE factory_channels SET label = 'Jon Mac AI (main)' WHERE id = 'jonmacai'");
  const page = await pageOf(db, hgp);
  assert.deepEqual(page.channels.slice(1).map((c) => c.slug), ['jonmacai', 'jon-mac-ig', 'jon-mac-tt', 'jon-mac']);
  assert.equal(page.channels[1].label, 'Jon Mac AI (main)');
  assert.equal(page.videos.find((v) => v.title === 'AI video').channelLabel, 'Jon Mac AI (main)');
});

test('with no visible row, or no table, Track is as it was: every channel', async () => {
  const { db, hgp } = await setup();
  db.sqlite.exec('UPDATE factory_channels SET visible = 0');
  const all = await pageOf(db, hgp);
  assert.ok(all.channels.length > 20);
  assert.equal(all.videos.length, 4);
  db.sqlite.exec('DROP TABLE factory_channels'); // migration 0033 not applied
  const none = await pageOf(db, hgp);
  assert.equal(none.channels.length, all.channels.length);
  assert.equal(none.videos.length, 4);
  assert.equal(showTrackChannels(null, []), null);
});

test('the signed-in snapshot Track page (/dash and /dashboard) carries only the four', async () => {
  const { env } = await setup();
  const snap = await call(env, 'GET', '/snapshot?pages=track', { jon: true });
  assert.equal(snap.status, 200);
  assert.deepEqual(snap.body.pages.track.channels.map((c) => c.label), ['All channels', ...FOUR]);
  assert.equal(snap.body.pages.track.videos.length, 2);
});

test('the Skool /track stats page is per video link, not per channel, and is not filtered', () => {
  assert.doesNotMatch(readFileSync(new URL('../src/skool.js', import.meta.url), 'utf8'), /factory_channels/);
});
