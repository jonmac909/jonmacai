// Dashboard 3 Factory page: the video_line feed (PUT /v1/feeds/video_line), the API part (d3.factory) and the page render.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import worker from '../src/worker.js';
import { signSession, COOKIE } from '../src/auth.js';
import { renderFactory, factoryJobs, factoryCols, factoryParts, kelowna } from '../public/d3/js/factory.js';

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

test('video_line feed: a step may carry done and total (whole numbers), kept as posted', async () => {
  const { env } = await setup();
  const B = BOARD();
  const withStep = (over) => ({ ...B, jobs: [{ ...B.jobs[2], steps: [{ ...B.jobs[2].steps[0], ...over }] }] });
  const ok = await put(env, 'developer', withStep({ done: 8, total: 11 }));
  assert.equal(ok.status, 201);
  assert.deepEqual([ok.body.feed.data.jobs[0].steps[0].done, ok.body.feed.data.jobs[0].steps[0].total], [8, 11]);
  const none = (await put(env, 'developer', withStep({ done: null }))).body.feed.data.jobs[0].steps[0];
  assert.ok(!('done' in none) && !('total' in none), 'left out when the step does not send them');
  for (const bad of [{ done: -1 }, { done: 1.5 }, { total: '11' }, { total: [11] }]) assert.equal((await put(env, 'developer', withStep(bad))).status, 400, JSON.stringify(bad));
});

const row = (html, id) => html.slice(html.indexOf(`<tr class="fyrow" data-id="${id}"`)).split('</tr>')[0];
const CHECK = /<span class="fyok" role="img" aria-label="Done"><svg[^>]*><path d="M5 13l4 4L19 7"\/><\/svg><\/span>/.source;
const IDLE = '<td class="fycell"><span class="fyidle" role="img" aria-label="Later step"></span></td>';

