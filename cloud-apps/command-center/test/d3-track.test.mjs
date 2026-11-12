// Dashboard 3 Track page (docs/dashboard-3.md): the old Track page, drawn by its own code inside the /dash shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { track as oldTrack } from '../public/js/pages/track.js';
import { renderTrack, trackSub } from '../public/d3/js/track.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TOKEN = `ccb_${'developer'.padEnd(43, 'x')}`;

async function setup() {
  const db = sqliteD1();
  await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(TOKEN), 'developer', 'x').run();
  return { DB: db, SESSION_SECRET: SECRET };
}
async function call(env, method, path, body) {
  const h = new Headers();
  if (body !== undefined) { h.set('Authorization', `Bearer ${TOKEN}`); h.set('Content-Type', 'application/json'); } else {
    h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`);
    h.set('X-CC', '1');
  }
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}

test('Track route: the channel comes from the hash', () => {
  assert.equal(trackSub('#track'), '');
  assert.equal(trackSub('#track/peter-collins'), 'peter-collins');
  assert.equal(trackSub('#/Track/jon%20mac'), 'jon mac');
  assert.equal(trackSub('#track/%E0%A4%A'), ''); // a broken escape reads as All channels
  for (const other of ['', '#factory', '#tracker/x', null, undefined]) assert.equal(trackSub(other), '');
});

test('Track page: loading, failed and no data yet', () => {
  assert.match(renderTrack(null, '', oldTrack), /^<div class="tkpage"><div class="wrap"><div class="head"><div><h1>Track<\/h1><\/div><\/div><section class="card"><p class="mut">Loading Track<\/p><\/section><\/div><\/div>$/);
  assert.match(renderTrack({ failed: true }, '', oldTrack), /<h1>Track<\/h1>[\s\S]*Could not load Track\. It tries again when you open this page\./);
  const empty = renderTrack({}, undefined, oldTrack);
  assert.equal(empty, `<div class="tkpage">${oldTrack({}, null, '')}</div>`);
  assert.match(empty, /Track has no data yet\./);
});

test('Track page: the old page\'s own markup and numbers, from the same snapshot the old page reads', async () => {
  const env = await setup();
  const put = await call(env, 'PUT', '/v1/calendar/peter-collins', { videos: [
    { date: '2026-11-03', time: '09:00', title: 'Tiny <b>houses</b>', status: 'scheduled', youtube_id: 'abcdefghijk' },
    { date: '2026-11-05', title: 'Road test', status: 'planned' },
  ] });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const snap = await call(env, 'GET', '/snapshot?pages=track');
  assert.equal(snap.status, 200);
  const page = snap.body.pages.track;
  assert.ok(page && typeof page === 'object', 'the snapshot carries pages.track');
  const all = renderTrack(page, '', oldTrack);
  // Exactly the old page inside the Dashboard 3 wrapper: nothing rewritten, so the numbers and links cannot drift.
  assert.equal(all, `<div class="tkpage">${oldTrack(page, null, '')}</div>`);
  assert.match(all, /<h1>Track<\/h1>/);
  assert.match(all, /data-page="track\/peter-collins"/);
  assert.match(all, /data-tsort="/);
  assert.doesNotMatch(all, /<b>houses<\/b>|undefined|NaN/);
  const one = renderTrack(page, 'peter-collins', oldTrack);
  assert.equal(one, `<div class="tkpage">${oldTrack(page, null, 'peter-collins')}</div>`);
  assert.match(one, /Tiny &lt;b&gt;houses&lt;\/b&gt;/);
  assert.match(one, /Road test/);
  assert.match(one, /data-copy="https:\/\/jonmac\.ai\/[^"]+"/);
  assert.notEqual(one, all);
});

test('Track page: wired into the shell (old renderer, old data, its own controls) and styled for both themes', () => {
  const app = readFileSync(new URL('../public/d3/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /const OLD_TRACK = '\/dashboard\/js\/pages\/track\.js';/);
  assert.match(app, /async function loadTrack\(\) \{\s*try \{\s*oldTrack \|\|= await import\(OLD_TRACK\);/);
  assert.match(app, /getJson\(`\/dashboard\/api\/snapshot\?pages=track&v=\$\{Date\.now\(\)\}`\)/);
  assert.match(app, /renderTrack\(S\.track, trackSub\(location\.hash\), oldTrack\?\.track\)/);
  assert.match(app, /if \(sort\) \{ oldTrack\?\.setSort\(sort\.dataset\.tsort\); render\(\); return; \}/);
  assert.match(app, /navigator\.clipboard \? navigator\.clipboard\.writeText\(copy\.dataset\.copy\)/);
  assert.match(app, /\^track\(\\\/\|\$\)\/\.test\(go\.dataset\.page\)\) \{ location\.hash = go\.dataset\.page; return; \}/);
  assert.doesNotMatch(app.slice(app.indexOf("if (page() === 'track')"), app.indexOf('// Factory, Track, Blockers')).split('return;\n  }')[0] + '', /method: '(POST|PUT|DELETE)'/, 'view only');
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  const tk = css.slice(css.indexOf('.d3 .tkpage'));
  assert.ok(tk.length > 500, 'the Track rules are there');
  assert.doesNotMatch(tk, /#(?!ffffff|7c3aed|0f766e|c4b5fd|5eead4)[0-9a-f]{6}\b/i, 'Track uses the theme variables (plus the violet and teal stage pills, set for light and dark), so it follows both themes');
  for (const line of tk.split('\n').filter((l) => /\{/.test(l) && !/^\s*(\/\*|@|\})/.test(l))) assert.match(line, /^\s*(\[data-theme="dark"\] )?\.d3 /, `scoped to Dashboard 3: ${line.slice(0, 60)}`);
});
