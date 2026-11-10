// Jiyoung Han's page copies the layout of her source channel's sales page, including where every photo sits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import worker from '../src/index.js';

const CHECKOUT = 'https://commas.com/checkout/KxE7MxjzfYrXBLt';
const env = (urls = { jiyoung: CHECKOUT }) => ({ SITE_URL: 'https://homeguidepress.com', INDEXING: 'true', CHECKOUT_URLS: JSON.stringify(urls), ASSETS: { fetch: async u => new Response(await (await import('node:fs/promises')).readFile(new URL('../public' + new URL(u).pathname, import.meta.url)), { status: 200 }) } });
const get = (path, e = env()) => worker.fetch(new Request('https://homeguidepress.com' + path, { redirect: 'manual' }), e, { waitUntil() {} });

test('jiyoung page has a photo in every source image slot, in the source order, with every buy button on /go/jiyoung', async () => {
  const r = await get('/fresher-after-60-the-korean-way?src=aff-jiyoung-1');
  assert.equal(r.status, 200);
  const body = await r.text();

  const order = ['class="hero"', 'id="choose"', 'class="counts"', 'class="vid"', 'id="look"', 'class="steps"', 'class="split"', 'id="inside"', 'wrap letter', 'id="order"', 'class="faq"', 'class="last"'];
  const at = order.map(s => body.indexOf(s));
  at.forEach((i, n) => assert.ok(i > 0, order[n]));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'sections in the source order');

  // photo slots: hero portrait, offer card, video poster, 8 step photos, photo card, author portrait
  for (const f of ['host-portrait', 'basics', 'host-poster', 'shelf', 'author', ...Array.from({ length: 8 }, (_, i) => 'step-' + (i + 1))])
    assert.match(body, new RegExp(`src="/looks/jiyoung/${f}\.jpg"`), f);
  assert.ok((body.match(/<img /g) || []).length >= 16);
  assert.equal((body.match(/<div class="step[ "]/g) || []).length, 8);
  assert.equal((body.match(/<div class="step[^"]*"><img /g) || []).length, 8, 'each step has its photo');

  // the video slot is a poster only: there is no real video, so no play button or video tag
  assert.doesNotMatch(body, /<video|<iframe|youtube|class="play"|&#9654;|\u25B6/i);

  const buys = [...body.matchAll(/href="(\/go\/[^"]*)"/g)].map(m => m[1]);
  assert.ok(buys.length >= 6);
  for (const href of buys) assert.equal(href, '/go/jiyoung');
  assert.doesNotMatch(body, /commas\.com/);
  assert.match(body, /\$27/);
  assert.doesNotMatch(body, /Soojin|soojinpark|\$37|\$54|countdown|testimonial|copies bought|readers have|—/i);
  assert.match(body, /AI-created character/);

  // every local file the page points at is in public/
  for (const [, path] of body.matchAll(/(?:src|href)="(\/(?:looks|covers)\/[^"#?]+)"/g))
    assert.ok(existsSync(new URL('../public' + path, import.meta.url)), path);
  for (const [, path] of body.matchAll(/url\((\/(?:looks|covers)\/[^)]+)\)/g))
    assert.ok(existsSync(new URL('../public' + path, import.meta.url)), path);
});

test('/go/jiyoung still forwards to the Commas checkout', async () => {
  const r = await get('/go/jiyoung?src=aff-jiyoung-1');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), CHECKOUT + '?src=aff-jiyoung-1');
});

test('jiyoung page has the sale popup (no clock, no strike-through), real numbers band, and 10 open FAQ questions', async () => {
  const body = await (await get('/fresher-after-60-the-korean-way?src=aff-jiyoung-1')).text();
  const at = body.indexOf('id="pop1"');
  const pop = body.slice(at, body.indexOf('</label>', body.indexOf('modal-secondary', at)));
  assert.doesNotMatch(body, /<script/);
  assert.match(pop, /\$27/);
  assert.match(pop, /href="\/go\/jiyoung"/);
  assert.doesNotMatch(pop, /<s>|<del>|line-through|countdown|hours left|only \d+/i);
  const band = body.slice(body.indexOf('class="counts"'), body.indexOf('</section>', body.indexOf('class="counts"')));
  for (const n of ['<b>91</b>', '<b>4</b>', '<b>16</b>', '<b>8</b>', '<b>$27</b>']) assert.ok(band.includes(n), n);
  assert.equal((body.match(/<details open>/g) || []).length, 10);
});