test('Factory page: the old Factory table, a row per video and a column per step', () => {
  const html = page(fresh());
  // Head, status pill and the one-line summary, as on the old page.
  assert.match(html, /<h1>Factory<\/h1><p class="mut">Every video in the new video program, step by step\. Updates on its own\.<\/p>/);
  assert.match(html, /<div class="fystatus sp" data-fy="status"><span class="fypill ok">Live · 10s ago<\/span><\/div>/);
  assert.match(html, /<p class="fysum"><span class="fylc on"><i class="fydot"><\/i><b>1<\/b> live now<\/span><span><b>2<\/b> Pack<\/span><span><b>1<\/b> Plan<\/span><span><b>1<\/b> Render<\/span><span><b>1<\/b> Done<\/span><span class="fypill crit">1 needs you<\/span><\/p>/);
  // Columns: the steps in pipeline order, capitalised, between Video and Waiting.
  assert.deepEqual(factoryCols(factoryJobs(fresh())), ['pack', 'plan', 'render']);
  assert.match(html, /<thead data-fy="cols"><tr><th>Video<\/th><th class="fycell">Pack<\/th><th class="fycell">Plan<\/th><th class="fycell">Render<\/th><th>Waiting<\/th><\/tr><\/thead>/);
  assert.match(html, /<table class="fytable" style="--fyn: 3">\s*<colgroup><col class="fyc1"><col class="fycs"><col class="fycs"><col class="fycs"><col class="fycw"><\/colgroup>/);
  // Rows: needs you, failed, running, waiting, done.
  assert.deepEqual(factoryJobs(fresh()).map((j) => j.id), ['need-1', 'fail-1', 'nora-5', 'wait-1', 'done-1']);
  assert.deepEqual([...html.matchAll(/<tr class="fyrow" data-id="([^"]+)" data-kind="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`), ['need-1:need', 'fail-1:fail', 'nora-5:run', 'wait-1:wait', 'done-1:done']);
  // Running: the unmeasured blue bar (no numbers on the step), the Live dot and what it is doing; the next step is a grey circle.
  const run = row(html, 'nora-5');
  assert.match(run, /<td><b>nora-5<\/b><small>nora<\/small><\/td>/);
  assert.match(run, /<td class="fycell fylv" title="after 8 of 11 pack checks; last: stills PASS all 198 stills on disk"><div class="fyrun"><div class="fypg ind" role="progressbar" aria-label="In progress"><i><\/i><\/div><span>In progress<\/span><\/div><span class="fylt"><i class="fydot"><\/i>Live<\/span><small class="fylx">after 8 of 11 pack checks; last: stills PASS all 198 stills on disk<\/small><\/td>/);
  assert.ok(run.includes(`${IDLE}<td class="fycell"></td><td class="fywait"><small>22m</small></td>`), 'plan waits (grey circle), this video has no render step, 22 minutes in its state');
  // Failed: the red X with the short reason; the full note and the fix sit in the tooltip.
  const fail = row(html, 'fail-1');
  assert.match(fail, new RegExp(`<td class="fycell">${CHECK}<small>30m</small></td><td class="fycell"><div class="fyfail" title="The plan had 3 scenes with no picture · Fix: Add pictures for scenes 4, 9 and 12, then run it again"><span class="fybad" role="img" aria-label="Failed">`));
  assert.match(fail, /<small>The plan had 3 scenes with no picture<\/small><\/div><\/td>/);
  assert.ok(fail.endsWith(`${IDLE}<td class="fywait"><small>3m</small></td>`));
  // Needs you: the red pill in the last column.
  assert.match(row(html, 'need-1'), /<td class="fywait"><span class="fypill crit">Needs you<\/span><small>15m<\/small><\/td>$/);
  // Waiting with no reason given: grey circles only.
  assert.ok(row(html, 'wait-1').includes(`<td><b>wait-1</b><small>nora</small></td>${IDLE}${IDLE}<td class="fycell"></td><td class="fywait"><small>9m</small></td>`));
  // Done: green checks with their minutes, a green Done pill; the finished file is only its tooltip.
  const done = row(html, 'done-1');
  assert.match(done, new RegExp(`${CHECK}<small>31m</small></td><td class="fycell"></td><td class="fycell">${CHECK}<small>12m</small></td>`));
  assert.match(done, /<td class="fywait"><span class="fypill ok" title="D:\\videos\\done-1\\final\.mp4">Done<\/span><small>40m<\/small><\/td>$/);
  assert.equal(html.split('final.mp4').length, 2, 'the file path appears once, as the tooltip');
  // Under the table: the Needs you list, then the events, newest first, Kelowna time (3 PM or 4 PM, by whether this
  // Node knows BC stopped changing its clocks in 2026).
  assert.match(html, /<section class="card fylist"><h2>Needs you<\/h2><p class="fyneed"><b>need-1<\/b><span>Render<\/span><span>The voice file is missing<\/span><span class="fylook">Look at D:\\videos\\need-1\\voice<\/span><\/p><\/section>/);
  assert.match(html, /<h2>Latest events <small class="mut">newest first, Kelowna time<\/small><\/h2><p class="fyev"><span>Nov 11, [34]:36 PM<\/span>nora-5 · pack · started · pid 2732<\/p><p class="fyev"><span>Nov 11, [34]:36 PM<\/span>nora-5 · job · created<\/p><\/section>/);
  assert.ok(html.indexOf('</table>') < html.indexOf('Needs you</h2>') && html.indexOf('Needs you</h2>') < html.indexOf('Latest events'));
  assert.doesNotMatch(html, /undefined|NaN|null|—|music|sound design/i);
});

test('Factory page: measured progress, a reason to wait, long times, oldest first inside a group', () => {
  const B = BOARD();
  const html = page(fresh({ jobs: [
    { id: 'b-new', channel: 'x', state: 'running', created: '2026-11-11T23:00:00Z', minutes_in_state: '135', steps: [step('pack', 'running', { done: 8, total: 11, doing: 'checking stills' }), step('plan', 'todo')] },
    { id: 'a-old', channel: 'x', state: 'running', created: '2026-11-11T20:00:00Z', minutes_in_state: 'soon', steps: [step('pack', 'running', { done: 30, total: 11 }), step('plan', 'todo', { note: 'Starts when the pack is checked' })] },
    { id: 'c-wait', channel: 'x', state: 'todo', note: 'Waiting for b-new to finish its pack: one pack is built at a time, and this is a long reason', steps: [step('pack', 'todo'), step('plan', 'todo')] },
    { id: 'd-fail', channel: 'x', state: 'failed', steps: [step('pack', 'failed', { tries: 3 }), step('plan', 'todo')] },
    { id: 'e-done', channel: 'x', state: 'done', minutes_in_state: '59', final: '', steps: [step('pack', 'done', { minutes: 125 }), step('plan', 'done')] },
  ], events: Array.from({ length: 15 }, (_, i) => `e${i}`) }));
  assert.deepEqual([...html.matchAll(/<tr class="fyrow" data-id="([^"]+)"/g)].map((m) => m[1]), ['d-fail', 'a-old', 'b-new', 'c-wait', 'e-done']);
  assert.match(row(html, 'b-new'), /<div class="fyrun"><div class="fypg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="73"><i style="width:73%"><\/i><\/div><span>8\/11<\/span><\/div><span class="fylt"><i class="fydot"><\/i>Live<\/span><small class="fylx">checking stills<\/small>/);
  assert.match(row(html, 'b-new'), /<td class="fywait"><small>2h 15m<\/small><\/td>$/);
  assert.match(row(html, 'a-old'), /aria-valuenow="100"><i style="width:100%"><\/i><\/div><span>11\/11<\/span>/); // never past the total
  assert.match(row(html, 'a-old'), /<td class="fycell" title="Starts when the pack is checked"><span class="fynew">Waiting<\/span><small class="fywhy">Starts when the pack is checked<\/small><\/td><td class="fywait"><small><\/small><\/td>$/);
  // The first step of a waiting video carries the video's own reason: full in the tooltip, one short line under "Waiting".
  assert.match(row(html, 'c-wait'), /<td class="fycell" title="Waiting for b-new to finish its pack: one pack is built at a time, and this is a long reason"><span class="fynew">Waiting<\/span><small class="fywhy">Waiting for b-new to finish its pack: one pac…<\/small><\/td><td class="fycell"><span class="fyidle"/);
  assert.match(row(html, 'd-fail'), /<div class="fyfail" title=""><span class="fybad"[\s\S]*<small>Failed, try 3<\/small>/);
  assert.match(row(html, 'e-done'), /<small>2h 5m<\/small><\/td><td class="fycell"><span class="fyok"[^>]*><svg[^>]*><path[^>]*><\/svg><\/span><\/td><td class="fywait"><span class="fypill ok">Done<\/span><small>59m<\/small>/);
  assert.match(html, /<span class="fylc on"><i class="fydot"><\/i><b>2<\/b> live now<\/span><span><b>4<\/b> Pack<\/span><span class="z"><b>0<\/b> Plan<\/span><span><b>1<\/b> Done<\/span><span class="fypill ok">0 need you<\/span>/);
  assert.match(html, /<div data-fy="needs"><\/div>/, 'no Needs you list when nobody is needed');
  assert.equal((html.match(/<p class="fyev">/g) || []).length, 12, 'at most 12 events');
  assert.match(html, /<p class="fyev"><span><\/span>e14<\/p><p class="fyev"><span><\/span>e13<\/p>/);
  assert.equal(B.jobs.length, 5);
});

test('Factory page: stale, scheduler stopped, not publishing, empty, unreadable videos', () => {
  const stale = page(fresh({ at: S(260), stale: true }));
  assert.match(stale, /<span class="fypill crit">Stale: last update 4m ago<\/span>/);
  assert.doesNotMatch(stale, /fylv|fylt/, 'a stale board shows nothing as live');
  assert.match(stale, /<span class="fylc"><i class="fydot"><\/i><b>0<\/b> live now<\/span>/);
  assert.match(row(stale, 'nora-5'), /<td class="fycell" title="after 8 of 11[^"]*"><div class="fyrun">[\s\S]*<small class="fylx">after 8 of 11/); // still says what it was doing
  assert.match(page(fresh({ at: S(100) })), /Live · 100s ago/);
  assert.match(page(fresh(), { now: NOW + 15000 }), /Live · 25s ago/); // the shell's clock ages the pill between loads
  assert.match(page(fresh({ at: S(100) }), { now: NOW + 200000 }), /Stale: last update 5m ago/); // old on the page's clock, whatever the server said
  const off = page(fresh({ scheduler_running: false }));
  assert.match(off, /data-fy="status"><span class="fypill ok">Live · 10s ago<\/span><span class="fypill crit">Scheduler stopped<\/span><\/div>/);
  assert.doesNotMatch(page(fresh({ scheduler_running: undefined })), /Scheduler stopped/);
  for (const none of [page(null), renderFactory({ d3: {} }), renderFactory(null), renderFactory(undefined, undefined)]) {
    assert.match(none, /<h1>Factory<\/h1>[\s\S]*<span class="fypill crit">Not publishing yet<\/span>[\s\S]*<p class="mut">No feed: the video program has not posted its board yet\.<\/p>/);
    assert.doesNotMatch(none, /undefined|NaN|fytable|Latest events/);
  }
  const empty = page(fresh({ jobs: [], events: [], unreadable_jobs: ['bad-1', 'bad-2'] }));
  assert.match(empty, /<thead data-fy="cols"><tr><th>Video<\/th><th>Waiting<\/th><\/tr><\/thead>/);
  assert.match(empty, /<tr class="fyrow" data-id="_empty"><td colspan="2" class="mut">No videos in the program right now\.<\/td><\/tr>/);
  assert.match(empty, /<span class="fylc"><i class="fydot"><\/i><b>0<\/b> live now<\/span><span class="z"><b>0<\/b> Done<\/span><span class="fypill ok">0 need you<\/span>/);
  assert.match(empty, /<p class="mut">2 videos could not be read: bad-1, bad-2<\/p>/);
  assert.match(empty, /No events yet\./);
  // A video whose program is gone stays with the running ones; a needs-person state with no details still lists.
  const odd = page(fresh({ jobs: [
    { id: 'gone-1', state: 'running? (process gone)', step: 'pack', steps: [step('pack', 'running', { minutes: 50 })] },
    { id: 'np-1', state: 'NEEDS A PERSON', step: 'plan', note: 'Pick a thumbnail', steps: [step('pack', 'done'), step('plan', 'todo')] },
    { id: 'np-1', state: 'todo', steps: [step('pack', 'skipped')] },
  ] }));
  assert.deepEqual([...odd.matchAll(/<tr class="fyrow" data-id="([^"]+)" data-kind="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`), ['np-1:need', 'gone-1:run', 'np-1#1:wait']); // one id twice: two rows
  assert.match(odd, /<p class="fyneed"><b>np-1<\/b><span>Plan<\/span><span>Pick a thumbnail<\/span><span class="fylook"><\/span><\/p>/);
});

