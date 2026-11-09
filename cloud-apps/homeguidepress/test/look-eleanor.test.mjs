// Eleanor Whitfield's page copies the look of her source channel's own sales page (publy.store/t/nAgYA0E), not the template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import worker from '../src/index.js';

const CHECKOUT = 'https://commas.com/checkout/KxE7MxjzfYrXBLt';
const env = (urls = { eleanor: CHECKOUT }) => ({ SITE_URL: 'https://homeguidepress.com', INDEXING: 'true', CHECKOUT_URLS: JSON.stringify(urls) });
const get = (path, e = env()) => worker.fetch(new Request('https://homeguidepress.com' + path, { redirect: 'manual' }), e, { waitUntil() {} });

test('eleanor page uses its own look, with the source sections in order, real pages and every buy button on /go/eleanor', async () => {
  const r = await get('/the-christmas-home-plan?src=aff-eleanor-1');
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /<link rel="stylesheet" href="\/looks\/eleanor\.css">/);
  assert.doesNotMatch(body, /href="\/styles\.css"|class="product/);  // not the default template

  const order = ['The Problem', 'Stop Believing', 'class="art-band"', 'The Shift', 'Why It Works', 'Is This You', '>Inside<',
    'What It Covers', 'Look Inside', 'The Difference', 'class="band-accent"', '>About<', 'The Offer', 'class="guarantee"', '>FAQ<', 'class="buybar"'];
  const at = order.map(s => body.indexOf(s));
  at.forEach((i, n) => assert.ok(i > 0, order[n]));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'sections in the source order');
  for (const n of [6, 46, 65, 77]) assert.match(body, new RegExp(`src="/looks/eleanor/page-${n}\\.jpg"`), `page ${n}`);
  assert.equal((body.match(/class="ic"/g) || []).length, 6);  // the book's six parts
  assert.equal((body.match(/class="qa"/g) || []).length, 6);

  const buys = [...body.matchAll(/href="(\/go\/[^"]*)"/g)].map(m => m[1]);
  assert.equal(buys.length, 5, 'hero, two bands, offer and buy bar');
  for (const href of buys) assert.equal(href, '/go/eleanor?src=aff-eleanor-1');
  assert.doesNotMatch(body, /commas\.com/);  // checkout only through /go/eleanor
  assert.match(body, /\$27/);
  assert.doesNotMatch(body, /\$29|Dorothy|publy/);
  assert.match(body, /Payments are processed by Commas/);
  assert.match(body, /Not electrical or fire safety advice/);
  assert.match(body, /Eleanor Whitfield is an AI-created character/);
  // no invented proof: no buyer counts, scores, reviews or urgency
  assert.doesNotMatch(body, /<script|<form|copies bought|readers have|\d\/5|testimonial|review|countdown|bestsell|hurry|limited time|—/i);

  // every local file the page points at is in public/
  for (const [, path] of body.matchAll(/(?:src|href)="(\/(?:looks|covers)\/[^"#?]+)"/g))
    assert.ok(existsSync(new URL('../public' + path, import.meta.url)), path);
});

test('eleanor stylesheet only loads files that exist', () => {
  const css = readFileSync(new URL('../public/looks/eleanor.css', import.meta.url), 'utf8');
  for (const [, path] of css.matchAll(/url\((\/looks\/[^)]+)\)/g))
    assert.ok(existsSync(new URL('../public' + path, import.meta.url)), path);
});

test('eleanor page with no checkout link shows the placeholder and no buy link', async () => {
  const body = await (await get('/the-christmas-home-plan', env({}))).text();
  assert.match(body, /Checkout opens soon/);
  assert.doesNotMatch(body, /\/go\/eleanor/);
});

test('/go/eleanor still forwards to the Commas checkout', async () => {
  const r = await get('/go/eleanor?src=aff-eleanor-1');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), CHECKOUT + '?src=aff-eleanor-1');
});

test('other products keep their layouts', async () => {
  const plain = await (await get('/finally-written-down')).text();
  assert.match(plain, /href="\/styles\.css"/);
  assert.match(plain, /<article class="product">/);
  assert.doesNotMatch(plain, /looks\/eleanor/);
});

