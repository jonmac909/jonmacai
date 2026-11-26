// One-word links survive every deploy (2026-11-26): `wrangler deploy` replaces the worker's routes with wrangler.jsonc's,
// and the worker has no CF_ROUTES_TOKEN to put API-made word routes back, so a deploy dropped skills/reanimate/lucyqa.
// This copies every word in D1 skool_words into wrangler.jsonc as "jonmac.ai/<word>*" (one wildcard covers its six links).
// Additive only: it never removes a route.
//   node scripts/word-routes.mjs --write   add missing words (reads D1 through wrangler); deploy.ps1 runs this before deploying
//   node scripts/word-routes.mjs --check   exit 1 when a D1 word has no route in wrangler.jsonc
//   --words a,b   use this list instead of D1 (tests, offline)
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORD_RE = /^[a-z][a-z0-9]{1,30}$/;
const ANCHOR = /^(\s*)\{ "pattern": "jonmac\.ai\/neon\*", "zone_name": "jonmac\.ai" \},\r?\n/m;
const line = (indent, w) => `${indent}{ "pattern": "jonmac.ai/${w}*", "zone_name": "jonmac.ai" },\n`;

export const hasWordRoute = (cfg, w) => cfg.includes(`"pattern": "jonmac.ai/${w}*"`);

// cfg text + words -> { cfg, added }. New lines go right after the neon seed route.
export function addWordRoutes(cfg, words) {
  const m = ANCHOR.exec(cfg);
  if (!m) throw new Error('wrangler.jsonc: neon* route (anchor) not found');
  const added = [...new Set(words)].filter((w) => WORD_RE.test(w) && !hasWordRoute(cfg, w)).sort();
  if (!added.length) return { cfg, added };
  const at = m.index + m[0].length;
  return { cfg: cfg.slice(0, at) + added.map((w) => line(m[1], w)).join('') + cfg.slice(at), added };
}

function d1Words() {
  const out = execSync('npx --yes wrangler@4.160.0 d1 execute command_center --remote --json --command "SELECT word FROM skool_words"',
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  const j = JSON.parse(out.slice(out.indexOf('[')));
  return (j[0]?.results || []).map((r) => r.word);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--words');
  const words = i >= 0 ? (args[i + 1] || '').split(',').filter(Boolean) : d1Words();
  const file = new URL('../wrangler.jsonc', import.meta.url);
  const cfg = readFileSync(file, 'utf8');
  const { cfg: next, added } = addWordRoutes(cfg, words);
  if (args.includes('--write')) {
    if (added.length) writeFileSync(file, next);
    console.log(added.length ? `word routes added to wrangler.jsonc: ${added.join(', ')} (commit it)` : 'word routes: all in wrangler.jsonc');
  } else {
    if (added.length) { console.error(`words with no route in wrangler.jsonc: ${added.join(', ')} - run node scripts/word-routes.mjs --write`); process.exit(1); }
    console.log('word routes: all in wrangler.jsonc');
  }
}
