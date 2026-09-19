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
