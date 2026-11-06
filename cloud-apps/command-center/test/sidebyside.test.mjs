import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { render } from '../public/js/pages/sidebyside.js';

test('Landing pages: 13 rows, every picture it points at is in public/sbs, no source slot left blank', () => {
  const html = render();
  assert.equal(html.match(/class="card pad sbsrow"/g).length, 13);
  const pics = [...html.matchAll(/src="\/dashboard\/sbs\/([\w-]+\.jpg)"/g)].map((m) => m[1]);
  assert.equal(pics.filter((p) => p.endsWith('-ours.jpg')).length, 13);
  for (const p of pics) assert.ok(existsSync(new URL(`../public/sbs/${p}`, import.meta.url)), `${p} missing`);
  assert.equal(html.match(/never recorded/g).length, 13 - pics.filter((p) => p.endsWith('-src.jpg')).length);
});
