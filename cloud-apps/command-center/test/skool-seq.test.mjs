// Skool 7-day email sequence: switch, cron sender, stops, unsubscribe, Resend webhook, test send, leads page. See src/skoolseq.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { runSequence, unsubUrl, verifySvix, TEST_TO, SEQ_CRON } from '../src/skoolseq.js';
import { EMAILS, renderEmail } from '../src/skoolmail.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const KEY = 're_test_key_do_not_print_123456';
const WH = `whsec_${Buffer.from('webhook-test-secret').toString('base64')}`;
const T0 = Date.parse('2026-11-20T10:00:00Z');
const H = 3600e3;
const mkenv = (extra = {}) => ({ DB: sqliteD1(), SESSION_SECRET: SECRET, RESEND_API_KEY: KEY, RESEND_WEBHOOK_SECRET: WH, SKOOL_ADDRESS: '1 Test Street, Kelowna BC', SKOOL_ZAP_TOKEN: 'zap', ...extra });
const iso = (ms) => new Date(ms).toISOString();
function resendMock({ fail = 0 } = {}) {
  const calls = []; let n = 0, failed = 0;
  const fn = async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    const body = JSON.parse(init.body);
    calls.push({ headers: init.headers, body });
    if (failed < fail) { failed++; return new Response(JSON.stringify({ message: 'boom' }), { status: 500 }); }
    return new Response(JSON.stringify({ id: `re-${++n}` }), { status: 200 });
  };
  fn.calls = calls;
  return fn;
}
async function addLead(e, email, { slug = 'vid-one', title = 'My First Video', at = T0, check = 'valid' } = {}) {
  await e.DB.prepare('INSERT OR IGNORE INTO skool_links (slug, title, created_at, capture) VALUES (?, ?, ?, 1)').bind(slug, title, iso(T0 - 864e5)).run();
  await e.DB.prepare('INSERT INTO skool_leads (slug, email, at, last_at, email_check) VALUES (?, ?, ?, ?, ?)').bind(slug, email, iso(at), iso(at), check).run();
}
const on = (e) => e.DB.prepare("INSERT INTO skool_settings (key, value, updated_at) VALUES ('skool_sequence_on', '1', ?) ON CONFLICT(key) DO UPDATE SET value = '1'").bind(iso(T0)).run();
const sends = async (e) => (await e.DB.prepare('SELECT email, day, status, attempts, resend_id FROM skool_seq_sends ORDER BY email, day').all()).results;
async function go(e, path, { method = 'GET', body, jon, headers = {}, raw } = {}) {
  const h = new Headers(headers);
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: 'manual' }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}

test('the switch is OFF by default: with leads waiting, the cron sends nothing and claims nothing', async () => {
  const e = mkenv(); const fx = resendMock();
  await addLead(e, 'a@gmail.com');
  const r = await runSequence(e, T0 + H, fx);
  assert.equal(r.skipped, 'off');
  assert.equal(fx.calls.length, 0);
  assert.deepEqual(await sends(e), []);
  await e.DB.prepare("INSERT INTO skool_settings (key, value, updated_at) VALUES ('skool_sequence_on', '0', 'x')").run();
  assert.equal((await runSequence(e, T0 + H, fx)).skipped, 'off');
  assert.equal(fx.calls.length, 0);
});

test('ON still sends nothing without the Resend key, or while the mailing address is the placeholder', async () => {
  const fx = resendMock();
  const noKey = mkenv({ RESEND_API_KEY: undefined }); await addLead(noKey, 'a@gmail.com'); await on(noKey);
  assert.equal((await runSequence(noKey, T0 + H, fx)).skipped, 'no-key');
  const noAddr = mkenv({ SKOOL_ADDRESS: undefined }); await addLead(noAddr, 'a@gmail.com'); await on(noAddr);
  assert.equal((await runSequence(noAddr, T0 + H, fx)).skipped, 'no-address');
  const ph = mkenv({ SKOOL_ADDRESS: '[ADDRESS]' }); await addLead(ph, 'a@gmail.com'); await on(ph);
  assert.equal((await runSequence(ph, T0 + H, fx)).skipped, 'no-address');
  assert.equal(fx.calls.length, 0);
  assert.deepEqual(await sends(noKey), []);
});

