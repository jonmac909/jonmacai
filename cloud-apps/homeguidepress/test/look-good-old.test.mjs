// The Good Old Dog and Good Old Cat pages follow the source's section list (stevecooperpets.com): popup, hero, three cards, note, contents, honest-part (in place of reviews), FAQ, final call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import worker from '../src/index.js';

const env = { SITE_URL: 'https://homeguidepress.com', INDEXING: 'true', CHECKOUT_URLS: JSON.stringify({ walter: 'https://commas.com/checkout/a', helen: 'https://commas.com/checkout/b' }) };
const ASSETS = { async fetch(u) {
  try { return new Response(readFileSync(new URL('../public' + new URL(u).pathname, import.meta.url), 'utf8')); }
  catch { return new Response('', { status: 404 }); }
} };
const get = path => worker.fetch(new Request('https://homeguidepress.com' + path, { redirect: 'manual' }), { ...env, ASSETS }, { waitUntil() {} });

for (const [slug, key, animal] of [['the-good-old-dog', 'walter', 'dog'], ['the-good-old-cat', 'helen', 'cat']]) {
  test(`${slug}: source section order, no extra sections, real pack image, buy on /go/${key}`, async () => {
    const r = await get('/' + slug);
    assert.equal(r.status, 200);
    const body = await r.text();
    // top-level sections, in order
    const secs = [...body.matchAll(/<(?:header|section) class="([^"]*)"/g)].map(m => m[1]);
    assert.deepEqual(secs, ['hero', 'products', 'note', 'block', 'block paper', 'block paper', 'block final']);
    assert.ok(body.indexOf('id="inside"') < body.indexOf('The honest part') && body.indexOf('The honest part') < body.indexOf('id="faq"') && body.indexOf('id="faq"') < body.indexOf('id="final"'));
    // the three sections the source does not have are gone
    assert.doesNotMatch(body, /Hour by Hour|What Makes It Different|Is This Book for You|class="[^"]*(?:trio|forwho|card-stack)/);
    // three product cards, the third with the real pack picture
    assert.equal((body.match(/<article class="prod/g) || []).length, 3);
    assert.match(body, new RegExp(`src="/clones/${slug}-assets/pack\.webp"`));
    // buy buttons only through /go/<key>; no raw checkout link; $27
    const buys = [...body.matchAll(/href="(\/go\/[^"]*)"/g)].map(m => m[1]);
    assert.ok(buys.length >= 5);
    for (const href of buys) assert.equal(href, `/go/${key}`);
    assert.doesNotMatch(body, /commas\.com\/checkout/);
    assert.match(body, /\$27/);
    // no invented proof
    assert.doesNotMatch(body.replace(/<style>[\s\S]*?<\/style>/, ''), /countdown|hurry|limited time|copies (?:sold|bought)|readers have|\d\/5|verified (?:buyer|reader)/i);
    // every local asset exists
    for (const [, path] of body.matchAll(/(?:src|href)="(\/clones\/[^"#?]+)"/g))
      assert.ok(existsSync(new URL('../public' + path, import.meta.url)), path);
    assert.ok(animal);
  });
}
