// Factory page channel list (Jon, 2026-11-17): only Jon Mac, Jon Mac AI, Jon Mac IG, Jon Mac TT, in that order.
// The rest are hidden by factory_channels.visible = 0 (migration 0033); nothing is deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './sqlited1.mjs';
import { handleApi } from '../src/api.js';
import { showChannels } from '../src/d3.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { renderFactory } from '../public/d3/js/factory.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-12T00:00:00Z');
const S = (s) => new Date(NOW - s * 1000).toISOString();
const DEV = `ccb_${'developer'.padEnd(43, 'x')}`;
const FOUR = ['Jon Mac', 'Jon Mac AI', 'Jon Mac IG', 'Jon Mac TT'];

const step = (name, status) => ({ name, status, tries: 1, minutes: null, started: null, ended: null, note: '', fix: '', doing: '' });
const job = (id, channel, state, extra = {}) => ({ id, channel, pipeline: 'hgp-longform', created: '2026-11-11T20:00:00Z', state, step: '', minutes_in_state: '5', note: '', steps_done: 1, steps_total: 2, needs_person: null, final: '', steps: [step('pack', 'done'), step('plan', state === 'done' ? 'done' : 'todo')], ...extra });
// The live board's shape: four clone channels with videos, plus Jon Mac and @JonMacAI as empty rows.
const BOARD = () => ({
  updated: '2026-11-11T23:59:03Z',
  scheduler_running: true,
  channels: [{ id: 'naomi', label: 'Naomi Takeda Japan' }, { id: 'giovanni', label: 'Giovanni Moretti' }, { id: 'nora', label: 'Nora Fairweather Cats' },
    { id: 'rosa-house', label: "Rosa's House Hacks" }, { id: 'jon-mac', label: 'Jon Mac', note: 'Not in the video program yet' }, { id: 'jonmacai', label: '@JonMacAI', note: 'Not in the video program yet' }],
  counts: { jobs: 4, done: 2, running: 1, needs_person: 1 },
  jobs: [job('naomi-10', 'naomi', 'done'), job('giovanni-4', 'giovanni', 'done'), job('nora-5', 'nora', 'running'),
    job('rosa-house-2', 'rosa-house', 'NEEDS A PERSON', { needs_person: { step: 'plan', why: 'Missing file', look_at: 'D:\\x', since: '2026-11-11T23:45:00+00:00' } })],
  events: ['2026-11-11T23:36:33Z  nora-5           job        created', '2026-11-11T23:36:42Z  naomi-10         pack       started', '2026-11-11T23:37:00Z  scheduler        tick       ok'],
  unreadable_jobs: ['naomi-3'],
});

