// Dashboard 3 Factory page: the video_line feed (PUT /v1/feeds/video_line), the API part (d3.factory) and the page render.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import worker from '../src/worker.js';
import { signSession, COOKIE } from '../src/auth.js';
import { renderFactory, factoryJobs, agoShort, kelowna } from '../public/d3/js/factory.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-12T00:00:00Z'); // Wed Nov 11, late afternoon in Kelowna
const S = (s) => new Date(NOW - s * 1000).toISOString();
const TOK = Object.fromEntries(['ana', 'developer', 'sponsors', 'video-editor'].map((b) => [b, `ccb_${b.padEnd(43, 'x')}`]));

// The board as the pusher posts it (the brief's sample), plus a failed, a needs-person, a waiting and a done video.
const step = (name, status, extra = {}) => ({ name, status, tries: status === 'todo' ? 0 : 1, minutes: null, started: null, ended: null, note: '', fix: '', doing: '', ...extra });
const BOARD = () => ({
  updated: '2026-11-11T23:59:03Z',
  scheduler_running: true,
  counts: { jobs: 5, done: 1, running: 1, needs_person: 1 },
  jobs: [
    { id: 'done-1', channel: 'hgp', pipeline: 'hgp-longform', created: '2026-11-11T20:00:00Z', state: 'done', step: '', minutes_in_state: '40', note: '', steps_done: 2, steps_total: 2, needs_person: null,
      final: 'D:\\videos\\done-1\\final.mp4', steps: [step('pack', 'done', { minutes: 31 }), step('render', 'done', { minutes: 12 })] },
    { id: 'wait-1', channel: 'nora', pipeline: 'hgp-longform', created: '2026-11-11T23:50:00Z', state: 'todo', step: '', minutes_in_state: '9', note: '', steps_done: 0, steps_total: 2, needs_person: null, final: '',
      steps: [step('pack', 'todo'), step('plan', 'todo')] },
    { id: 'nora-5', channel: 'nora', pipeline: 'hgp-longform', created: '2026-11-11T23:36:33Z', state: 'running', step: 'pack', minutes_in_state: '22', note: '', steps_done: 0, steps_total: 4, needs_person: null, final: '',
      steps: [step('pack', 'running', { minutes: 22, started: '2026-11-11T23:36:42Z', doing: 'after 8 of 11 pack checks; last: stills PASS all 198 stills on disk' }), step('plan', 'todo')] },
    { id: 'fail-1', channel: 'nora', pipeline: 'hgp-longform', created: '2026-11-11T22:00:00Z', state: 'failed', step: 'plan', minutes_in_state: '3', note: 'plan failed twice', steps_done: 1, steps_total: 3, needs_person: null, final: '',
      steps: [step('pack', 'done', { minutes: 30 }), step('plan', 'failed', { tries: 2, minutes: 4, note: 'The plan had 3 scenes with no picture', fix: 'Add pictures for scenes 4, 9 and 12, then run it again' }), step('render', 'todo')] },
    { id: 'need-1', channel: 'hgp', pipeline: 'hgp-longform', created: '2026-11-11T21:00:00Z', state: 'NEEDS A PERSON', step: 'render', minutes_in_state: '15', note: '', steps_done: 1, steps_total: 2,
      needs_person: { step: 'render', why: 'The voice file is missing', look_at: 'D:\\videos\\need-1\\voice', since: '2026-11-11T23:45:00+00:00' }, final: '',
      steps: [step('pack', 'done', { minutes: 28 }), step('render', 'failed', { tries: 3, note: 'No voice file', fix: 'Record the voice' })] },
  ],
  events: ['2026-11-11T23:36:33Z  nora-5           job        created', '2026-11-11T23:36:42Z  nora-5           pack       started         pid 2732'],
  unreadable_jobs: [],
});

