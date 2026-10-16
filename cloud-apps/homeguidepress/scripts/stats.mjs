// Views, buy clicks and sales per product and source (?src= / utm_source), from the live D1.
// Uses the existing wrangler login. Read-only. Usage: node scripts/stats.mjs [days=30]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const days = Math.max(1, Math.min(365, Number(process.argv[2]) || 30));
const since = new Date(Date.now() - days * 86400000).toISOString();
const query = `
SELECT c.slug, COALESCE(c.src, c.utm_source, '(none)') AS source,
  SUM(c.kind = 'view') AS views, SUM(c.kind = 'buy') AS buy_clicks
FROM clicks c WHERE c.created_at >= '${since}' GROUP BY 1, 2 ORDER BY 1, 3 DESC;
SELECT slug, COALESCE(src, '(unknown)') AS source, COUNT(*) AS sales, SUM(amount_cents) / 100.0 AS usd,
  SUM(revoked_at IS NOT NULL) AS refunded
FROM orders WHERE is_test = 0 AND created_at >= '${since}' GROUP BY 1, 2 ORDER BY 1;`;
const file = join(mkdtempSync(join(tmpdir(), 'hgp-')), 'stats.sql');
writeFileSync(file, query);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'homeguidepress', '--remote', '--file', `"${file}"`], { stdio: 'inherit', shell: true, cwd: new URL('..', import.meta.url) });
