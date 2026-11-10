import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { funnelsData, SITE } from '../src/funnels.js';
import { PRODUCTS } from '../../homeguidepress/src/products.js';

// Dashboard 2 Funnels: the live check of every Home Guide Press book page and Buy link, against a fake shop.
const pub = new URL('../public/', import.meta.url);
registerHooks({ resolve: (spec, ctx, next) => next(spec.startsWith('/dashboard/js/') ? new URL(spec.slice('/dashboard/'.length), pub).href : spec, ctx) });
const { render } = await import('../public/d2/js/pages/funnels.js');

const [working, noCheckout, down, wrongPrice, unsold] = PRODUCTS;
const CO = 'https://commas.com/checkout/Abc123';
const shop = (seen) => async (url, init) => {
  seen.push({ url, init });
  const u = new URL(url);
  if (u.pathname === `/${down.path}`) return new Response('oops', { status: 500 });
  if (u.pathname === `/go/${noCheckout.key}`) return new Response(null, { status: 302, headers: { location: `${SITE}/${noCheckout.path}` } });
  if (u.pathname.startsWith('/go/')) return new Response(null, { status: 302, headers: { location: `${CO}?src=dashboard-check` } });
  return new Response('<html>', { status: 200 });
};
const db = (rows) => ({ prepare: () => ({ all: async () => ({ results: rows }) }) });
const SALES = [
  { slug: working.key, amount_cents: Math.round(working.price * 100), last: '2026-11-09T18:00:00Z', n: 4 },
  { slug: wrongPrice.key, amount_cents: 1900, last: '2026-11-08T18:00:00Z', n: 1 },
  { slug: down.key, amount_cents: Math.round(down.price * 100), last: '2026-11-07T18:00:00Z', n: 2 },
];
const NOW = Date.parse('2026-11-09T22:30:00Z');
const by = (f, key) => f.rows.find((r) => r.key === key);

test('every book page gets a row with its live state', async () => {
  const seen = [];
  const f = await funnelsData({ HGP_DB: db(SALES) }, shop(seen), NOW);
  assert.equal(f.total, PRODUCTS.length);
  assert.equal(f.rows.length, PRODUCTS.length);
  assert.equal(f.checked, '3:30 PM'); // Kelowna time
  assert.equal(seen.length, PRODUCTS.length * 2); // one page and one Buy link each
  assert.ok(seen.every((s) => s.url.endsWith('?src=dashboard-check') && s.init.redirect === 'manual'), 'checks are tagged and stop at the redirect');
  const w = by(f, working.key);
  assert.deepEqual([w.book, w.channel, w.url], [working.title, working.persona.brand, `${SITE}/${working.path}`]);
  assert.equal(w.page.text, 'Loads');
  assert.equal(w.buy.text, 'Working');
  assert.match(w.buy.note, /Last sale \$[\d.]+ on Nov 9, 4 sold/);
});

test('problems: no checkout, a page that is down, a sale at another price, no sale yet', async () => {
  const f = await funnelsData({ HGP_DB: db(SALES) }, shop([]), NOW);
  assert.deepEqual([by(f, noCheckout.key).buy.text, by(f, noCheckout.key).buy.cls], ['No checkout', 'crit']);
  assert.deepEqual([by(f, down.key).page.text, by(f, down.key).page.note], ['Down', 'Answered 500']);
  assert.equal(by(f, wrongPrice.key).buy.text, 'Check price');
  assert.match(by(f, wrongPrice.key).buy.note, /Last sale \$19 on Nov 8/);
  assert.deepEqual([by(f, unsold.key).buy.text, by(f, unsold.key).buy.cls], ['Reaches checkout', 'blue']);
  assert.equal(by(f, unsold.key).buy.note, `No sale yet to prove the $${unsold.price} price`);
  assert.equal(f.problems, 3);
  assert.equal(f.reach, PRODUCTS.length - 1); // all but the one whose Buy goes back to the page
  assert.ok(f.rows.every((r) => !('reach' in r)), 'internal fields stay off the rows');
  const firstOk = f.rows.findIndex((r) => [r.page, r.price, r.buy].every((x) => x.cls !== 'crit'));
  assert.ok(f.rows.slice(0, firstOk).length === 3, 'the three broken pages come first');
});

test('price: $27 is the single price, anything else is flagged for Jon', async () => {
  const f = await funnelsData({ HGP_DB: db([]) }, shop([]), NOW);
  for (const p of PRODUCTS) {
    const r = by(f, p.key);
    assert.equal(r.price.cls, p.price === 27 ? 'ok' : 'risk', p.key);
  }
});

test('no sales database, or one that fails: says so, never claims Working', async () => {
  for (const env of [{}, { HGP_DB: { prepare: () => ({ all: async () => { throw new Error('down'); } }) } }]) {
    const f = await funnelsData(env, shop([]), NOW);
    assert.equal(f.salesKnown, false);
    assert.equal(by(f, working.key).buy.text, 'Goes to checkout');
    assert.equal(f.working, 0);
  }
});

test('a shop that does not answer: rows say so instead of failing the page', async () => {
  const f = await funnelsData({}, async () => { throw new Error('offline'); }, NOW);
  assert.equal(f.rows.length, PRODUCTS.length);
  assert.ok(f.rows.every((r) => r.page.text === 'Down' && r.buy.text === 'Broken'));
});

test('the page: one row per book with its link, then loading and error states', async () => {
  const f = await funnelsData({ HGP_DB: db(SALES) }, shop([]), NOW);
  const html = render({ pages: { funnels: f }, d2: {} });
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.equal((html.match(/<tr>/g) || []).length, PRODUCTS.length + 1); // + the header row
  for (const p of PRODUCTS) {
    assert.ok(text.includes(p.title.replace(/&/g, '&amp;').replace(/'/g, '&#39;')) || text.includes(p.title), p.title);
    assert.ok(html.includes(`href="${SITE}/${p.path}"`), p.path);
  }
  assert.match(text, /Checked live at 3:30 PM/);
  assert.match(text, new RegExp(`${PRODUCTS.length - 1} reach a checkout · 2 with a working checkout · 3 to fix`)); // working + the page that is down
  assert.ok(html.includes('data-fcheck'));
  assert.match(render({ pages: {}, d2: {} }), /Checking every book page/);
  assert.match(render({ pages: { funnels: { error: true } }, d2: {} }), /Could not check the pages/);
});
