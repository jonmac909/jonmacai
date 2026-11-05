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

// A fake page skeleton with just what factory.js touches. Rows are real nodes that can be moved, so a test can tell "kept" from "rebuilt".
// tblwrap, table and tbody refuse innerHTML: the scroll box and the table must never be rewritten.
function fakePage(sub = '') {
  const sections = ['.fymsg', '.fystatus', '.fypanel', '.fytabsbox', '.fysumbox', '.fycols', '.fythead', '.fynotes'];
  const nodes = {};
  for (const s of sections) nodes[s] = { innerHTML: '' };
  nodes['.fyview'] = { hidden: true };
  const locked = (name) => ({ get innerHTML() { return ''; }, set innerHTML(_v) { throw new Error(`${name} must not be rewritten`); } });
  nodes['.tblwrap'] = locked('.tblwrap');
  nodes['.fytable'] = { ...locked('.fytable'), vars: {}, style: { setProperty(k, v) { nodes['.fytable'].vars[k] = v; } } };
  const body = { ...locked('.fytbody'), children: [] };
  const link = () => body.children.forEach((r, i) => { r.nextElementSibling = body.children[i + 1] || null; });
  Object.defineProperty(body, 'firstElementChild', { get: () => body.children[0] || null });
  body.insertBefore = (n, ref) => { const k = body.children.indexOf(n); if (k >= 0) body.children.splice(k, 1); const at = ref ? body.children.indexOf(ref) : -1; if (at < 0) body.children.push(n); else body.children.splice(at, 0, n); n.remove = () => { body.children.splice(body.children.indexOf(n), 1); link(); }; link(); };
  nodes['.fytbody'] = body;
  globalThis.document = {
    hidden: false,
    createElement: () => { const t = { content: {} }; Object.defineProperty(t, 'innerHTML', { set(h) { t.content.firstElementChild = { html: h, dataset: { id: /data-id="([^"]*)"/.exec(h)?.[1] } }; } }); return t; },
  };
  let alive = true;
  const el = { dataset: { sub }, get isConnected() { return alive; }, querySelector: (s) => nodes[s] };
  const html = () => [nodes['.fymsg'].innerHTML, nodes['.fypanel'].innerHTML, nodes['.fytabsbox'].innerHTML, nodes['.fysumbox'].innerHTML, nodes['.fythead'].innerHTML, ...body.children.map((r) => r.html), nodes['.fynotes'].innerHTML].join('');
  return { el, nodes, html, rows: () => [...body.children], stop: () => { alive = false; } };
}
const flush = () => new Promise((r) => setImmediate(r));

test('factory page: first load fetches even when the tab reports hidden', async () => {
  let calls = 0;
  const pg = fakePage();
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ ok: true, factory: { ...SNAP, cols: ['Script'], tiles: [{ ...SNAP.tiles[0], cells: [{ s: 'done' }] }] }, asOf: new Date().toISOString(), channels: [] }) }; };
  pg.el.querySelector('.fyview').hidden = true;
  globalThis.document.hidden = true;
  mount(pg.el);
  await new Promise((r) => setTimeout(r, 50)); pg.stop();
  assert.equal(calls, 1);
  assert.doesNotMatch(pg.html(), /Loading/);
  assert.match(pg.html(), /Tesco Transport Shake-Up/);
  assert.equal(pg.nodes['.fyview'].hidden, false);
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

async function open(sub = '', asOf = new Date().toISOString()) {
  const pg = fakePage(sub);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, factory: TABLE, asOf, channels: CHANNELS }) });
  mount(pg.el);
  await new Promise((r) => setTimeout(r, 50)); pg.stop();
  return pg;
}
const board = async (sub, asOf) => (await open(sub, asOf)).html();

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
  assert.equal((html.match(/aria-label="Later step"/g) || []).length, 2);
});

test('factory table: stuck is a small red pill with the hours in Waiting, rows keep a white fill, owner is a name', async () => {
  const html = await board();
  const rows = html.split('<tr class="fyrow').slice(1);
  assert.doesNotMatch(html, /fyrow stuck/);
  assert.match(rows[0], /<b>video editor<\/b><span class="pill crit">Stuck 3h<\/span>/);
  assert.match(rows[1], /<b>elle<\/b><small>5m<\/small>/);
  assert.doesNotMatch(rows[1], /Stuck/);
});

