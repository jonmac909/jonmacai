import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../src/index.js';
import { SALES_CLOSE } from '../src/reminder-plan.js';
import { OFFER_PLAN, OFFER_PRICE } from '../src/offer.js';

const checkout = 'https://commas.com/checkout/nmGzEY7RCWcGOKl';
const seat = query => worker.fetch(new Request('https://jonmac.ai/clone/seat' + query), { CHECKOUT_URL: checkout });

test('email seat link: the live checkout before the sales close, the closed lander after', async t => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['Date'], now: SALES_CLOSE - 60000 });
  const open = await seat('?utm_source=nurture&utm_campaign=d3&email=x@example.test&coupon=FREE');
  assert.equal(open.status, 302);
  assert.equal(open.headers.get('cache-control'), 'no-store');
  assert.equal(open.headers.get('location'), checkout + '?utm_source=nurture&utm_campaign=d3&lp=clone', 'only utm_* tags pass through');
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: SALES_CLOSE });
  const closed = await seat('?utm_source=nurture');
  assert.equal(closed.status, 302);
  assert.equal(closed.headers.get('location'), 'https://jonmac.ai/clone/');
  mock.timers.reset();
  const broken = await worker.fetch(new Request('https://jonmac.ai/clone/seat'), { CHECKOUT_URL: 'not a url' });
  assert.equal(broken.headers.get('location'), 'https://jonmac.ai/clone/', 'a bad CHECKOUT_URL falls back to the lander');
});

test('pages show the one offer price wherever they say {{OFFER_PRICE}}, and never get a stale 304', async () => {
  assert.match(OFFER_PRICE, /^\$\d{1,3}(,\d{3})*$/);
  const seen = [];
  const ASSETS = { async fetch(request) {
    seen.push([new URL(request.url).pathname, request.headers.get('if-none-match')]);
    const html = new URL(request.url).pathname.endsWith('.html');
    const body = request.url.endsWith('/refund.html') ? readFileSync(new URL('../public/refund.html', import.meta.url), 'utf8') : '<meta charset="utf-8"><p>{{OFFER_PRICE}} or {{OFFER_PRICE}}</p>';
    return new Response(body, { headers: { 'content-type': html ? 'text/html; charset=utf-8' : 'text/javascript', etag: '"v1"', 'last-modified': 'Fri, 30 Oct 2026 00:00:00 GMT' } });
  } };
  const page = await worker.fetch(new Request('https://jonmac.ai/clone/vault.html', { headers: { 'if-none-match': '"v1"' } }), { ASSETS });
  assert.equal(page.status, 200);
  assert.equal(await page.text(), `<meta charset="utf-8"><p>${OFFER_PRICE} or ${OFFER_PRICE}</p>`);
  assert.equal(page.headers.get('etag'), null, 'no validator that describes the unfilled file');
  assert.equal(page.headers.get('last-modified'), null);
  const refund = await (await worker.fetch(new Request('https://jonmac.ai/clone/refund.html'), { ASSETS })).text();
  assert.ok(refund.includes(`(${OFFER_PRICE}, or ${OFFER_PLAN})`) && !refund.includes('{{'), 'the refund policy shows the one price');
  const script = await worker.fetch(new Request('https://jonmac.ai/clone/schedule.js', { headers: { 'if-none-match': '"v1"' } }), { ASSETS });
  assert.match(await script.text(), /\{\{OFFER_PRICE\}\}/, 'scripts are served as they are');
  assert.deepEqual(seen, [['/vault.html', null], ['/refund.html', null], ['/schedule.js', '"v1"']]);
});

test('pages use no {{TOKEN}} other than the offer price and plan', () => {
  const dir = new URL('../public/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.html'))) {
    const tokens = readFileSync(new URL(file, dir), 'utf8').match(/\{\{\s*[A-Z_]+\s*\}\}/g) || [];
    assert.deepEqual(tokens.filter(token => !['{{OFFER_PRICE}}', '{{OFFER_PLAN}}'].includes(token)), [], file);
  }
});

test('the lead email and the nurture event carry the seat link and the offer price', async t => {
  const saved = globalThis.fetch, sent = {};
  t.after(() => { globalThis.fetch = saved; mock.timers.reset(); });
  globalThis.fetch = async (url, init = {}) => {
    sent[new URL(url).pathname] = init.body ? JSON.parse(init.body) : null;
    return Response.json({});
  };
  mock.timers.enable({ apis: ['Date'], now: SALES_CLOSE - 86400000 });
  const leads = new Map();
  const env = { RESEND_API_KEY: 'mock-resend', CLONE_LEADS: { async get(k) { return leads.get(k) || null; }, async put(k, v) { leads.set(k, v); } } };
  const res = await worker.fetch(new Request('https://jonmac.ai/clone/api/lead', { method: 'POST',
    headers: { origin: 'https://jonmac.ai', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Seat Test', email: 'seat@example.test' }) }), env);
  assert.deepEqual(await res.json(), { ok: true });
  const email = sent['/emails'], event = sent['/events/send'];
  assert.ok(email.text.includes('https://jonmac.ai/clone/seat'));
  assert.ok(!email.text.includes('commas.com'), 'no direct checkout link that ignores the close');
  assert.equal(event.event, 'clone.lead');
  assert.equal(event.payload.offer_price, OFFER_PRICE);
  assert.equal(event.payload.offer_plan, OFFER_PLAN);
  assert.equal(event.payload.seat_url, 'https://jonmac.ai/clone/seat');
  assert.match(event.payload.session_label, /Thursday, November 12, 2026/);
  assert.deepEqual(event.data, { first_name: 'Seat', name: 'Seat Test' }, 'the existing event field is unchanged');
});
