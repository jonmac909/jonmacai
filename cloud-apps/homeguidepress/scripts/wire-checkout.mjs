// Wire one product's Commas checkout link and product id into wrangler.jsonc.
// Usage: node scripts/wire-checkout.mjs <key> <checkoutUrl> <productId> [--check]
//   --check   only report whether the key is already wired, change nothing
// Example: node scripts/wire-checkout.mjs rosa-cooks https://commas.com/checkout/AbC12xyz  AbC12
//
// The Worker reads two vars, both JSON objects stored as strings:
//   CHECKOUT_URLS -> { "<key>": "https://commas.com/checkout/<id>" }
//   PRODUCT_IDS   -> { "<key>": "<commas product id>" }
// The checkout URL must match the same shape the Worker enforces in checkoutFor().
import { readFileSync, writeFileSync } from 'node:fs';

const HERE = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FILE = HERE + 'wrangler.jsonc';
const URL_OK = /^https:\/\/(?:www\.)?commas\.com\/checkout\/[A-Za-z0-9]+$/;

const [key, checkoutUrl, productId] = process.argv.slice(2);
const checkOnly = process.argv.includes('--check');
if (!key) { console.error('usage: node scripts/wire-checkout.mjs <key> <checkoutUrl> <productId> [--check]'); process.exit(2); }

const source = readFileSync(FILE, 'utf8');
const varValue = (name) => {
  const m = source.match(new RegExp(`"${name}":\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) throw new Error(`${name} var not found in wrangler.jsonc`);
  return { json: m[1] };
};
const state = {};
for (const name of ['CHECKOUT_URLS', 'PRODUCT_IDS']) {
  const { json } = varValue(name);
  state[name] = { parsed: JSON.parse(json.replace(/\\"/g, '"')), raw: json };
}

const wired = Object.keys(state.CHECKOUT_URLS.parsed);
if (checkOnly) {
  console.log('wired checkout keys:', wired.join(', '));
  console.log(key + ':', wired.includes(key) ? 'already wired' : 'NOT wired (page will show "Checkout opens soon")');
  process.exit(0);
}

if (!checkoutUrl || !productId) { console.error('need <checkoutUrl> and <productId>'); process.exit(2); }
if (!URL_OK.test(checkoutUrl)) { console.error('checkout URL must look like https://commas.com/checkout/<id>: ' + checkoutUrl); process.exit(2); }
if (!/^[A-Za-z0-9]{4,}$/.test(productId)) { console.error('that product id does not look like a Commas id: ' + productId); process.exit(2); }
if (checkoutUrl.split('/').pop() !== productId) { console.error('product id does not match the checkout URL: ' + productId); process.exit(2); }

let out = source;
for (const [name, value] of [['CHECKOUT_URLS', checkoutUrl], ['PRODUCT_IDS', productId]]) {
  const parsed = state[name].parsed;
  const was = parsed[key];
  parsed[key] = value;
  const json = JSON.stringify(parsed).replace(/"/g, '\\"').replace(/\\"/g, '\\"');
  const quoted = JSON.stringify(JSON.stringify(parsed)).slice(1, -1);
  const before = state[name].raw;
  if (!out.includes(`"${name}": "${before}"`)) throw new Error(`could not find the ${name} var text to replace`);
  out = out.replace(`"${name}": "${before}"`, `"${name}": "${quoted}"`);
  console.log(name, was ? `updated ${key}: ${was} -> ${value}` : `added ${key}: ${value}`);
}
writeFileSync(FILE, out);
console.log('wrote', FILE);
console.log('next: npx wrangler deploy   (needs Jon\'s OK through Ana)');