test('factory table: a step nobody started says "Not started", and the top line counts videos per step and stuck ones', async () => {
  const keep = TABLE.tiles;
  const at = (i, s) => COLS.map((_, k) => ({ s: k < i ? 'done' : k === i ? s : 'idle' }));
  TABLE.tiles = [
    { title: 'A - Peter Collins', channel: 'Peter Collins', owner: 'Elle', waitMin: 1500, stuck: true, cells: at(2, 'new') },
    { title: 'B - Peter Collins', channel: 'Peter Collins', owner: 'Elle', waitMin: 10, stuck: false, cells: at(2, 'run') },
    { title: 'C - Rosa Cooks', channel: 'Rosa Cooks', owner: 'Jessica', waitMin: 10, stuck: false, cells: COLS.map(() => ({ s: 'done' })) },
  ];
  try {
    const html = await board();
    assert.match(html, /<span class="fynew">Not started<\/span>/);
    assert.equal((html.match(/class="pg ind"/g) || []).length, 1, 'only the started step animates');
    assert.match(html, /Stuck 25h/);
    const sum = html.match(/<p class="fysum">.*?<\/p>/)[0];
    assert.match(sum, /<b>2<\/b> A-roll/);
    assert.match(sum, /<span class="z"><b>0<\/b> Script<\/span>/);
    assert.match(sum, /<b>1<\/b> Review/);
    assert.match(sum, /pill crit">1 stuck/);
    assert.match(await board('rosa-cooks').then((h) => h.match(/<p class="fysum">.*?<\/p>/)[0]), /pill ok">0 stuck/, 'the line follows the channel filter');
  } finally { TABLE.tiles = keep; }
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

test('factory table: a short host joins the one chip whose name starts with it; two fits or none stay under Other', async () => {
  const keepT = TABLE.tiles; const keepC = CHANNELS.slice();
  CHANNELS.push({ slug: 'nora-fairweather-cats', label: 'Nora Fairweather Cats', group: 'Home Guide Press' }, { slug: 'rosas-clean-home', label: "Rosa's Clean Home", group: 'Home Guide Press' });
  const done = COLS.map(() => ({ s: 'done' }));
  TABLE.tiles = [
    { title: 'A - Nora Fairweather', channel: 'Nora Fairweather', owner: 'elle', waitMin: 1, cells: done },
    { title: 'B - Nora Fairweather Cats', channel: 'Nora Fairweather Cats', owner: 'elle', waitMin: 1, cells: done },
    { title: 'C - Rosa', channel: 'Rosa', owner: 'elle', waitMin: 1, cells: done }, // Rosa Cooks and Rosa's Clean Home both fit
  ];
  try {
    const html = await board();
    assert.match(html, /data-page="factory\/nora-fairweather-cats"[^>]*>Nora Fairweather Cats<span class="ccn">2<\/span>/);
    assert.doesNotMatch(html, /data-page="factory\/norafairweather"/, 'no duplicate chip for the short name');
    assert.match(html, /<b>Other<\/b>.*data-page="factory\/rosa"[^>]*>Rosa<span class="ccn">1<\/span>/);
    assert.match(html, /All channels<span class="ccn">3<\/span>/);
    const nora = await board('nora-fairweather-cats');
    assert.match(nora, /A<\/b>/); assert.match(nora, /B<\/b>/); assert.doesNotMatch(nora, /C<\/b>/);
  } finally { TABLE.tiles = keepT; CHANNELS.splice(0, CHANNELS.length, ...keepC); }
});

test('factory table: each column header shows its owner in brackets', async () => {
  const keep = TABLE.owners; TABLE.owners = ['Sydney', 'Nina', 'Scarlett', 'Elle, Scarlett', 'Elle, Scarlett', 'Olivia', 'Jessica'];
  try {
    const html = await board();
    assert.match(html, /<th class="fycell">Script<small class="fyown">\(Sydney\)<\/small><\/th>/);
    assert.match(html, /<th class="fycell">Clips<small class="fyown">\(Elle, Scarlett\)<\/small><\/th>/);
  } finally { TABLE.owners = keep; }
});

test('factory table: a live cell turns green with a Live dot and what is running, the count is on top, the rest stays white', async () => {
  const keep = TABLE.tiles;
  const cells = (live) => COLS.map((_, k) => (k === 3 ? { s: 'run', done: 14, total: 32, ...(live ? { live } : {}) } : { s: k < 3 ? 'done' : 'idle' }));
  TABLE.tiles = [
    { title: 'A - Peter Collins', channel: 'Peter Collins', owner: 'Elle', waitMin: 5, cells: cells('Clips 14/32 on GPU1') },
    { title: 'B - Rosa Cooks', channel: 'Rosa Cooks', owner: 'Elle', waitMin: 5, cells: cells(null) },
  ];
  try {
    const html = await board();
    assert.equal((html.match(/class="fycell fylv"/g) || []).length, 1, 'only the live cell is green');
    assert.match(html, /<td class="fycell fylv">.*?<span class="fylt"><i class="fydot"><\/i>Live<\/span><small class="fylx">Clips 14\/32 on GPU1<\/small><\/td>/);
    assert.match(html, /<span class="fylc on"><i class="fydot"><\/i><b>1<\/b> live now<\/span>/);
    assert.match(await board('rosa-cooks'), /<span class="fylc"><i class="fydot"><\/i><b>0<\/b> live now<\/span>/, 'the count follows the channel filter');
    const old = await board('', new Date(Date.now() - 300000).toISOString());
    assert.doesNotMatch(old, /fylv/, 'a stale snapshot shows nothing as live');
    assert.match(old, /<b>0<\/b> live now/);
  } finally { TABLE.tiles = keep; }
});

test('factory table: an Original link sits above the title, only for a real YouTube link; the Upload cell links the video and says what is missing', async () => {
  const keep = TABLE.tiles; const keepCols = TABLE.cols;
  const cols = [...COLS, 'Thumbnail', 'Upload'];
  const ours = 'https://youtu.be/BBBBBBBBBBB';
  TABLE.cols = cols;
  TABLE.tiles = [
    { title: 'A - Peter Collins', channel: 'Peter Collins', owner: 'Elle', waitMin: 5, original: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
      cells: [...COLS.map(() => ({ s: 'done' })), { s: 'done' }, { s: 'run', note: 'Needs playlist + pinned comment <i>', link: ours }] },
    { title: 'B - Rosa Cooks', channel: 'Rosa Cooks', owner: 'Elle', waitMin: 5, original: 'javascript:alert(1)',
      cells: [...COLS.map(() => ({ s: 'done' })), { s: 'new' }, { s: 'idle' }] },
    { title: 'C - Rosa Cooks', channel: 'Rosa Cooks', owner: 'Elle', waitMin: 5, original: 'https://evil.example/watch?v=AAAAAAAAAAA',
      cells: [...COLS.map(() => ({ s: 'done' })), { s: 'done' }, { s: 'done', link: ours }] },
  ];
  try {
    const html = await board();
    const rows = html.split('<tr class="fyrow').slice(1);
    assert.match(rows[0], /<td><a class="fyorig" href="https:\/\/www\.youtube\.com\/watch\?v=AAAAAAAAAAA" target="_blank" rel="noopener noreferrer">Original<\/a><b>A<\/b><small>Peter Collins<\/small><\/td>/);
    assert.doesNotMatch(rows[1], /fyorig/, 'javascript: is never a link');
    assert.doesNotMatch(rows[2], /fyorig/, 'only YouTube links');
    assert.match(rows[0], /<span>Needs playlist \+ pinned comment &lt;i&gt;<\/span>/, 'the missing part is shown, escaped');
    assert.equal((html.match(/class="fylk" href="https:\/\/youtu\.be\/BBBBBBBBBBB"/g) || []).length, 2, 'the video is linked from a running and a done Upload cell');
    assert.match(html, /<th[^>]*>Thumbnail<\/th>/);
    assert.match(html, /<th[^>]*>Upload<\/th>/);
    const sum = html.match(/<p class="fysum">.*?<\/p>/)[0];
    assert.match(sum, /<b>1<\/b> Thumbnail/);
    assert.match(sum, /<b>1<\/b> Upload/);
    assert.match(sum, /<b>1<\/b> Review/);
  } finally { TABLE.tiles = keep; TABLE.cols = keepCols; }
});

test('factory panel: GPU1 and GPU2 lines with what runs and how many wait, the team working first then idle', async () => {
  const keep = { gpus: TABLE.gpus, team: TABLE.team };
  TABLE.gpus = { gpu1: { running: [{ type: 'Clips', what: 'peter-2', runningS: 600 }], waiting: 4 }, gpu2: { running: [{ type: 'Z-Image Turbo', what: 'rosa-house', runningS: 125 }], waiting: 12 } };
  TABLE.team = [{ name: 'Elle', working: true, idleMin: 0, card: 'Rosa <b>' }, { name: 'Ana', working: false, idleMin: 75, card: '' }];
  try {
    const pg = await open();
    const p = pg.nodes['.fypanel'].innerHTML;
    assert.match(p, /<b>GPU1<\/b> Clips · peter-2 · 10m · 4 waiting/);
    assert.match(p, /<b>GPU2<\/b> Z-Image Turbo · rosa-house · 2m · 12 waiting/);
    assert.ok(p.indexOf('Elle') < p.indexOf('Ana'), 'the feed order (working first) is kept');
    assert.match(p, /<p class="fyt on"><i class="fydot"><\/i><b>Elle<\/b><span>Working<\/span><em title="Rosa &lt;b&gt;">Rosa &lt;b&gt;<\/em>/);
    assert.match(p, /<b>Ana<\/b><span>Idle 1h 15m<\/span>/);
    TABLE.gpus = { gpu1: null, gpu2: { running: [], waiting: 0 } };
    assert.match((await open()).nodes['.fypanel'].innerHTML, /<b>GPU1<\/b> <span class="muted">queue unreadable<\/span>.*<b>GPU2<\/b> <span class="muted">Idle<\/span> · 0 waiting/);
    TABLE.gpus = undefined; TABLE.team = undefined;
    assert.equal((await open()).nodes['.fypanel'].innerHTML, '', 'no data: no panel');
    TABLE.gpu = { running: [{ model: 'LTX', who: 'old', runningS: 60 }], waiting: 1 };
    const old = (await open()).nodes['.fypanel'].innerHTML;
    assert.match(old, /<b>GPU1<\/b> LTX · old · 1m · 1 waiting/, 'an older snapshot still shows GPU1');
    assert.doesNotMatch(old, /GPU2/);
  } finally { Object.assign(TABLE, keep); delete TABLE.gpu; }
});

test('factory refresh: three polls keep unchanged rows, the table and the scroll box; only what changed is touched', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const keep = TABLE.tiles;
  const done = COLS.map(() => ({ s: 'done' }));
  const tile = (id, wait, extra = {}) => ({ id, title: `V${id} - Peter Collins`, channel: 'Peter Collins', owner: 'elle', waitMin: wait, cells: done, ...extra });
  TABLE.tiles = [tile('a', 5), tile('b', 6), tile('c', 7)];
  const pg = fakePage();
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, factory: TABLE, asOf: new Date().toISOString(), channels: CHANNELS }) });
  try {
    mount(pg.el); await flush();
    const [a, b, c] = pg.rows();
    assert.equal(pg.rows().length, 3);
    const poll = async () => { t.mock.timers.tick(15000); await flush(); await flush(); };

    TABLE.tiles = [tile('a', 5), tile('b', 9), tile('c', 7)]; // poll 1: only B changes
    await poll();
    let now = pg.rows();
    assert.equal(now[0], a); assert.equal(now[2], c); assert.notEqual(now[1], b);
    assert.match(now[1].html, /9m/);

    const b2 = now[1];
    const writes = []; // a section whose html did not change is not written again
    for (const k of ['.fypanel', '.fytabsbox', '.fysumbox', '.fythead', '.fycols', '.fynotes']) {
      const n = pg.nodes[k]; let v = n.innerHTML;
      Object.defineProperty(n, 'innerHTML', { get: () => v, set: (x) => { writes.push(k); v = x; } });
    }
    TABLE.tiles = [tile('a', 5), tile('b', 9), tile('c', 7)]; // poll 2: nothing changes
    await poll();
    assert.deepEqual(pg.rows(), [a, b2, c]);
    assert.deepEqual(writes, []);

    TABLE.tiles = [tile('c', 7), tile('a', 5), tile('d', 1)]; // poll 3: B is gone, C moves first, D is new
    await poll();
    now = pg.rows();
    assert.equal(now.length, 3);
    assert.equal(now[0], c); assert.equal(now[1], a);
    assert.equal(now[2].dataset.id, 'd');
    assert.equal(pg.nodes['.fytable'].vars['--fyn'], String(COLS.length));
  } finally { TABLE.tiles = keep; pg.stop(); }
});
