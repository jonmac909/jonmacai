// One-off: copy the Bluesky and System text out of the approved design files into data modules, unchanged.
import { readFileSync, writeFileSync } from 'node:fs';
const [, , designDir, outDir] = process.argv;
const lines = (f) => readFileSync(`${designDir}/${f}`, 'utf8').split(/\r?\n/);
const slice = (L, a, b) => L.slice(a - 1, b).map((l) => l.replace(/^ {4}/, '')); // 1-based, inclusive
const exp = (s, names) => s.map((l) => { for (const n of names) if (l.startsWith(`const ${n} = `) || l.startsWith(`var ${n} = `)) return l.replace(/^(const|var) /, 'export const '); return l.replace(/^var /, 'const '); });

const B = lines('Bluesky.dc.html');
const chk = (L, n, re) => { if (!re.test(L[n - 1])) throw new Error(`line ${n} moved: ${L[n - 1]}`); };
chk(B, 306, /const T = \[\['vision'/); chk(B, 309, /const num = /); chk(B, 402, /^\s+\]\);$/);
const bs = [
  '// Jon\'s Bluesky 2027 doc as it stood on 2026-11-10, copied unchanged from the approved design (briefs\\dashboard3\\Bluesky.dc.html).',
  '// Change the words here; the layout is in bluesky.js. Do not rewrite it without Jon.',
  '/* eslint-disable */',
  ...exp(slice(B, 306, 306), ['T']).map((l) => l.replace('export const T = ', 'export const TABS = ')),
  ...exp(slice(B, 309, 402), ['values', 'horizons', 'okrs', 'quarters', 'depts', 'highlights', 'learn', 'calls']),
  '',
];
writeFileSync(`${outDir}/bluesky-data.js`, bs.join('\n'));

const S = lines('System.dc.html');
chk(S, 323, /var CATS = \[/); chk(S, 330, /var BUILD/); chk(S, 331, /var STATE/); chk(S, 332, /var AREAS/); chk(S, 552, /^\s+\];$/);
chk(S, 629, /const rules = \[/); chk(S, 636, /\]\.map/); chk(S, 638, /const day = \[/); chk(S, 657, /\]\.map/);
const sy = [
  '// The system map as designed on 2026-11-10 (D:\\AgentTeam\\strategy\\team-system-2026-11.md), copied unchanged from the',
  '// approved design (briefs\\dashboard3\\System.dc.html). The layout is in system.js.',
  '// Ana keeps this file true: when a part goes live, set its b to \'ready\' (In place); \'fix\' is To fix; no b is To build.',
  '/* eslint-disable */',
  ...exp(slice(S, 323, 329), ['CATS']),
  ...exp(slice(S, 332, 552), ['AREAS', 'VST', 'L', 'OBJ', 'P', 'ROLES']),
  ...exp(slice(S, 629, 636), ['rules']),
  ...exp(slice(S, 638, 657), ['day', 'rhythm']),
  '',
];
writeFileSync(`${outDir}/system-data.js`, sy.join('\n'));
console.log('ok', bs.length, sy.length);
