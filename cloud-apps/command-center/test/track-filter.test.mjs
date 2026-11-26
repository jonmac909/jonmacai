// /track shows real visitors only (Jon, 2026-11-26): team IPs and bots are not counted, test sign-ups are hidden,
// and nothing is deleted. Runs on the SQLite stand-in for D1, never the live database.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { trackerData } from '../src/skool.js';
import { leadsData } from '../src/skoolcrm.js';
import { ipInList, isTeamIp, isBotUA, isTestEmail, TEAM_IPS } from '../src/trackfilter.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const iso = (ms) => new Date(ms).toISOString();
const env = () => ({ DB: sqliteD1(), SESSION_SECRET: 'test-session-secret-32-bytes-ok!', SKOOL_ZAP_TOKEN: 'zap' });
async function visit(e, path, { ip = '203.0.113.9', ua = CHROME, method = 'GET', email } = {}) {
  const h = new Headers({ 'CF-Connecting-IP': ip, 'User-Agent': ua });
  if (email) h.set('Content-Type', 'application/x-www-form-urlencoded');
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, { method, headers: h, body: email ? `email=${encodeURIComponent(email)}` : undefined, redirect: 'manual' }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
const n = async (e, t) => (await e.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n;
const row = async (e, slug = 'vid') => (await trackerData(e.DB)).rows.find((r) => r.slug === slug);
async function seed(e, capture = 0) {
  await e.DB.prepare('INSERT INTO skool_links (slug, title, created_at, capture) VALUES (?, ?, ?, ?)').bind('vid', 'Video', iso(Date.now() - 864e5), capture).run();
}

test('IP list: exact IPv4, IPv4 CIDR, IPv6 prefix; outsiders and junk do not match', () => {
  const L = ['10.1.2.3', '192.168.0.0/16', '2001:db8:aa::/48'];
  assert.ok(ipInList('10.1.2.3', L));
  assert.ok(!ipInList('10.1.2.4', L));
  assert.ok(ipInList('192.168.200.7', L));
  assert.ok(!ipInList('192.169.0.1', L));
  assert.ok(ipInList('2001:db8:aa:ff::1', L));
  assert.ok(ipInList('2001:0db8:00aa:0001:0000:0000:0000:0001', L));
  assert.ok(!ipInList('2001:db8:ab::1', L));
  assert.ok(!ipInList('', L) && !ipInList(null, L) && !ipInList('not-an-ip', L) && !ipInList('1.2.3.999', L));
  // GPU1 (this office) is in the real list, on both IPv4 and its IPv6 network.
  assert.ok(isTeamIp('216.232.165.114'));
  assert.ok(isTeamIp('2001:569:f05c:7900:a014:6817:14a0:7c5b'));
  assert.ok(isTeamIp('2001:569:f05c:7900::1'));
  assert.ok(!isTeamIp('2001:569:f05c:7901::1'));
  assert.ok(TEAM_IPS.length >= 2);
  // planted: a broken entry ('1.2.3.4/', bad or out-of-range bits) matches nothing, never a /0 that hides everyone.
  for (const bad of ['1.2.3.4/', '1.2.3.4/x', '1.2.3.4/33', '1.2.3.4/-1', '1.2.3.4/ 8', '2001:db8::/', '2001:db8::/129'])
    assert.ok(!ipInList('8.8.8.8', [bad]) && !ipInList('1.2.3.4', [bad]) && !ipInList('2001:db8::1', [bad]), bad);
});

test('bot user agents: headless browsers, scripts, crawlers and preview fetchers; real phones and desktops pass', () => {
  for (const ua of ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36',
    'python-requests/2.32', 'curl/8.4.0', 'Wget/1.21', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'facebookexternalhit/1.1', 'Twitterbot/1.0', 'Slackbot-LinkExpanding 1.0', 'WhatsApp/2.23.20', 'Playwright/1.48', 'node-fetch/1.0', 'Discordbot/2.0',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'Mozilla/5.0 (compatible; bot)'])
    assert.ok(isBotUA(ua), ua);
  for (const ua of [CHROME, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0',
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview',
    // planted: CUBOT Android phones are real people ("CUBOT" ends in "bot").
    'Mozilla/5.0 (Linux; Android 11; CUBOT X50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; KingKong 9 Build/TP1A.220624.014; CUBOT) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'])
    assert.ok(!isBotUA(ua), ua);
});

test('test emails: "test" sign-ups, example and team domains; real addresses pass', () => {
  for (const m of ['test@gmail.com', 'test123@yahoo.com', 'jon+test@gmail.com', 'a@example.com', 'x@test.io', 'jon@jonmac.co', 'ana@thejonmac.com', 'bot@jonmac.ai',
    'test.jon@gmail.com', 'jon.test@gmail.com', 'jon_test2@gmail.com', 'a@mail.test', 'x@sub.jonmac.ai'])
    assert.ok(isTestEmail(m), m);
  for (const m of ['latest@gmail.com', 'contest.winner@gmail.com', 'fanofguitars@gmail.com', 'ann@jonmac.com.au.example.org.real.ca', '', null,
    // planted: real people whose address only contains the letters "test".
    'testa.maria@gmail.com', 'testimonials4u@gmail.com', 'jon.testerman@gmail.com', 'bob@contestcanada.ca', 'x@attest.io', 'x@testing.com'])
    assert.ok(!isTestEmail(m), String(m));
});

test('planted: a click from a team IP is not stored or counted; a normal visitor still counts', async () => {
  const e = env(); await seed(e);
  for (const ip of ['216.232.165.114', '2001:569:f05c:7900:a014:6817:14a0:7c5b']) {
    const r = await visit(e, '/vid', { ip });
    assert.equal(r.status, 302); // the team is still forwarded to Skool
  }
  assert.equal(await n(e, 'skool_clicks'), 0);
  await visit(e, '/vid'); // a real visitor
  assert.equal(await n(e, 'skool_clicks'), 1);
  const stored = await e.DB.prepare('SELECT ip, ua FROM skool_clicks').first();
  assert.deepEqual([stored.ip, stored.ua], ['203.0.113.9', CHROME]);
  assert.equal((await row(e)).clicks.all, 1);
});

test('planted: a headless or script user agent is not counted', async () => {
  const e = env(); await seed(e);
  await visit(e, '/vid', { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36' });
  await visit(e, '/vid', { ua: 'python-requests/2.32.3' });
  await visit(e, '/vid', { ua: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' });
  assert.equal(await n(e, 'skool_clicks'), 0);
  assert.equal((await row(e)).clicks.all, 0);
});

test('read time: rows already stored from a team IP, a bot, or the team\'s own pages are hidden, never deleted', async () => {
  const e = env(); await seed(e);
  const now = Date.now();
  const ins = (ip, ua, ref) => e.DB.prepare('INSERT INTO skool_clicks (slug, at, referrer, ip, ua) VALUES (?, ?, ?, ?, ?)').bind('vid', iso(now - 1000), ref, ip, ua).run();
  await ins('216.232.165.114', CHROME, null); // team IP
  await ins('2001:569:f05c:7900::abcd', CHROME, null); // team IPv6 network
  await ins('198.51.100.1', 'curl/8.4.0', null); // bot
  await ins(null, null, 'studio.youtube.com/'); // old row: Jon in YouTube Studio
  await ins(null, null, 'jonmac.ai/track'); // old row: the dashboard
  await ins('198.51.100.2', CHROME, 'www.youtube.com/'); // real
  await ins(null, null, null); // old row with nothing to go on: still counted
  assert.equal((await row(e)).clicks.all, 2);
  assert.equal(await n(e, 'skool_clicks'), 7);
});

test('planted: a test-email lead and sale are hidden on /track and /track/leads; a real lead still counts', async () => {
  const e = env(); await seed(e, 1);
  await visit(e, '/vid', { method: 'POST', email: 'test123@yahoo.com' });
  await visit(e, '/vid', { method: 'POST', email: 'jon@jonmac.co' });
  await visit(e, '/vid', { method: 'POST', email: 'realfan@gmail.com', ip: '216.232.165.114' }); // team IP: saved, hidden
  await visit(e, '/vid', { method: 'POST', email: 'realfan2@gmail.com' }); // real
  assert.equal(await n(e, 'skool_leads'), 4); // all saved: the team can still test the email sequence
  assert.equal((await row(e)).emails, 1);
  const leads = (await leadsData(e.DB)).rows.map((r) => r.email);
  assert.deepEqual(leads, ['realfan2@gmail.com']);
  // A sale from a test address is not listed or attributed.
  await e.DB.prepare('INSERT INTO skool_sales (id, email, name, at, created_at) VALUES (?, ?, ?, ?, ?)').bind('t1', 'test123@yahoo.com', 'T', iso(Date.now()), iso(Date.now())).run();
  await e.DB.prepare('INSERT INTO skool_sales (id, email, name, at, created_at) VALUES (?, ?, ?, ?, ?)').bind('t2', 'realfan2@gmail.com', 'R', iso(Date.now()), iso(Date.now())).run();
  const d = await trackerData(e.DB);
  assert.deepEqual(d.sales.map((s) => s.name), ['R']);
  assert.equal(d.rows.find((r) => r.slug === 'vid').sales, 1);
});