test('day 0 goes out to the lead: right sender, their video, unsubscribe headers and link, no key in the body, one row', async () => {
  const e = mkenv(); const fx = resendMock();
  await addLead(e, 'sam@gmail.com'); await on(e);
  const r = await runSequence(e, T0 + 60e3, fx);
  assert.equal(r.sent, 1);
  const { body, headers } = fx.calls[0];
  assert.equal(headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(body.to, ['sam@gmail.com']);
  assert.equal(body.subject, EMAILS[0].subject);
  assert.match(body.from, /Jon Mac/);
  assert.match(body.text, /My First Video/);
  assert.match(body.html, /My First Video/);
  assert.match(body.text, /utm_campaign=vid-one-email-d0/);
  assert.match(body.text, /https:\/\/jonmac\.ai\/track\/unsub\?e=sam%40gmail\.com&t=[0-9a-f]{32}/);
  assert.match(body.headers['List-Unsubscribe'], /^<https:\/\/jonmac\.ai\/track\/unsub\?e=/);
  assert.equal(body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(body.text, /1 Test Street, Kelowna BC/);
  assert.equal(JSON.stringify(body).includes(KEY), false);
  assert.deepEqual(await sends(e), [{ email: 'sam@gmail.com', day: 0, status: 'sent', attempts: 1, resend_id: 're-1' }]);
});

test('no double sends: a second run, two runs at once and a re-run all leave one email per lead and day', async () => {
  const e = mkenv(); const fx = resendMock();
  await addLead(e, 'sam@gmail.com'); await addLead(e, 'pat@gmail.com'); await on(e);
  await Promise.all([runSequence(e, T0 + 60e3, fx), runSequence(e, T0 + 60e3, fx)]);
  await runSequence(e, T0 + 2 * 60e3, fx);
  assert.equal(fx.calls.length, 2);
  assert.equal((await sends(e)).length, 2);
  await runSequence(e, T0 + 20 * H, fx); // day 1 is not due for 24 h after day 0
  assert.equal(fx.calls.length, 2);
});

test('the week runs: day 1 to 6 each 24 h after the last, 7 emails in all, then it is finished', async () => {
  const e = mkenv(); const fx = resendMock();
  await addLead(e, 'sam@gmail.com'); await on(e);
  let t = T0 + 60e3;
  await runSequence(e, t, fx);
  await runSequence(e, t + 23 * H, fx);
  assert.equal(fx.calls.length, 1);
  for (let d = 1; d <= 6; d++) {
    t += 24 * H; await runSequence(e, t, fx);
    assert.equal(fx.calls.length, d + 1);
    assert.equal(fx.calls[d].body.subject, EMAILS[d].subject);
    assert.match(fx.calls[d].body.text, new RegExp(`utm_campaign=vid-one-email-d${d}`));
  }
  await runSequence(e, t + 30 * 24 * H, fx);
  assert.equal(fx.calls.length, 7);
  assert.equal((await sends(e)).length, 7);
});

test('a catch-up never bursts: after a long gap only one email goes out per lead per run', async () => {
  const e = mkenv(); const fx = resendMock();
  await addLead(e, 'sam@gmail.com'); await on(e);
  await runSequence(e, T0 + 5 * 24 * H, fx);
  await runSequence(e, T0 + 5 * 24 * H + 60e3, fx);
  assert.equal(fx.calls.length, 1);
});

test('a sale stops it: the buyer gets no more emails, also a sale that lands just before the next one', async () => {
  const e = mkenv(); const fx = resendMock();
  await addLead(e, 'buyer@gmail.com'); await addLead(e, 'other@gmail.com'); await on(e);
  await runSequence(e, T0 + 60e3, fx);
  assert.equal(fx.calls.length, 2);
  await e.DB.prepare("INSERT INTO skool_sales (id, email, name, at, created_at, amount) VALUES ('s1', 'buyer@gmail.com', 'B', ?, ?, 9)").bind(iso(T0 + 5 * H), iso(T0 + 5 * H)).run();
  await runSequence(e, T0 + 25 * H, fx);
  assert.deepEqual(fx.calls.slice(2).map((c) => c.body.to[0]), ['other@gmail.com']);
  assert.equal((await sends(e)).filter((s) => s.email === 'buyer@gmail.com').length, 1);
});

test('unsubscribe: one click stops all mail; a bad link does nothing; POST (mail apps one-click) works too', async () => {
  const e = mkenv(); const fx = resendMock();
  await addLead(e, 'leave@gmail.com'); await addLead(e, 'stay@gmail.com'); await on(e);
  await runSequence(e, T0 + 60e3, fx);
  const bad = await go(e, '/track/unsub?e=leave%40gmail.com&t=0000');
  assert.equal(bad.status, 400);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_seq_stops').first()).n, 0);
  const url = new URL(await unsubUrl(e, 'leave@gmail.com'));
  const ok = await go(e, url.pathname + url.search);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /unsubscribed/);
  assert.deepEqual((await e.DB.prepare('SELECT email, reason FROM skool_seq_stops').all()).results, [{ email: 'leave@gmail.com', reason: 'unsubscribed' }]);
  await runSequence(e, T0 + 25 * H, fx);
  assert.deepEqual(fx.calls.slice(2).map((c) => c.body.to[0]), ['stay@gmail.com']);
  const post = new URL(await unsubUrl(e, 'stay@gmail.com'));
  assert.equal((await go(e, post.pathname + post.search, { method: 'POST', raw: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 200);
  await runSequence(e, T0 + 50 * H, fx);
  assert.equal(fx.calls.length, 3);
  // someone who unsubscribed and enters their email again on another video still gets nothing
  await addLead(e, 'leave@gmail.com', { slug: 'vid-two', title: 'Two', at: T0 + 60 * H });
  await runSequence(e, T0 + 61 * H, fx);
  assert.equal(fx.calls.length, 3);
});

async function svix(secret, id, body, ts = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', Buffer.from(secret.replace('whsec_', ''), 'base64'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`))).toString('base64');
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}` };
}
const hook = async (e, type, data, { secret = WH, ts } = {}) => {
  const raw = JSON.stringify({ type, data });
  return go(e, '/track/api/resend', { method: 'POST', raw, headers: { 'Content-Type': 'application/json', ...(await svix(secret, 'msg_1', raw, ts)) } });
};

test('Resend webhook: bounce and complaint stop the lead, open is recorded, unsigned or foreign mail is ignored', async () => {
  const e = mkenv(); const fx = resendMock();
  for (const a of ['bounce@gmail.com', 'spam@gmail.com', 'reader@gmail.com', 'soft@gmail.com']) await addLead(e, a);
  await on(e);
  await runSequence(e, T0 + 60e3, fx);
  const id = async (a) => (await e.DB.prepare('SELECT resend_id FROM skool_seq_sends WHERE email = ?').bind(a).first()).resend_id;
  assert.equal((await go(e, '/track/api/resend', { method: 'POST', raw: '{"type":"email.bounced","data":{"email_id":"re-1"}}' })).status, 401);
  assert.equal((await hook(e, 'email.bounced', { email_id: await id('bounce@gmail.com') }, { secret: `whsec_${Buffer.from('wrong').toString('base64')}` })).status, 401);
  assert.equal((await hook(e, 'email.bounced', { email_id: await id('bounce@gmail.com') }, { ts: 1000 })).status, 401); // too old
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_seq_stops').first()).n, 0);
  assert.equal((await hook(e, 'email.bounced', { email_id: await id('bounce@gmail.com'), bounce: { type: 'Permanent' } })).status, 200);
  assert.equal((await hook(e, 'email.complained', { email_id: await id('spam@gmail.com') })).status, 200);
  assert.equal((await hook(e, 'email.opened', { email_id: await id('reader@gmail.com') })).status, 200);
  assert.equal((await hook(e, 'email.bounced', { email_id: await id('soft@gmail.com'), bounce: { type: 'Transient' } })).status, 200);
  assert.equal((await hook(e, 'email.bounced', { email_id: 'someone-elses-email', to: ['bounce@gmail.com'] })).status, 200); // not ours: ignored
  assert.deepEqual((await e.DB.prepare('SELECT email, reason FROM skool_seq_stops ORDER BY email').all()).results, [{ email: 'bounce@gmail.com', reason: 'bounced' }, { email: 'spam@gmail.com', reason: 'complained' }]);
  assert.ok((await e.DB.prepare("SELECT opened_at FROM skool_seq_sends WHERE email = 'reader@gmail.com'").first()).opened_at);
  await runSequence(e, T0 + 25 * H, fx);
  assert.deepEqual(fx.calls.slice(4).map((c) => c.body.to[0]).sort(), ['reader@gmail.com', 'soft@gmail.com']);
  assert.equal(await verifySvix('', new Headers(), '{}'), false);
  const noSecret = mkenv({ RESEND_WEBHOOK_SECRET: undefined });
  assert.equal((await go(noSecret, '/track/api/resend', { method: 'POST', raw: '{}' })).status, 503);
});

test('a failed send is retried up to 3 times, then given up on; nothing is sent twice', async () => {
  const e = mkenv(); const fx = resendMock({ fail: 3 });
  await addLead(e, 'sam@gmail.com'); await on(e);
  for (let i = 0; i < 3; i++) await runSequence(e, T0 + (i + 1) * 60e3, fx);
  assert.deepEqual(await sends(e), [{ email: 'sam@gmail.com', day: 0, status: 'failed', attempts: 3, resend_id: null }]);
  await runSequence(e, T0 + 10 * 60e3, fx);
  assert.equal(fx.calls.length, 3);
  const e2 = mkenv(); const fx2 = resendMock({ fail: 1 });
  await addLead(e2, 'sam@gmail.com'); await on(e2);
  await runSequence(e2, T0 + 60e3, fx2); await runSequence(e2, T0 + 2 * 60e3, fx2); await runSequence(e2, T0 + 3 * 60e3, fx2);
  assert.equal(fx2.calls.length, 2);
  assert.deepEqual(await sends(e2), [{ email: 'sam@gmail.com', day: 0, status: 'sent', attempts: 2, resend_id: 're-1' }]);
});

test('who is not enrolled: a kept typo, a lead older than 30 days', async () => {
  const e = mkenv(); const fx = resendMock();
  await addLead(e, 'typo@gmial.com', { check: 'suggested' });
  await addLead(e, 'old@gmail.com', { at: T0 - 40 * 864e5 });
  await addLead(e, 'risky@aonly.test', { check: 'risky' });
  await on(e);
  await runSequence(e, T0 + 60e3, fx);
  assert.deepEqual(fx.calls.map((c) => c.body.to[0]), ['risky@aonly.test']);
});

test('the cron entry point: the 15-minute trigger runs the sequence, and it does nothing while OFF', async () => {
  const e = mkenv(); await addLead(e, 'sam@gmail.com');
  const real = globalThis.fetch; const fx = resendMock();
  globalThis.fetch = (u, i) => (String(u).startsWith('https://api.resend.com') ? fx(u, i) : real(u, i));
  try {
    const waits = [];
    await worker.scheduled({ cron: SEQ_CRON }, e, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    assert.equal(fx.calls.length, 0);
    await e.DB.prepare("INSERT INTO skool_settings (key, value, updated_at) VALUES ('skool_sequence_on', '1', 'x')").run();
    await e.DB.prepare('UPDATE skool_leads SET at = ?, last_at = ?').bind(iso(Date.now() - 60e3), iso(Date.now() - 60e3)).run();
    await worker.scheduled({ cron: SEQ_CRON }, e, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
    assert.equal(fx.calls.length, 1);
  } finally { globalThis.fetch = real; }
});

test('the On/Off switch needs the session and X-CC, starts Off, and never turns itself on', async () => {
  const e = mkenv();
  assert.equal((await go(e, '/track/api/sequence', { method: 'POST', body: { on: true } })).status, 401);
  const cookie = `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;
  const noHeader = new Request('https://jonmac.ai/track/api/sequence', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"on":true}' });
  assert.equal((await worker.fetch(noHeader, e, { waitUntil() {} })).status, 403);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM skool_settings').first()).n, 0);
  const page = await (await go(e, '/track', { jon: true })).text();
  assert.match(page, /id="seq" data-on="0" aria-pressed="false">Off</);
  assert.equal((await go(e, '/track/api/sequence', { method: 'POST', jon: true, body: { on: true } })).status, 200);
  assert.match(await (await go(e, '/track', { jon: true })).text(), /data-on="1" aria-pressed="true">On</);
  await go(e, '/track/api/sequence', { method: 'POST', jon: true, body: { on: false } });
  assert.match(await (await go(e, '/track', { jon: true })).text(), /data-on="0"/);
});

test('the test send: all seven to jon@thejonmac.com only, [TEST] subjects, needs the session, Blocked without the key, once per 2 minutes', async () => {
  const e = mkenv(); const real = globalThis.fetch; const fx = resendMock();
  globalThis.fetch = (u, i) => (String(u).startsWith('https://api.resend.com') ? fx(u, i) : real(u, i));
  try {
    assert.equal((await go(e, '/track/api/sequence/test', { method: 'POST', body: {} })).status, 401);
    const r = await go(e, '/track/api/sequence/test', { method: 'POST', jon: true, body: { to: 'someone@else.com' } });
    assert.equal(r.status, 200);
    assert.equal(fx.calls.length, 7);
    assert.deepEqual([...new Set(fx.calls.flatMap((c) => c.body.to))], [TEST_TO]);
    assert.equal(TEST_TO, 'jon@thejonmac.com');
    fx.calls.forEach((c, d) => assert.equal(c.body.subject, `[TEST day ${d} of 6] ${EMAILS[d].subject}`));
    assert.equal((await go(e, '/track/api/sequence/test', { method: 'POST', jon: true, body: {} })).status, 429);
    assert.equal(fx.calls.length, 7);
    assert.deepEqual(await sends(e), []); // a test is not a lead
  } finally { globalThis.fetch = real; }
  const bare = mkenv({ RESEND_API_KEY: undefined });
  const b = await go(bare, '/track/api/sequence/test', { method: 'POST', jon: true, body: {} });
  assert.equal(b.status, 503);
  assert.match((await b.json()).error, /Blocked: Resend key/);
});

test('the preview page shows all 7 emails as they will look, signed-in only, with the key and address status', async () => {
  const e = mkenv({ RESEND_API_KEY: undefined, SKOOL_ADDRESS: undefined });
  await addLead(e, 'a@gmail.com', { title: 'Seedance <UGC> Test' });
  assert.equal((await go(e, '/track/emails')).status, 302);
  const html = await (await go(e, '/track/emails', { jon: true })).text();
  for (const m of EMAILS) assert.ok(html.includes(m.subject.replace(/'/g, '&#39;')), m.subject);
  assert.match(html, /Day 0:[\s\S]*Day 6:/);
  assert.match(html, /Seedance &lt;UGC&gt; Test/);
  assert.match(html, /Blocked: Resend key/);
  assert.match(html, /\[ADDRESS\]/);
  assert.equal((html.match(/Unsubscribe in one click/g) || []).length >= 7, true);
  assert.match(html, /id="test" disabled/);
  assert.match(html, /data-on="0"/);
});

test('copy rules: every email has a P.S., one Skool link tagged with its day, an unsubscribe line, the address, no em dashes, no fake numbers', () => {
  assert.equal(EMAILS.length, 7);
  EMAILS.forEach((m, d) => {
    assert.equal(m.day, d);
    const r = renderEmail(d, { title: 'Vid', slug: 'vid-one', unsubUrl: 'https://jonmac.ai/track/unsub?e=a&t=b', business: 'Biz Inc.', address: '[ADDRESS]' });
    assert.match(r.text, /\nP\.S\. /);
    assert.match(r.text, /Unsubscribe in one click: https:\/\/jonmac\.ai\/track\/unsub/);
    assert.match(r.text, /Biz Inc\.\n\[ADDRESS\]/);
    assert.match(r.html, /<a href="https:\/\/jonmac\.ai\/track\/unsub[^"]*"[^>]*>Unsubscribe in one click<\/a>/);
    const links = r.text.match(/https?:\/\/\S+/g).filter((u) => !u.includes('jonmac.ai/track/unsub'));
    assert.equal(links.length, 1, 'one Skool link');
    const u = new URL(links[0]);
    assert.equal(u.origin + u.pathname, 'https://www.skool.com/ai-ugc');
    assert.equal(u.searchParams.get('utm_campaign'), `vid-one-email-d${d}`);
    const copy = JSON.stringify(m);
    assert.doesNotMatch(copy, /[—–]/); // no dashes
    assert.doesNotMatch(copy, /game.?changer|unlock your potential|delve|elevate/i);
    assert.doesNotMatch(copy, /\b(only \d+|last chance|expires|ends (today|tonight|soon)|hurry|\d+% )/i); // no deadlines or made-up numbers
    assert.ok(m.subject.length < 60);
  });
  assert.match(renderEmail(0, { title: '', slug: 's', unsubUrl: 'u', business: 'B', address: 'A' }).text, /from my video "my video"/);
});

test('Leads page: one row per email with videos, check, sale and sequence status; search, filter and CSV', async () => {
  const e = mkenv();
  await addLead(e, 'first@gmail.com', { slug: 'vid-one', title: 'One', at: T0 });
  await addLead(e, 'first@gmail.com', { slug: 'vid-two', title: 'Two', at: T0 + H });
  await addLead(e, 'buyer@gmail.com', { slug: 'vid-two', title: 'Two', at: T0 + 2 * H, check: 'risky' });
  await addLead(e, 'gone@gmail.com', { slug: 'vid-one', title: 'One', at: T0 + 3 * H });
  await addLead(e, '=cmd@gmail.com', { slug: 'vid-one', title: 'One', at: T0 + 4 * H });
  await e.DB.prepare("INSERT INTO skool_sales (id, email, name, at, created_at, amount) VALUES ('s1', 'buyer@gmail.com', 'B', ?, ?, 9)").bind(iso(T0 + 5 * H), iso(T0 + 5 * H)).run();
  await e.DB.prepare("INSERT INTO skool_seq_stops (email, reason, at) VALUES ('gone@gmail.com', 'unsubscribed', ?)").bind(iso(T0 + 6 * H)).run();
  await e.DB.prepare("INSERT INTO skool_seq_sends (email, day, slug, status, sent_at, opened_at) VALUES ('first@gmail.com', 0, 'vid-one', 'sent', ?, ?), ('first@gmail.com', 1, 'vid-one', 'sent', ?, NULL)").bind(iso(T0), iso(T0 + 60e3), iso(T0 + 24 * H)).run();
  assert.equal((await go(e, '/track/leads')).status, 302);
  assert.equal((await go(e, '/track/leads.csv')).status, 302);
  const page = async (qs = '') => (await go(e, `/track/leads${qs}`, { jon: true })).text();
  let html = await page();
  assert.equal((html.match(/<tr><td>/g) || []).length, 4);
  assert.match(html, /<td>first@gmail\.com<\/td><td>vid-one<br><span class="est">One<\/span><\/td>\s*<td>vid-one, vid-two<\/td>/);
  assert.match(html, /day 1 sent/);
  assert.match(html, /opened/);
  assert.match(html, /stopped: bought/);
  assert.match(html, /\$9/);
  assert.match(html, /unsubscribed/);
  assert.match(html, /Download CSV/);
  assert.match(html, /<th>Bought<\/th>/);
  // search
  html = await page('?q=BUYER');
  assert.equal((html.match(/<tr><td>/g) || []).length, 1);
  assert.equal((await page('?q=two')).match(/<tr><td>/g).length, 2); // by video
  // filters
  assert.equal((await page('?f=bought')).match(/<tr><td>/g).length, 1);
  assert.equal((await page('?f=notbought')).match(/<tr><td>/g).length, 3);
  assert.equal((await page('?f=unsub')).match(/<tr><td>/g).length, 1);
  assert.match(await page('?q=%3Cscript%3E'), /No leads match/);
  assert.doesNotMatch(await page('?q=%22%3E%3Cscript%3Ealert'), /<script>alert/);
  // csv
  const csvRes = await go(e, '/track/leads.csv?f=notbought', { jon: true });
  assert.match(csvRes.headers.get('Content-Type'), /text\/csv/);
  const lines = (await csvRes.text()).trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], 'email,first_video_slug,first_video_title,all_videos,first_seen,last_seen,email_check,bought,amount,sale_date,sequence_status,last_day_sent,opened,stopped');
  assert.ok(lines.some((l) => l.startsWith('first@gmail.com,vid-one,One,vid-one vid-two,')));
  assert.ok(lines.some((l) => l.startsWith("'=cmd@gmail.com,")), 'formula-looking email is neutralised');
  const all = (await (await go(e, '/track/leads.csv', { jon: true })).text()).trim().split('\r\n');
  assert.equal(all.length, 5);
  assert.ok(all.some((l) => l.startsWith('buyer@gmail.com,vid-two,Two,vid-two,') && l.includes(',risky,yes,9,')));
});

test('per-video table shows lead counts; sale intake keeps the amount', async () => {
  const e = mkenv();
  await addLead(e, 'a@gmail.com'); await addLead(e, 'b@gmail.com');
  const r = await go(e, '/track/api/sale', { method: 'POST', headers: { 'X-Track-Token': 'zap' }, body: { email: 'A@gmail.com', transaction_id: 't1', amount: '$9.00' } });
  assert.equal(r.status, 200);
  assert.equal((await e.DB.prepare('SELECT amount FROM skool_sales').first()).amount, 9);
  const html = await (await go(e, '/track', { jon: true })).text();
  assert.match(html, /<th class="n">Leads<\/th>/);
  assert.match(html, /<td class="n">0<\/td><td class="n">0<\/td><td class="n">0<\/td><td class="n">2<\/td>/);
});
