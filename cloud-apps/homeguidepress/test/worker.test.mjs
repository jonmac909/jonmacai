import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { keyForProduct, makeToken, retryUnsent, filesFor } from '../src/delivery.js';
import { BY_KEY } from '../src/products.js';

const SECRET = 'mock-only-webhook-key';
const TEST_SECRET = 'mock-only-test-webhook-key';
const BUYER = 'buyer_mock@example.com';

function fixture(vars = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const DB = { prepare(query) {
    const stmt = sql.prepare(query);
    return { bind(...args) { return {
      async run() { return { meta: { changes: Number(stmt.run(...args).changes) } }; },
      async first() { return stmt.get(...args) || null; },
      async all() { return { results: stmt.all(...args) }; },
    }; } };
  } };
  const objects = new Map([['angelo/finally-written-down.pdf', '%PDF-mock-angelo']]);
  const BOOKS = { async get(key) { return objects.has(key) ? { body: objects.get(key), httpMetadata: { contentType: 'application/pdf' } } : null; } };
  const env = { DB, BOOKS, SITE_URL: 'https://homeguidepress.com', RESEND_FROM_ADDRESS: 'books@homeguidepress.com',
    INDEXING: 'false', CHECKOUT_URLS: JSON.stringify({ angelo: 'https://commas.com/checkout/AbC12xyzXYZ' }), PRODUCT_IDS: '{}', FILES: '{}',
    TEST_RECIPIENTS: 'delivered@resend.dev', COMMAS_WEBHOOK_SECRET: SECRET, COMMAS_TEST_WEBHOOK_SECRET: TEST_SECRET,
    RESEND_API_KEY: 'mock-only-resend-key', LINK_SECRET: 'mock-only-link-secret', ...vars };
  const waits = [];
  const ctx = { waitUntil(p) { waits.push(p); } };
  return { sql, env, ctx, settle: () => Promise.all(waits) };
}

function mockResend(t, { fail = false } = {}) {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    const body = JSON.parse(init.body);
    sent.push({ ...body, idempotency: init.headers['Idempotency-Key'] });
    if (fail) return new Response(JSON.stringify({ name: 'mock_failure' }), { status: 500 });
    return new Response(JSON.stringify({ id: 'email-' + sent.length }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = real; });
  return sent;
}

function paid(overrides = {}, tx = 'ORD-MOCK-0001', eventId = 'evt-1') {
  return { id: eventId, type: 'payment.succeeded', created_at: '2026-10-16T12:00:00Z', data: {
    transaction_history_id: tx, payment_id: tx, status: 'succeeded', amount: 19, currency: 'USD', quantity: 1,
    item: { id: 'AbC12', type: 'onetime', title: 'Finally Written Down' }, buyer: { email: BUYER, name: 'Mock Buyer', id: 'user_mock00000000' },
    ...overrides } };
}

