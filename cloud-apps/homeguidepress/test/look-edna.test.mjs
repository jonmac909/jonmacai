// Edna Haynes' page copies the look of her source channel's own Gumroad page (bakingwithcarol.gumroad.com), not the template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import worker from '../src/index.js';

const CHECKOUT = 'https://commas.com/checkout/KxE7MxjzfYrXBLt';
const env = (urls = {}) => ({ SITE_URL: 'https://homeguidepress.com', INDEXING: 'true', CHECKOUT_URLS: JSON.stringify(urls) });
const get = (path, e = env()) => worker.fetch(new Request('https://homeguidepress.com' + path, { redirect: 'manual' }), e, { waitUntil() {} });

test('edna page uses the Gumroad look: source sections in order, $27, Checkout opens soon and no buy link until checkout is live', async () => {
  const r = await get('/three-ingredients-and-a-pan?src=aff-edna-1');
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /<link rel="stylesheet" href="\/looks\/three-ingredients\.css">/);
  assert.doesNotMatch(body, /href="\/styles\.css"|class="product|fonts\.googleapis/);  // not the template, not the old clone

  const order = ['class="topbar"', 'class="covers"', '<h1>', 'class="price"', 'class="controls"', 'class="by"', 'class="desc"',
    '>What you get:<', '>What is inside:<', '>The honest version:<', '>Who it is for:<', '>Who it is not for:<', '>About Edna:<', '>FAQ<', '<footer', 'class="buybar"'];
  const at = order.map(s => body.indexOf(s));
  at.forEach((i, n) => assert.ok(i > 0, order[n]));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'sections in the source order');
  assert.equal((body.match(/class="slide /g) || []).length, 3);
  assert.equal((body.match(/type="radio"/g) || []).length, 3);  // carousel dots

  assert.match(body, /\$27/);
  assert.doesNotMatch(body, /\$29|Carol|gumroad|CA\$/i);
  assert.match(body, /Checkout opens soon/);
  assert.doesNotMatch(body, /\/go\/edna|commas\.com\/checkout/);  // no checkout link yet
  assert.match(body, /30-day money-back guarantee/);
  assert.match(body, /Edna Haynes is an AI-created character/);
  // no invented proof: no ratings, reviews, buyer counts or urgency
  assert.doesNotMatch(body, /<script|<form|\brating|\breview|\bstars?\b|\d\/5|testimonial|readers have|copies bought|countdown|bestsell|hurry|limited time|—/i);

  // every local file the page points at is in public/
  for (const [, path] of body.matchAll(/(?:src|href)="(\/(?:looks|covers)\/[^"#?]+)"/g))
    assert.ok(existsSync(new URL('../public' + path, import.meta.url)), path);
});

test('edna stylesheet only loads files that exist', () => {
  const css = readFileSync(new URL('../public/looks/three-ingredients.css', import.meta.url), 'utf8');
  for (const [, path] of css.matchAll(/url\((\/looks\/[^)]+)\)/g))
    assert.ok(existsSync(new URL('../public' + path, import.meta.url)), path);
});

test('edna buy buttons go to /go/edna once checkout is live, and /go/edna forwards to Commas', async () => {
  const live = env({ edna: CHECKOUT });
  const body = await (await get('/three-ingredients-and-a-pan?src=aff-edna-1', live)).text();
  const buys = [...body.matchAll(/href="(\/go\/[^"]*)"/g)].map(m => m[1]);
  assert.equal(buys.length, 3, 'top bar, buy box and mobile bar');
  for (const href of buys) assert.equal(href, '/go/edna?src=aff-edna-1');
  assert.doesNotMatch(body, /commas\.com\/checkout|Checkout opens soon/);
  const r = await get('/go/edna?src=aff-edna-1', live);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), CHECKOUT + '?src=aff-edna-1');
});

test('other products keep their layouts', async () => {
  const plain = await (await get('/finally-written-down')).text();
  assert.match(plain, /href="\/styles\.css"/);
  assert.doesNotMatch(plain, /looks\/three-ingredients/);
});
