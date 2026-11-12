// Dashboard 3 Factory page: the video_line feed (PUT /v1/feeds/video_line), the API part (d3.factory) and the page render.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { sha256Hex, FEEDS, feedKeepMs } from '../src/bots.js';
import worker from '../src/worker.js';
import { signSession, COOKIE } from '../src/auth.js';
import { renderFactory, factoryJobs, factoryCols, factoryParts, factoryChannels, totalMinutes, took, clock, kelowna } from '../public/d3/js/factory.js';

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

test('video_line feed: developer or ana post it, the board is kept as posted, the last 30 minutes are kept', async () => {
  const { db, env } = await setup();
  assert.equal((await put(env, 'sponsors', BOARD())).status, 403);
  assert.equal((await put(env, 'video-editor', BOARD())).status, 403);
  // "now" for the feed is the real clock, so these ages are counted from it.
  const aged = (id, min) => db.sqlite.prepare('INSERT INTO bot_feed_entries (id, name, bot, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, id === 'f_other' ? 'dispatch_live' : 'video_line', 'developer', '{}', new Date(Date.now() - min * 60000).toISOString());
  aged('f_old', 2 * 1440); aged('f_31', 31); aged('f_29', 29); aged('f_other', 31);
  const ok = await put(env, 'developer', BOARD());
  assert.equal(ok.status, 201);
  // Times come back in the server's ISO form (with milliseconds); everything else is as posted. A video that sends no
  // whole time gets an empty one (started, ended and total_minutes are null).
  const want = JSON.parse(JSON.stringify(BOARD()).replace(/(T\d\d:\d\d:\d\d)Z"/g, '$1.000Z"'));
  want.jobs = want.jobs.map((j) => ({ ...j, started: null, ended: null, total_minutes: null }));
  assert.deepEqual(ok.body.feed.data, want, 'a good board comes back unchanged');
  assert.equal((await put(env, 'ana', { ...BOARD(), scheduler_running: null })).body.feed.data.scheduler_running, undefined); // null is not stored
  const left = (await db.prepare("SELECT id FROM bot_feed_entries WHERE id IN ('f_old', 'f_31', 'f_29', 'f_other') ORDER BY id").all()).results.map((r) => r.id);
  assert.deepEqual(left, ['f_29', 'f_other'], 'video_line entries older than 30 minutes are dropped; other feeds are not touched');
  // The rule itself: minutes win over days, neither keeps everything.
  assert.equal(FEEDS.video_line.keepMinutes, 30);
  assert.deepEqual([feedKeepMs(FEEDS.video_line), feedKeepMs(FEEDS.dispatch_live), feedKeepMs({ keepMinutes: 5, keepDays: 1 }), feedKeepMs({}), feedKeepMs(undefined)], [30 * 60000, 2 * 86400000, 5 * 60000, 0, 0]);
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

test('video_line feed: long input is cut, not refused (60 videos, 20 steps and 20 stages, newest 20 events, 300 characters)', async () => {
  const { env } = await setup();
  const B = BOARD();
  const long = 'x'.repeat(500);
  const big = {
    ...B,
    // Only the first video carries long text: the whole request must stay under the API's 256 KB body limit.
    // The second video carries 25 stages; the others 15 steps, which are all kept.
    jobs: Array.from({ length: 70 }, (_, i) => (i ? { ...B.jobs[2], id: `v${i}`, steps: Array.from({ length: 15 }, (_x, n) => step(`s${n}`, 'todo')), ...(i === 1 ? { stages: Array.from({ length: 25 }, (_x, n) => step(`g${n}`, 'todo', { label: long })) } : {}) }
      : { ...B.jobs[2], id: 'v0', channel: long, pipeline: long, state: long, step: long, minutes_in_state: long, note: long, final: long, needs_person: { step: long, why: long, look_at: long, since: long },
        steps: Array.from({ length: 25 }, (_x, n) => step(`s${n}${long}`, long, { note: long, fix: long, doing: long })) })),
    events: Array.from({ length: 30 }, (_, i) => `e${i} ${long}`),
    unreadable_jobs: Array.from({ length: 70 }, (_, i) => (i ? `u${i}` : long)),
  };
  const r = await put(env, 'developer', big);
  assert.equal(r.status, 201);
  const d = r.body.feed.data;
  assert.deepEqual([d.jobs.length, d.jobs[0].steps.length, d.events.length, d.unreadable_jobs.length], [60, 20, 20, 60]);
  assert.deepEqual([d.jobs[1].steps.length, d.jobs[1].stages.length, d.jobs[1].stages[19].name, d.jobs[1].stages[0].label.length], [15, 20, 'g19', 40], 'stages are cut at 20, a label at 40 characters');
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
  assert.match(html, /<h1>Factory<\/h1><p class="mut">Every video in the new video program, stage by stage\. Updates on its own\.<\/p>/);
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

test('Factory and Track: together on the rail, in the shell (3 s board read, 1 s clock, no-jump refresh), files served', async () => {
  const index = readFileSync(new URL('../public/d3/index.html', import.meta.url), 'utf8');
  assert.match(index, /<a href="#team" data-nav="team">.*\n<a href="#factory" data-nav="factory">.*Factory<\/a>\n<a href="#track" data-nav="track">.*Track<\/a>\n<a href="#blockers"/);
  const app = readFileSync(new URL('../public/d3/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /factory: 'Factory', track: 'Track'/);
  assert.match(app, /const html = renderFactory\(S\.d3, S\.ui\);\s*if \(S\.fyNote !== note \|\| !syncFactory\(main, html\)\) main\.innerHTML/);
  assert.match(app, /page\(\) !== 'factory' \|\| document\.visibilityState !== 'visible'/);
  assert.match(app, /getJson\('\/dashboard\/api\/d3\/factory'\)/);
  assert.match(app, /setInterval\(loadFactory, 3000\)/);
  assert.match(app, /setInterval\(\(\) => \{ if \(S\.d3 && !S\.signedOut && page\(\) === 'factory' && document\.visibilityState === 'visible'\) render\(\); \}, 1000\)/);
  assert.match(app, /setInterval\(\(\) => \{ if \(document\.visibilityState === 'visible'\) load\(\); \}, 60000\)/, 'the slower full reload stays');
  // The no-jump refresh touches only what differs and keeps the rows it has.
  const fy = readFileSync(new URL('../public/d3/js/factory.js', import.meta.url), 'utf8');
  assert.match(fy, /const tr = have\.get\(n\.dataset\.id\);\s*if \(tr\) morph\(tr, n\);/);
  assert.match(fy, /if \(a\.nodeType !== 1\) \{ if \(a\.data !== b\.data\) a\.data = b\.data; return; \}/);
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

const top = (html, id) => html.slice(html.indexOf(`<tr class="fyrow fytop" data-id="${id}"`)).split('</tr>')[0];
const low = (html, id) => html.slice(html.indexOf(`<tr class="fyrow fylow" data-id="${id}~parts"`)).split('</tr>')[0];
const ICON = (cls, label) => `<span class="${cls}" role="img" aria-label="${label}"><svg viewBox="0 0 24 24" width="12" height="12"[^>]*><path[^>]*/></svg></span>`;
const BAR = (cls, label) => `<div class="fypb${cls ? ` ${cls}` : ''}" role="img" aria-label="${label}">${cls ? '<i></i>' : ''}</div>`;
const TODO = BAR('', 'Not started');
const DONE = `${BAR('ok', 'Done')}<span class="fypl">${ICON('fyok', 'Done')}</span>`;
const SUM = (d, n, cls = '') => `<div class="fysb${cls}" role="img" aria-label="${d} of ${n} done"><i style="width:${Math.round((d / n) * 1000) / 10}%"></i></div><b>${d}/${n}</b>`;

test('Factory page with parts: a column per part under its step, a plain summary per step above its parts', () => {
  const F = PARTS_BOARD();
  const jobs = factoryJobs(F);
  const cols = factoryCols(jobs);
  assert.deepEqual(cols, ['pack', 'plan', 'gates']);
  // Part columns: every name the videos send for a step, in working order ("Clips" is only on the second video).
  assert.deepEqual(factoryParts(jobs, cols), [['Host video', 'Stills', 'Clips', 'Picture check', 'Pack sheet'], ['A-roll', 'Words'], ['qc_precheck', 'look_match']]);
  const html = page(F);
  assert.match(html, /<table class="fytable fyw" style="--fyn: 0; --fyp: 9">\s*<colgroup><col class="fyc1">(<col class="fycp">){9}<col class="fycw"><\/colgroup>/);
  // Two heading rows: the steps spanning their parts, then the part names (underscores read as spaces).
  assert.match(html, /<thead data-fy="cols"><tr><th class="fyh1" rowspan="2">Video<\/th><th class="fygrp fyg1" colspan="5">Pack<\/th><th class="fygrp fyg1" colspan="2">Plan<\/th><th class="fygrp fyg1" colspan="2">Gates<\/th><th class="fyhw" rowspan="2">Waiting<\/th><\/tr>\s*<tr><th class="fypt fyg1">Host video<\/th><th class="fypt">Stills<\/th><th class="fypt">Clips<\/th><th class="fypt">Picture check<\/th><th class="fypt">Pack sheet<\/th><th class="fypt fyg1">A-roll<\/th><th class="fypt">Words<\/th><th class="fypt fyg1">Qc precheck<\/th><th class="fypt">Look match<\/th><\/tr><\/thead>/);
  // Each video is two rows: "id" (video, each step's summary, state) and "id~parts" (the part cells). Order as before.
  assert.deepEqual([...html.matchAll(/<tr class="fyrow fy(top|low)" data-id="([^"]+)" data-kind="([^"]+)"/g)].map((m) => `${m[2]}:${m[3]}`), ['fail-1:fail', 'fail-1~parts:fail', 'run-1:run', 'run-1~parts:run', 'wait-1:wait', 'wait-1~parts:wait']);

  // Running step: parts done out of parts (2 of this video's 4), the count and the step's minutes. No band, no Live
  // word, no text line; what it is doing is the tooltip. No channels on this board, so the channel is under the id.
  assert.equal(top(html, 'run-1'), `<tr class="fyrow fytop" data-id="run-1" data-kind="run"><td class="fyvid" rowspan="2"><b>run-1</b><small>nora</small></td><td class="fyst fyg1" colspan="5" title="after 2 of 4 pack checks"><div class="fyss">${SUM(2, 4)}<span>22m</span></div></td><td class="fyst fyg1" colspan="2"><div class="fyss">${SUM(0, 2)}</div></td><td class="fyst fyg1" colspan="2"><div class="fyss">${SUM(0, 2)}</div></td><td class="fywait" rowspan="2"><small>22m</small></td>`);
  // Its parts, a bar each: done (the result line is the tooltip), a part this video does not have (blank), running
  // with no numbers (the moving stripe; no start time, so no clock), not started (an empty track).
  assert.match(low(html, 'run-1'), new RegExp(`^<tr[^>]*><td class="fyp fyg1" title="14 min, 1080p">${DONE}</td><td class="fyp">${DONE}</td><td class="fyp"></td><td class="fyp fyprun" title="Checking pictures: 61 of 198"><div class="fypb run ind" role="progressbar" aria-label="Running"><i></i></div></td><td class="fyp">${TODO}</td><td class="fyp fyg1">${TODO}</td><td class="fyp">${TODO}</td><td class="fyp fyg1">${TODO}</td><td class="fyp">${TODO}</td>$`));
  // Done step: a full thin bar and its time. Failed step: "Failed, try 2" in red (the reason and the fix are the
  // tooltip); the failed part: a red track, an X and its reason. A step with no parts keeps its one cell across both rows.
  assert.ok(top(html, 'fail-1').endsWith(`<td class="fyst fyg1" colspan="5"><div class="fyss">${SUM(5, 5, ' ok')}<span>28m</span></div></td><td class="fyst fyg1" colspan="2" title="The plan had 3 scenes with no picture · Fix: Add pictures"><div class="fyss">${SUM(1, 2, ' bad')}<span>4m</span><em class="fysf">Failed, try 2</em></div></td><td colspan="2" rowspan="2" class="fycell fyg1"><span class="fyidle" role="img" aria-label="Later step"></span></td><td class="fywait" rowspan="2"><small>12m</small></td>`), top(html, 'fail-1'));
  assert.match(low(html, 'fail-1'), new RegExp(`<td class="fyp" title="29 clips">${DONE}</td>`));
  assert.match(low(html, 'fail-1'), new RegExp(`<td class="fyp fyg1">${DONE}</td><td class="fyp fypbad" title="3 scenes with no picture">${BAR('bad', 'Failed')}<span class="fypl">${ICON('fybad', 'Failed')}</span><small>3 scenes with no picture</small></td>$`));
  assert.equal((low(html, 'fail-1').match(/<td/g) || []).length, 7, 'five pack parts and two plan parts; gates is the one cell above');
  // Waiting: the step's summary says "Waiting" and the video's reason, the part an amber track, a clock and its own
  // reason. A step with no parts on this video (plan) and a step this video does not have (gates) each span their columns.
  assert.ok(top(html, 'wait-1').endsWith(`<td class="fyst fyg1" colspan="5" title="Waiting for run-1 to finish its pack"><div class="fyss">${SUM(0, 2)}<em class="fysw">Waiting</em><small>Waiting for run-1 to finish its pack</small></div></td><td colspan="2" rowspan="2" class="fycell fyg1"><span class="fyidle" role="img" aria-label="Later step"></span></td><td colspan="2" rowspan="2" class="fycell fyg1"></td><td class="fywait" rowspan="2"><small></small></td>`), top(html, 'wait-1'));
  assert.match(low(html, 'wait-1'), new RegExp(`^<tr[^>]*><td class="fyp fypwait fyg1" title="Waits for run-1: one pack at a time">${BAR('wait', 'Waiting')}<span class="fypl">${ICON('fywt', 'Waiting')}</span><small>Waits for run-1: one pack at a time</small></td><td class="fyp">${TODO}</td><td class="fyp"></td><td class="fyp"></td><td class="fyp"></td>$`));
  // The summary still counts by step. The old green band and its sticky line are gone.
  assert.match(html, /<b>1<\/b> live now<\/span><span><b>2<\/b> Pack<\/span><span><b>1<\/b> Plan<\/span><span class="z"><b>0<\/b> Gates<\/span>/);
  assert.doesNotMatch(html.slice(html.indexOf('<table')), /fylv|fylt|fysl|fystg|fydot|In progress/);
  assert.doesNotMatch(html, /undefined|NaN|null|—/);
});

test('Factory page with parts: every bar state, the time a part took, the clock of a running part', () => {
  // The texts: how long a finished part took, and a running part's clock from its start.
  assert.deepEqual([54, 614, 59.6, 3599, 3720, 0, 0.4, -1, null, '54', NaN].map(took), ['54s', '10m 14s', '1m 0s', '59m 59s', '1h 2m', '0s', '0s', '', '', '', '']);
  assert.deepEqual([[S(7), NOW], [S(127), NOW], [S(127), NOW + 1000], [S(3725), NOW], [S(-30), NOW], ['soon', NOW], [null, NOW], [S(5), null]].map((a) => clock(...a)), ['0:07', '2:07', '2:08', '1:02:05', '0:00', '', '', '']);
  const parts = [
    P('A', 'todo'), { ...P('B', 'done', '41 sources'), seconds: 614 }, { ...P('C'), seconds: 54 }, P('D'),
    { ...P('E', 'running', 'Making stills'), done: 61, total: 198, started: S(127) }, { ...P('F', 'running', 'Making clips'), started: S(3725) }, P('G', 'running'),
    { ...P('H', 'running'), done: 300, total: 198 }, { ...P('I', 'running'), done: 5, total: 0, started: 'soon' }, P('J', 'failed', 'No host photo'), P('K', 'waiting', 'Waits for nora-5'),
  ];
  const board = (over = {}) => fresh({ jobs: [{ id: 'v-1', channel: 'nora', state: 'running', steps: [step('pack', 'running', { minutes: 22, parts })] }], ...over });
  const cells = (html) => low(html, 'v-1').split('<td ').slice(1).map((c) => `<td ${c}`);
  const c = cells(page(board()));
  assert.equal(c.length, 11);
  // todo: an empty grey track. done: a full green track, a check, and the time it took when the board sends it.
  assert.equal(c[0], `<td class="fyp fyg1">${TODO}</td>`);
  assert.match(c[1], new RegExp(`^<td class="fyp" title="41 sources">${BAR('ok', 'Done')}<span class="fypl">${ICON('fyok', 'Done')}<span>10m 14s</span></span></td>$`));
  assert.match(c[2], /<span>54s<\/span><\/span><\/td>$/);
  assert.match(c[3], new RegExp(`^<td class="fyp">${DONE}</td>$`));
  // running with a total: the fill is done / total (61 of 198 is 30.8%), the count, and the clock since it started.
  assert.equal(c[4], '<td class="fyp fyprun" title="Making stills"><div class="fypb run" role="progressbar" aria-label="Running" aria-valuemin="0" aria-valuemax="198" aria-valuenow="61"><i style="width:30.8%"></i></div><span class="fypl"><b>61 / 198</b></span><span class="fyt" data-since="' + S(127) + '">2:07</span></td>');
  // running without a total: the moving stripe (no width, no percentage) and the clock; with no start time, the stripe alone.
  assert.equal(c[5], '<td class="fyp fyprun" title="Making clips"><div class="fypb run ind" role="progressbar" aria-label="Running"><i></i></div><span class="fyt" data-since="' + S(3725) + '">1:02:05</span></td>');
  assert.equal(c[6], '<td class="fyp fyprun"><div class="fypb run ind" role="progressbar" aria-label="Running"><i></i></div></td>');
  assert.match(c[7], /aria-valuenow="198"><i style="width:100%"><\/i><\/div><span class="fypl"><b>198 \/ 198<\/b><\/span><\/td>$/, 'never past the total');
  assert.equal(c[8], '<td class="fyp fyprun"><div class="fypb run ind" role="progressbar" aria-label="Running"><i></i></div></td>', 'a total of 0 is no total; a start that is not a time is no clock');
  // failed: a red track, an X and the reason. waiting: an amber track, a clock icon and the reason.
  assert.match(c[9], new RegExp(`^<td class="fyp fypbad" title="No host photo">${BAR('bad', 'Failed')}<span class="fypl">${ICON('fybad', 'Failed')}</span><small>No host photo</small></td>$`));
  assert.match(c[10], new RegExp(`^<td class="fyp fypwait" title="Waits for nora-5">${BAR('wait', 'Waiting')}<span class="fypl">${ICON('fywt', 'Waiting')}</span><small>Waits for nora-5</small></td>$`));
  // The step's summary: 3 of its 11 parts are done.
  assert.match(top(page(board()), 'v-1'), new RegExp(`<div class="fyss">${SUM(3, 11).replace(/[/()]/g, '\\$&')}<span>22m</span></div>`));
  assert.match(top(page(board()), 'v-1'), /<i style="width:27\.3%">/);
  // The clocks count on the page's own clock between reads (the shell redraws every second).
  const later = cells(page(board(), { now: NOW + 8000 }));
  assert.match(later[4], />2:15<\/span><\/td>$/);
  assert.match(later[5], />1:02:13<\/span><\/td>$/);
  assert.match(page(board(), { now: NOW + 8000 }), /Live · 18s ago/);
  // Stale: nothing is live, so the stripe stands still and no clock counts; the measured count stays as posted.
  const stale = cells(page(board({ at: S(260), stale: true })));
  assert.equal(stale[4], '<td class="fyp fyprun" title="Making stills"><div class="fypb run" role="progressbar" aria-label="Running" aria-valuemin="0" aria-valuemax="198" aria-valuenow="61"><i style="width:30.8%"></i></div><span class="fypl"><b>61 / 198</b></span></td>');
  assert.equal(stale[5], '<td class="fyp fyprun" title="Making clips"><div class="fypb run off" role="progressbar" aria-label="Running"><i></i></div></td>');
  assert.doesNotMatch(page(board({ at: S(260), stale: true })), /fypb run ind|class="fyt"|%<\/|NaN|undefined/);
});

const CHANNELS = () => [{ id: 'naomi', label: 'Naomi Takeda Japan' }, { id: 'nora', label: 'Nora Fairweather Cats' }, { id: 'rosa', label: "Rosa's House Hacks" }, { id: 'jon-mac', label: 'Jon Mac', note: 'Not in the video program yet' }];

test('Factory page with channels: a heading per channel in the board\'s order, a quiet row for a channel with no video', () => {
  const F = { ...PARTS_BOARD(), channels: CHANNELS() };
  // run-1 is nora's, fail-1 is rosa's; wait-1 is on "jack", which the board does not list: last, under its own id.
  assert.deepEqual(factoryChannels(F, factoryJobs(F)).map((c) => [c.id, c.label, c.note, c.jobs.map((j) => j.id).join()]), [
    ['naomi', 'Naomi Takeda Japan', '', ''], ['nora', 'Nora Fairweather Cats', '', 'run-1'], ['rosa', "Rosa's House Hacks", '', 'fail-1'], ['jon-mac', 'Jon Mac', 'Not in the video program yet', ''], ['jack', 'jack', '', 'wait-1'],
  ]);
  assert.deepEqual(factoryChannels(PARTS_BOARD(), factoryJobs(PARTS_BOARD())), [], 'no channels on the board: no headings');
  const html = page(F);
  assert.deepEqual([...html.matchAll(/<tr class="[^"]+" data-id="([^"]+)"/g)].map((m) => m[1]), [
    '~ch:naomi', '~ch:naomi~none', '~ch:nora', 'run-1', 'run-1~parts', '~ch:rosa', 'fail-1', 'fail-1~parts', '~ch:jon-mac', '~ch:jon-mac~none', '~ch:~jack', 'wait-1', 'wait-1~parts',
  ]);
  // Wide table (11 columns): the words sit in the Video column's cell, the rest of the row is one empty cell.
  assert.match(html, /<tr class="fych" data-id="~ch:naomi"><td class="fyvid fychn"><span>Naomi Takeda Japan<\/span><\/td><td colspan="10"><\/td><\/tr>\n<tr class="fyrow fynone" data-id="~ch:naomi~none"><td class="fyvid fychq" title="No video in the program yet"><span>No video in the program yet<\/span><\/td><td colspan="10"><\/td><\/tr>/);
  assert.match(html, /<tr class="fych" data-id="~ch:nora"><td class="fyvid fychn"><span>Nora Fairweather Cats<\/span><small>1 video<\/small><\/td><td colspan="10"><\/td><\/tr>\n<tr class="fyrow fytop" data-id="run-1"/);
  assert.match(html, /<span>Rosa&#39;s House Hacks<\/span><small>1 video<\/small>/);
  assert.match(html, /<tr class="fyrow fynone" data-id="~ch:jon-mac~none"><td class="fyvid fychq" title="Not in the video program yet"><span>Not in the video program yet<\/span><\/td>/);
  assert.match(html, /<tr class="fych" data-id="~ch:~jack"><td class="fyvid fychn"><span>jack<\/span><small>1 video<\/small><\/td>/);
  // Under a channel heading the video cell is just the id; the count line at the top is unchanged.
  assert.match(top(html, 'run-1'), /<td class="fyvid" rowspan="2"><b>run-1<\/b><\/td>/);
  assert.match(html, /<p class="fysum"><span class="fylc on"><i class="fydot"><\/i><b>1<\/b> live now<\/span><span><b>2<\/b> Pack<\/span><span><b>1<\/b> Plan<\/span><span class="z"><b>0<\/b> Gates<\/span><span class="z"><b>0<\/b> Done<\/span><span class="fypill ok">0 need you<\/span><\/p>/);
  // Inside a channel the order is as before (failed, running, waiting), and "2 videos" counts them. A video with no channel goes last.
  const two = { ...PARTS_BOARD(), channels: [{ id: 'nora', label: 'Nora' }] };
  two.jobs.forEach((j, i) => { j.channel = i < 2 ? 'nora' : ''; });
  const h2 = page(two);
  assert.deepEqual([...h2.matchAll(/<tr class="[^"]+" data-id="([^"]+)"/g)].map((m) => m[1]), ['~ch:nora', 'fail-1', 'fail-1~parts', 'run-1', 'run-1~parts', '~ch:~', 'wait-1', 'wait-1~parts']);
  assert.match(h2, /<span>Nora<\/span><small>2 videos<\/small>/);
  assert.match(h2, /<tr class="fych" data-id="~ch:~"><td class="fyvid fychn"><span>No channel<\/span>/);
  // A board with channels and no parts: the plain table; the heading sits in the Video cell (it stays put) over an empty cell. No videos at all: every channel still shows.
  const plain = page(fresh({ channels: [{ id: 'hgp', label: 'Home Guide Press' }, { id: 'jon-mac', label: 'Jon Mac' }] }));
  assert.match(plain, /<tr class="fych" data-id="~ch:hgp"><td class="fyvid fychn"><span>Home Guide Press<\/span><small>2 videos<\/small><\/td><td colspan="4"><\/td><\/tr>\n<tr class="fyrow" data-id="need-1" data-kind="need"><td><b>need-1<\/b><\/td>/);
  assert.match(plain, /<tr class="fych" data-id="~ch:jon-mac"><td class="fyvid fychn"><span>Jon Mac<\/span><\/td><td colspan="4"><\/td><\/tr>\n<tr class="fyrow fynone" data-id="~ch:jon-mac~none"><td class="fyvid fychq" title="No video in the program yet"><span>No video in the program yet<\/span><\/td><td colspan="4"><\/td><\/tr>/);
  assert.match(plain, /<tr class="fych" data-id="~ch:~nora"><td class="fyvid fychn"><span>nora<\/span><small>3 videos<\/small>/);
  const none = page(fresh({ jobs: [], channels: CHANNELS() }));
  assert.equal((none.match(/<tr class="fych"/g) || []).length, 4);
  assert.doesNotMatch(none, /No videos in the program right now/);
  // Channel text is data: escaped everywhere.
  const x = '<img src=x onerror=alert(1)>"\'&';
  const bad = page(fresh({ channels: [{ id: x, label: x, note: x }, { id: 'nora', label: x }] }));
  assert.doesNotMatch(bad, /<img|onerror=alert\(1\)>|"'&/);
  assert.doesNotMatch(`${html}${h2}${plain}${none}`, /undefined|NaN|null|—/);
});

test('Factory page with parts: stale, mixed with a step no video sends parts for, escaped, old boards unchanged', () => {
  // Stale: nothing reads as live, the bars stand still.
  const stale = page({ ...PARTS_BOARD(), at: S(260), stale: true });
  assert.doesNotMatch(stale, /fylv|fylt|fypb run ind/);
  assert.match(stale, /<td class="fyp fyprun"[^>]*><div class="fypb run off" role="progressbar" aria-label="Running">/);
  // A step no video sends parts for keeps one 9rem column and one heading over both heading rows; parts: [] is no parts.
  // Its one cell is plain in this table: no green Live cell.
  const mixed = page(fresh({ jobs: [{ id: 'm-1', state: 'running', steps: [step('pack', 'done', { minutes: 31, parts: [P('Stills'), P('Clips')] }), step('render', 'running', { minutes: 5, parts: [] }), step('gates', 'todo')] }] }));
  assert.match(mixed, /<table class="fytable fyw" style="--fyn: 2; --fyp: 2">\s*<colgroup><col class="fyc1"><col class="fycp"><col class="fycp"><col class="fycs"><col class="fycs"><col class="fycw"><\/colgroup>/);
  assert.match(mixed, /<th class="fygrp fyg1" colspan="2">Pack<\/th><th class="fycell fyg1" rowspan="2">Render<\/th><th class="fycell fyg1" rowspan="2">Gates<\/th>/);
  assert.match(mixed, /<td colspan="1" rowspan="2" class="fycell fyg1"><div class="fyrun"><div class="fypg ind"/);
  assert.doesNotMatch(mixed, /fylv|fylt/);
  // Feed text is data in every new place: part names, notes, tooltips, start times.
  const x = '<img src=x onerror=alert(1)>"\'&';
  const esc = page(fresh({ jobs: [{ id: 'e-1', state: 'running', steps: [{ name: x, status: 'running', doing: x, parts: [{ name: x, status: 'failed', note: x }, { name: `${x}2`, status: 'waiting', note: x }, { name: `${x}3`, status: 'running', note: x, started: x }, { name: `${x}4`, status: x, note: x }, { name: `${x}5`, status: 'done', note: x, seconds: x }] }] }] }));
  assert.doesNotMatch(esc, /<img|onerror=alert\(1\)>|"'&/);
  assert.ok((esc.match(/&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/g) || []).length >= 14);
  // A board with no parts anywhere draws exactly the single-cell table.
  const old = page(fresh());
  assert.match(old, /<table class="fytable" style="--fyn: 3">/);
  assert.doesNotMatch(old, /fytable fyw|fytop|fylow|fyst |fypb|fych|~parts|rowspan/);
  // Empty board: still the plain table.
  assert.match(page(fresh({ jobs: [] })), /<td colspan="2" class="mut">No videos in the program right now\.<\/td>/);
});

test('Factory with parts: styles for the bars, nothing sticky but the Video and state columns, phone width', () => {
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  const fy = css.slice(css.indexOf('/* Factory page'), css.indexOf('/* Track page'));
  for (const rule of ['.d3 .fytable col.fycp{width:5.2rem}', '.d3 .fytable.fyw th.fyh1,.d3 .fytable.fyw td.fyvid{position:sticky;left:0;z-index:2}', '.d3 .fytable.fyw th.fyhw,.d3 .fytable.fyw td.fywait{position:sticky;right:0;',
    '.d3 .fypb{height:.45rem;border-radius:1rem;background:var(--track);overflow:hidden}', '.d3 .fypb.ok i{width:100%;background-color:var(--ok)}', '.d3 .fypb.bad i{width:100%;background-color:var(--bad)}', '.d3 .fypb.wait i{width:100%;background-color:var(--warn)}',
    '.d3 .fypb.ind i{animation:fystripe .7s linear infinite}', '.d3 .fysb{', '.d3 .fytable tr.fych td{', '.d3 .fywt{color:var(--warn)}', '.d3 .fytblwrap{overflow-x:auto}']) assert.ok(fy.includes(rule), rule);
  // The part column is 75 to 90 px wide (5.2rem at the browser's 16 px).
  assert.ok(5.2 * 16 >= 75 && 5.2 * 16 <= 90);
  // Sticky: only the Video column (and the state column on wide screens; it lets go on a phone). The old band is gone.
  const sticky = fy.split('\n').filter((l) => l.includes('position:sticky'));
  assert.deepEqual(sticky.map((l) => l.trim().split('{')[0]), ['.d3 .fytable:not(.fyw) th:first-child,.d3 .fytable:not(.fyw) td:first-child', '.d3 .fytable.fyw th.fyh1,.d3 .fytable.fyw td.fyvid', '.d3 .fytable.fyw th.fyhw,.d3 .fytable.fyw td.fywait', '.d3 .fytable th:first-child,.d3 .fytable td:first-child']);
  assert.doesNotMatch(fy, /\.fysl\b|\.fystg\b|fysbad|th\.fygrp span/);
  assert.match(fy, /@media \(max-width:700px\)\{\n\.d3 \.fytable\.fyw\{--fyc1:6\.2rem\}[\s\S]*?\.d3 \.fytable\.fyw th\.fyhw,\.d3 \.fytable\.fyw td\.fywait\{position:static\}/);
  assert.match(fy, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?\.d3 \.fypb\.ind i\{animation:none\}/);
  const src = readFileSync(new URL('../public/d3/js/factory.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Host video|Source map|Loudness|qc_precheck|Naomi|Giovanni|Fairweather|House Hacks/, 'part and channel names come from the board, never from the page');
  assert.doesNotMatch(src, /\b(source|script|pack|plan|render|gates)\b'/, 'no step name is written into the page');
});

// ---- the board's new optional fields: channels, and a part's done, total, started, seconds ----
test('video_line feed: channels (at most 20, in order), kept as posted; one that is not right is a 400', async () => {
  const { env } = await setup();
  const B = BOARD();
  const sent = [{ id: 'naomi', label: 'Naomi Takeda Japan' }, { id: ' nora ', label: ' Nora Fairweather Cats ', note: '' }, { id: 'jon-mac', label: 'Jon Mac', note: ' Not in the video program yet ' }, { id: 'i'.repeat(40), label: 'l'.repeat(60), note: 'n'.repeat(200) }, { id: 'x', label: 'X', note: null }];
  const ok = await put(env, 'developer', { ...B, channels: sent });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.feed.data.channels, [{ id: 'naomi', label: 'Naomi Takeda Japan' }, { id: 'nora', label: 'Nora Fairweather Cats' }, { id: 'jon-mac', label: 'Jon Mac', note: 'Not in the video program yet' }, { id: 'i'.repeat(40), label: 'l'.repeat(60), note: 'n'.repeat(200) }, { id: 'x', label: 'X' }]);
  assert.equal((await put(env, 'developer', { ...B, channels: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, label: `C ${i}` })) })).body.feed.data.channels.length, 20);
  assert.deepEqual((await put(env, 'developer', { ...B, channels: [] })).body.feed.data.channels, []);
  for (const none of [undefined, null]) assert.ok(!('channels' in (await put(env, 'developer', { ...B, channels: none })).body.feed.data), 'left out when the board does not send channels');
  const c = { id: 'nora', label: 'Nora' };
  const bad = [
    'nora', { nora: c }, [null], ['nora'], [[]], [{ label: 'Nora' }], [{ id: 'nora' }], [{ ...c, id: '' }], [{ ...c, id: '  ' }], [{ ...c, id: 7 }], [{ ...c, id: 'i'.repeat(41) }],
    [{ ...c, label: '' }], [{ ...c, label: 7 }], [{ ...c, label: 'l'.repeat(61) }], [{ ...c, note: 7 }], [{ ...c, note: ['x'] }], [{ ...c, note: 'n'.repeat(201) }],
    [c, { ...c, label: 'Nora again' }], Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, label: `C ${i}` })),
  ];
  for (const channels of bad) {
    const r = await put(env, 'developer', { ...B, channels });
    assert.equal(r.status, 400, JSON.stringify(channels).slice(0, 80));
    assert.match(r.body.error, /channels/);
  }
  // The d3 answer hands them to the page as posted.
  await put(env, 'developer', { ...B, channels: sent.slice(0, 3) });
  assert.deepEqual((await d3Of(env.DB)).d3.factory.channels.map((x) => x.id), ['naomi', 'nora', 'jon-mac']);
});

test('video_line feed: a part may carry done, total, started and seconds; a wrong one is a 400; six steps are kept', async () => {
  const { env } = await setup();
  const B = BOARD();
  const withParts = (parts) => ({ ...B, jobs: [{ ...B.jobs[2], steps: [{ ...B.jobs[2].steps[0], parts }] }] });
  const sent = [
    { ...P('Stills', 'running', 'Making stills'), done: 61, total: 198, started: '2026-11-11T23:57:53Z' }, { ...P('Clips', 'running'), started: '2026-11-11T23:59:00+00:00' },
    { ...P('A-roll'), seconds: 614.5 }, { ...P('Words'), seconds: 0, done: 0, total: 0 }, { ...P('Look', 'todo'), done: null, total: null, started: null, seconds: null }, { ...P('Scrub', 'todo'), started: '' },
  ];
  const ok = await put(env, 'developer', withParts(sent));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.feed.data.jobs[0].steps[0].parts, [
    { ...P('Stills', 'running', 'Making stills'), done: 61, total: 198, started: '2026-11-11T23:57:53.000Z' }, { ...P('Clips', 'running'), started: '2026-11-11T23:59:00.000Z' },
    { ...P('A-roll'), seconds: 614.5 }, { ...P('Words'), done: 0, total: 0, seconds: 0 }, P('Look', 'todo'), P('Scrub', 'todo'),
  ]);
  for (const over of [{ done: -1 }, { done: 1.5 }, { done: '61' }, { done: [61] }, { done: true }, { total: -1 }, { total: 1.5 }, { total: '198' }, { started: 'soon' }, { started: 1794441473 }, { started: {} }, { seconds: -1 }, { seconds: '54' }, { seconds: Infinity }, { seconds: [54] }]) {
    // JSON has no Infinity: post it as text that is not a number.
    const r = await put(env, 'developer', withParts([{ ...P('Stills', 'running'), ...(over.seconds === Infinity ? { seconds: 'Infinity' } : over) }]));
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.match(r.body.error, /parts\[0\]\.(done|total|started|seconds)/);
  }
  // The new program's six steps, in order, all kept (the cut is at 20).
  const six = ['source', 'script', 'pack', 'plan', 'render', 'gates'];
  const r = await put(env, 'developer', { ...B, jobs: [{ ...B.jobs[2], steps: six.map((n) => step(n, 'todo', { parts: [P(`${n} part`, 'todo')] })) }] });
  assert.deepEqual(r.body.feed.data.jobs[0].steps.map((x) => x.name), six);
  assert.deepEqual(factoryCols(r.body.feed.data.jobs), six);
});

// ---- stages: the steps folded into a few columns, the whole time a video took, the review page ----
const G = (name, label, status, extra = {}) => step(name, status, { ...(label ? { label } : {}), ...extra });

test('video_line feed: a video may carry stages (with a label), started, ended, total_minutes and a jonmac.ai review_url', async () => {
  const { env } = await setup();
  const B = BOARD();
  const job = (over) => ({ ...B, jobs: [{ ...B.jobs[0], ...over }] });
  const stages = [G('outlier', 'Outlier', 'done', { minutes: 12 }), G('script_qc', 'QC', 'waiting', { doing: 'Waits for the script' }), G('pack', 'Pack', 'todo', { done: 3, total: 8 }), G('pack_qc', 'QC', 'skip'), G('render', '', 'todo')];
  const ok = await put(env, 'developer', job({ stages, started: '2026-11-11T20:00:00Z', ended: '2026-11-11T22:05:30+00:00', total_minutes: 125.5, review_url: 'https://jonmac.ai/review/done-1' }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const j = ok.body.feed.data.jobs[0];
  assert.deepEqual(j.stages, stages, 'the stages come back as posted, a label only where one was sent');
  assert.deepEqual(j.stages.map((s) => s.label), ['Outlier', 'QC', 'Pack', 'QC', undefined]);
  assert.deepEqual([j.started, j.ended, j.total_minutes, j.review_url], ['2026-11-11T20:00:00.000Z', '2026-11-11T22:05:30.000Z', 125.5, 'https://jonmac.ai/review/done-1']);
  assert.equal(j.steps.length, 2, 'the steps are kept beside the stages');
  // Still being made: no end yet. Not sent at all: no stages, no review_url, an empty whole time.
  const live = (await put(env, 'developer', job({ started: '2026-11-11T23:20:00Z', ended: null, total_minutes: null }))).body.feed.data.jobs[0];
  assert.deepEqual([live.started, live.ended, live.total_minutes], ['2026-11-11T23:20:00.000Z', null, null]);
  const none = (await put(env, 'developer', job({}))).body.feed.data.jobs[0];
  assert.ok(!('stages' in none) && !('review_url' in none), 'left out when the video does not send them');
  assert.deepEqual([none.started, none.ended, none.total_minutes], [null, null, null]);
  assert.deepEqual((await put(env, 'developer', job({ stages: [] }))).body.feed.data.jobs[0].stages, []);
  // Only a jonmac.ai review page is kept; any other address is dropped, never refused.
  for (const url of ['https://jonmac.ai/review/done-1', 'https://jonmac.ai/review/nora-6-v1']) assert.equal((await put(env, 'developer', job({ review_url: url }))).body.feed.data.jobs[0].review_url, url);
  for (const url of ['', null, 'https://jonmac.ai/review/nora/done-1_v2.html', 'https://jonmac.ai/review/../dash', 'http://jonmac.ai/review/done-1', 'https://evil.example/review/done-1', 'https://jonmac.ai.evil.example/review/done-1', 'https://jonmac.ai/review/', 'https://jonmac.ai/reviews/done-1',
    'https://jonmac.ai/review/done-1?next=x', 'https://jonmac.ai/review/a"b', ' https://jonmac.ai/review/done-1', 'javascript:alert(1)', `https://jonmac.ai/review/${'x'.repeat(201)}`]) {
    const r = await put(env, 'developer', job({ review_url: url }));
    assert.equal(r.status, 201, String(url));
    assert.ok(!('review_url' in r.body.feed.data.jobs[0]), String(url));
  }
  // A wrong type is a 400.
  const bad = [{ review_url: 7 }, { review_url: { a: 1 } }, { review_url: ['https://jonmac.ai/review/x'] }, { review_url: true }, { stages: 'outlier' }, { stages: {} }, { stages: ['outlier'] }, { stages: [{ status: 'done' }] },
    { stages: [G('pack', 7, 'done', { label: { a: 1 } })] }, { started: 'soon' }, { started: 1794441473 }, { ended: 'later' }, { total_minutes: '125' }, { total_minutes: -1 }, { total_minutes: [125] }];
  for (const over of bad) assert.equal((await put(env, 'developer', job(over))).status, 400, JSON.stringify(over));
  // The d3 answer hands them to the page as posted.
  await put(env, 'developer', job({ stages, started: '2026-11-11T20:00:00Z', review_url: 'https://jonmac.ai/review/done-1' }));
  const f = (await d3Of(env.DB)).d3.factory.jobs[0];
  assert.deepEqual([f.stages.length, f.stages[1].label, f.started, f.review_url], [5, 'QC', '2026-11-11T20:00:00.000Z', 'https://jonmac.ai/review/done-1']);
  // A stage may carry what it made: a text (the title) and a link under the review pages (the thumbnail). Any other link is dropped.
  const made = [G('title', 0, 'done', { label: 'Title', text: 'Why Your Eggplant Casserole Turns Soggy' }), G('thumbnail', 0, 'done', { label: 'Thumbnail', url: 'https://jonmac.ai/review/done-1/thumb.jpg' }),
    G('schedule', 0, 'todo', { url: 'https://evil.example/x.jpg', text: '' })];
  await put(env, 'developer', job({ stages: made }));
  const m = (await d3Of(env.DB)).d3.factory.jobs[0].stages;
  assert.deepEqual([m[0].text, m[0].url, m[1].url, m[2].url, m[2].text], ['Why Your Eggplant Casserole Turns Soggy', undefined, 'https://jonmac.ai/review/done-1/thumb.jpg', undefined, undefined]);
  assert.equal((await put(env, 'developer', job({ stages: [G('thumbnail', 0, 'done', { url: 7 })] }))).status, 400);
});

// Three videos: one being made, one finished (with its review page), one that sends no stages yet. The steps carry
// parts, which a board with stages never draws.
const STAGES = (st = {}) => [G('outlier', 'Outlier', 'done', { minutes: 12 }), G('script', 'Script', 'done'), G('script_qc', 'QC', 'done'), G('pack', 'Pack', 'done'), G('pack_qc', 'QC', 'done'), G('render', '', 'done'), G('final_qc', 'QC', 'done')]
  .map((s) => ({ ...s, ...(st[s.name] ? { tries: 0, ...st[s.name] } : {}) }));
const STAGE_BOARD = (over = {}) => fresh({ jobs: [
  { id: 'done-9', channel: 'hgp', state: 'done', created: '2026-11-11T20:00:00Z', minutes_in_state: '114', final: 'D:\\videos\\done-9\\final.mp4', review_url: 'https://jonmac.ai/review/done-9',
    started: '2026-11-11T20:00:00.000Z', ended: '2026-11-11T22:05:30.000Z', total_minutes: 125.5, stages: STAGES({ pack: { status: 'skip' } }), steps: [step('source', 'done', { parts: [P('Find')] })] },
  { id: 'run-9', channel: 'nora', state: 'running', created: '2026-11-11T23:20:00Z', minutes_in_state: '3', started: '2026-11-11T23:20:00.000Z', ended: null, total_minutes: 38,
    stages: STAGES({ script_qc: { status: 'running', doing: 'Checking the script' }, pack: { status: 'todo', done: 3, total: 8 }, pack_qc: { status: 'waiting', doing: 'Waits for the pack' }, render: { status: 'todo' }, final_qc: { status: 'skip' } }),
    steps: [step('source', 'done', { parts: [P('Find')] }), step('script', 'running', { parts: [P('Draft', 'running')] })] },
  { id: 'old-9', channel: 'nora', state: 'todo', created: '2026-11-11T23:50:00Z', minutes_in_state: '9', steps: [step('outlier', 'todo', { parts: [P('Find', 'todo')] })] },
], ...over });
const SKIP = '<td class="fycell" title="Not a part of this video"><span class="fyskip" role="img" aria-label="Not a part of this video">–</span></td>';

test('Factory page with stages: a column per stage headed by its label, no part columns, skip, waiting, a partly done bar', () => {
  const html = page(STAGE_BOARD());
  assert.match(html, /<h1>Factory<\/h1><p class="mut">Every video in the new video program, stage by stage\. Updates on its own\.<\/p>/);
  // Headings: each stage's label (three of them read QC), its name when it sends no label; no part columns, one row a video.
  assert.match(html, /<table class="fytable" style="--fyn: 7">\s*<colgroup><col class="fyc1">(<col class="fycs">){7}<col class="fycw"><\/colgroup>/);
  assert.match(html, /<thead data-fy="cols"><tr><th>Video<\/th><th class="fycell">Outlier<\/th><th class="fycell">Script<\/th><th class="fycell">QC<\/th><th class="fycell">Pack<\/th><th class="fycell">QC<\/th><th class="fycell">Render<\/th><th class="fycell">QC<\/th><th>Total time<\/th><\/tr><\/thead>/);
  assert.doesNotMatch(html, /fytable fyw|fytop|fylow|fyst |fypb|~parts|rowspan|Find|Draft|Source/);
  assert.deepEqual([...html.matchAll(/<tr class="fyrow" data-id="([^"]+)" data-kind="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`), ['run-9:run', 'old-9:wait', 'done-9:done']);
  // The summary: no count per column (several are called QC); live now, In progress, Done, needs you.
  assert.match(html, /<div data-fy="sum"><p class="fysum"><span class="fylc on"><i class="fydot"><\/i><b>1<\/b> live now<\/span><span><b>2<\/b> In progress<\/span><span><b>1<\/b> Done<\/span><span class="fypill ok">0 need you<\/span><\/p><\/div>/);
  // The video being made: done, done, running (Live), a stage begun with nothing of it running (a bar, 3 of 8),
  // a stage that waits (why is the tooltip), a later stage (grey circle), a stage this video skips (a dash).
  const run = row(html, 'run-9');
  const DONE_CELL = `<td class="fycell">${CHECK}</td>`;
  assert.match(run, new RegExp(`^<tr[^>]*><td><b>run-9</b><small>nora</small></td><td class="fycell">${CHECK}<small>12m</small></td>${DONE_CELL}<td class="fycell fylv" title="Checking the script"><div class="fyrun"><div class="fypg ind" role="progressbar" aria-label="In progress"><i></i></div><span>In progress</span></div><span class="fylt"><i class="fydot"></i>Live</span><small class="fylx">Checking the script</small></td>`));
  assert.ok(run.includes('</small></td><td class="fycell"><div class="fyrun"><div class="fypg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="38"><i style="width:38%"></i></div><span>3/8</span></div></td>'
    + `<td class="fycell" title="Waits for the pack"><span class="fynew">Waiting</span><small class="fywhy">Waits for the pack</small></td>${IDLE}${SKIP}<td class="fywait">`), run);
  // The finished video: checks, a dash for the stage it skipped.
  assert.match(row(html, 'done-9'), new RegExp(`${DONE_CELL}${DONE_CELL}${SKIP.replace(/[()]/g, '\\$&')}${DONE_CELL}${DONE_CELL}${DONE_CELL}<td class="fywait">`));
  // A video with no stages on such a board shows its steps, without their parts.
  assert.ok(row(html, 'old-9').includes(`<td><b>old-9</b><small>nora</small></td>${IDLE}${'<td class="fycell"></td>'.repeat(6)}<td class="fywait"><small>9m</small></td>`), row(html, 'old-9'));
  // A needs-you video and a failed one: the pill and the count; a failed video still counts as In progress.
  const more = page(STAGE_BOARD({ jobs: [...STAGE_BOARD().jobs, { id: 'need-9', state: 'NEEDS A PERSON', step: 'script_qc', note: 'Read the script', stages: STAGES({ script_qc: { status: 'failed', note: 'Two weak lines' } }) }, { id: 'fail-9', state: 'failed', stages: STAGES({ render: { status: 'failed' } }) }] }));
  assert.match(more, /<b>1<\/b> live now<\/span><span><b>3<\/b> In progress<\/span><span><b>1<\/b> Done<\/span><span class="fypill crit">1 needs you<\/span>/);
  assert.match(row(more, 'need-9'), /<div class="fyfail" title="Two weak lines">[\s\S]*<td class="fywait"><span class="fypill crit">Needs you<\/span><small><\/small><\/td>$/);
  // Stale: nothing is live. Stages that carry parts of their own still get no part columns. Stage text is data.
  const stale = page(STAGE_BOARD({ at: S(260), stale: true }));
  assert.match(stale, /<span class="fylc"><i class="fydot"><\/i><b>0<\/b> live now<\/span><span><b>2<\/b> In progress<\/span>/);
  assert.doesNotMatch(stale, /fylv|fylt/);
  assert.doesNotMatch(page(fresh({ jobs: [{ id: 'p-1', state: 'running', stages: [G('pack', 'Pack', 'running', { parts: [P('Stills')] })] }] })), /fytable fyw|fypb|~parts|Stills/);
  const x = '<img src=x onerror=alert(1)>"\'&';
  const bad = page(fresh({ jobs: [{ id: 'e-1', state: 'done', review_url: x, started: x, ended: x, stages: [{ name: x, label: x, status: 'waiting', doing: x }, { name: `${x}2`, label: `${x}2`, status: 'skip', note: x }] }] }));
  assert.doesNotMatch(bad, /<img|onerror=alert\(1\)>|"'&|<a /);
  assert.match(bad, /<th class="fycell">&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;<\/th>/);
  assert.doesNotMatch(`${html}${more}${stale}`, /undefined|NaN|null|—/);
});

test('Factory page: the last column is "Total time" when the board sends started, from started to ended or to now', () => {
  // The numbers: whole minutes from started to ended; while it is being made, to now on a live board only; else the
  // board's own total_minutes; null when the board sends no times.
  const [from, to] = ['2026-11-11T20:00:00.000Z', '2026-11-11T22:05:30.000Z'];
  assert.deepEqual([
    totalMinutes({ started: from, ended: to }, NOW, true), totalMinutes({ started: from, ended: to, total_minutes: 7 }, NOW, false), totalMinutes({ started: to, ended: from }, NOW, true),
    totalMinutes({ started: S(2400), ended: null }, NOW, true), totalMinutes({ started: S(2400) }, NOW + 119000, true), totalMinutes({ started: S(-60), ended: null }, NOW, true),
    totalMinutes({ started: S(2400), ended: null, total_minutes: 38 }, NOW, false), totalMinutes({ started: S(2400), ended: null }, NOW, false), totalMinutes({ started: S(2400) }, NaN, true),
    totalMinutes({ started: 'soon', ended: to, total_minutes: 12 }, NOW, true), totalMinutes({ total_minutes: '12' }, NOW, true), totalMinutes({}, NOW, true), totalMinutes(null, NOW, true),
  ], [125, 125, 0, 40, 41, 0, 38, null, null, 12, null, null, null]);
  const html = page(STAGE_BOARD());
  assert.match(html, /<th>Total time<\/th><\/tr><\/thead>/);
  assert.doesNotMatch(html, /<th>Waiting<\/th>/);
  // Ended: 20:00:00 to 22:05:30 is 2h 5m, whatever minutes_in_state says, and it does not count on.
  const END = /<small title="From the start of the video until its render was finished and checked">2h 5m<\/small><\/td>$/;
  assert.match(row(html, 'done-9'), END);
  assert.match(row(page(STAGE_BOARD(), { now: NOW + 120000 }), 'done-9'), END);
  // Being made on a live board: counted from started (23:20) to the page's clock: 40m now, 42m two minutes later.
  assert.match(row(html, 'run-9'), /<td class="fywait"><small title="Since the video was started; still counting">40m<\/small><\/td>$/);
  assert.match(row(page(STAGE_BOARD(), { now: NOW + 120000 }), 'run-9'), /<small title="Since the video was started; still counting">42m<\/small><\/td>$/);
  // A stale board does not count: the board's own total_minutes. A video that sends no times keeps its minutes in state.
  assert.match(row(page(STAGE_BOARD({ at: S(260), stale: true })), 'run-9'), /<td class="fywait"><small[^>]*>38m<\/small><\/td>$/);
  assert.match(row(html, 'old-9'), /<td class="fywait"><small>9m<\/small><\/td>$/);
  // The heading follows `started` alone: a board with parts and no stages gets it too, in its own heading cell.
  const parts = PARTS_BOARD();
  parts.jobs[0].started = S(2400);
  const wide = page(parts);
  assert.match(wide, /<th class="fyhw" rowspan="2">Total time<\/th>/);
  assert.match(top(wide, 'run-1'), /<td class="fywait" rowspan="2"><small title="Since the video was started; still counting">40m<\/small><\/td>$/);
  assert.match(top(wide, 'fail-1'), /<td class="fywait" rowspan="2"><small>12m<\/small><\/td>$/);
});

test('Factory page: the Done pill is a link to the review page when the board sends one, else a pill with the file as its tooltip', () => {
  const html = page(STAGE_BOARD());
  assert.match(row(html, 'done-9'), /<td class="fywait"><a class="fypill ok fylink" href="https:\/\/jonmac\.ai\/review\/done-9" target="_blank" rel="noopener" title="Open the review page">Done<\/a><small/);
  assert.doesNotMatch(html, /final\.mp4/, 'with a link the file path shows nowhere');
  // No review page, or an address that is not a jonmac.ai review page: the plain pill, the file its tooltip.
  for (const url of [undefined, '', null, 7, 'https://evil.example/review/done-9', 'http://jonmac.ai/review/done-9', 'https://jonmac.ai/review/', 'https://jonmac.ai/review/x?y=1', 'javascript:alert(1)']) {
    const b = STAGE_BOARD();
    b.jobs[0].review_url = url;
    const h = page(b);
    assert.match(row(h, 'done-9'), /<td class="fywait"><span class="fypill ok" title="D:\\videos\\done-9\\final\.mp4">Done<\/span><small/, String(url));
    assert.doesNotMatch(h, /<a |fylink|evil|javascript/, String(url));
  }
  // A video that is not done never links, and an old board with a review page still does.
  const b = STAGE_BOARD();
  b.jobs[1].review_url = 'https://jonmac.ai/review/run-9';
  assert.equal((page(b).match(/<a /g) || []).length, 1);
  const old = fresh();
  old.jobs[0].review_url = 'https://jonmac.ai/review/done-1';
  assert.match(row(page(old), 'done-1'), /<a class="fypill ok fylink" href="https:\/\/jonmac\.ai\/review\/done-1" target="_blank" rel="noopener" title="Open the review page">Done<\/a><small>40m<\/small><\/td>$/);
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  for (const rule of ['.d3 .fyskip{color:var(--muted)}', '.d3 a.fypill.fylink{text-decoration:none;cursor:pointer}', '.d3 a.fypill.fylink:hover{text-decoration:underline}']) assert.ok(css.includes(rule), rule);
});

test('Factory page: an old board (no stages, no started) is drawn as before', () => {
  const html = page(fresh());
  assert.match(html, /<thead data-fy="cols"><tr><th>Video<\/th><th class="fycell">Pack<\/th><th class="fycell">Plan<\/th><th class="fycell">Render<\/th><th>Waiting<\/th><\/tr><\/thead>/);
  assert.match(html, /<b>1<\/b> live now<\/span><span><b>2<\/b> Pack<\/span><span><b>1<\/b> Plan<\/span><span><b>1<\/b> Render<\/span><span><b>1<\/b> Done<\/span><span class="fypill crit">1 needs you<\/span>/);
  assert.match(row(html, 'done-1'), /<td class="fywait"><span class="fypill ok" title="D:\\videos\\done-1\\final\.mp4">Done<\/span><small>40m<\/small><\/td>$/);
  assert.match(row(html, 'nora-5'), /<td class="fywait"><small>22m<\/small><\/td>$/);
  assert.doesNotMatch(html, /Total time|In progress<\/span><span|fylink|fyskip|<a |<small title=/);
  // The feed's empty whole time (null, null, null) and an empty list of stages change nothing; a label on a step is its heading.
  const same = fresh();
  same.jobs = same.jobs.map((j) => ({ ...j, started: null, ended: null, total_minutes: null, stages: [] }));
  assert.equal(page(same), html);
  const parts = page(PARTS_BOARD());
  assert.match(parts, /<th class="fyhw" rowspan="2">Waiting<\/th>/);
  assert.match(parts, /<span><b>2<\/b> Pack<\/span><span><b>1<\/b> Plan<\/span>/);
});

test('GET /dashboard/api/d3/factory: the board alone, the same shape as d3.factory, Jon\'s session only', async () => {
  const { db, env } = await setup();
  const real = Date.now;
  Date.now = () => NOW;
  try {
    const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
    const get = (headers = { Cookie: cookie }, e = env, method = 'GET') => handleApi(new Request('https://jonmac.ai/dashboard/api/d3/factory', { method, headers }), e);
    // Signed out, or a bot's token: refused, exactly as /dashboard/api/d3 is.
    for (const h of [{}, { Authorization: `Bearer ${TOK.developer}` }]) {
      const [a, b] = [await get(h), await handleApi(new Request('https://jonmac.ai/dashboard/api/d3', { headers: h }), env)];
      assert.equal(a.status, b.status);
      assert.equal(a.status, 401);
    }
    assert.notEqual((await get({ Cookie: cookie }, env, 'POST')).status, 200, 'read only');
    const none = await get();
    assert.equal(none.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await none.json(), { ok: true, asOf: new Date(NOW).toISOString(), factory: null });
    entry(db, 'v1', 600, { ...BOARD(), counts: { jobs: 99 } });
    entry(db, 'v2', 20, { ...BOARD(), channels: [{ id: 'nora', label: 'Nora' }] });
    const body = await (await get()).json();
    assert.deepEqual(Object.keys(body), ['ok', 'asOf', 'factory']);
    assert.deepEqual(body.factory, (await d3Of(db)).d3.factory, 'the same answer the full read gives');
    assert.deepEqual([body.factory.at, body.factory.stale, body.factory.counts.jobs, body.factory.channels[0].id], [S(20), false, 5, 'nora']);
    db.sqlite.prepare("DELETE FROM bot_feed_entries WHERE id = 'v2'").run();
    assert.equal((await (await get()).json()).factory.stale, true, 'stale after 3 minutes, as before');
    // One query, on the feed table only.
    const seen = [];
    const spy = { prepare: (sql) => { seen.push(sql); return db.prepare(sql); } };
    await get({ Cookie: cookie }, { DB: spy, SESSION_SECRET: SECRET });
    assert.equal(seen.length, 1);
    assert.match(seen[0], /FROM bot_feed_entries WHERE name = 'video_line' ORDER BY created_at DESC LIMIT 1/);
    // A table that can't be read is a 503, so the page keeps what it shows (it does not flip to "Not publishing yet").
    const down = await get({ Cookie: cookie }, { DB: { prepare: () => { throw new Error('no table'); } }, SESSION_SECRET: SECRET });
    assert.equal(down.status, 503);
    assert.equal((await down.json()).ok, false);
  } finally { Date.now = real; }
});

test('Factory with many stages: narrow stage columns, a wide one for the title, the Video column stays put', () => {
  const names = ['outlier', 'script', 'qc1', 'captions', 'aroll', 'broll', 'qc2', 'edit', 'qc3', 'title'];
  const job = (id) => ({ id, channel: 'hgp', state: 'running', steps: names.map((n, i) => (n === 'title' ? { name: n, status: 'done', text: 'A long video title' } : { name: n, status: i < 3 ? 'done' : 'pending' })) });
  const html = page(fresh({ jobs: [job('a-1'), job('a-2')], channels: [{ id: 'hgp', label: 'Home Guide Press' }] }));
  assert.match(html, /<table class="fytable fyt" style="--fyn: 10; --fyt: 1">\s*<colgroup><col class="fyc1">(<col class="fycs">){9}<col class="fyct"><col class="fycw"><\/colgroup>/);
  assert.match(html, /<tr class="fych" data-id="~ch:hgp"><td class="fyvid fychn"><span>Home Guide Press<\/span><small>2 videos<\/small><\/td><td colspan="11"><\/td><\/tr>/);
  // eight stages or fewer keep the roomy columns
  assert.match(page(fresh()), /<table class="fytable" style="--fyn: 3">/);
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  for (const rule of ['.d3 .fytable.fyt col.fycs{width:4.6rem}', '.d3 .fytable.fyt col.fyct{width:11rem}', '.d3 .fytable:not(.fyw) th:first-child,.d3 .fytable:not(.fyw) td:first-child{position:sticky;left:0;']) assert.ok(css.includes(rule), rule);
  // 15 stages with one title column: 10 + 14 x 4.6 + 11 + 7 = 92.4rem, about 1480 px, down from 2488
  assert.ok((10 + 14 * 4.6 + 11 + 7) * 16 < 1500);
});
