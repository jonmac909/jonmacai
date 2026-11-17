// Dashboard 3 Cards page: a checklist of open cards (every owner, MacFrames included) and the last 7 days of done ones. The list read is
// read-only; the tick box and Delete on each card are tested in cards-delete-tick.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './sqlited1.mjs';
import worker from '../src/worker.js';
import { handleApi } from '../src/api.js';
import { signSession, COOKIE } from '../src/auth.js';
import { cardsData, isMacFrames } from '../src/cards.js';
import { renderCards, ownerName } from '../public/d3/js/cards.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const NOW = Date.parse('2026-11-17T20:00:00Z');
const assets = { fetch: async (r) => new Response(`asset:${new URL(r.url).pathname}`) };
const cookie = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(NOW / 1000) + 10 * 365 * 86400)}`; // far-future expiry: the real clock moves past NOW+1h and a fixed 1 h cookie made these tests fail after 21:00Z on 2026-11-17
const iso = (offsetDays) => new Date(NOW + offsetDays * 86400000).toISOString();

let n = 0;
function card(db, o) {
  n += 1;
  const row = { id: `t_${String(n).padStart(16, '0')}`, title: `Card ${n}`, owner: 'ana', status: 'todo', note: null, project: null, created_by: 'ana', updated_by: 'ana', created_at: iso(-3), updated_at: iso(-1), done_at: null, ...o };
  const keys = Object.keys(row);
  db.sqlite.prepare(`INSERT INTO bot_tasks (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
  return row.id;
}
function seeded() {
  const db = sqliteD1();
  card(db, { title: 'Write the sponsor reply', owner: 'sponsors', status: 'doing' });
  card(db, { title: 'MacFrames audit: Remake, Remix, Sponsor', owner: 'ana', status: 'doing' });
  card(db, { title: 'Voice step as a script', owner: 'developer', status: 'todo', note: 'part of the Mac Frames runner' });
  card(db, { title: 'Edit the Nov 20 video', owner: 'video-editor', status: 'review' });
  card(db, { title: 'Jon to pick a thumbnail', owner: 'jon', status: 'waiting_on_jon' });
  card(db, { title: 'Old thing nobody wants', owner: 'ana', status: 'cancelled' });
  card(db, { title: 'Done two days ago', owner: 'developer', status: 'done', done_at: iso(-2), updated_at: iso(-2) });
  card(db, { title: 'MacFrames sponsor button shipped', owner: 'ana', status: 'done', done_at: iso(-1), updated_at: iso(-1) });
  card(db, { title: 'Done a month ago', owner: 'developer', status: 'done', done_at: iso(-30), updated_at: iso(-30) });
  return db;
}
const withNow = async (fn) => { const real = Date.now; Date.now = () => NOW; try { return await fn(); } finally { Date.now = real; } };

test('cardsData: every open card of every owner, done only from the last 7 days, cancelled never', async () => {
  const c = await cardsData({ DB: seeded() }, NOW);
  assert.deepEqual(c.open.map((x) => x.title).sort(), ['Edit the Nov 20 video', 'Jon to pick a thumbnail', 'MacFrames audit: Remake, Remix, Sponsor', 'Voice step as a script', 'Write the sponsor reply']);
  assert.deepEqual(new Set(c.open.map((x) => x.owner)), new Set(['sponsors', 'ana', 'developer', 'video-editor', 'jon']));
  assert.deepEqual(c.done.map((x) => x.title).sort(), ['Done two days ago', 'MacFrames sponsor button shipped']);
  assert.ok(![...c.open, ...c.done].some((x) => /Old thing|a month ago/.test(x.title)));
  assert.deepEqual(c.counts, { open: 5, done: 2, macframesOpen: 2, macframesDone: 1 });
  assert.equal(c.cut, false);
  assert.equal(await cardsData({}, NOW), null); // no database: null, never made-up rows
});

test('MacFrames is found in the title, the note or the project, however it is spelled', () => {
  for (const c of [{ title: 'MacFrames audit' }, { title: 'Mac Frames runner' }, { title: 'x', note: 'for mac-frames' }, { title: 'x', project: 'macframes' }]) assert.equal(isMacFrames(c), true, JSON.stringify(c));
  for (const c of [{ title: 'Frames of Mac' }, { title: 'Jon Mac video' }, {}]) assert.equal(isMacFrames(c), false, JSON.stringify(c));
});

test('GET /dashboard/api/cards: Jon session only, read only, no-store', async () => {
  const db = seeded();
  const env = { SESSION_SECRET: SECRET, DB: db };
  const call = (headers = {}, method = 'GET') => withNow(() => handleApi(new Request('https://jonmac.ai/dashboard/api/cards', { method, headers }), env, {}));
  assert.equal((await call()).status, 401);
  assert.equal((await call({ Cookie: `${COOKIE}=1.2` })).status, 401);
  const res = await call({ Cookie: await cookie() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.cards.open.length, 5);
  assert.equal(body.cards.open.filter((x) => x.macframes).length, 2);
  // Nothing here writes: a POST, PUT or DELETE changes no card.
  const dump = () => JSON.stringify(db.sqlite.prepare('SELECT * FROM bot_tasks ORDER BY id').all());
  const before = dump();
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = await call({ Cookie: await cookie(), 'Content-Type': 'application/json', 'X-CC': '1', Origin: 'https://jonmac.ai' }, m);
    assert.notEqual(r.status, 200, m);
  }
  assert.equal(dump(), before);
});

test('GET /dashboard/api/cards: 503 when the cards cannot be read', async () => {
  const res = await withNow(async () => handleApi(new Request('https://jonmac.ai/dashboard/api/cards', { headers: { Cookie: await cookie() } }), { SESSION_SECRET: SECRET }, {}));
  assert.equal(res.status, 503);
});

