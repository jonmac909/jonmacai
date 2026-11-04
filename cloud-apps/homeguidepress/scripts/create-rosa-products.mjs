// Create the 3 Rosa Commas products for Home Guide Press, wire their checkout links
// into wrangler.jsonc, and make sure the delivery webhook subscription exists.
// The API key is read from the environment or the team .env file and never printed.
//
// Usage:
//   node scripts/create-rosa-products.mjs --check   list what exists, change nothing
//   node scripts/create-rosa-products.mjs           create missing products, wire, set secret
//
// Key names accepted: COMMAS_AFFILIATE_API_KEY (preferred), COMMAS_API_KEY.
// Base is the production API. Products are one-time charges in dollars (not cents).
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const BASE = 'https://www.fanbasis.com/public-api';
const SITE = 'https://homeguidepress.com';
const checkOnly = process.argv.includes('--check');

const ENV_FILE = 'C:/Users/partn/AppData/Local/hermes/.env';
function loadKey() {
  let key = process.env.COMMAS_AFFILIATE_API_KEY || process.env.COMMAS_API_KEY;
  if (key) return key.trim();
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(COMMAS_AFFILIATE_API_KEY|COMMAS_HGP_API_KEY)\s*=\s*(.*)$/);
      if (m) return m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

const KEY = loadKey();
if (!KEY) { console.error('no Commas key: set COMMAS_AFFILIATE_API_KEY (env or hermes .env)'); process.exit(2); }

const ROSA = [
  { key: 'rosa-cooks', title: 'The Hand-Me-Down Kitchen',
    description: '90 Mexican family recipes with the exact amounts, the old tricks, and what to do when it goes wrong. PDF cookbook, 94 pages.' },
  { key: 'rosa-hacks', title: 'Fix It Like Family Did',
    description: 'Repair, mend and make do around the house, room by room. PDF handbook, 94 pages, 60 fixes.' },
  { key: 'rosa-clean', title: 'The Old Way to a Clean House',
    description: '32 mixes for the whole house, a 40 stain book, and the room by room playbooks. PDF book, 98 pages.' },
];

async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'x-api-key': KEY, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { status: 'error', message: text.slice(0, 200) }; }
  if (!res.ok || body.status === 'error') {
    throw new Error(`${init.method || 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body.errors || body.message).slice(0, 300)}`);
  }
  return body.data ?? body;
}

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual' });
    return res.status >= 200 && res.status < 400;
  } catch { return false; }
}

const listed = await api('/products?per_page=100');
const existing = (Array.isArray(listed) ? listed : (listed.data || [])).map(p => ({
  title: p.title, id: p.id, price: p.price, link: p.payment_link,
}));

const results = [];
for (const item of ROSA) {
  const found = existing.find(p => p.title === item.title);
  let link = found?.link || null;
  let id = found?.id || null;
  if (!found) {
    if (checkOnly) { results.push({ ...item, state: 'missing' }); continue; }
    const created = await api('/products/create', {
      method: 'POST',
      body: JSON.stringify({
        title: item.title,
        price: 39.99,
        type: 'onetime',
        description: item.description,
        successful_payment_redirect: `${SITE}/thanks?p=${item.key}`,
        webhook_url: `${SITE}/api/commas/webhook`,
      }),
    });
    id = created.product_id;
    link = created.payment_link;
  }
  // The worker only accepts https://commas.com/checkout/<hashid>. The API returns a
  // fanbasis agency-checkout link, so take its last segment as the hashid and use the
  // commas.com form the dashboard links use.
  const hashid = String(link || '').split('/').filter(Boolean).pop();
  const commas = hashid ? `https://commas.com/checkout/${hashid}` : null;
  const ok = commas ? await headOk(commas) : false;
  results.push({ ...item, state: found ? (found.price === '39.99' ? 'existing' : `existing price ${found.price}`) : 'created',
    id, hashid, link: ok ? commas : link, commasOk: ok });
}

for (const r of results) {
  console.log(`${r.key} | ${r.state} | id ${r.id ?? '-'} | ${r.link ?? '-'}${r.commasOk === false ? ' | WARNING commas link not 200, not wired' : ''}`);
}

if (checkOnly) process.exit(0);

const ready = results.filter(r => r.commasOk && r.hashid);
if (ready.length !== results.length) {
  console.error('some products are not ready to wire; wrangler.jsonc left unchanged');
  process.exit(1);
}
for (const r of ready) {
  const out = execFileSync(process.execPath, ['scripts/wire-checkout.mjs', r.key, r.link, r.hashid], { encoding: 'utf8' });
  console.log(out.trim().split('\n').filter(l => l.startsWith('CHECKOUT_URLS')).join(' '));
}

// One webhook subscription for the whole business. Its secret goes to the worker
// as COMMAS_WEBHOOK_SECRET and is never printed here.
const subs = await api('/webhook-subscriptions');
const list = Array.isArray(subs) ? subs : (subs.data || []);
const url = `${SITE}/api/commas/webhook`;
if (list.some(s => s.webhook_url === url)) {
  console.log('webhook subscription already exists, secret left as is');
} else {
  const created = await api('/webhook-subscriptions', {
    method: 'POST',
    body: JSON.stringify({ webhook_url: url, event_types: ['payment.succeeded', 'refund.created', 'dispute.created'] }),
  });
  const secret = created.secret_key;
  if (!secret) throw new Error('webhook created but no secret_key in the response');
  const put = spawnSync('npx', ['wrangler', 'secret', 'put', 'COMMAS_WEBHOOK_SECRET'], {
    cwd: process.cwd(), input: secret + '\n', encoding: 'utf8', shell: true,
  });
  console.log(put.status === 0 ? 'webhook created, COMMAS_WEBHOOK_SECRET set on the worker' : 'webhook created but secret put failed');
}
console.log('next: npx wrangler deploy');
