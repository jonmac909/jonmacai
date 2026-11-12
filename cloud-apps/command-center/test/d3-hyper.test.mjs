// Dashboard 3 Hyper page (docs/dashboard-3.md): the ticket that opens the HyperFrames app, and the page that frames it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleApi } from '../src/api.js';
import { signSession, hmacHex, COOKIE } from '../src/auth.js';
import { hyperTicket, hyperTicketOk, TICKET_SECONDS } from '../src/hyper.js';
import { renderHyper, openHyper } from '../public/d3/js/hyper.js';

const SECRET = 'test-session-secret-32-bytes-ok!';
const env = { SESSION_SECRET: SECRET };
const api = (path, headers = {}, method = 'GET') => handleApi(new Request(`https://jonmac.ai/dashboard/api${path}`, { method, headers }), env, {});
const session = async () => `${COOKIE}=${await signSession(SECRET, Math.floor(Date.now() / 1000) + 3600)}`;

test('GET /dashboard/api/hyper/ticket: Jon’s session only; the answer is the app’s entry address with a 60-second ticket', async () => {
  assert.equal((await api('/hyper/ticket')).status, 401);
  assert.equal((await api('/hyper/ticket', { Cookie: `${COOKIE}=1.2` })).status, 401);
  assert.equal((await api('/hyper/ticket', { Cookie: await session() }, 'POST')).status, 403); // read only: nothing answers a write here
  const res = await api('/hyper/ticket', { Cookie: await session() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.equal(body.origin, 'https://hyper.jonmac.ai');
  assert.equal(body.seconds, 60);
  const m = /^https:\/\/hyper\.jonmac\.ai\/__enter\?t=(\d+\.[0-9a-f]{64})$/.exec(body.url);
  assert.ok(m, body.url);
  const left = Number(m[1].split('.')[0]) - Date.now() / 1000;
  assert.ok(left > 55 && left <= 60, String(left));
  const ok = await api(`/hyper/check?t=${m[1]}`); // no session: the gate Worker asks, and the ticket is the proof
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
});

test('GET /dashboard/api/hyper/check: refuses anything that is not a live ticket', async () => {
  const now = Date.now();
  const sec = Math.floor(now / 1000);
  const good = await hyperTicket(env, now);
  assert.equal(await hyperTicketOk(env, good, now), true);
  assert.equal(await hyperTicketOk(env, good, now + TICKET_SECONDS * 1000), false); // expired
  assert.equal(await hyperTicketOk({ SESSION_SECRET: 'another' }, good, now), false);
  assert.equal(await hyperTicketOk({}, good, now), false);
  const sessionToken = await signSession(SECRET, sec + 30); // a session cookie's value is not a ticket
  const gcal = `${sec + 30}.${await hmacHex(SECRET, `gcal.${sec + 30}`)}`; // nor is a Google sign-in state
  const far = `${sec + 3600}.${await hmacHex(SECRET, `hyper.${sec + 3600}`)}`; // nor one dated further ahead than 60 s
  const [exp, sig] = good.split('.');
  for (const t of ['', 'x', sessionToken, gcal, far, `${Number(exp) + 1}.${sig}`, `${exp}.${sig.slice(0, 63)}`, `${exp}.${sig}0`, `${good} `, good.toUpperCase().replace(/[0-9]+\./, `${exp}.`)]) {
    const res = await api(`/hyper/check?t=${encodeURIComponent(t)}`);
    assert.equal(res.status, 401, t);
    assert.deepEqual(await res.json(), { ok: false });
  }
  assert.equal((await api('/hyper/check')).status, 401);
});

test('Hyper page: in the menu after Scripts, drawn once with a hidden frame, opened with the ticket address', async () => {
  const index = readFileSync(new URL('../public/d3/index.html', import.meta.url), 'utf8');
  assert.match(index, /Scripts<\/a>\n<a href="#hyper" data-nav="hyper">.*Hyper<\/a>\n<a href="#money"/);
  const app = readFileSync(new URL('../public/d3/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /hyper: 'Hyper'/);
  assert.match(app, /if \(!main\.querySelector\?\.\('#hyFrame'\)\)/); // a data reload must not restart the app
  const html = renderHyper(null);
  assert.match(html, /<h1>Hyper<\/h1>/);
  assert.match(html, /<iframe id="hyFrame" title="HyperFrames"[^>]* hidden><\/iframe>/);
  assert.doesNotMatch(html, /src=/);
  const el = (extra = {}) => ({ hidden: false, isConnected: true, textContent: '', innerHTML: '', ...extra });
  const page = () => {
    const parts = { '#hyFrame': el({ hidden: true, src: '' }), '#hyNote': el(), '#hyTab': el({ hidden: true, href: '#hyper' }) };
    return { parts, main: { querySelector: (s) => parts[s] || null } };
  };
  const url = 'https://hyper.jonmac.ai/__enter?t=1.abc';
  const a = page();
  const asked = [];
  await openHyper(a.main, async (p) => { asked.push(p); return { body: { url, origin: 'https://hyper.jonmac.ai' } }; });
  assert.deepEqual(asked, ['/dashboard/api/hyper/ticket']);
  assert.equal(a.parts['#hyFrame'].src, url);
  assert.equal(a.parts['#hyFrame'].hidden, false);
  assert.equal(a.parts['#hyNote'].hidden, true);
  assert.equal(a.parts['#hyTab'].href, 'https://hyper.jonmac.ai/');
  assert.equal(a.parts['#hyTab'].hidden, false);
  const b = page(); // signed out: a sign-in link, no frame
  await openHyper(b.main, async () => ({ signedOut: true }));
  assert.match(b.parts['#hyNote'].innerHTML, /href="\/dash\/"/);
  assert.equal(b.parts['#hyFrame'].hidden, true);
  for (const body of [{}, { url: 'javascript:alert(1)', origin: 'https://hyper.jonmac.ai' }, { url: 'http://hyper.jonmac.ai/', origin: 'https://hyper.jonmac.ai' }]) {
    const c = page(); // an address that is not https never reaches the frame
    await openHyper(c.main, async () => ({ body }));
    assert.equal(c.parts['#hyFrame'].src, '');
    assert.match(c.parts['#hyNote'].textContent, /Could not open the app/);
  }
  const d = page(); // the dashboard could not be reached
  await openHyper(d.main, async () => { throw new Error('/dashboard/api/hyper/ticket answered 500'); });
  assert.match(d.parts['#hyNote'].textContent, /answered 500/);
});

test('d3.css: the Hyper frame fills the window under the header', () => {
  const css = readFileSync(new URL('../public/d3/css/d3.css', import.meta.url), 'utf8');
  assert.match(css, /\.d3 \.card\.hy\{[^}]*height:calc\(100vh - 118px\)/);
  assert.match(css, /\.d3 \.shell:has\(\.main\[data-page="hyper"\]\)\{max-width:none\}/);
});
