// The Long-Life Dog page (public/clones/dog.html) keeps the section order of its source page (frenchiedogdad.netlify.app):
// hero, lead, "what you'll get", who it is for, dark "what you'll learn" band, photo story blocks, order box, FAQ, two choices, footer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/clones/dog.html', import.meta.url), 'utf8');
const page = html.slice(html.indexOf('<body'));  // the markup, not the stylesheet
const pub = path => new URL('../public' + path, import.meta.url);

test('sections follow the source order, with none of the sections the source does not have', () => {
  const order = ['class="top"', 'class="hero"', 'class="herospace"', 'id="lead"', 'class="torn"', 'id="reviews"', 'id="learn"', 'id="why"',
    'id="order"', 'class="faq"', 'class="two"', '<footer>'];
  const at = order.map(s => html.indexOf(s));
  at.forEach((i, n) => assert.ok(i > 0, order[n]));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'source order');
  assert.doesNotMatch(html, /class="math"|class="ledger"|class="breed"|class="story"|class="bookshow"|class="guar"|<table|Your first month, step by step/);
  assert.equal((html.match(/class="col"/g) || []).length, 3, 'three "what you get" columns, as in the source');
  assert.equal((html.match(/class="lcard"/g) || []).length, 9, 'nine learn cards, as in the source');
  assert.equal((html.match(/class="ts( rev)?"/g) || []).length, 4, 'four photo story blocks');
  assert.match(html, /class="lrail" id="lrail"/);
});

test('$27, every buy button goes to /go/steve, no raw checkout link', () => {
  const buys = [...html.matchAll(/<a class='btn buy' href='([^']*)'/g)].map(m => m[1]);
  assert.ok(buys.length >= 5);
  for (const href of buys) assert.equal(href, '/go/steve');
  assert.doesNotMatch(html, /commas\.com|whop\.com|href=['"]\/checkout/i);
  assert.match(html, /\$27/);
  assert.doesNotMatch(html, /\$47|\$19|\$12/);
});

test('no invented proof: no reviews, scores, buyer counts, countdowns or host bio', () => {
  assert.doesNotMatch(page, /★|reviews ·|testimonial|countdown|id="cd|bestsell|hurry|limited time|until Sunday|copies bought|readers have|\d\/5|—/i);
  assert.doesNotMatch(page, /Frenchie|Leo\b|Whop|Gus\b/);  // nothing of the source brand is left
});

test('the hero shows the host photo with no play button, because there is no video for this book', () => {
  const hero = html.slice(html.indexOf('class="hero"'), html.indexOf('class="herospace"'));
  assert.match(hero, /class="video"/);
  assert.doesNotMatch(hero, /class="play"|<video|<iframe|onclick/);
});

test('every local image the page points at exists', () => {
  const files = [...html.matchAll(/src="(\/(?:clones|covers)\/[^"#?]+)"/g)].map(m => m[1]);
  assert.ok(files.length >= 8);
  for (const f of files) assert.ok(existsSync(pub(f)), f);
});
