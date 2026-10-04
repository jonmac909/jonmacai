// Local browser verification only. Payment responses are mocked inside the page;
// no payment credentials, checkout submissions or Commas charge calls are used.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeSync, openSync, readFileSync } from 'node:fs';

const cli = process.env.CLONE_BROWSER_CLI;
if (!cli) throw new Error('Set CLONE_BROWSER_CLI to the installed agent-browser.js');
const base = 'http://127.0.0.1:8796/clone/';
function browser(...args) {
  // The Windows browser daemon inherits pipes from its launcher. File-backed
  // stdio avoids waiting for those inherited pipes after the CLI has exited.
  const output = join(tmpdir(), 'clone-browser-output.txt');
  const errors = join(tmpdir(), 'clone-browser-errors.txt');
  const out = openSync(output, 'w'), err = openSync(errors, 'w');
  try {
    execFileSync(process.execPath, [cli, '--session', 'clone-upsells-review', ...args], { stdio: ['ignore', out, err], timeout: 45000 });
    return readFileSync(output, 'utf8').trim();
  } finally { closeSync(out); closeSync(err); }
}
function evaluate(js) { return browser('eval', js); }
function expectTrue(js) { assert.equal(evaluate(js), 'true', js); }
try {
  browser('open', base + 'software.html'); browser('snapshot', '-i');
  expectTrue(`document.querySelectorAll('[data-upsell="software"]').length > 0 && document.querySelectorAll('[data-upsell="trial"]').length > 0 && Array.from(document.querySelectorAll('a.yes')).every(a=>a.dataset.upsell)`);
  evaluate(`window.mockRequests=0; window.fetch=async function(url){if(String(url).endsWith('/upsell')){window.mockRequests++;return new Promise(resolve=>{window.finishMock=()=>resolve(new Response(JSON.stringify({ok:true,next:'/clone/audit.html'})));});}return new Response(JSON.stringify({ok:false}));};`);
  evaluate(`document.querySelector('[data-upsell]').click();document.querySelectorAll('[data-upsell]')[1].click();`);
  expectTrue(`!!document.querySelector('.upsell-spinner') && Array.from(document.querySelectorAll('[data-upsell]')).every(b=>b.getAttribute('aria-disabled')==='true') && window.mockRequests===1`);
  evaluate(`window.finishMock();`); browser('wait', '--url', '**/clone/audit.html');
  console.log('PASS: spinner, all offer buttons disabled, duplicate click suppressed, software advances to audit');

  evaluate(`window.fetch=async()=>new Response(JSON.stringify({ok:false,fallback:true,reason:'payment_rejected',message:'Payment declined. Continue with secure checkout.',checkoutUrl:'https://commas.com/checkout/XXYMA1NymVQ5wpc'}));document.querySelector('[data-upsell]').click();`);
  browser('wait', '.upsell-result');
  expectTrue(`document.querySelector('.upsell-result a').href === 'https://commas.com/checkout/XXYMA1NymVQ5wpc' && !document.querySelector('.upsell-spinner')`);
  browser('scrollintoview', '.upsell-result');
  browser('screenshot', join(tmpdir(), 'clone-upsell-fallback.png'));
  console.log('PASS: explicit decline shows message and correct blue hosted fallback');

  browser('open', base + 'audit.html');
  evaluate(`window.fetch=async()=>{throw new Error('mock network loss');};document.querySelector('[data-upsell]').click();`);
  browser('wait', '.upsell-result');
  expectTrue(`!document.querySelector('.upsell-result a') && document.querySelector('.upsell-result button').textContent==='Check Payment Status'`);
  browser('reload');
  evaluate(`window.fetch=async()=>new Response(JSON.stringify({ok:false,fallback:true,reason:'buyer_unverified',checkoutUrl:'https://commas.com/checkout/XXYMA1NymVQ5wpc'}));document.querySelector('[data-upsell]').click();`);
  browser('wait', '.upsell-result');
  expectTrue(`!document.querySelector('.upsell-result a') && document.querySelector('.upsell-result button').textContent==='Check Payment Status'`);
  evaluate(`window.fetch=async()=>new Response(JSON.stringify({ok:true,next:'/clone/vault.html'}));document.querySelector('.upsell-result button').click();`);
  browser('wait', '--url', '**/clone/vault.html');
  console.log('PASS: ambiguous payment stays safe after refresh/expired identity; confirmed audit advances to vault');

  expectTrue(`document.querySelector('[data-upsell="vault_plan"]').href === 'https://commas.com/checkout/jJYvvwCNDeq7PMsh'`);
  evaluate(`document.querySelector('[data-exit]').click();`);
  expectTrue(`document.querySelector('#pop').classList.contains('show')`);
  browser('snapshot', '-i'); browser('click', '#pop a[data-close]');
  browser('wait', '--url', '**/clone/welcome.html');
  console.log('PASS: vault plan stays mapped to its service; final No thanks reaches welcome');

  browser('open', base + 'software.html');
  evaluate(`document.querySelector('[data-exit]').click();`);
  browser('snapshot', '-i'); browser('click', '#pop a[data-close]');
  browser('wait', '--url', '**/clone/audit.html');
  browser('snapshot', '-i'); browser('find', 'first', 'a.no', 'click'); browser('wait', '--url', '**/clone/vault.html');
  console.log('PASS: software and audit decline paths advance');

  browser('set', 'viewport', '390', '844'); browser('open', base + 'software.html');
  expectTrue(`document.documentElement.scrollWidth <= innerWidth`);
  browser('screenshot', join(tmpdir(), 'clone-upsell-mobile.png'));
  assert.ok(['', 'No errors'].includes(browser('errors')));
  console.log('PASS: mobile layout has no horizontal overflow or browser errors');

  // No endpoint call here: inspect the automatic fallback destination using a
  // mocked unavailable response and intercept the hosted navigation locally.
  browser('network', 'route', '**/checkout/**', '--body', '<html><body>Hosted fallback intercepted. No charge.</body></html>');
  for (const reason of ['rebill_unavailable', 'previous_fallback']) {
    browser('open', base + 'software.html');
    evaluate(`window.fetch=async()=>new Response(JSON.stringify({ok:false,fallback:true,reason:'${reason}',checkoutUrl:'https://commas.com/checkout/wg0E8nj4FjdaJ6L'}));document.querySelector('[data-upsell]').click();`);
    browser('wait', '--url', '**/checkout/wg0E8nj4FjdaJ6L');
    expectTrue(`document.body.textContent.includes('Hosted fallback intercepted')`);
    console.log('PASS: ' + reason + ' automatically sends YES to the existing hosted checkout');
  }
} finally {
  browser('close');
}
