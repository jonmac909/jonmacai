// Skool pop-over email check: syntax, disposable, role, typo suggestion, DNS (MX/A) over DoH, fail open. See src/skoolcheck.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { parseEmail, isDisposable, isRole, suggestDomain, checkEmail } from '../src/skoolcheck.js';
import { signSession, COOKIE } from '../src/auth.js';
import { sqliteD1 } from './sqlited1.mjs';
import { stubDns, calls } from './dnsstub.mjs';

const SECRET = 'test-session-secret-32-bytes-ok!';
const env = () => ({ DB: sqliteD1(), SESSION_SECRET: SECRET });
async function go(e, path, { method = 'GET', body, jon } = {}) {
  const h = new Headers();
  if (jon) { h.set('Cookie', `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`); h.set('X-CC', '1'); }
  if (body !== undefined) h.set('Content-Type', 'application/json');
  const waits = [];
  const r = await worker.fetch(new Request(`https://jonmac.ai${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }), e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return r;
}
async function linkOn(slug = 'chk') {
  const e = env();
  await go(e, '/track/api/links', { method: 'POST', jon: true, body: { slug, title: 'Check test' } });
  return e;
}
const post = (e, body, slug = 'chk') => go(e, `/s/${slug}`, { method: 'POST', body });
const leads = async (e) => (await e.DB.prepare('SELECT slug, email, email_check FROM skool_leads ORDER BY id').all()).results;

test('syntax: bad emails are refused, nothing is stored, the pop-over comes back with an error and what was typed', async () => {
  stubDns();
  const e = await linkOn();
  for (const bad of ['not-an-email', 'a@b', 'a b@gmail.com', '@gmail.com', 'a@@gmail.com', 'a@gmail..com', 'a@-gmail.com', 'a@1.2.3.4', '']) {
    const r = await post(e, { email: bad });
    assert.equal(r.status, 400, bad);
    const html = await r.text();
    assert.match(html, /Please enter a valid email address\./, bad);
    assert.match(html, /Enter your email to get access/);
  }
  assert.deepEqual(await leads(e), []);
  assert.equal(calls.length, 0); // syntax is checked before any DNS lookup
  assert.deepEqual(parseEmail('Jo.N+tag@Example.COM'), { local: 'jo.n+tag', domain: 'example.com', email: 'jo.n+tag@example.com' });
  assert.equal(parseEmail(`${'a'.repeat(65)}@gmail.com`), null);
});

test('disposable domains are refused (also subdomains), real providers are not', async () => {
  stubDns();
  const e = await linkOn();
  for (const d of ['mailinator.com', 'yopmail.com', 'x.mailinator.com']) {
    const r = await post(e, { email: `someone@${d}` });
    assert.equal(r.status, 400, d);
    assert.match(await r.text(), /not a temporary one/);
  }
  assert.deepEqual(await leads(e), []);
  assert.equal(isDisposable('gmail.com') || isDisposable('outlook.com') || isDisposable('icloud.com') || isDisposable('proton.me'), false);
  assert.equal(calls.length, 0);
});

test('role addresses (admin@, info@, noreply@ ...) are refused, also with a +tag', async () => {
  stubDns();
  const e = await linkOn();
  for (const local of ['admin', 'info', 'noreply', 'support', 'sales', 'info+news']) {
    const r = await post(e, { email: `${local}@company.com` });
    assert.equal(r.status, 400, local);
    assert.match(await r.text(), /not a shared one/);
  }
  assert.deepEqual(await leads(e), []);
  assert.equal(isRole('jon'), false);
  assert.equal(isRole('jane.doe'), false);
});

test('typo: gmial.com gets "Did you mean name@gmail.com?", stores nothing until the visitor chooses', async () => {
  stubDns();
  const e = await linkOn();
  const r = await post(e, { email: 'Sam@gmial.com' });
  assert.equal(r.status, 400);
  const html = await r.text();
  assert.match(html, /Did you mean sam@gmail\.com\?/);
  assert.match(html, /name="suggest" value="sam@gmail\.com"/);
  assert.match(html, /value="fix"/);
  assert.match(html, /value="keep"/);
  assert.deepEqual(await leads(e), []);
  // "Yes": the corrected address is stored, and it is valid
  const fix = await post(e, { email: 'sam@gmial.com', suggest: 'sam@gmail.com', pick: 'fix' });
  assert.equal(fix.status, 302);
  assert.deepEqual(await leads(e), [{ slug: 'chk', email: 'sam@gmail.com', email_check: 'valid' }]);
  // "No, keep": stored as typed, check = suggested
  const keep = await post(e, { email: 'pat@hotmail.cmo', suggest: 'pat@hotmail.com', pick: 'keep' });
  assert.equal(keep.status, 302);
  assert.deepEqual((await leads(e)).at(-1), { slug: 'chk', email: 'pat@hotmail.cmo', email_check: 'suggested' });
  for (const [d, want] of [['gmail.con', 'gmail.com'], ['yaho.com', 'yahoo.com'], ['hotmail.cmo', 'hotmail.com'], ['gmail.com', ''], ['outlook.com', ''], ['jonmac.ai', ''], ['startup.co', '']]) assert.equal(suggestDomain(d), want, d);
});

test('a domain that cannot receive mail is refused (nothing, or a null MX); an A record alone is accepted as risky', async () => {
  stubDns({ 'nomail.test': 'none', 'nullmx.test': 'nullmx', 'aonly.test': 'a', 'noanswer.test': 'noanswer' });
  const e = await linkOn();
  for (const d of ['nomail.test', 'nullmx.test']) {
    const r = await post(e, { email: `real.person@${d}` });
    assert.equal(r.status, 400, d);
    assert.match(await r.text(), /can&#39;t receive mail/);
  }
  assert.deepEqual(await leads(e), []);
  assert.equal((await post(e, { email: 'real.person@aonly.test' })).status, 302);
  assert.deepEqual(await leads(e), [{ slug: 'chk', email: 'real.person@aonly.test', email_check: 'risky' }]);
  assert.ok(calls.includes('nomail.test/MX'));
  const r = await checkEmail('x@noanswer.test'); // MX, A and AAAA all empty
  assert.equal(r.ok, false);
});

test('a good email passes through Cloudflare DNS-over-HTTPS, is stored with check = valid, and forwards', async () => {
  stubDns();
  const e = await linkOn();
  const r = await post(e, { email: ' Buyer@Example-Domain.com ' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('Location'), /^https:\/\/www\.skool\.com\/ai-ugc\?utm_source=youtube/);
  assert.deepEqual(await leads(e), [{ slug: 'chk', email: 'buyer@example-domain.com', email_check: 'valid' }]);
  assert.deepEqual(calls, ['example-domain.com/MX']);
  const row = await e.DB.prepare('SELECT at, last_at FROM skool_leads').first();
  assert.equal(row.at, row.last_at);
});

test('DNS trouble fails open: a timeout (1.5 s) or SERVFAIL still lets the visitor in, marked risky', async () => {
  stubDns({ 'slow.test': 'timeout', 'broken.test': 'servfail' });
  const e = await linkOn();
  const t0 = Date.now();
  const slow = await post(e, { email: 'a.person@slow.test' });
  const took = Date.now() - t0;
  assert.equal(slow.status, 302);
  assert.ok(took >= 1400 && took < 3000, `took ${took} ms`);
  assert.equal((await post(e, { email: 'b.person@broken.test' })).status, 302);
  assert.deepEqual((await leads(e)).map((l) => l.email_check), ['risky', 'risky']);
});

test('a repeat visit keeps the first time, moves last_at and refreshes the check', async () => {
  stubDns({ 'aonly.test': 'a' });
  const e = await linkOn();
  await post(e, { email: 'again@aonly.test' });
  await e.DB.prepare("UPDATE skool_leads SET at = '2026-01-01T00:00:00.000Z', last_at = '2026-01-01T00:00:00.000Z'").run();
  stubDns();
  const before = await e.DB.prepare('SELECT at FROM skool_leads').first();
  await post(e, { email: 'again@aonly.test' });
  const row = await e.DB.prepare('SELECT at, last_at, email_check FROM skool_leads').first();
  assert.equal(row.at, before.at);
  assert.notEqual(row.last_at, row.at);
  assert.equal(row.email_check, 'valid'); // the domain has an MX now: the newest check wins
});
