// "Reset stats" on /track: nothing is deleted, /track counts only what came after the latest reset, Undo brings it all back.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { trackerData } from '../src/skool.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const env = () => ({ DB: sqliteD1(), SESSION_SECRET: SECRET, SKOOL_ZAP_TOKEN: 'zap' });
async function go(e, path, { method = 'GET', body, jon = false, headers = {} } = {}) {
  const h = new Headers(headers);
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
const pause = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();
const rowOf = async (e, slug = 'vid-one') => (await trackerData(e.DB)).rows.find((r) => r.slug === slug);
const count = async (e, t, where = '') => (await e.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} ${where}`).first()).n;

// 3 old clicks, 2 old leads, 1 old sale, all before the reset.
async function seed(e) {
  const old = Date.now() - 2 * 864e5;
  await e.DB.prepare('INSERT INTO skool_links (slug, title, created_at, capture) VALUES (?, ?, ?, 0)').bind('vid-one', 'Video One', iso(old - 864e5)).run();
  for (let i = 0; i < 3; i++) await e.DB.prepare('INSERT INTO skool_clicks (slug, at) VALUES (?, ?)').bind('vid-one', iso(old + i * 1000)).run();
  for (const m of ['a@gmail.com', 'b@gmail.com']) await e.DB.prepare('INSERT INTO skool_leads (slug, email, at, last_at, email_check) VALUES (?, ?, ?, ?, ?)').bind('vid-one', m, iso(old + 5000), iso(old + 5000), 'valid').run();
  await e.DB.prepare('INSERT INTO skool_sales (id, email, name, at, created_at) VALUES (?, ?, ?, ?, ?)').bind('s1', 'a@gmail.com', 'Ann', iso(old + 9000), iso(old + 9000)).run();
}
const reset = (e, body = {}) => go(e, '/track/api/reset', { method: 'POST', jon: true, body });

test('reset zeroes every count and keeps every row', async () => {
  const e = env(); await seed(e);
  let r = await rowOf(e);
  assert.deepEqual([r.clicks.all, r.clicks.d7, r.clicks.d30, r.emails, r.sales], [3, 3, 3, 2, 1]);
  await pause();
  const res = await reset(e);
  assert.equal(res.status, 200);
  assert.ok((await res.json()).since);
  r = await rowOf(e);
  assert.deepEqual([r.clicks.all, r.clicks.d7, r.clicks.d30, r.emails, r.sales, r.estimated], [0, 0, 0, 0, 0, 0]);
  const d = await trackerData(e.DB);
  assert.equal(d.sales.length, 0);
  assert.ok(d.since);
  assert.equal(await count(e, 'skool_clicks'), 3); // nothing deleted
  assert.equal(await count(e, 'skool_leads'), 2);
  assert.equal(await count(e, 'skool_sales'), 1);
});

test('a click, lead and sale after the reset count; older ones stay out', async () => {
  const e = env(); await seed(e);
  await pause(); await reset(e); await pause();
  assert.equal((await go(e, '/s/vid-one')).status, 302);
  let r = await rowOf(e);
  assert.deepEqual([r.clicks.all, r.clicks.d7, r.clicks.d30], [1, 1, 1]);
  await e.DB.prepare('INSERT INTO skool_leads (slug, email, at, last_at, email_check) VALUES (?, ?, ?, ?, ?)').bind('vid-one', 'c@gmail.com', iso(Date.now()), iso(Date.now()), 'valid').run();
  await e.DB.prepare('INSERT INTO skool_sales (id, email, at, created_at) VALUES (?, ?, ?, ?)').bind('s2', 'c@gmail.com', iso(Date.now()), iso(Date.now())).run();
  r = await rowOf(e);
  assert.equal(r.emails, 1);
  assert.equal(r.sales, 1);
  assert.equal((await trackerData(e.DB)).sales.length, 1);
});

test('undo brings the old counts back; a new reset works again', async () => {
  const e = env(); await seed(e);
  await pause(); await reset(e); await pause();
  await go(e, '/s/vid-one');
  assert.equal((await rowOf(e)).clicks.all, 1);
  const u = await reset(e, { undo: true });
  assert.equal(u.status, 200);
  const r = await rowOf(e);
  assert.deepEqual([r.clicks.all, r.emails, r.sales], [4, 2, 1]); // 3 old + the one after the reset
  assert.equal((await trackerData(e.DB)).since, null);
  assert.equal(await count(e, 'skool_settings', "WHERE key = 'skool_stats_reset_at'"), 0);
  await pause(); await reset(e);
  assert.equal((await rowOf(e)).clicks.all, 0);
});

test('a second reset moves the line forward', async () => {
  const e = env(); await seed(e);
  await pause(); await reset(e); const a = (await trackerData(e.DB)).since;
  await pause(); await reset(e); const b = (await trackerData(e.DB)).since;
  assert.ok(b > a);
});

test('signed-out POST is refused and nothing changes', async () => {
  const e = env(); await seed(e);
  assert.equal((await go(e, '/track/api/reset', { method: 'POST', body: {} })).status, 401);
  assert.equal((await go(e, '/track/api/reset', { method: 'POST', body: {}, headers: { 'X-CC': '1' } })).status, 401); // the header alone is no proof
  assert.equal((await go(e, '/track/api/reset', { method: 'POST', body: { undo: true } })).status, 401);
  assert.equal((await trackerData(e.DB)).since, null);
  assert.equal((await rowOf(e)).clicks.all, 3);
  assert.equal(await count(e, 'skool_settings'), 0);
  assert.equal((await go(e, '/track')).status, 302); // the page still goes to sign-in
});

test('undo while signed out changes nothing either', async () => {
  const e = env(); await seed(e);
  await pause(); await reset(e);
  const since = (await trackerData(e.DB)).since;
  assert.equal((await go(e, '/track/api/reset', { method: 'POST', body: { undo: true }, headers: { 'X-CC': '1' } })).status, 401);
  assert.equal((await trackerData(e.DB)).since, since);
});

test('signed in without the X-CC header, or from another origin: refused', async () => {
  const e = env(); await seed(e);
  const h = new Headers({ Cookie: `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`, 'Content-Type': 'application/json' });
  const noCC = await worker.fetch(new Request('https://jonmac.ai/track/api/reset', { method: 'POST', headers: h, body: '{}' }), e, { waitUntil() {} });
  assert.equal(noCC.status, 403);
  assert.equal((await go(e, '/track/api/reset', { method: 'POST', jon: true, body: {}, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await trackerData(e.DB)).since, null);
  assert.equal((await go(e, '/track/api/reset', { method: 'POST', jon: true, body: {}, headers: { Origin: 'https://jonmac.ai' } })).status, 200);
  assert.equal((await go(e, '/track/api/reset', { method: 'GET', jon: true })).status, 404);
});

test('the /track page has the button, the confirm text, and the Since line with Undo after a reset', async () => {
  const e = env(); await seed(e);
  let html = await (await go(e, '/track', { jon: true })).text();
  assert.match(html, /Reset stats/);
  assert.match(html, /Reset all stats on this page to zero\? Past data is kept and can be restored\./);
  assert.doesNotMatch(html, /Undo reset<\/a>/);
  await pause(); await reset(e);
  html = await (await go(e, '/track', { jon: true })).text();
  assert.match(html, /Since \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\. <a href="#" id="undo">Undo reset<\/a>/);
});

test('/track/leads keeps every lead after a reset', async () => {
  const e = env(); await seed(e);
  await pause(); await reset(e);
  const html = await (await go(e, '/track/leads', { jon: true })).text();
  assert.match(html, /a@gmail\.com/);
  assert.match(html, /b@gmail\.com/);
  assert.match(html, /2 in all/);
});

test('a sale after the reset still goes to the link of a lead captured before it', async () => {
  const e = env(); await seed(e);
  await pause(); await reset(e); await pause();
  await e.DB.prepare('INSERT INTO skool_sales (id, email, at, created_at) VALUES (?, ?, ?, ?)').bind('s3', 'b@gmail.com', iso(Date.now()), iso(Date.now())).run();
  const r = await rowOf(e);
  assert.equal(r.sales, 1);
  assert.equal(r.emails, 0); // the lead itself is old
});
