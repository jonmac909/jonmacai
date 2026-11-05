import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../public/css/components.css'), 'utf8');

test('desktop shell stays 16.5rem + content', () => {
  assert.match(css, /\.shell\{display:grid;grid-template-columns:16\.5rem 1fr/);
});

test('under 820px sidebar is a shrinking top strip, not a page-widening column', () => {
  const m = css.match(/@media \(max-width:820px\)\{([\s\S]*?)\n\}/);
  assert.ok(m, 'missing 820px query');
  const phone = m[1];
  assert.match(phone, /\.shell\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(phone, /\.side\{[^}]*min-width:0/);
  assert.match(phone, /\.navs\{[^}]*overflow-x:auto/);
  assert.match(phone, /\.navs\{[^}]*min-width:0/);
  assert.match(phone, /\.side \.primary,\.plan,\.navgrp h4\{display:none\}/);
  assert.match(phone, /\.navgrp\{flex-direction:row;gap:\.3rem;flex:none\}/);
  assert.match(phone, /\.nav\{white-space:nowrap;width:auto;flex:none\}/);
  assert.match(phone, /\.wrap\{min-width:0;max-width:100%\}/);
});

test('821px+ navs stay a column', () => {
  assert.match(css, /@media \(min-width:821px\)\{\.navs\{display:flex;flex-direction:column;gap:1\.25rem\}\}/);
});

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../public/index.html'), 'utf8');
const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../public/js/app.js'), 'utf8');

test('sidebar toggle: a panel button in the brand row, and the saved choice applies before first paint', () => {
  assert.match(html, /<div class="brand">.*<button type="button" class="sidetoggle" id="sideToggle" aria-controls="navs" aria-expanded="true" aria-label="Hide sidebar"/);
  assert.match(html, /<symbol id="i-panel"/);
  assert.match(html, /<script>try\{if\(localStorage\.getItem\("cc-side"\)==="0"\)document\.documentElement\.setAttribute\("data-side","closed"\)\}catch\(e\)\{\}<\/script>/);
  assert.ok(html.indexOf('cc-side') < html.indexOf('<div class="shell">'), 'set before the shell paints');
  assert.match(app, /localStorage\.setItem\('cc-side', closed \? '0' : '1'\)/);
  assert.match(app, /e\.target\.closest\('#sideToggle'\)\) \{ toggleSide\(\); return; \}/);
});

test('sidebar toggle: nav labels sit in a span so the desktop rail can hide them', () => {
  assert.match(app, /<span class="nl">\$\{it\.label\}<\/span>/);
  assert.match(app, /title="\$\{it\.label\}"/);
});

test('hidden sidebar: desktop is a 4.25rem icon rail, phone drops the nav strip and keeps the bar', () => {
  assert.match(css, /@media \(min-width:821px\)\{\s*html\[data-side="closed"\] \.shell\{grid-template-columns:4\.25rem 1fr\}/);
  assert.match(css, /html\[data-side="closed"\] \.nav \.nl[^{]*\{display:none\}/);
  assert.match(css, /@media \(max-width:820px\)\{html\[data-side="closed"\] \.navs\{display:none\}\}/);
  assert.doesNotMatch(css, /html\[data-side="closed"\] \.brand\{[^}]*display:none/, 'the toggle must stay reachable');
});