async function setup() {
  const db = sqliteD1(); // the real migrations, 0033 included
  await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(DEV), 'developer', 'x').run();
  db.sqlite.prepare("INSERT INTO bot_feed_entries (id, name, bot, data, created_at) VALUES ('v1', 'video_line', 'developer', ?, ?)").run(JSON.stringify(BOARD()), S(10));
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
async function asJon(path, env, headers = {}) {
  const real = Date.now;
  Date.now = () => NOW;
  try {
    const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 3600)}`;
    return await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { headers: { Cookie: cookie, ...headers } }), env);
  } finally { Date.now = real; }
}
const factoryOf = async (env) => (await (await asJon('/d3/factory', env)).json()).factory;
const d3Of = async (env) => (await (await asJon('/d3', env)).json()).d3;

test('Factory API: exactly the four channels, in order, with their names', async () => {
  const { env } = await setup();
  const F = await factoryOf(env);
  assert.deepEqual(F.channels.map((c) => c.label), FOUR);
  assert.deepEqual(F.channels.map((c) => c.id), ['jon-mac', 'jonmacai', 'jon-mac-ig', 'jon-mac-tt']);
  assert.ok(F.channels.every((c) => c.note), 'the empty rows say why they are empty');
  // The full read the page loads first gives the same answer.
  assert.deepEqual((await d3Of(env)).factory, F);
});

test('Factory API: videos, events, unreadable jobs and counts of hidden channels are left out of the view', async () => {
  const { env } = await setup();
  const F = await factoryOf(env);
  assert.deepEqual(F.jobs, []);
  assert.deepEqual(F.events, ['2026-11-11T23:37:00Z  scheduler        tick       ok'], 'a line about no channel stays');
  assert.deepEqual(F.unreadable_jobs, []);
  assert.deepEqual(F.counts, { jobs: 0, done: 0, running: 0, needs_person: 0 });
});

test('Factory page: the four headings in order, no hidden channel anywhere, no "Needs you" from a hidden one', async () => {
  const { env } = await setup();
  const html = renderFactory({ asOf: new Date(NOW).toISOString(), d3: { factory: await factoryOf(env) } }, { now: NOW });
  const heads = [...html.matchAll(/<tr class="fych" data-id="([^"]+)"><td class="fyvid fychn"><span>([^<]+)<\/span>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(heads, [['~ch:jon-mac', 'Jon Mac'], ['~ch:jonmacai', 'Jon Mac AI'], ['~ch:jon-mac-ig', 'Jon Mac IG'], ['~ch:jon-mac-tt', 'Jon Mac TT']]);
  for (const gone of ['Naomi', 'Giovanni', 'Nora', 'Rosa', 'naomi-10', 'nora-5', '@JonMacAI', 'fyneed']) assert.ok(!html.includes(gone), gone);
  assert.match(html, /<b>0<\/b> live now/);
});

test('hidden channels keep everything: the posted board, the channel rows; nothing is deleted', async () => {
  const { db, env } = await setup();
  await factoryOf(env);
  await d3Of(env);
  const posted = JSON.parse(db.sqlite.prepare("SELECT data FROM bot_feed_entries WHERE id = 'v1'").get().data);
  assert.deepEqual(posted, BOARD(), 'the stored entry is exactly what was posted');
  assert.equal(posted.jobs.length, 4);
  const rows = db.sqlite.prepare('SELECT id, visible FROM factory_channels ORDER BY sort').all().map((r) => [r.id, Number(r.visible)]);
  assert.deepEqual(rows, [['jon-mac', 1], ['jonmacai', 1], ['jon-mac-ig', 1], ['jon-mac-tt', 1], ['naomi', 0], ['giovanni', 0], ['nora', 0], ['rosa-house', 0]]);
  // A bot reading the raw feed still sees every channel and video.
  const raw = await handleApi(new Request('https://jonmac.ai/dashboard/api/v1/feeds/video_line', { headers: { Authorization: `Bearer ${DEV}` } }), env);
  assert.equal(raw.status, 200);
  assert.match(JSON.stringify(await raw.json()), /nora-5/);
});

test('unhide: one UPDATE brings a channel and its videos back, at the place its sort gives', async () => {
  const { db, env } = await setup();
  db.sqlite.exec("UPDATE factory_channels SET visible = 1, sort = 5 WHERE id = 'nora'");
  const F = await factoryOf(env);
  assert.deepEqual(F.channels.map((c) => c.label), [...FOUR, 'Nora Fairweather Cats']);
  assert.deepEqual(F.jobs.map((j) => j.id), ['nora-5']);
  assert.equal(F.counts.running, 1);
  assert.ok(F.events.some((e) => e.includes('nora-5')) && !F.events.some((e) => e.includes('naomi-10')));
  db.sqlite.exec("UPDATE factory_channels SET visible = 0 WHERE id = 'nora'");
  assert.deepEqual((await factoryOf(env)).channels.map((c) => c.label), FOUR, 'and hidden again');
});

test('a channel the board posts that is not in the table is hidden; no visible row at all shows the board as posted', async () => {
  const { db, env } = await setup();
  db.sqlite.prepare("UPDATE bot_feed_entries SET data = ? WHERE id = 'v1'").run(JSON.stringify({ ...BOARD(), jobs: [...BOARD().jobs, job('new-1', 'brand-new', 'running')] }));
  assert.deepEqual((await factoryOf(env)).jobs, []);
  db.sqlite.exec('UPDATE factory_channels SET visible = 0');
  const F = await factoryOf(env);
  assert.equal(F.jobs.length, 5);
  assert.equal(F.channels.length, 6);
  assert.equal(F.channels[5].label, '@JonMacAI', 'the board as posted');
  db.sqlite.exec('DROP TABLE factory_channels'); // migration not applied: the board as posted for the page's own read
  assert.equal((await factoryOf(env)).jobs.length, 5);
});

test('signed out (or a bot token): the Factory reads are refused', async () => {
  const { env } = await setup();
  for (const path of ['/d3/factory', '/d3']) {
    for (const headers of [{}, { Authorization: `Bearer ${DEV}` }]) {
      const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { headers }), env);
      assert.equal(r.status, 401, `${path} ${Object.keys(headers)}`);
    }
  }
});

test('other pages are untouched: every other part of the dashboard read is the same with and without the filter', async () => {
  const { db, env } = await setup();
  const { factory: a, ...withFilter } = await d3Of(env);
  db.sqlite.exec('DELETE FROM factory_channels');
  const { factory: b, ...without } = await d3Of(env);
  assert.equal(b.jobs.length, 4);
  assert.notDeepEqual(a, b);
  assert.deepEqual(withFilter, without, 'review, queue, goals, team, sources and the rest do not change');
  assert.ok(Object.keys(withFilter.goals).length > 3);
});

test('showChannels is a pure view', () => {
  const F = BOARD();
  const before = JSON.stringify(F);
  const rows = [{ id: 'nora', label: 'Nora', note: null, sort: 2, visible: 1 }, { id: 'jon-mac', label: 'Jon Mac', note: '', sort: 1, visible: 1 }];
  const out = showChannels(F, rows);
  assert.equal(JSON.stringify(F), before);
  assert.deepEqual(out.channels, [{ id: 'jon-mac', label: 'Jon Mac', note: 'Not in the video program yet' }, { id: 'nora', label: 'Nora' }]);
  assert.equal(showChannels(F, null), F);
  assert.equal(showChannels(F, []), F);
  assert.equal(showChannels(null, rows), null);
});
