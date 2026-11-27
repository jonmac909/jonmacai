// Unlisted Founding Reviewer Bonus Vault at jonmac.ai/reviewer-vault (Jon 2026-11-27).
// Verifies all 4 static assets return 200 with X-Robots-Tag: noindex, nofollow, links resolve
// cleanly without a trailing slash, unknown/traversal paths 404, and reviewer-vault is reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import worker from '../src/worker.js';
import { RESERVED } from '../src/skoolroutes.js';
import { sqliteD1 } from './sqlited1.mjs';
import './dnsstub.mjs';

const PUBLIC = new URL('../public', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FILES = [
  '/reviewer-vault/files/gemini-4-neon-5-jobs-kit.zip',
  '/reviewer-vault/files/token-saver-multimodel-setup.zip',
  '/reviewer-vault/files/smb-retainer-pricing-calculator.html',
];

function fakeAssets() {
  return {
    fetch: async (req) => {
      const p = new URL(req.url).pathname;
      const disk = join(PUBLIC, p.replace(/^\/+/, ''));
      if (!existsSync(disk)) return new Response('missing', { status: 404 });
      const body = readFileSync(disk);
      const type = p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/zip';
      return new Response(body, { status: 200, headers: { 'Content-Type': type } });
    },
  };
}

async function call(path, method = 'GET', env = {}) {
  const waits = [];
  const r = await worker.fetch(
    new Request(`https://jonmac.ai${path}`, { method, redirect: 'manual' }),
    { DB: sqliteD1(), ASSETS: fakeAssets(), ...env },
    { waitUntil: (p) => waits.push(p) },
  );
  await Promise.all(waits);
  return r;
}

test('reviewer-vault index and all 3 bonus files return 200 with noindex headers', async () => {
  for (const p of ['/reviewer-vault', '/reviewer-vault/', '/reviewer-vault?utm_source=skool', ...FILES]) {
    const r = await call(p);
    assert.equal(r.status, 200, `${p}: expected 200, got ${r.status}`);
    assert.equal(r.headers.get('X-Robots-Tag'), 'noindex, nofollow', `${p}: X-Robots-Tag`);
  }
  const html = await (await call('/reviewer-vault')).text();
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/i);
  assert.doesNotMatch(html, /href="\.\/files\//, 'relative ./files/ links break on /reviewer-vault without trailing slash');
  for (const f of FILES) assert.ok(html.includes(`href="${f}"`), `index links to ${f}`);

  const calc = await (await call('/reviewer-vault/files/smb-retainer-pricing-calculator.html')).text();
  assert.match(calc, /<meta name="robots" content="noindex, nofollow"/i);
});

test('unknown paths, traversal attempts, and non-GET methods are rejected; unrelated /reviewer-vault-* passes through', async () => {
  for (const bad of ['/reviewer-vault/secret.txt', '/reviewer-vault/files/other.zip', '/reviewer-vault/files/..%2f..%2flogin.html']) {
    const r = await call(bad);
    assert.equal(r.status, 404, `${bad}: expected 404`);
    assert.equal(r.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  }
  const post = await call('/reviewer-vault', 'POST');
  assert.equal(post.status, 405);

  const seen = [];
  const APEX = { fetch: async (req) => { seen.push(new URL(req.url).pathname); return new Response('apex', { status: 200 }); } };
  const pass = await call('/reviewer-vault-other', 'GET', { APEX });
  assert.equal(pass.status, 200);
  assert.deepEqual(seen, ['/reviewer-vault-other']);
});

test('reviewer-vault is reserved and routed in wrangler.jsonc', () => {
  assert.ok(RESERVED.has('reviewer-vault'), 'reviewer-vault must be in RESERVED');
  const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(cfg, /"pattern": "jonmac\.ai\/reviewer-vault\*"/);
});

test('planted fault: missing X-Robots-Tag or unrewritten ./files/ link fails check', () => {
  const checkIndex = (html) => {
    if (!/<meta name="robots" content="noindex, nofollow"/i.test(html)) throw new Error('missing meta noindex');
    if (/href="\.\/files\//.test(html)) throw new Error('relative ./files/ link');
  };
  assert.throws(() => checkIndex('<a href="./files/a.zip">x</a><meta name="robots" content="noindex, nofollow"/>'), /relative/);
  assert.throws(() => checkIndex('<a href="/reviewer-vault/files/a.zip">x</a>'), /missing meta noindex/);
  checkIndex(readFileSync(join(PUBLIC, 'reviewer-vault', 'index.html'), 'utf8'));
});