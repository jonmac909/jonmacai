import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/api.js';
import { sha256Hex } from '../src/bots.js';
import { signSession, COOKIE } from '../src/auth.js';
import { render, mount } from '../public/js/pages/factory.js';
import { sqliteD1 } from './sqlited1.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const BOTS = ['ana', 'moneyclaw', 'developer', 'sponsors'];
const TOK = Object.fromEntries(BOTS.map((b) => [b, `ccb_${b.padEnd(43, 'x')}`]));

async function setup() {
  const db = sqliteD1();
  for (const [bot, t] of Object.entries(TOK)) {
    await db.prepare('INSERT INTO bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)').bind(await sha256Hex(t), bot, 'x').run();
  }
  return { db, env: { DB: db, SESSION_SECRET: SECRET } };
}
async function call(env, method, path, { bot, body, jon } = {}) {
  const h = new Headers();
  if (bot) h.set('Authorization', `Bearer ${TOK[bot]}`);
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const r = await handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}

const SNAP = { columns: ['Script', 'Pack'], cols: ['Script'], tiles: [{ title: 'Tesco Transport Shake-Up - Peter Collins', channel: 'Peter Collins', column: 1, cells: [{ s: 'done' }] }] };

test('factory: only writers post, one row is overwritten, Jon and bots read it', async () => {
  const { db, env } = await setup();
  assert.equal((await call(env, 'GET', '/v1/factory', { jon: true })).body.factory, null);
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'sponsors', body: SNAP })).status, 403);
  assert.equal((await call(env, 'PUT', '/v1/factory', { jon: true, body: SNAP })).status, 403, 'Jon reads, a script writes');
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: { columns: 'x', tiles: [] } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: { columns: [], tiles: Array(601).fill({}) } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: { columns: [], tiles: [null] } })).status, 400, 'a null tile would break the page');
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: { columns: [1], tiles: [] } })).status, 400);
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: SNAP })).status, 200);
  assert.equal((await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: { ...SNAP, tiles: [] } })).status, 200);
  const got = await call(env, 'GET', '/v1/factory', { jon: true });
  assert.deepEqual(got.body.factory.tiles, []);
  assert.ok(Date.parse(got.body.asOf));
  assert.ok(got.body.channels.some((c) => c.slug === 'peter-collins'));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE source = 'factory'").first()).n, 1);
  assert.equal((await call(env, 'GET', '/v1/factory', { bot: 'ana' })).status, 200);
  assert.equal((await call(env, 'GET', '/v1/factory')).status, 401);
});

test('factory: the 60 s snapshot poll never carries the factory row', async () => {
  const { env } = await setup();
  await call(env, 'PUT', '/v1/factory', { bot: 'moneyclaw', body: SNAP });
  const snap = await call(env, 'GET', '/snapshot', { jon: true });
  assert.equal(snap.status, 200);
  assert.equal(snap.body.sources.factory, undefined);
  assert.ok(snap.body.nav.groups.some((g) => g.items.some((i) => i.id === 'factory')));
});

test('factory page: shell renders and tabs filter tiles by channel', () => {
  assert.match(render(null, null, 'peter-collins'), /data-sub="peter-collins"/);
});

test('factory page: first load fetches even when the tab reports hidden', async () => {
  const boxes = { '.fybody': { innerHTML: '' }, '.fystatus': { innerHTML: '' } };
  let calls = 0; let alive = true;
  const el = { dataset: {}, get isConnected() { return alive; }, querySelector: (s) => boxes[s] };
  globalThis.document = { hidden: true };
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ ok: true, factory: SNAP, asOf: new Date().toISOString(), channels: [] }) }; };
  mount(el);
  await new Promise((r) => setTimeout(r, 50)); alive = false;
  assert.equal(calls, 1);
  assert.doesNotMatch(boxes['.fybody'].innerHTML, /Loading/);
  assert.match(boxes['.fybody'].innerHTML, /Tesco Transport Shake-Up/);
});

const COLS = ['Script', 'Script QC', 'A-roll', 'Clips', 'Preflight', 'Edit', 'Video QC'];
const MIXED = [{ s: 'done' }, { s: 'done' }, { s: 'done' }, { s: 'run', done: 40, total: 100 }, { s: 'fail', why: 'Moving clips 12% <b>', full: 'long reason' }, { s: 'idle' }, { s: 'idle' }];
const TABLE = {
  columns: [], cols: COLS,
  tiles: [
    { title: 'Old Video - Peter Collins', channel: 'Peter Collins', owner: 'video editor', waitMin: 190, stuck: true, cells: MIXED },
    { title: 'New Video - Rosa Cooks', channel: 'Rosa Cooks', owner: 'elle', waitMin: 5, stuck: false, cells: COLS.map(() => ({ s: 'done' })) },
    { title: 'On the calendar - Peter Collins', channel: 'Peter Collins', column: 9 }, // already scheduled: not an open video
  ],
};
const CHANNELS = [{ slug: 'peter-collins', label: 'Peter Collins', group: 'Home Guide Press' }, { slug: 'rosa-cooks', label: 'Rosa Cooks', group: 'Home Guide Press' }];

