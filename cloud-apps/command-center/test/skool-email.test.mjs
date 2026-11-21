// Skool tracker, optional email step (off by default, switched per link on /track). See src/skool.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { trackerData } from '../src/skool.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const TOKEN = 'zap-token-for-tests';
const H = { 'X-Track-Token': TOKEN };
const env = () => ({ DB: sqliteD1(), SESSION_SECRET: SECRET, SKOOL_ZAP_TOKEN: TOKEN });
async function go(e, path, { method = 'GET', body, jon, headers = {} } = {}) {
  const h = new Headers(headers);
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
const addLink = (e, slug, title) => go(e, '/track/api/links', { method: 'POST', jon: true, body: { slug, title } });
const toggle = (e, slug, capture, jon = true) => go(e, '/track/api/capture', { method: 'POST', jon, body: { slug, capture } });
const leads = async (e) => (await e.DB.prepare('SELECT slug, email FROM skool_leads ORDER BY id').all()).results;
const sale = (e, b) => go(e, '/track/api/sale', { method: 'POST', headers: H, body: b });

test('email step is on for every new link; switched off, the link forwards straight away', async () => {
  const e = env();
  await addLink(e, 'plain-link', 'Plain');
  assert.equal((await e.DB.prepare('SELECT capture FROM skool_links').first()).capture, 1);
  assert.equal((await go(e, '/plain-link')).status, 200); // new link shows the pop-over
  assert.equal((await toggle(e, 'plain-link', false)).status, 200);
  assert.equal((await e.DB.prepare('SELECT capture FROM skool_links').first()).capture, 0);
  const r = await go(e, '/plain-link');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('Location'), /^https:\/\/www\.skool\.com\/ai-ugc\?utm_source=youtube/);
  assert.equal((await go(e, '/plain-link', { method: 'POST', body: { email: 'a@b.co' } })).status, 302); // POST to an off link forwards, stores nothing
  assert.deepEqual(await leads(e), []);
});

test('email step on: form shows and counts the click; POST stores the email and forwards with UTM only', async () => {
  const e = env();
  await addLink(e, 'gated', 'Gated');
  assert.equal((await toggle(e, 'gated', true)).status, 200);
  const g = await go(e, '/gated');
  assert.equal(g.status, 200);
  const html = await g.text();
  assert.match(html, /Enter your email to get access/);
  assert.doesNotMatch(html, /stays on jonmac\.ai/); // Jon removed the privacy line
  assert.match(html, /<form method="post" action="\/gated">/);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_clicks').first()).n, 1);
  assert.equal((await go(e, '/gated', { method: 'POST', body: { email: 'not-an-email' } })).status, 400);
  assert.deepEqual(await leads(e), []);
  const ok = await go(e, '/gated', { method: 'POST', body: { email: ' Buyer@Example.COM ' } });
  assert.equal(ok.status, 302);
  const to = new URL(ok.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://www.skool.com/ai-ugc');
  assert.equal(to.searchParams.get('utm_campaign'), 'gated');
  assert.equal(to.searchParams.has('email'), false); // the email never travels to Skool
  assert.deepEqual(await leads(e), [{ slug: 'gated', email: 'buyer@example.com' }]);
  await go(e, '/gated', { method: 'POST', body: { email: 'buyer@example.com' } }); // same email and link stays one row
  assert.equal((await leads(e)).length, 1);
  assert.equal((await toggle(e, 'gated', false)).status, 200); // switched off, it forwards again
  assert.equal((await go(e, '/gated')).status, 302);
  assert.equal((await toggle(e, 'nope', true)).status, 404);
});

test('the email step switch needs the session and the X-CC header', async () => {
  const e = env();
  await addLink(e, 'locked', 'Locked');
  assert.equal((await toggle(e, 'locked', true, false)).status, 401);
  const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;
  const noHeader = new Request('https://jonmac.ai/track/api/capture', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'locked', capture: true }) });
  assert.equal((await worker.fetch(noHeader, e, { waitUntil() {} })).status, 403);
  assert.equal((await e.DB.prepare('SELECT capture FROM skool_links').first()).capture, 1); // refused calls changed nothing
  assert.equal((await toggle(e, 'locked', false)).status, 200);
  assert.equal((await e.DB.prepare('SELECT capture FROM skool_links').first()).capture, 0);
});

test('a captured email beats the answer and the estimate; page columns and counts add up', async () => {
  const e = env();
  await addLink(e, 'gated', 'Gated video');
  await addLink(e, 'other', 'Other video');
  await toggle(e, 'other', false);
  await go(e, '/gated', { method: 'POST', body: { email: 'buyer@example.com' } });
  await go(e, '/other'); // latest click is on "other", so an estimate would pick it
  await go(e, '/track/api/answer', { method: 'POST', headers: H, body: { email: 'buyer@example.com', answer: 'Other video' } }); // answer disagrees: email wins
  await sale(e, { email: 'Buyer@Example.com', first_name: 'Exact', transaction_id: 't-exact' });
  await sale(e, { email: 'stranger@example.com', first_name: 'Guess', transaction_id: 't-est' });
  const d = await trackerData(e.DB);
  const by = Object.fromEntries(d.rows.map((r) => [r.slug, r]));
  const exact = d.sales.find((s) => s.name === 'Exact'), guess = d.sales.find((s) => s.name === 'Guess');
  assert.deepEqual([exact.how, exact.slug, guess.how, guess.slug], ['email', 'gated', 'estimate', 'other']);
  assert.deepEqual([by.gated.sales, by.gated.estimated, by.gated.emails, by.gated.capture], [1, 0, 1, true]);
  assert.deepEqual([by.other.sales, by.other.estimated, by.other.emails, by.other.capture], [0, 1, 0, false]);
  const html = await (await go(e, '/track', { jon: true })).text();
  assert.match(html, /<th class="n">Leads<\/th>/);
  assert.match(html, /email match \(exact\)/);
  assert.doesNotMatch(html, /buyer@example\.com/); // captured emails never appear on the page
});

