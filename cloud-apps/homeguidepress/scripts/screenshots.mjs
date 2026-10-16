// Headless screenshots of every page at phone and desktop width.
// Runs the Worker in-process with an in-memory database (no network, no real email).
// Usage: node scripts/screenshots.mjs [outDir] [baseUrl]
//   With baseUrl (e.g. https://homeguidepress.com) it shoots the live site instead.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import worker from '../src/index.js';
import { PRODUCTS } from '../src/products.js';

const out = process.argv[2] || 'C:/Users/partn/my-agent/state/affiliate/site-shots';
let base = process.argv[3];
mkdirSync(out, { recursive: true });

let server;
if (!base) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const DB = { prepare(q) { const s = sql.prepare(q); return { bind: (...a) => ({
    run: async () => ({ meta: { changes: Number(s.run(...a).changes) } }), first: async () => s.get(...a) || null, all: async () => ({ results: s.all(...a) }) }) }; } };
  const env = { DB, SITE_URL: 'http://localhost', INDEXING: 'false', FILES: '{}', PRODUCT_IDS: '{}',
    // Placeholder link so the buy button renders as it will once the ebook worker posts the real ones.
    CHECKOUT_URLS: JSON.stringify(Object.fromEntries(PRODUCTS.map(p => [p.key, 'https://commas.com/checkout/PLACEHOLDER']))) };
  server = createServer(async (req, res) => {
    const asset = { '/styles.css': 'text/css', '/favicon.svg': 'image/svg+xml' }[req.url] || (req.url.startsWith('/covers/') && 'image/jpeg');
    if (asset) { res.writeHead(200, { 'content-type': asset }); return res.end(readFileSync(new URL('../public' + req.url, import.meta.url))); }
    const r = await worker.fetch(new Request('http://localhost' + req.url, { method: req.method }), env, { waitUntil() {} });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(0);
  base = `http://localhost:${server.address().port}`;
}

const pages = [['index', '/'], ...PRODUCTS.map(p => [p.key, '/' + p.path]), ['thanks', '/thanks?p=angelo'],
  ['refunds', '/refunds'], ['privacy', '/privacy'], ['terms', '/terms'], ['link-expired', '/download/invalid-token']];
const browser = await chromium.launch();
try {
  for (const [label, width, height, mobile] of [['phone', 390, 844, true], ['desktop', 1366, 900, false]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    for (const [name, path] of pages) {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) console.warn(`horizontal scroll: ${name} at ${label}`);
      await page.screenshot({ path: `${out}/${name}-${label}.png`, fullPage: true });
    }
    await context.close();
  }
} finally {
  await browser.close();
  server?.close();
}
console.log(`saved ${pages.length * 2} screenshots to ${out}`);