async function hook(f, payload, { secret = SECRET, path = '/api/commas/webhook', signature } = {}) {
  const raw = JSON.stringify(payload);
  const sig = signature ?? createHmac('sha256', secret).update(raw).digest('hex');
  const response = await worker.fetch(new Request('https://homeguidepress.com' + path, { method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', 'x-webhook-signature': sig } }), f.env, f.ctx);
  return { status: response.status, body: await response.json() };
}

const get = (f, path, init) => worker.fetch(new Request('https://homeguidepress.com' + path, init), f.env, f.ctx);
const linkFrom = mail => mail.html.match(/https:\/\/homeguidepress\.com\/download\/[^"]+/)[0].replace('https://homeguidepress.com', '');

test('landing page: noindex, chapters, buy link keeps src and utm', async () => {
  const f = fixture();
  const r = await get(f, '/finally-written-down?src=aff-angelo-1&utm_source=youtube&junk=1');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.match(r.headers.get('cache-control'), /no-transform/);
  const body = await r.text();
  assert.match(body, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(body, /Sauces and Sunday Gravy/);
  assert.match(body, /By Giovanni Moretti./);
  assert.match(body, /href="\/go\/angelo\?src=aff-angelo-1&amp;utm_source=youtube"|href="\/go\/angelo\?src=aff-angelo-1&utm_source=youtube"/);
  assert.doesNotMatch(body, /junk/);
  assert.doesNotMatch(body, /testimonial|countdown|bestsell/i);
  await f.settle();
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM clicks WHERE kind='view' AND slug='angelo' AND src='aff-angelo-1'").get().n, 1);
});

test('missing checkout link shows a placeholder, never a buy link', async () => {
  const f = fixture();
  const body = await (await get(f, '/the-long-life-dog')).text();
  assert.match(body, /By Frank Bennett./);
  assert.match(body, /Checkout opens soon/);
  assert.doesNotMatch(body, /href="\/go\/steve/);
  const go = await get(f, '/go/steve?src=x', { redirect: 'manual' });
  assert.equal(go.status, 302);
  assert.equal(go.headers.get('location'), 'https://homeguidepress.com/the-long-life-dog?src=x');
});

test('/go counts the click and forwards attribution to Commas', async () => {
  const f = fixture();
  const r = await get(f, '/go/angelo?src=vid1&utm_campaign=oct', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://commas.com/checkout/AbC12xyzXYZ?src=vid1&utm_campaign=oct');
  await f.settle();
  assert.deepEqual({ ...f.sql.prepare("SELECT slug, src, utm_campaign FROM clicks WHERE kind='buy'").get() }, { slug: 'angelo', src: 'vid1', utm_campaign: 'oct' });
});

test('robots.txt disallows everything before launch; www and http redirect', async () => {
  const f = fixture();
  assert.equal(await (await get(f, '/robots.txt')).text(), 'User-agent: *\nDisallow: /\n');
  const www = await worker.fetch(new Request('https://www.homeguidepress.com/angelo?src=a'), f.env, f.ctx);
  assert.equal(www.headers.get('location'), 'https://homeguidepress.com/angelo?src=a');
  const http = await worker.fetch(new Request('http://homeguidepress.com/'), f.env, f.ctx);
  assert.equal(http.headers.get('location'), 'https://homeguidepress.com/');
  const key = await get(f, '/angelo?src=a', { redirect: 'manual' });
  assert.equal(key.headers.get('location'), 'https://homeguidepress.com/finally-written-down?src=a');
});

test('bad signature is rejected and sends nothing', async t => {
  const f = fixture();
  const sent = mockResend(t);
  assert.equal((await hook(f, paid(), { signature: 'ab'.repeat(32) })).status, 401);
  assert.equal((await hook(f, paid(), { secret: TEST_SECRET })).status, 401);
  assert.equal(sent.length, 0);
});

test('paid webhook: exactly one email per transaction, link downloads the right PDF', async t => {
  const f = fixture();
  const sent = mockResend(t);
  const first = await hook(f, paid());
  assert.deepEqual([first.status, first.body.result], [200, 'sent']);
  assert.equal((await hook(f, paid())).body.duplicate_event, true);
  assert.equal((await hook(f, paid({}, 'ORD-MOCK-0001', 'evt-retry'))).body.result, 'duplicate transaction: already sent');
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.deepEqual(mail.to, [BUYER]);
  assert.equal(mail.from, "Giovanni Moretti <books@homeguidepress.com>");
  assert.equal(mail.reply_to, 'partners@thejonmac.com');
  assert.equal(mail.idempotency, 'hgp-delivery-ORD-MOCK-0001');
  assert.match(mail.html, /30 days/);
  const link = linkFrom(mail);
  const page = await get(f, link);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Download Giovanni Moretti - Finally Written Down\.pdf/);
  const file = await get(f, link + '/0');
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition'), /attachment; filename="Giovanni Moretti - Finally Written Down.pdf"/);
  assert.equal(await file.text(), '%PDF-mock-angelo');
  assert.equal(f.sql.prepare('SELECT downloads FROM orders').get().downloads, 1);
});

test('expired and tampered links fail; expired page offers a fresh link', async t => {
  const f = fixture();
  mockResend(t);
  await hook(f, paid());
  const old = await makeToken(f.env, 'ORD-MOCK-0001', 'angelo', Date.now() - 8 * 86400 * 1000);
  const expired = await get(f, '/download/' + old);
  assert.equal(expired.status, 410);
  const text = await expired.text();
  assert.match(text, /This link has expired/);
  assert.match(text, /action="\/api\/resend-link"/);
  assert.equal((await get(f, '/download/' + old + '/0')).status, 410);
  const fresh = await makeToken(f.env, 'ORD-MOCK-0001', 'angelo');
  const tampered = fresh.replace(/.$/, c => (c === '0' ? '1' : '0'));
  assert.match(await (await get(f, '/download/' + tampered)).text(), /couldn&#39;t open that link/);
  const otherProduct = await makeToken(f.env, 'ORD-MOCK-0001', 'steve');
  assert.equal((await get(f, '/download/' + otherProduct)).status, 410);
});

test('refund revokes the link (matched by buyer email + product, as Commas sends no order ID)', async t => {
  const f = fixture();
  const sent = mockResend(t);
  await hook(f, paid());
  const link = linkFrom(sent[0]);
  const refund = { id: 'evt-refund', type: 'refund.created', data: { refund_id: 'r1', refund_transaction_id: 'xYz12', amount: 19, status: 'success',
    refund_type: 'full', buyer: { email: BUYER.toUpperCase() }, item: { id: 'AbC12' } } };
  assert.equal((await hook(f, refund)).body.result, 'revoked');
  const r = await get(f, link + '/0');
  assert.equal(r.status, 410);
  assert.match(await r.text(), /no longer active/);
  assert.equal(sent.length, 1);
});

test('fresh-link form: sends once per 10 minutes, never reveals whether an email bought', async t => {
  const f = fixture();
  const sent = mockResend(t);
  await hook(f, paid());
  const form = email => get(f, '/api/resend-link', { method: 'POST', body: new URLSearchParams({ email, p: 'angelo' }), redirect: 'manual' });
  const a = await form(BUYER);
  assert.equal(a.status, 303);
  assert.equal(a.headers.get('location'), 'https://homeguidepress.com/thanks?p=angelo&sent=1');
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /fresh link/);
  await form(BUYER);
  assert.equal(sent.length, 2);
  const stranger = await form('nobody@example.com');
  assert.equal(stranger.headers.get('location'), a.headers.get('location'));
  assert.equal(sent.length, 2);
});

test('test webhooks only email the test sink, never a real inbox', async t => {
  const f = fixture();
  const sent = mockResend(t);
  const toJon = await hook(f, paid({ buyer: { email: 'jon+affiliatetest@thejonmac.com' } }, 'ORD-TEST-1', 'evt-t1'), { secret: TEST_SECRET, path: '/api/commas/test-webhook' });
  assert.equal(toJon.body.result, 'send failed');
  const ok = await hook(f, paid({ buyer: { email: 'delivered@resend.dev' } }, 'ORD-TEST-2', 'evt-t2'), { secret: TEST_SECRET, path: '/api/commas/test-webhook' });
  assert.equal(ok.body.result, 'sent');
  assert.deepEqual(sent.map(m => m.to[0]), ['delivered@resend.dev']);
  assert.equal(f.sql.prepare("SELECT is_test FROM orders WHERE transaction_id='ORD-TEST-2'").get().is_test, 1);
  const off = fixture({ COMMAS_TEST_WEBHOOK_SECRET: undefined });
  assert.equal((await hook(off, paid(), { secret: TEST_SECRET, path: '/api/commas/test-webhook' })).status, 404);
});

test('a failed send is retried by the cron, still only one email', async t => {
  const f = fixture();
  mockResend(t, { fail: true });
  assert.equal((await hook(f, paid())).body.result, 'send failed');
  const sent = mockResend(t);
  assert.equal(await retryUnsent(f.env), 1);
  assert.equal(await retryUnsent(f.env), 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].idempotency, 'hgp-delivery-ORD-MOCK-0001');
});

test('unknown Commas product stores the order but sends nothing', async t => {
  const f = fixture();
  const sent = mockResend(t);
  assert.equal((await hook(f, paid({ item: { id: 'ZZZ99' } }))).body.result, 'unknown product');
  assert.equal(sent.length, 0);
  assert.equal(keyForProduct(f.env, 'AbC12'), 'angelo');
  assert.equal(keyForProduct({ ...f.env, PRODUCT_IDS: '{"rosa-cooks":"Q9q9q"}' }, 'Q9q9q'), 'rosa-cooks');
});

test('every public page renders', async () => {
  const f = fixture();
  for (const path of ['/', '/drivers-bundle', '/ready-at-home', '/the-hand-me-down-kitchen', '/fix-it-like-family-did', '/the-old-way-to-a-clean-house', '/the-long-life-dog', '/finally-written-down', '/thanks?p=angelo', '/privacy', '/terms', '/refunds']) {
    const r = await get(f, path);
    assert.equal(r.status, 200, path);
  }
  for (const path of ['/rosa-cooks', '/rosa-hacks', '/rosa-clean']) {
    const r = await get(f, path, { redirect: 'manual' });
    assert.equal(r.status, 301, path);
  }
  assert.match(await (await get(f, '/the-hand-me-down-kitchen')).text(), /Checkout opens soon/);
  assert.equal((await get(f, '/nope')).status, 404);
});

test('focus channel pages (Takeshi, Kenzo, Jiyoung, Peggy): served as clones, $27; Jiyoung and Peggy sell, the rest wait for their book', async () => {
  const ASSETS = { async fetch(u) {
    try { return new Response(readFileSync(new URL('../public' + new URL(u).pathname, import.meta.url), 'utf8')); }
    catch { return new Response('', { status: 404 }); }
  } };
  const pages = { takeshi: ['/the-japanese-way-to-a-lighter-home', 'Takeshi Morimoto'], kenzo: ['/calm-and-ready', 'Kenzo Arai'],
    jiyoung: ['/fresher-after-60-the-korean-way', 'Jiyoung Han'],
    peggy: ['/the-fixed-income-pantry', 'Peggy Donovan'] };
  const SOLD = { jiyoung: 'https://commas.com/checkout/w4gy8obq1WOiKe', peggy: 'https://commas.com/checkout/g4XDGDUvQL5ougI' };
  for (const [key, [path, host]] of Object.entries(pages)) {
    const sold = SOLD[key];
    const f = fixture({ ASSETS, ...(sold ? { CHECKOUT_URLS: JSON.stringify({ [key]: sold }) } : {}) });
    const r = await get(f, path + '?src=aff-' + key + '-1');
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-security-policy'), /fonts\.googleapis\.com/, path);  // CLONE_CSP, so it is the clone
    const body = await r.text();
    assert.match(body, /\$27/, path);
    assert.match(body, new RegExp(host + ' is an AI-created character'), path);
    if (sold) {
      assert.doesNotMatch(body, /Checkout opens soon/, path);
      assert.match(body, new RegExp('<a class="buy" data-buy="' + key + '" href="/go/' + key + '">Buy now for \\$27</a>'), path);
    } else {
      assert.match(body, /Checkout opens soon/, path);
      assert.doesNotMatch(body, new RegExp('href="/go/' + key), path);
    }
    assert.doesNotMatch(body, /\d+\s*(pages|chapters)\b|testimonial|countdown|bestsell|hurry|limited time|—/i, path);
    assert.doesNotMatch(body, /<script|src="http/i, path);
    await f.settle();
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM clicks WHERE kind='view' AND slug=?").get(key).n, 1, path);
    assert.equal((await get(f, '/go/' + key)).headers.get('location'), sold || 'https://homeguidepress.com' + path, path);
  }
});

test('every product with a live checkout link has a file to deliver', () => {
  const w = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  const keys = Object.keys(JSON.parse(w.vars.CHECKOUT_URLS));
  assert.ok(keys.length > 0);
  for (const key of keys) {
    assert.ok(BY_KEY[key], key);
    assert.ok(filesFor(w.vars, BY_KEY[key]).length > 0, key);  // files in products.js or vars.FILES
  }
});

test('homepage shelf lists Jiyoung and Peggy and leaves out the 3 books not for sale yet', async () => {
  const body = await (await get(fixture(), '/')).text();
  for (const path of ['/finally-written-down', '/fresher-after-60-the-korean-way', '/the-fixed-income-pantry']) assert.match(body, new RegExp('href="' + path + '"'), path);
  for (const path of ['/the-japanese-way-to-a-lighter-home', '/calm-and-ready', '/three-ingredients-and-a-pan'])
    assert.doesNotMatch(body, new RegExp('href="' + path + '"'), path);
});

test('books with no chapter list yet still render from the template when no clone is served', async () => {
  const f = fixture();
  for (const path of ['/the-japanese-way-to-a-lighter-home', '/calm-and-ready']) {
    const r = await get(f, path);
    assert.equal(r.status, 200, path);
    assert.match(await r.text(), /The full chapter list goes here once the book is finished/, path);
  }
});