async function board(sub = '') {
  const boxes = { '.fybody': { innerHTML: '' }, '.fystatus': { innerHTML: '' } };
  let alive = true;
  const el = { dataset: { sub }, get isConnected() { return alive; }, querySelector: (s) => boxes[s] };
  globalThis.document = { hidden: false };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, factory: TABLE, asOf: new Date().toISOString(), channels: CHANNELS }) });
  mount(el);
  await new Promise((r) => setTimeout(r, 50)); alive = false;
  return boxes['.fybody'].innerHTML;
}

test('factory table: one row per open video, oldest first, channel under the title, calendar tiles left out', async () => {
  const html = await board();
  for (const c of [...COLS, 'Video', 'Waiting']) assert.match(html, new RegExp(`<th[^>]*>${c}</th>`));
  assert.equal((html.match(/<tr class="fyrow/g) || []).length, 2);
  assert.ok(html.indexOf('Old Video') < html.indexOf('New Video'), 'feed order is kept');
  assert.match(html, /<b>Old Video<\/b><small>Peter Collins<\/small>/);
  assert.doesNotMatch(html, /On the calendar/);
  assert.match(html, /All channels<span class="ccn">2<\/span>/);
});

test('factory table: cells show a check, a blue bar with n/total, a red X with the reason, a grey circle', async () => {
  const html = await board();
  assert.equal((html.match(/aria-label="Done"/g) || []).length, 3 + 7);
  assert.match(html, /aria-valuenow="40"[^>]*><i style="width:40%"><\/i><\/div><span>40\/100<\/span>/);
  assert.match(html, /aria-label="Failed"/);
  assert.match(html, /Moving clips 12% &lt;b&gt;/, 'the reason is escaped');
  assert.doesNotMatch(html, /12% <b>/);
  assert.equal((html.match(/aria-label="Not started"/g) || []).length, 2);
});

test('factory table: a row stuck 2 hours or more is red and says how long and who', async () => {
  const html = await board();
  const rows = html.split('<tr class="fyrow').slice(1);
  assert.match(rows[0], /^ stuck"/);
  assert.match(rows[0], /video editor<small>3h 10m · stuck<\/small>/);
  assert.match(rows[1], /^"/);
  assert.match(rows[1], /elle<small>5m<\/small>/);
});

test('factory table: the channel filter keeps only that channel', async () => {
  const html = await board('rosa-cooks');
  assert.match(html, /New Video/);
  assert.doesNotMatch(html, /Old Video/);
  assert.match(html, /aria-current="page"[^>]*>Rosa Cooks/);
});

test('factory table: a tile with no title does not break the board', async () => {
  const keep = TABLE.tiles; TABLE.tiles = [{ channel: 'Rosa Cooks', owner: 'elle', cells: COLS.map(() => ({ s: 'done' })) }];
  try { const html = await board(); assert.match(html, /<tr class="fyrow/); } finally { TABLE.tiles = keep; }
});

test('factory table: an old snapshot without cols says the new table is on its way', async () => {
  const keep = TABLE.cols; TABLE.cols = undefined;
  try { assert.match(await board(), /Waiting for the publisher to send the new table\./); } finally { TABLE.cols = keep; }
});

test('factory table: a host with no chip gets its own chip under Other, and the counts add up', async () => {
  const keep = TABLE.tiles;
  TABLE.tiles = [...keep.slice(0, 2), { title: 'Odd One - Diane Kowalski', channel: 'Diane Kowalski', owner: 'elle', waitMin: 1, cells: COLS.map(() => ({ s: 'done' })) }];
  try {
    const html = await board();
    assert.match(html, /<b>Other<\/b>/);
    assert.match(html, /data-page="factory\/dianekowalski"[^>]*>Diane Kowalski<span class="ccn">1<\/span>/);
    assert.match(html, /All channels<span class="ccn">3<\/span>/);
    assert.match(await board('dianekowalski'), /Odd One/);
  } finally { TABLE.tiles = keep; }
});