test('a lead after the sale does not count; the newest earlier lead wins', async () => {
  const e = env();
  await addLink(e, 'one-vid', 'One');
  await addLink(e, 'two-vid', 'Two');
  await e.DB.prepare('INSERT INTO skool_leads (slug, email, at) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)')
    .bind('one-vid', 'm@x.co', '2026-11-10T00:00:00.000Z', 'two-vid', 'm@x.co', '2026-11-12T00:00:00.000Z', 'one-vid', 'late@x.co', '2026-11-20T00:00:00.000Z').run();
  await sale(e, { email: 'm@x.co', transaction_id: 'a', first_name: 'M', date: '2026-11-13T00:00:00Z' });
  await sale(e, { email: 'late@x.co', transaction_id: 'b', first_name: 'Late', date: '2026-11-13T00:00:00Z' });
  const d = await trackerData(e.DB);
  const m = d.sales.find((s) => s.name === 'M');
  assert.deepEqual([m.slug, m.how], ['two-vid', 'email']);
  assert.equal(d.sales.find((s) => s.name === 'Late').how, 'none');
  assert.equal(d.unattributed, 1);
});

test('the email is never written to the logs, and a failed save still forwards', async () => {
  const e = env();
  await addLink(e, 'quiet', 'Quiet');
  await toggle(e, 'quiet', true);
  const seen = [];
  const real = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a) => seen.push(a.map(String).join(' '));
  try {
    await go(e, '/quiet', { method: 'POST', body: { email: 'secret@example.com' } });
    const real_prepare = e.DB.prepare;
    const broken = { ...e, DB: { prepare: (sql) => (/skool_leads/.test(sql) ? { bind: () => ({ first: async () => { throw new Error('boom'); }, run: async () => { throw new Error('boom'); } }) } : real_prepare(sql)) } };
    assert.equal((await go(broken, '/quiet', { method: 'POST', body: { email: 'secret@example.com' } })).status, 302);
  } finally { Object.assign(console, real); }
  assert.ok(seen.length > 0); // the failure was reported, by slug only
  assert.ok(!seen.join('\n').includes('secret@example.com'));
});

test('a script cannot flood one link with emails', async () => {
  const e = env();
  await addLink(e, 'flood', 'Flood');
  await toggle(e, 'flood', true);
  for (let i = 0; i < 65; i++) await go(e, '/flood', { method: 'POST', body: { email: `u${i}@example.com` } });
  assert.equal((await leads(e)).length, 60);
});

test('a repeat visit does not move the capture time past an earlier sale', async () => {
  const e = env();
  await addLink(e, 'again', 'Again');
  await toggle(e, 'again', true);
  await go(e, '/again', { method: 'POST', body: { email: 'rep@example.com' } });
  const first = (await e.DB.prepare('SELECT at FROM skool_leads').first()).at;
  await new Promise((r) => setTimeout(r, 15));
  await go(e, '/again', { method: 'POST', body: { email: 'rep@example.com' } });
  assert.equal((await e.DB.prepare('SELECT at FROM skool_leads').first()).at, first);
});

test('before migration 0030 a link still forwards and counts the click', async () => {
  const e = env();
  await addLink(e, 'old-schema', 'Old');
  e.DB.sqlite.exec('ALTER TABLE skool_links DROP COLUMN capture');
  const origError = console.error;
  console.error = () => {};
  try {
    const r = await go(e, '/old-schema');
    assert.equal(r.status, 302);
  } finally { console.error = origError; }
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_clicks').first()).n, 1);
});

test('a sale dated with a bare day matches an email captured earlier that day', async () => {
  const e = env();
  await addLink(e, 'day-vid', 'Day');
  const today = new Date().toISOString().slice(0, 10);
  await e.DB.prepare('INSERT INTO skool_leads (slug, email, at) VALUES (?, ?, ?)').bind('day-vid', 'd@x.co', `${today}T00:00:01.000Z`).run();
  await sale(e, { email: 'd@x.co', transaction_id: 'bare', first_name: 'Bare', date: '2000-01-01' }); // old date: lead is later, no match
  await sale(e, { email: 'd@x.co', transaction_id: 'bare2', first_name: 'Today', date: today });
  const d = await trackerData(e.DB);
  assert.equal(d.sales.find((s) => s.name === 'Today').how, 'email');
  assert.notEqual(d.sales.find((s) => s.name === 'Bare').how, 'email');
});
