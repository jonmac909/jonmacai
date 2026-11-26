import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addWordRoutes, hasWordRoute } from '../scripts/word-routes.mjs';

const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

test('words live on Nov 26 (D1 skool_words) have their wildcard route checked in, so a deploy keeps them', () => {
  for (const w of ['neon', 'skills', 'reanimate', 'lucyqa', 'levels']) assert.ok(hasWordRoute(cfg, w), w);
});

test('addWordRoutes is additive: adds only missing valid words, keeps every existing route', () => {
  const { cfg: next, added } = addWordRoutes(cfg, ['skills', 'newword', 'Bad-Word', 'newword']);
  assert.deepEqual(added, ['newword']);
  assert.ok(hasWordRoute(next, 'newword'));
  const pats = (t) => [...t.matchAll(/"pattern":\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(pats(next).filter((p) => p !== 'jonmac.ai/newword*'), pats(cfg));
  assert.deepEqual(addWordRoutes(next, ['newword']).added, []);
});
