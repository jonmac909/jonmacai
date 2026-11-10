// Peggy's page opens on a video block like its source; Ruth's page shows the same sections on a phone as on desktop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = f => readFileSync(new URL('../public/clones/' + f, import.meta.url), 'utf8');
const localFiles = body => [...body.matchAll(/(?:src|href)="(\/(?:clones|covers)\/[^"#?]+)"/g)].map(m => m[1]);

test('peggy hero is a video block, with no fake play button and the same buy links', () => {
  const b = read('peggy.html');
  const hero = b.slice(b.indexOf('<header class="hero'), b.indexOf('<main'));
  assert.match(hero, /id="vid"/);
  assert.doesNotMatch(hero, /class="frame"|<video|playbig|play-btn|&#9654;/);  // no player until a real video exists
  assert.doesNotMatch(b, /<script/);
  const buys = [...b.matchAll(/href="(\/go\/[^"]*)"/g)].map(m => m[1]);
  assert.equal(buys.length, 3);
  for (const h of buys) assert.equal(h, '/go/peggy');
  assert.doesNotMatch(b, /commas\.com/);
  assert.match(b, /\$27/);
  assert.doesNotMatch(b, /\$29|countdown|testimonial|\d\/5/i);
  for (const p of localFiles(b)) assert.ok(existsSync(new URL('../public' + p, import.meta.url)), p);
});

test('ruth phone layout keeps the numbers strip and every section the source shows', () => {
  const b = read('ruth.html');
  const order = ['class="stats"', 'id="inside"', 'id="house"', 'id="free"', 'id="honest"'];
  const at = order.map(s => b.indexOf(s));
  at.forEach((i, n) => assert.ok(i > 0, order[n]));
  assert.deepEqual([...at].sort((x, y) => x - y), at);
  // no phone rule hides them
  for (const m of b.matchAll(/([^{}]*)\{display:none!important\}/g))
    assert.doesNotMatch(m[1], /\.stats|#inside|#house|#free|#honest/, 'hidden on phone: ' + m[1]);
  const buys = [...b.matchAll(/href="(\/go\/[^"]*)"/g)].map(m => m[1]);
  assert.ok(buys.length >= 3);
  for (const h of buys) assert.equal(h, '/go/ruth');
  assert.doesNotMatch(b, /commas\.com/);
  for (const p of localFiles(b)) assert.ok(existsSync(new URL('../public' + p, import.meta.url)), p);
});

test('angelo page shows no buyer-quote section (its source quotes belong to another author)', () => {
  const b = read('angelo.html');
  assert.doesNotMatch(b, /What buyers say|verified buyer|From readers/i);
});
