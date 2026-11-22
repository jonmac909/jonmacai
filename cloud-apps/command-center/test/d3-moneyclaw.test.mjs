// Dashboard 3 Budget, Expenses and P&L pages: MoneyClaw's own pages in a frame (public/d3/js/moneyclaw.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MC_ORIGIN, MC_PAGES, isMcPage, mcUrl, renderMc, mcTheme } from '../public/d3/js/moneyclaw.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('menu: Budget, Expenses and P&L follow Money, and each is a route', () => {
  const index = read('../public/d3/index.html');
  assert.match(index, /Money<\/a>\n<a href="#budget" data-nav="budget">.*Budget<\/a>\n<a href="#expenses" data-nav="expenses">.*Expenses<\/a>\n<a href="#pnl" data-nav="pnl">.*P&amp;L<\/a>\n<a href="#bluesky"/);
  const app = read('../public/d3/js/app.js');
  assert.match(app, /budget: 'Budget', expenses: 'Expenses', pnl: 'P&L'/);
  assert.match(app, /if \(main\.querySelector\?\.\('#mcFrame'\)\?\.dataset\?\.mc !== p\)/); // a data reload must not reload the frame
  assert.match(app, /e\.origin !== MC_ORIGIN \|\| e\.data\?\.type !== 'moneyclaw:open-tab'/);
  for (const p of ['budget', 'expenses', 'pnl']) assert.equal(isMcPage(p), true);
  for (const p of ['money', 'toString', '__proto__', '']) assert.equal(isMcPage(p), false);
});

test('frame addresses: MoneyClaw embed mode, shown in /dash, in the dashboard theme', () => {
  assert.equal(MC_ORIGIN, 'https://moneyclaw.jonmac.ai');
  assert.equal(mcUrl('budget', 'dark'), 'https://moneyclaw.jonmac.ai/budget/?embed=1&host=dash&theme=dark');
  assert.equal(mcUrl('expenses', 'light'), 'https://moneyclaw.jonmac.ai/test/?tab=budgets&embed=1&host=dash&theme=light');
  assert.equal(mcUrl('pnl', 'x'), 'https://moneyclaw.jonmac.ai/test/?tab=matrix&embed=1&host=dash&theme=light');
  assert.equal(mcUrl('nope', 'dark'), '');
  assert.deepEqual(Object.keys(MC_PAGES), ['budget', 'expenses', 'pnl']);
});

test('page: header with an Open in MoneyClaw link, and one frame', () => {
  const html = renderMc(null, 'pnl', 'dark');
  assert.match(html, /<h1>P&L<\/h1>|<h1>P&amp;L<\/h1>/);
  assert.match(html, /href="https:\/\/moneyclaw\.jonmac\.ai\/\?tab=pnl" target="_blank" rel="noopener">Open in MoneyClaw<\/a>/);
  assert.match(html, /<iframe id="mcFrame" data-mc="pnl" title="MoneyClaw P&amp;L" src="https:\/\/moneyclaw\.jonmac\.ai\/test\/\?tab=matrix&embed=1&host=dash&theme=dark"/);
  assert.equal((html.match(/<iframe/g) || []).length, 1);
  assert.equal(renderMc(null, 'nope', 'dark'), '');
});

test('theme switch: posted to the open frame, addressed to MoneyClaw only', () => {
  const sent = [];
  const main = { querySelector: (s) => (s === '#mcFrame' ? { contentWindow: { postMessage: (m, o) => sent.push([m, o]) } } : null) };
  mcTheme(main, 'dark');
  mcTheme(main, 'weird');
  assert.deepEqual(sent, [[{ type: 'moneyclaw:display', theme: 'dark' }, MC_ORIGIN], [{ type: 'moneyclaw:display', theme: 'light' }, MC_ORIGIN]]);
  mcTheme({ querySelector: () => null }, 'dark'); // no frame open: nothing to do
  mcTheme(null, 'dark');
});

test('d3.css: the frame fills the window, and the screen on phones', () => {
  const css = read('../public/d3/css/d3.css');
  assert.match(css, /\.d3 \.shell:has\(\.main\[data-page="budget"\]\)/);
  assert.match(css, /@media \(max-width:760px\)\{\n  \.d3 \.card\.hy\.mc\{height:calc\(100dvh - 150px\)/);
});

test('d3.css phones: the frame fits the screen under the header (no guessed height), so the last card can be reached', () => {
  const css = read('../public/d3/css/d3.css');
  const P = '.d3 .shell:has(.main:is([data-page="budget"],[data-page="expenses"],[data-page="pnl"]))';
  const at = css.indexOf('Phones, jonmac.ai/dash#budget');
  assert.ok(at > 0);
  const block = css.slice(at, css.indexOf('/* Home page', at));
  assert.match(block, /@media \(max-width:760px\)\{/);
  for (const rule of [
    `${P}{flex-direction:column;flex-wrap:nowrap;min-height:calc(100dvh - 20px)}`,
    `${P} .rail{flex:none}`,
    `${P} .main{flex:1 1 auto;min-height:0;gap:10px}`,
    `${P} .card.hy.mc{flex:1 1 auto;height:auto;min-height:280px}`,
  ]) assert.ok(block.includes(rule), rule);
});
