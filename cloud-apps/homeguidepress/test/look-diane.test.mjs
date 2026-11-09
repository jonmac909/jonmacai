// Diane Kowalski's page copies the look of her channel's own sales page (jackieshawsafety.com), not the cream template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import worker from '../src/index.js';

const CHECKOUT = 'https://commas.com/checkout/1A150k6AKQ2XaV';
const env = (urls = { diane: CHECKOUT }) => ({ SITE_URL: 'https://homeguidepress.com', INDEXING: 'true', CHECKOUT_URLS: JSON.stringify(urls) });
const get = (path, e = env()) => worker.fetch(new Request('https://homeguidepress.com' + path, { redirect: 'manual' }), e, { waitUntil() {} });

test('diane page uses its own look, with the video, real pages, #buy and every buy button on /go/diane', async () => {
  const r = await get('/the-safe-house-guide?src=aff-diane-1');
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /<link rel="stylesheet" href="\/looks\/diane\.css">/);
  assert.doesNotMatch(body, /href="\/styles\.css"|class="product/);  // not the default template
  assert.match(body, /<a class="btn" href="#buy">Get my copy<\/a>/);  // header scrolls to the buy box
  assert.match(body, /<section id="buy">/);
  assert.match(body, /<video [^>]*poster="\/looks\/diane\/diane-intro-poster\.jpg"[^>]*><source src="\/looks\/diane\/diane-intro\.mp4" type="video\/mp4"><track kind="captions" src="\/looks\/diane\/diane-intro\.vtt"/);
  for (const n of [4, 20, 38, 42, 58]) assert.match(body, new RegExp(`src="/looks/diane/page-${n}\\.jpg"`), `page ${n}`);
  for (const n of [1, 2, 3, 4]) assert.match(body, new RegExp(`src="/looks/diane/part-${n}\\.jpg"`), `part ${n}`);

  const buys = [...body.matchAll(/href="(\/go\/[^"]*)"/g)].map(m => m[1]);
  assert.ok(buys.length >= 4, 'hero, buy box, last call and buy bar');
  for (const href of buys) assert.equal(href, '/go/diane?src=aff-diane-1');
  assert.doesNotMatch(body, /commas\.com/);  // checkout only through /go/diane
  assert.equal((body.match(/<details>/g) || []).length, 8);  // 2 book questions + 3 from products.js + 3 shared
  assert.match(body, /\$27/);
  assert.match(body, /Payments are processed by Commas/);
  assert.match(body, /Not professional security, legal or medical advice/);
  assert.match(body, /Diane Kowalski is an AI-created character/);
  assert.doesNotMatch(body, /<script|<form|<s>|class="was"|SALE|countdown|Stripe|bundle|testimonial|bestsell|—/);

  // every local file the page points at is in public/
  for (const [, path] of body.matchAll(/(?:src|href|poster)="(\/(?:looks|covers)\/[^"#?]+)"/g))
    assert.ok(existsSync(new URL('../public' + path, import.meta.url)), path);
  for (const font of ['montserrat-latin-700-normal', 'source-serif-4-latin-600-normal'])
    assert.ok(existsSync(new URL(`../public/looks/diane/fonts/${font}.woff2`, import.meta.url)), font);
});

test('diane page with no checkout link shows the placeholder and no buy link', async () => {
  const body = await (await get('/the-safe-house-guide', env({}))).text();
  assert.match(body, /Checkout opens soon/);
  assert.doesNotMatch(body, /\/go\/diane/);
});

test('/go/diane still forwards to the Commas checkout', async () => {
  const r = await get('/go/diane?src=aff-diane-1');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), CHECKOUT + '?src=aff-diane-1');
});

test('other products keep their layouts', async () => {
  const plain = await (await get('/finally-written-down')).text();
  assert.match(plain, /href="\/styles\.css"/);
  assert.match(plain, /<article class="product">/);
  assert.doesNotMatch(plain, /looks\/diane/);
  assert.match(await (await get('/the-christmas-home-plan')).text(), /href="\/looks\/eleanor\.css"/);
});
