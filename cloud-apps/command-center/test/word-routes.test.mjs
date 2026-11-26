import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

// Planted gate test (card t_a1663275a7da4652): a deploy with a D1 word missing from wrangler.jsonc must be blocked.
const dir = fileURLToPath(new URL('..', import.meta.url));
const runCheck = (words) => spawnSync(process.execPath, ['scripts/word-routes.mjs', '--check', '--words', words], { cwd: dir, encoding: 'utf8' });

test('--check exits 1 and names a planted word with no route, exits 0 when all are routed, never writes the file', () => {
  const bad = runCheck('neon,levels,zzplanted');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /zzplanted/);
  const ok = runCheck('neon,levels,reanimate');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'), cfg);
});

test('deploy.ps1 runs word-routes --check and throws on failure before Invoke-WranglerDeploy', () => {
  const lines = readFileSync(new URL('../scripts/deploy.ps1', import.meta.url), 'utf8').split(/\r?\n/);
  const check = lines.findIndex((l) => /^\s*node scripts\/word-routes\.mjs --check\b/.test(l));
  assert.ok(check >= 0, 'word-routes.mjs --check line missing');
  assert.match(lines[check], /--check;\s*if \(\$LASTEXITCODE\) \{ throw /);
  const deploy = lines.findIndex((l) => /^\s*Invoke-WranglerDeploy\b/.test(l));
  assert.ok(deploy > check, 'Invoke-WranglerDeploy must come after the word-routes check');
});