test('/dash/cards: signed out 302 to sign-in, signed in 302 to the page; /dash/ pages are unchanged', async () => {
  const env = { SESSION_SECRET: SECRET, ASSETS: assets, DB: seeded() };
  const go = (path, headers) => withNow(() => worker.fetch(new Request(`https://jonmac.ai${path}`, { headers, redirect: 'manual' }), env, {}));
  for (const p of ['/dash/cards', '/dash/cards/']) {
    const out = await go(p);
    assert.equal(out.status, 302, p);
    assert.equal(out.headers.get('Location'), 'https://jonmac.ai/dash/');
    assert.equal(out.headers.get('Cache-Control'), 'private, no-store');
    const bad = await go(p, { Cookie: `${COOKIE}=1.2` });
    assert.equal(bad.status, 302);
    assert.equal(bad.headers.get('Location'), 'https://jonmac.ai/dash/');
    const inn = await go(p, { Cookie: await cookie() });
    assert.equal(inn.status, 302);
    assert.equal(inn.headers.get('Location'), 'https://jonmac.ai/dash/#cards');
  }
  assert.equal(await (await go('/dash/')).text(), 'asset:/d3/login.html'); // signed out: still the login page
  assert.equal(await (await go('/dash/', { Cookie: await cookie() })).text(), 'asset:/d3/index.html');
  assert.equal((await go('/dash/cardz')).status, 404);
  assert.equal((await go('/dash/cards.js')).status, 404);
  assert.equal(await (await go('/dash/js/cards.js')).text(), 'asset:/d3/js/cards.js'); // the page's own script, like every other page's
});

test('Cards page (signed in): a row per open card with a tick box, title, owner and status; MacFrames on top; done ticked at the bottom', async () => {
  const cards = await cardsData({ DB: seeded() }, NOW);
  const html = renderCards(null, { ok: true, cards });
  assert.equal((html.match(/<li class="ckrow/g) || []).length, 7); // 5 open + 2 done
  assert.equal((html.match(/class="ckbox"/g) || []).length, 5); // open = empty box
  assert.equal((html.match(/class="ckbox on"/g) || []).length, 2); // done = ticked
  assert.equal((html.match(/data-ck-del=/g) || []).length, 7); // a Delete on every row
  assert.match(html, /<b>5<\/b> open cards · <b>5<\/b> owners · <b>2<\/b> MacFrames/);
  const mf = html.indexOf('<b>MacFrames</b>');
  assert.ok(mf > 0 && mf < html.indexOf('<b>Sponsors</b>'), 'MacFrames group first');
  assert.ok(html.indexOf('<b>Done in the last 7 days</b>') > html.lastIndexOf('<b>Video Editor</b>'), 'done group last');
  assert.match(html, /MacFrames audit: Remake, Remix, Sponsor<\/button><span class="ckm"><span class="ckown">Ana<\/span> <span class="ckst s-doing">Doing<\/span> <span class="ckmf">MacFrames<\/span>/);
  assert.match(html, /Jon to pick a thumbnail/);
  assert.match(html, /Waiting on Jon/);
  assert.match(html, /Voice step as a script<\/button><span class="ckm"><span class="ckown">Developer<\/span>/); // the note names Mac Frames, so this one is flagged too
  assert.doesNotMatch(html, /Old thing nobody wants|a month ago/);
  assert.equal(ownerName('video-editor'), 'Video Editor');
  assert.equal(ownerName('some-new-bot'), 'some-new-bot');
});

test('Cards page: titles are escaped, no inline handlers or links in the lists', () => {
  const cards = { open: [{ id: 't_1', title: '<img src=x onerror=alert(1)> & "q"', owner: 'ana', status: 'todo', macframes: false }], done: [], counts: {}, cut: false };
  const html = renderCards(null, { ok: true, cards });
  assert.doesNotMatch(html, /<(input|form|textarea|select|a)\b|onclick|href=/i);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;q&quot;/);
  assert.match(renderCards(null, undefined), /Loading/);
  assert.match(renderCards(null, null), /Could not read the cards/);
  assert.match(renderCards(null, { ok: true, cards: { open: [], done: [], counts: {}, cut: false } }), /<b>0<\/b> open cards/);
});

test('Cards page wiring: one new menu item, a Cards route, writes only through the tick/delete/undelete calls, the other pages unchanged', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const index = read('../public/d3/index.html');
  assert.equal((index.match(/data-nav="cards"/g) || []).length, 1);
  assert.match(index, /<a href="#cards" data-nav="cards">.*<\/svg>Cards<\/a>\n<\/nav>/);
  const app = read('../public/d3/js/app.js');
  assert.match(app, /cards: 'Cards' \};/);
  assert.match(app, /GET \/dashboard\/api\/cards/);
  const js = read('../public/d3/js/cards.js');
  assert.deepEqual([...js.matchAll(/call\('(POST|GET)', `([^`]+)`/g)].map((m) => `${m[1]} ${m[2].replace(/\$\{[^}]+\}/g, ':id')}`).sort(),
    ['GET /v1/tasks/:id', 'POST /v1/tasks/:id/delete', 'POST /v1/tasks/:id/tick', 'POST /v1/tasks/:id/tick', 'POST /v1/tasks/:id/undelete']);
  assert.doesNotMatch(js, /'(PUT|PATCH|DELETE)'|addEventListener/);
  assert.doesNotMatch(read('../src/cards.js'), /(INSERT INTO|UPDATE \w+ SET|DELETE FROM|REPLACE INTO)/i);
});
