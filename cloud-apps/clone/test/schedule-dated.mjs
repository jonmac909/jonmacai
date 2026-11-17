// Loads public/schedule.js with the same test date the Worker tests use (see next-session-loader.mjs).
import { readFileSync } from 'node:fs';
(0, eval)(readFileSync(new URL('../public/schedule.js', import.meta.url), 'utf8')
  .replace('var NEXT_SESSION = null;', 'var NEXT_SESSION = Date.UTC(2026, 10, 13, 0, 0, 0);'));
