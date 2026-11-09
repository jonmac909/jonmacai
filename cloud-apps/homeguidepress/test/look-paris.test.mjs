// Claudine Marchand's page copies the look of her channel's own book page (styleneverages.com), not the cream template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import worker from '../src/index.js';

const CHECKOUT = 'https://commas.com/checkout/LyB1XeDjxJMhw6';
const env = (urls = { paris: CHECKOUT }) => ({ SITE_URL: 'https://homeguidepress.com', INDEXING: 'true', CHECKOUT_URLS: JSON.stringify(urls) });
const get = (path, e = env()) => worker.fetch(new Request('https://homeguidepress.com' + path, { redirect: 'manual' }), e, { waitUntil() {} });

test('paris page uses its own look: film, 8 real pages in the slider, parts, and every buy button on /go/paris', async () => {
  const r = await get('/the-french-wardrobe-after-60?src=aff-paris-1');
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /<link rel="stylesheet" href="\/looks\/paris\.css">/);
  assert.doesNotMatch(body, /href="\/styles\.css"|class="product/);  // not the default template
  // the source's sections, in the source's order
  const order = ['class="site-header"', 'class="hero"', 'id="watch"', 'id="claudine"', 'class="screens"', 'id="inside"', 'class="divider"', 'id="get"', 'id="parts"', 'class="divider"', 'id="faq"', 'class="site-footer"', 'class="buybar"'];
  let at = -1;
  for (const mark of order) { const i = body.indexOf(mark, at + 1); assert.ok(i > at, mark); at = i; }
  assert.match(body, /<video [^>]*poster="\/looks\/paris\/claudine-wide\.jpg"[^>]*><source src="\/looks\/paris\/claudine-wide\.mp4" type="video\/mp4"><track kind="captions" src="\/looks\/paris\/claudine-intro\.vtt"/);
  for (const n of [4, 9, 16, 34, 40, 60, 64, 73]) assert.match(body, new RegExp(`src="/looks/paris/page-${n}\\.jpg"`), `page ${n}`);
  assert.equal((body.match(/class="pg-r" type="radio"/g) || []).length, 8);
  assert.equal((body.match(/class="part-n"/g) || []).length, 4);

  const buys = [...body.matchAll(/href="(\/go\/[^"]*)"/g)].map(m => m[1]);
  assert.equal(buys.length, 3, 'hero, buy again and buy bar');
  for (const href of buys) assert.equal(href, '/go/paris?src=aff-paris-1');
  assert.doesNotMatch(body, /commas\.com/);  // checkout only through /go/paris
  assert.equal((body.match(/<details>/g) || []).length, 8);  // 2 book questions + 3 from products.js + 3 shared
  assert.match(body, /\$27/);
  assert.match(body, /Payments are processed by Commas/);
  assert.match(body, /General style ideas only\. Not medical advice/);
  assert.match(body, /Claudine Marchand is an AI-created character/);
  assert.doesNotMatch(body, /<script|<form|<s>|price-was|SALE|countdown|days left|Launch price|Gumroad|Hélène|Paris Never Ages|testimonial|bestsell|â€/);

  // every local file the page points at is in public/
  for (const [, path] of body.matchAll(/(?:src|href|poster)="(\/(?:looks|covers)\/[^"#?]+)"/g))
    assert.ok(existsSync(new URL('../public' + path, import.meta.url)), path);
  for (const font of ['archivo', 'caveat'])
    assert.ok(existsSync(new URL(`../public/looks/paris/fonts/${font}.woff2`, import.meta.url)), font);
});

test('paris page with no checkout link shows the placeholder and no buy link', async () => {
  const body = await (await get('/the-french-wardrobe-after-60', env({}))).text();
  assert.match(body, /Checkout opens soon/);
  assert.doesNotMatch(body, /\/go\/paris/);
});

test('/go/paris still forwards to the Commas checkout', async () => {
  const r = await get('/go/paris?src=aff-paris-1');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), CHECKOUT + '?src=aff-paris-1');
});

test('other products keep their layouts', async () => {
  const plain = await (await get('/finally-written-down')).text();
  assert.match(plain, /href="\/styles\.css"/);
  assert.doesNotMatch(plain, /looks\/paris/);
  assert.doesNotMatch(await (await get('/the-christmas-home-plan')).text(), /looks\/paris/);
  assert.doesNotMatch(await (await get('/the-safe-house-guide')).text(), /looks\/paris/);
});
