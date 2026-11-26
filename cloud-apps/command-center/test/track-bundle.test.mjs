// /track inline script survives wrangler bundling (card t_b5f61b3767414d44, PR #384 review).
// Bundles test/track-bundle-entry.js with the worker's real wrangler config (keep_names on), renders trackerPage from
// the bundle and runs the whole inline <script> against a stub document. Catches __name(...) leaking into browser code,
// which threw ReferenceError on every /track load and killed all page JS. Skips if wrangler is not installed locally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npx = (args, cwd) => spawnSync(['npx --no-install wrangler', ...args].join(' '), { cwd, shell: true, windowsHide: true, encoding: 'utf8', timeout: 60000 });
const hasWrangler = npx(['--version'], root).status === 0;

// Permissive stand-in for any element the rest of the page script touches.
const anyEl = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : anyEl()),
  set: () => true,
  apply: () => anyEl(),
});

export function runInlineScripts(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const rows = [['a', '2'], ['b', '10'], ['c', '1']].map((r) => ({ id: r[0], cells: r.map((t) => ({ textContent: t, dataset: {} })) }));
  const ths = ['Video', 'Clicks'].map(() => ({ dataset: {}, classList: { contains: () => false }, setAttribute() {} }));
  const body = { get rows() { return rows.slice(); }, appendChild(r) { rows.splice(rows.indexOf(r), 1); rows.push(r); } };
  const tbl = { id: 'links', dataset: { col: '1', dir: '-1' }, tHead: { rows: [{ cells: ths }] }, tBodies: [body] };
  const document = new Proxy({ querySelectorAll: (sel) => (sel === 'table.sortable' ? [tbl] : []) }, { get: (t, k) => (k in t ? t[k] : anyEl()) });
  const ctx = vm.createContext({ document, localStorage: { getItem: () => null, setItem() {} }, window: anyEl(), navigator: anyEl(),
    location: anyEl(), fetch: anyEl(), confirm: () => false, alert() {}, setTimeout() {}, console });
  for (const s of scripts) vm.runInContext(s, ctx);
  return { scripts, order: rows.map((r) => r.id).join('') };
}

test('bundled /track page: inline script has no __name and runs in a browser-like context', { skip: !hasWrangler && 'wrangler not installed' }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'track-bundle-'));
  try {
    const r = npx(['deploy', '--dry-run', '--outdir', JSON.stringify(out), 'test/track-bundle-entry.js'], root);
    assert.equal(r.status, 0, `wrangler dry run failed: ${(r.stderr || r.stdout).slice(-400)}`);
    const { trackerPage } = await import(pathToFileURL(join(out, 'track-bundle-entry.js')).href);
    const html = trackerPage({ rows: [], sales: [], unattributed: 0, since: null }, 'https://jonmac.ai');
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    assert.ok(inline.includes('table.sortable'), 'page has the sort script');
    assert.ok(!inline.includes('__name'), 'served inline script contains __name');
    const { order } = runInlineScripts(html);
    assert.equal(order, 'bac'); // sort ran: Clicks column, high to low
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