async function setup() {
  const db = sqliteD1();
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
async function put(env, bot, body) {
  const r = await handleApi(new Request('https://jonmac.ai/dashboard/api/v1/feeds/video_line', {
    method: 'PUT', headers: { Authorization: `Bearer ${TOK[bot]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env);
  return { status: r.status, body: await r.json() };
}
const d3Of = async (db) => {
  const real = Date.now;
  Date.now = () => NOW;
  try {
    const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
    return await (await handleApi(new Request('https://jonmac.ai/dashboard/api/d3', { headers: { Cookie: cookie } }), { DB: db, SESSION_SECRET: SECRET })).json();
  } finally { Date.now = real; }
};
const entry = (db, id, ageS, data) => db.sqlite.prepare('INSERT INTO bot_feed_entries (id, name, bot, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, 'video_line', 'developer', JSON.stringify(data), S(ageS));
const page = (factory, ui = {}) => renderFactory({ asOf: new Date(NOW).toISOString(), d3: { factory } }, ui);
const fresh = (over = {}) => ({ ...BOARD(), at: S(10), stale: false, ...over });

test('video_line feed: developer or ana post it, the board is kept as posted, 1 day is kept', async () => {
  const { db, env } = await setup();
  assert.equal((await put(env, 'sponsors', BOARD())).status, 403);
  assert.equal((await put(env, 'video-editor', BOARD())).status, 403);
  entry(db, 'f_old', 2 * 86400, {});
  const ok = await put(env, 'developer', BOARD());
  assert.equal(ok.status, 201);
  // Times come back in the server's ISO form (with milliseconds); everything else is as posted.
  assert.deepEqual(ok.body.feed.data, JSON.parse(JSON.stringify(BOARD()).replace(/(T\d\d:\d\d:\d\d)Z"/g, '$1.000Z"')), 'a good board comes back unchanged');
  assert.equal((await put(env, 'ana', { ...BOARD(), scheduler_running: null })).body.feed.data.scheduler_running, undefined); // null is not stored
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM bot_feed_entries WHERE id = 'f_old'").first()).n, 0, 'entries older than a day are dropped');
  // The smallest board: only the time and an empty list of videos.
  const least = await put(env, 'developer', { updated: '2026-11-11T23:59:03Z', jobs: [] });
  assert.equal(least.status, 201);
  assert.deepEqual(least.body.feed.data, { updated: '2026-11-11T23:59:03.000Z', counts: { jobs: 0, done: 0, running: 0, needs_person: 0 }, jobs: [], events: [], unreadable_jobs: [] });
});

test('video_line feed: a wrong shape is a 400', async () => {
  const { env } = await setup();
  const B = BOARD();
  const job = (over) => ({ ...B, jobs: [{ ...B.jobs[2], ...over }] });
  const st = (over) => job({ steps: [{ ...B.jobs[2].steps[0], ...over }] });
  const bad = [
    { ...B, updated: undefined }, { ...B, updated: 'just now' }, { ...B, scheduler_running: 'yes' }, { ...B, counts: [1] }, { ...B, counts: { jobs: -1 } },
    { ...B, counts: { jobs: '3' } }, { ...B, jobs: undefined }, { ...B, jobs: {} }, { ...B, jobs: ['nora-5'] }, { ...B, events: 'x' }, { ...B, events: [{ at: 'x' }] },
    { ...B, unreadable_jobs: 'x' }, job({ id: '' }), job({ id: { a: 1 } }), job({ state: undefined }), job({ created: 'yesterday' }), job({ note: ['x'] }),
    job({ steps_done: 1.5 }), job({ needs_person: 'yes' }), job({ needs_person: { why: { a: 1 } } }), job({ steps: 'pack' }), job({ steps: ['pack'] }),
    st({ name: '' }), st({ minutes: '22' }), st({ tries: -1 }), st({ started: 'soon' }), st({ doing: { a: 1 } }),
  ];
  for (const b of bad) assert.equal((await put(env, 'developer', b)).status, 400, JSON.stringify(b).slice(0, 200));
});

test('video_line feed: long input is cut, not refused (60 videos, 12 steps, newest 20 events, 300 characters)', async () => {
  const { env } = await setup();
  const B = BOARD();
  const long = 'x'.repeat(500);
  const big = {
    ...B,
    // Only the first video carries long text: the whole request must stay under the API's 256 KB body limit.
    jobs: Array.from({ length: 70 }, (_, i) => (i ? { ...B.jobs[2], id: `v${i}`, steps: Array.from({ length: 15 }, (_x, n) => step(`s${n}`, 'todo')) }
      : { ...B.jobs[2], id: 'v0', channel: long, pipeline: long, state: long, step: long, minutes_in_state: long, note: long, final: long, needs_person: { step: long, why: long, look_at: long, since: long },
        steps: Array.from({ length: 15 }, (_x, n) => step(`s${n}${long}`, long, { note: long, fix: long, doing: long })) })),
    events: Array.from({ length: 30 }, (_, i) => `e${i} ${long}`),
    unreadable_jobs: Array.from({ length: 70 }, (_, i) => (i ? `u${i}` : long)),
  };
  const r = await put(env, 'developer', big);
  assert.equal(r.status, 201);
  const d = r.body.feed.data;
  assert.deepEqual([d.jobs.length, d.jobs[0].steps.length, d.events.length, d.unreadable_jobs.length], [60, 12, 20, 60]);
  assert.deepEqual([d.jobs[0].id, d.jobs[59].id, d.events[0].slice(0, 4), d.events[19].slice(0, 4)], ['v0', 'v59', 'e10 ', 'e29 ']); // the newest events are the last ones
  const texts = [];
  const walk = (v) => { if (typeof v === 'string') texts.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(d);
  assert.equal(Math.max(...texts.map((t) => t.length)), 300);
});

test('d3.factory: null with no entry, the newest entry with at, stale after 3 minutes', async () => {
  const { db } = await setup();
  assert.equal((await d3Of(db)).d3.factory, null);
  assert.equal((await d3Of({ prepare: () => { throw new Error('no table'); } })).d3.factory, null, 'an unreadable table is null too');
  entry(db, 'v1', 600, { ...BOARD(), counts: { jobs: 99 } });
  entry(db, 'v2', 170, BOARD());
  const f = (await d3Of(db)).d3.factory;
  assert.deepEqual([f.at, f.stale, f.counts.jobs, f.jobs.length, f.jobs[2].id], [S(170), false, 5, 5, 'nora-5']);
  db.sqlite.prepare("DELETE FROM bot_feed_entries WHERE id = 'v2'").run();
  entry(db, 'v3', 190, BOARD());
  const old = (await d3Of(db)).d3;
  assert.deepEqual([old.factory.at, old.factory.stale, old.factory.updated], [S(190), true, '2026-11-11T23:59:03Z']);
  assert.deepEqual(old.sources.filter((s) => s.name === 'video_line').map((s) => [s.label, s.stale]), [['Video program board', true]]);
});

test('Factory page: summary, order, step chips, what is happening now', () => {
  const html = page(fresh());
  assert.match(html, /<h1>Factory<\/h1>/);
  assert.match(html, /<b>5 videos<\/b><span class="pill">1 running<\/span><span class="pill ok">1 done<\/span><span class="pill bad">1 needs you<\/span><span class="mut sp">updated 57 s ago<\/span>/);
  assert.doesNotMatch(html, /fcnote|fcstale/, 'fresh and the scheduler runs: no notice');
  // Needs you first, then failed, running, waiting, done.
  assert.deepEqual(factoryJobs(fresh()).map((j) => j.id), ['need-1', 'fail-1', 'nora-5', 'wait-1', 'done-1']);
  assert.deepEqual([...html.matchAll(/data-job="([^"]+)" data-kind="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`), ['need-1:need', 'fail-1:fail', 'nora-5:run', 'wait-1:wait', 'done-1:done']);
  const card = (id) => html.slice(html.indexOf(`data-job="${id}"`)).split('</section>')[0];
  // The running video: an accent chip with its minutes, a grey waiting chip, and the step's own words.
  const run = card('nora-5');
  assert.match(run, /<h2>nora-5<\/h2><span class="mut">nora · 0 of 4 steps done<\/span><span class="pill  sp">Running · 22 min<\/span>/);
  assert.match(run, /<span class="fcc run" role="listitem" title="pack, running, 22 min">pack · 22 min<\/span><span class="fcc wait" role="listitem" title="plan, waiting">plan<\/span>/);
  assert.match(run, /<p class="fcnow">after 8 of 11 pack checks; last: stills PASS all 198 stills on disk<\/p>/);
  assert.doesNotMatch(run, /fcneed|fcfail|Finished file/);
  // The failed video: a red chip with its try, then what happened and how to fix it.
  const fail = card('fail-1');
  assert.match(fail, /<span class="fcc done"[^>]*>pack · 30 min<\/span><span class="fcc fail" role="listitem" title="plan, failed, try 2">plan · try 2<\/span><span class="fcc wait"/);
  assert.match(fail, /<b>plan failed after 2 tries<\/b>[\s\S]*What happened<\/span><span>The plan had 3 scenes with no picture<\/span>[\s\S]*How to fix it<\/span><span>Add pictures for scenes 4, 9 and 12, then run it again/);
  assert.match(fail, /<span class="pill bad sp">Failed · 3 min<\/span>/);
  assert.match(fail, /<p class="fcnow">plan failed twice<\/p>/); // the video's note; the failed step's note sits in its own block, once
  assert.equal(fail.split('The plan had 3 scenes with no picture').length, 2);
  // Needs you: the block comes before the steps, with step, why, where to look and since when (Kelowna time: 3 PM or 4 PM, by whether this Node knows BC stopped changing its clocks in 2026).
  const need = card('need-1');
  assert.match(need, /<span class="pill bad sp">Needs you · 15 min<\/span>/);
  assert.match(need, /<div class="fcneed">\s*<b>Needs you<\/b>[\s\S]*Step<\/span><span>render<\/span>[\s\S]*Why<\/span><span>The voice file is missing<\/span>[\s\S]*Look at<\/span><span>D:\\videos\\need-1\\voice<\/span>[\s\S]*Since<\/span><span>Nov 11, [34]:45 PM<\/span>/);
  assert.ok(need.indexOf('fcneed') < need.indexOf('fcsteps'));
  // Waiting and done.
  assert.match(card('wait-1'), /<span class="pill  sp">Waiting · 9 min<\/span>[\s\S]*<p class="fcnow">Waiting to start\.<\/p>/);
  const done = card('done-1');
  assert.match(done, /<span class="pill ok sp">Done · 40 min<\/span>/);
  assert.match(done, /<span class="fcc done" role="listitem" title="pack, done, 31 min">pack · 31 min<\/span><span class="fcc done" role="listitem" title="render, done, 12 min">render · 12 min<\/span>/);
  assert.match(done, /class="fcrow fcfinal"><span class="mut">Finished file<\/span><span>D:\\videos\\done-1\\final\.mp4<\/span>/);
  // Events: newest first, Kelowna time, columns joined.
  const ev = html.slice(html.indexOf('Latest events'));
  assert.match(ev, /<div class="fcev first"><span class="mut">Nov 11, [34]:36 PM<\/span><span>nora-5 · pack · started · pid 2732<\/span><\/div>\s*<div class="fcev"><span class="mut">Nov 11, [34]:36 PM<\/span><span>nora-5 · job · created<\/span>/);
  assert.doesNotMatch(html, /undefined|NaN|null|—|music|sound design/i);
});

test('Factory page: stale and scheduler notices, the page clock, counts from the videos when the feed has none', () => {
  const stale = page(fresh({ at: S(400), stale: true }));
  assert.match(stale, /<p class="fcnote bad" role="status"><span class="dot r"><\/span>The video program is not reporting\. Its last report came 7 min ago/);
  assert.match(stale, /<div class="fclist fcstale">/);
  const off = page(fresh({ scheduler_running: false }));
  assert.match(off, /<p class="fcnote bad" role="status"><span class="dot r"><\/span>The scheduler is not running\./);
  assert.doesNotMatch(off, /not reporting/);
  const unknown = page(fresh({ scheduler_running: undefined }));
  assert.match(unknown, /<p class="fcnote grey"><span class="dot"><\/span>The video program did not say whether the scheduler is running\./);
  // ui.now (the shell's clock) moves "updated N s ago" between loads.
  assert.match(page(fresh(), { now: NOW + 15000 }), /updated 72 s ago/);
  assert.match(page(fresh({ updated: S(4000) })), /updated 67 min ago/);
  assert.deepEqual([agoShort(0), agoShort(89000), agoShort(90000), agoShort(3 * 3600000)], ['0 s ago', '89 s ago', '2 min ago', '3 hr ago']);
  assert.deepEqual([kelowna('2026-07-01T19:05:00Z'), kelowna('soon'), kelowna(null)], ['Jul 1, 12:05 PM', '', '']);
  const counted = page(fresh({ counts: undefined, unreadable_jobs: ['bad-1', 'bad-2'] }));
  assert.match(counted, /<b>5 videos<\/b><span class="pill">1 running<\/span><span class="pill ok">1 done<\/span><span class="pill bad">1 needs you<\/span>/);
  assert.match(counted, /2 videos could not be read: bad-1, bad-2/);
  // A video whose program is gone, a state the page does not know, and a needs-person state with no details.
  const odd = page(fresh({ counts: undefined, jobs: [
    { id: 'gone-1', state: 'running? (process gone)', step: 'pack', steps: [step('pack', 'running', { minutes: 50 })] },
    { id: 'odd-1', state: 'paused', steps: [step('pack', 'skipped')] },
    { id: 'np-1', state: 'NEEDS A PERSON', note: 'Pick a thumbnail', steps: [] },
  ] }));
  assert.deepEqual([...odd.matchAll(/data-job="([^"]+)"/g)].map((m) => m[1]), ['np-1', 'gone-1', 'odd-1']);
  assert.match(odd, /<span class="pill warn sp">Stopped<\/span>[\s\S]*This video says it is running, but the program working on it has stopped\./);
  assert.match(odd, /<span class="pill  sp">paused<\/span>[\s\S]*<span class="fcc other" role="listitem" title="pack, skipped">pack · skipped<\/span>/);
  assert.match(odd, /<div class="fcneed">\s*<b>Needs you<\/b>\s*<div class="fcrow"><span class="mut">Why<\/span><span>Pick a thumbnail<\/span>/);
  assert.match(odd, /<span class="pill">1 running<\/span><span class="pill ">0 done<\/span><span class="pill bad">1 needs you<\/span>/);
});

test('Factory page: feed text is escaped, and the empty and no-feed states', () => {
  const x = '<img src=x onerror=alert(1)>"\'&';
  const html = page(fresh({
    jobs: [{ id: x, channel: x, state: 'NEEDS A PERSON', step: x, minutes_in_state: x, note: x, final: x, needs_person: { step: x, why: x, look_at: x, since: x },
      steps: [{ name: x, status: 'running', minutes: 1, doing: x }, { name: x, status: 'failed', tries: 2, note: x, fix: x }, { name: x, status: x }] }],
    events: [x, `2026-11-11T23:36:42Z  ${x}`], unreadable_jobs: [x],
  }));
  assert.doesNotMatch(html, /<img|onerror=alert\(1\)>|"'&/);
  assert.ok((html.match(/&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/g) || []).length >= 15);
  const empty = page(fresh({ jobs: [], events: [], counts: { jobs: 0, done: 0, running: 0, needs_person: 0 } }));
  assert.match(empty, /<b>0 videos<\/b><span class="pill">0 running<\/span><span class="pill ">0 done<\/span><span class="pill ">0 need you<\/span>/);
  assert.match(empty, /<p class="mut">No videos are being made right now\.<\/p>/);
  assert.match(empty, /No events yet\./);
  for (const none of [page(null), renderFactory({ d3: {} }), renderFactory(null), renderFactory(undefined, undefined, undefined)]) {
    assert.match(none, /<h1>Factory<\/h1>[\s\S]*<p class="mut">No feed: the video program has not reported\.<\/p>/);
    assert.doesNotMatch(none, /undefined|NaN|Latest events/);
  }
});

test('Factory page: on the rail, in the shell with its 15 s reload, and its file is served', async () => {
  const index = readFileSync(new URL('../public/d3/index.html', import.meta.url), 'utf8');
  assert.match(index, /<a href="#factory" data-nav="factory">.*Factory<\/a>/);
  const app = readFileSync(new URL('../public/d3/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /factory: 'Factory'/);
  assert.match(app, /renderFactory\(d3, ui, d2\)/);
  assert.match(app, /page\(\) !== 'factory' \|\| document\.visibilityState !== 'visible'/);
  assert.match(app, /setInterval\(loadFactory, 15000\)/);
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  for (const rule of ['.d3 .fcc.run{', '.d3 .fcc.done{', '.d3 .fcc.fail{', '.d3 .fcneed{', '.d3 .fcnote.bad{']) assert.ok(css.includes(rule), rule);
  const res = await worker.fetch(new Request('https://jonmac.ai/dash/js/factory.js'), { SESSION_SECRET: SECRET, ASSETS: { fetch: async (r) => new Response(`asset:${new URL(r.url).pathname}`) } }, {});
  assert.equal(await res.text(), 'asset:/d3/js/factory.js');
});