test('Factory page: feed text is escaped everywhere', () => {
  const x = '<img src=x onerror=alert(1)>"\'&';
  const html = page(fresh({
    jobs: [{ id: x, channel: x, state: 'NEEDS A PERSON', step: x, minutes_in_state: x, note: x, final: x, needs_person: { step: x, why: x, look_at: x, since: x },
      steps: [{ name: x, status: 'running', minutes: 1, doing: x }, { name: `${x}2`, status: 'failed', tries: 2, note: x, fix: x }, { name: `${x}3`, status: x, note: x }] },
    { id: 'ok', channel: x, state: 'done', final: x, steps: [{ name: x, status: 'done', minutes: 3 }] }],
    events: [x, `2026-11-11T23:36:42Z  ${x}`], unreadable_jobs: [x],
  }));
  assert.doesNotMatch(html, /<img|onerror=alert\(1\)>|"'&/);
  assert.ok((html.match(/&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/g) || []).length >= 15);
  assert.match(html, /<th class="fycell">&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;<\/th>/);
});

test('Factory and Track: together on the rail, in the shell (15 s reload, no-jump refresh), files served', async () => {
  const index = readFileSync(new URL('../public/d3/index.html', import.meta.url), 'utf8');
  assert.match(index, /<a href="#team" data-nav="team">.*\n<a href="#factory" data-nav="factory">.*Factory<\/a>\n<a href="#track" data-nav="track">.*Track<\/a>\n<a href="#blockers"/);
  const app = readFileSync(new URL('../public/d3/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /factory: 'Factory', track: 'Track'/);
  assert.match(app, /const html = renderFactory\(S\.d3, S\.ui\);\s*if \(S\.fyNote !== note \|\| !syncFactory\(main, html\)\) main\.innerHTML/);
  assert.match(app, /page\(\) !== 'factory' \|\| document\.visibilityState !== 'visible'/);
  assert.match(app, /setInterval\(loadFactory, 15000\)/);
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  for (const rule of ['.d3 .fytblwrap{overflow-x:auto}', '.d3 .fytable td.fylv{', '.d3 .fypg.ind i{', '.d3 .fypill.crit{', '.d3 .fyidle{', '.d3 .tkpage td.num{', '.d3 .tkpage .chip{']) assert.ok(css.includes(rule), rule);
  assert.doesNotMatch(css, /\.d3 \.fc(c|need|job|steps)\b/, 'the first Factory look is gone');
  assert.doesNotMatch(css.slice(css.indexOf('/* Factory page')), /#(?!ffffff|7c3aed|0f766e|c4b5fd|5eead4)[0-9a-f]{6}\b/i, 'Factory uses the theme variables, so it follows light and dark');
  const env = { SESSION_SECRET: SECRET, ASSETS: { fetch: async (r) => new Response(`asset:${new URL(r.url).pathname}`) } };
  for (const [path, want] of [['/dash/js/factory.js', 'asset:/d3/js/factory.js'], ['/dash/js/track.js', 'asset:/d3/js/track.js'], ['/dashboard/js/pages/track.js', 'asset:/js/pages/track.js']]) {
    assert.equal(await (await worker.fetch(new Request(`https://jonmac.ai${path}`), env, {})).text(), want, path);
  }
});

// ---- parts: a step's own sub-steps, a column each ----
const P = (name, status = 'done', note = '') => ({ name, status, note });

test('video_line feed: a step may carry parts, kept whole; a part that is not right is a 400, never dropped', async () => {
  const { env } = await setup();
  const B = BOARD();
  const withParts = (parts) => ({ ...B, jobs: [{ ...B.jobs[2], steps: [{ ...B.jobs[2].steps[0], parts }] }] });
  const sent = [P('Host video', 'done', '14 min, 1080p'), P('Stills', 'running', 'Checking 61 of 198'), P('Clips', 'waiting', 'Waits for stills'), P('Preflight', 'failed', 'x'.repeat(300)), { name: 'Pack sheet', status: 'todo' }, { name: ' N'.padEnd(40, 'n'), status: 'todo', note: null }];
  const ok = await put(env, 'developer', withParts(sent));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.feed.data.jobs[0].steps[0].parts, [...sent.slice(0, 4), P('Pack sheet', 'todo'), P('N'.padEnd(39, 'n'), 'todo')]);
  assert.equal((await put(env, 'developer', withParts(Array.from({ length: 30 }, (_, i) => P(`p${i}`))))).body.feed.data.jobs[0].steps[0].parts.length, 30);
  assert.deepEqual((await put(env, 'developer', withParts([]))).body.feed.data.jobs[0].steps[0].parts, []);
  const none = (await put(env, 'developer', withParts(null))).body.feed.data.jobs[0].steps[0];
  assert.ok(!('parts' in none), 'left out when the step does not send parts');
  const bad = [
    'parts', { 0: P('a') }, [null], ['Host video'], [[]],
    [{ status: 'done' }], [P('')], [P('   ')], [P(7)], [P('x'.repeat(41))],
    [{ name: 'a' }], [P('a', 'DONE')], [P('a', 'skipped')], [P('a', '')], [P('a', 1)],
    [P('a', 'done', 7)], [P('a', 'done', ['x'])], [P('a', 'done', 'x'.repeat(301))],
    [P('ok'), P('a', 'nope')], Array.from({ length: 31 }, (_, i) => P(`p${i}`)),
  ];
  for (const parts of bad) {
    const r = await put(env, 'developer', withParts(parts));
    assert.equal(r.status, 400, JSON.stringify(parts).slice(0, 80));
    assert.match(r.body.error, /parts/);
  }
  // The d3 answer hands the parts to the page as posted.
  await put(env, 'developer', withParts(sent.slice(0, 2)));
  assert.deepEqual((await d3Of(env.DB)).d3.factory.jobs[0].steps[0].parts, sent.slice(0, 2));
});

const PARTS_BOARD = () => fresh({ jobs: [
  { id: 'run-1', channel: 'nora', state: 'running', created: '2026-11-11T23:00:00Z', minutes_in_state: '22', steps: [
    step('pack', 'running', { minutes: 22, done: 2, total: 4, doing: 'after 2 of 4 pack checks', parts: [P('Host video', 'done', '14 min, 1080p'), P('Stills', 'done'), P('Picture check', 'running', 'Checking pictures: 61 of 198'), P('Pack sheet', 'todo')] }),
    step('plan', 'todo', { parts: [P('A-roll', 'todo'), P('Words', 'todo')] }),
    step('gates', 'todo', { parts: [P('qc_precheck', 'todo'), P('look_match', 'todo')] }),
  ] },
  { id: 'fail-1', channel: 'rosa', state: 'failed', created: '2026-11-11T22:00:00Z', minutes_in_state: '12', steps: [
    step('pack', 'done', { minutes: 28, parts: [P('Host video'), P('Stills'), P('Clips', 'done', '29 clips'), P('Picture check'), P('Pack sheet')] }),
    step('plan', 'failed', { tries: 2, minutes: 4, note: 'The plan had 3 scenes with no picture', fix: 'Add pictures', parts: [P('A-roll'), P('Words', 'failed', '3 scenes with no picture')] }),
    step('gates', 'todo'), // no parts on this step: its one cell, as before
  ] },
  { id: 'wait-1', channel: 'jack', state: 'todo', created: '2026-11-11T23:30:00Z', note: 'Waiting for run-1 to finish its pack', steps: [
    step('pack', 'todo', { parts: [P('Host video', 'waiting', 'Waits for run-1: one pack at a time'), P('Stills', 'todo')] }),
    step('plan', 'todo'),
  ] },
] });

test('Factory page with parts: a column per part under its step, the step\'s own line above its parts', () => {
  const F = PARTS_BOARD();
  const jobs = factoryJobs(F);
  const cols = factoryCols(jobs);
  assert.deepEqual(cols, ['pack', 'plan', 'gates']);
  // Part columns: every name the videos send for a step, in working order ("Clips" is only on the second video).
  assert.deepEqual(factoryParts(jobs, cols), [['Host video', 'Stills', 'Clips', 'Picture check', 'Pack sheet'], ['A-roll', 'Words'], ['qc_precheck', 'look_match']]);
  const html = page(F);
  assert.match(html, /<table class="fytable fyw" style="--fyn: 0; --fyp: 9">\s*<colgroup><col class="fyc1">(<col class="fycp">){9}<col class="fycw"><\/colgroup>/);
  // Two heading rows: the steps spanning their parts, then the part names (underscores read as spaces).
  assert.match(html, /<thead data-fy="cols"><tr><th class="fyh1" rowspan="2">Video<\/th><th class="fygrp fyg1" colspan="5"><span>Pack<\/span><\/th><th class="fygrp fyg1" colspan="2"><span>Plan<\/span><\/th><th class="fygrp fyg1" colspan="2"><span>Gates<\/span><\/th><th class="fyhw" rowspan="2">Waiting<\/th><\/tr>\s*<tr><th class="fypt fyg1">Host video<\/th><th class="fypt">Stills<\/th><th class="fypt">Clips<\/th><th class="fypt">Picture check<\/th><th class="fypt">Pack sheet<\/th><th class="fypt fyg1">A-roll<\/th><th class="fypt">Words<\/th><th class="fypt fyg1">Qc precheck<\/th><th class="fypt">Look match<\/th><\/tr><\/thead>/);
  // Each video is two rows: "id" (video, each step's line, state) and "id~parts" (the part cells). Order as before.
  assert.deepEqual([...html.matchAll(/<tr class="fyrow fy(top|low)" data-id="([^"]+)" data-kind="([^"]+)"/g)].map((m) => `${m[2]}:${m[3]}`), ['fail-1:fail', 'fail-1~parts:fail', 'run-1:run', 'run-1~parts:run', 'wait-1:wait', 'wait-1~parts:wait']);
  const top = (id) => html.slice(html.indexOf(`<tr class="fyrow fytop" data-id="${id}"`)).split('</tr>')[0];
  const low = (id) => html.slice(html.indexOf(`<tr class="fyrow fylow" data-id="${id}~parts"`)).split('</tr>')[0];
  const ICON = (cls, label) => `<span class="${cls}" role="img" aria-label="${label}"><svg viewBox="0 0 24 24" width="16" height="16"[^>]*><path[^>]*/></svg></span>`;
  const TODO = '<span class="fyidle" role="img" aria-label="Not started"></span>';

  // Running: the measured bar, the step's minutes, Live and what it is doing stay visible on the step's line.
  assert.match(top('run-1'), /^<tr[^>]*><td class="fyvid" rowspan="2"><b>run-1<\/b><small>nora<\/small><\/td><td class="fystg fyg1 fylv" colspan="5" title="after 2 of 4 pack checks"><div class="fysl"><div class="fypg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><i style="width:50%"><\/i><\/div><b>2\/4<\/b><span>22m<\/span><span class="fylt"><i class="fydot"><\/i>Live<\/span><small class="fylx">after 2 of 4 pack checks<\/small><\/div><\/td><td class="fystg fyg1" colspan="2"><div class="fysl"><\/div><\/td><td class="fystg fyg1" colspan="2"><div class="fysl"><\/div><\/td><td class="fywait" rowspan="2"><small>22m<\/small><\/td>$/);
  // Its parts: done (the result line is the tooltip), a part this video does not have (blank), running, not started.
  assert.match(low('run-1'), new RegExp(`^<tr[^>]*><td class="fyp fyg1" title="14 min, 1080p">${ICON('fyok', 'Done')}</td><td class="fyp">${ICON('fyok', 'Done')}</td><td class="fyp"></td><td class="fyp fyprun" title="Checking pictures: 61 of 198"><div class="fypg ind" role="progressbar" aria-label="Running"><i></i></div><small>Checking pictures: 61 of 198</small></td><td class="fyp">${TODO}</td><td class="fyp fyg1">${TODO}</td><td class="fyp">${TODO}</td><td class="fyp fyg1">${TODO}</td><td class="fyp">${TODO}</td>$`));
  // Done step: its time on the line. Failed step: "Failed, try 2", minutes and the reason (the fix in the tooltip);
  // the failed part: red X with its reason. A step with no parts keeps its one cell across both rows.
  assert.match(top('fail-1'), new RegExp(`<td class="fystg fyg1" colspan="5"><div class="fysl"><span class="fyok" role="img" aria-label="Done"><svg viewBox="0 0 24 24" width="14" height="14"[^>]*><path[^>]*/></svg></span><b>28m</b></div></td><td class="fystg fyg1 fysbad" colspan="2" title="The plan had 3 scenes with no picture · Fix: Add pictures"><div class="fysl"><span class="fybad"[^>]*><svg[^>]*><path[^>]*/></svg></span><b>Failed, try 2</b><span>4m</span><small>The plan had 3 scenes with no picture</small></div></td><td colspan="2" rowspan="2" class="fycell fyg1"><span class="fyidle" role="img" aria-label="Later step"></span></td><td class="fywait" rowspan="2"><small>12m</small></td>$`));
  assert.match(low('fail-1'), new RegExp(`<td class="fyp" title="29 clips">${ICON('fyok', 'Done')}</td>`));
  assert.match(low('fail-1'), new RegExp(`<td class="fyp fyg1">${ICON('fyok', 'Done')}</td><td class="fyp fypbad" title="3 scenes with no picture">${ICON('fybad', 'Failed')}<small>3 scenes with no picture</small></td>$`));
  assert.equal((low('fail-1').match(/<td/g) || []).length, 7, 'five pack parts and two plan parts; gates is the one cell above');
  // Waiting: the step's line carries the video's reason, the part an amber clock and its own reason. A step with no
  // parts on this video (plan) and a step this video does not have (gates) each span their columns.
  assert.match(top('wait-1'), /<td class="fystg fyg1" colspan="5" title="Waiting for run-1 to finish its pack"><div class="fysl"><span class="fynew">Waiting<\/span><small class="fywhy">Waiting for run-1 to finish its pack<\/small><\/div><\/td><td colspan="2" rowspan="2" class="fycell fyg1"><span class="fyidle" role="img" aria-label="Later step"><\/span><\/td><td colspan="2" rowspan="2" class="fycell fyg1"><\/td><td class="fywait" rowspan="2"><small><\/small><\/td>$/);
  assert.match(low('wait-1'), new RegExp(`^<tr[^>]*><td class="fyp fypwait fyg1" title="Waits for run-1: one pack at a time">${ICON('fywt', 'Waiting')}<small>Waits for run-1: one pack at a time</small></td><td class="fyp">${TODO}</td><td class="fyp"></td><td class="fyp"></td><td class="fyp"></td>$`));
  // The summary still counts by step.
  assert.match(html, /<b>1<\/b> live now<\/span><span><b>2<\/b> Pack<\/span><span><b>1<\/b> Plan<\/span><span class="z"><b>0<\/b> Gates<\/span>/);
  assert.doesNotMatch(html, /undefined|NaN|null|—/);
});

test('Factory page with parts: stale, unmeasured, mixed with a step no video sends parts for, escaped, old boards unchanged', () => {
  // Stale: nothing reads as live, the bars stand still.
  const stale = page({ ...PARTS_BOARD(), at: S(260), stale: true });
  assert.doesNotMatch(stale, /fylv|fylt|fypg ind/);
  assert.match(stale, /<td class="fyp fyprun"[^>]*><div class="fypg off" role="progressbar" aria-label="Running">/);
  // No done/total: the moving bar that reads "In progress".
  const B = PARTS_BOARD();
  delete B.jobs[0].steps[0].done; delete B.jobs[0].steps[0].total;
  assert.match(page(B), /<div class="fysl"><div class="fypg ind" role="progressbar" aria-label="In progress"><i><\/i><\/div><b>In progress<\/b><span>22m<\/span>/);
  // A step no video sends parts for keeps one 9rem column and one heading over both heading rows; parts: [] is no parts.
  const mixed = page(fresh({ jobs: [{ id: 'm-1', state: 'running', steps: [step('pack', 'done', { minutes: 31, parts: [P('Stills'), P('Clips')] }), step('render', 'running', { minutes: 5, parts: [] }), step('gates', 'todo')] }] }));
  assert.match(mixed, /<table class="fytable fyw" style="--fyn: 2; --fyp: 2">\s*<colgroup><col class="fyc1"><col class="fycp"><col class="fycp"><col class="fycs"><col class="fycs"><col class="fycw"><\/colgroup>/);
  assert.match(mixed, /<th class="fygrp fyg1" colspan="2"><span>Pack<\/span><\/th><th class="fycell fyg1" rowspan="2">Render<\/th><th class="fycell fyg1" rowspan="2">Gates<\/th>/);
  assert.match(mixed, /<td colspan="1" rowspan="2" class="fycell fyg1 fylv"><div class="fyrun"><div class="fypg ind"/);
  // Feed text is data in every new place: part names, notes, tooltips.
  const x = '<img src=x onerror=alert(1)>"\'&';
  const esc = page(fresh({ jobs: [{ id: 'e-1', state: 'running', steps: [{ name: x, status: 'running', doing: x, parts: [{ name: x, status: 'failed', note: x }, { name: `${x}2`, status: 'waiting', note: x }, { name: `${x}3`, status: 'running', note: x }, { name: `${x}4`, status: x, note: x }] }] }] }));
  assert.doesNotMatch(esc, /<img|onerror=alert\(1\)>|"'&/);
  assert.ok((esc.match(/&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/g) || []).length >= 14);
  // A board with no parts anywhere draws exactly the single-cell table.
  const old = page(fresh());
  assert.match(old, /<table class="fytable" style="--fyn: 3">/);
  assert.doesNotMatch(old, /fytable fyw|fytop|fylow|fystg|~parts|rowspan/);
  // Empty board: still the plain table.
  assert.match(page(fresh({ jobs: [] })), /<td colspan="2" class="mut">No videos in the program right now\.<\/td>/);
});

test('Factory with parts: styles for the wide table, sticky video column, phone width', () => {
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  for (const rule of ['.d3 .fytable col.fycp{width:4.7rem}', '.d3 .fytable.fyw th.fyh1,.d3 .fytable.fyw td.fyvid{position:sticky;left:0;z-index:2}', '.d3 .fytable.fyw th.fyhw,.d3 .fytable.fyw td.fywait{position:sticky;right:0;', '.d3 .fytable.fyw th.fygrp span,.d3 .fysl{position:sticky;', '.d3 .fywt{color:var(--warn)}', '.d3 .fytblwrap{overflow-x:auto}']) assert.ok(css.includes(rule), rule);
  assert.match(css, /@media \(max-width:700px\)\{\n\.d3 \.fytable\.fyw\{--fyc1:6\.2rem\}/);
  const src = readFileSync(new URL('../public/d3/js/factory.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Host video|Source map|Loudness|qc_precheck/, 'part names come from the board, never from the page');
});
