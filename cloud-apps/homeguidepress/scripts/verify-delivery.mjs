// One-shot sandbox delivery proof: a signed test webhook creates the order and sends
// the email, then the signed download link is fetched and checked for a real PDF.
// No live card, no real buyer. Test orders may only email delivered@resend.dev.
//
// Usage: node scripts/verify-delivery.mjs <key> <productId> [baseUrl]
// Secrets: HGP_TEST_WEBHOOK_SECRET and HGP_LINK_SECRET (env or C:/Users/partn/AppData/Local/hermes/.env).
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const ENV_FILE = 'C:/Users/partn/AppData/Local/hermes/.env';
const fileEnv = {};
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) fileEnv[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const pick = name => process.env[name] || fileEnv[name];

const [key, productId, base = 'https://homeguidepress.com'] = process.argv.slice(2);
const webhookSecret = pick('HGP_TEST_WEBHOOK_SECRET');
const linkSecret = pick('HGP_LINK_SECRET');
if (!key || !productId || !webhookSecret || !linkSecret) {
  console.error('usage: node scripts/verify-delivery.mjs <key> <productId> [baseUrl]  (needs HGP_TEST_WEBHOOK_SECRET and HGP_LINK_SECRET)');
  process.exit(2);
}

const b64url = s => Buffer.from(s).toString('base64url');
const hex = b => Buffer.from(b).toString('hex');
const dbToken = (tx, k) => {
  const data = b64url(JSON.stringify({ t: tx, k, e: Math.floor(Date.now() / 1000) + 7 * 86400 }));
  return data + '.' + hex(createHmac('sha256', linkSecret).update(data).digest());
};

const tx = 'ORD-TEST-' + randomUUID().slice(0, 8).toUpperCase();
const now = new Date().toISOString();
const payload = { id: randomUUID(), type: 'payment.succeeded', created_at: now, data: {
  transaction_history_id: tx, payment_id: tx, status: 'succeeded', amount: 39.99, currency: 'USD', quantity: 1, created_at: now,
  item: { id: productId, type: 'onetime' }, buyer: { id: 'user_simulated01', email: 'delivered@resend.dev', name: 'Simulated Buyer' },
  api_metadata: { data: { src: 'sandbox-check' } } } };
const raw = JSON.stringify(payload);
const sig = createHmac('sha256', webhookSecret).update(raw).digest('hex');

const posted = await fetch(base + '/api/commas/test-webhook', { method: 'POST', body: raw,
  headers: { 'content-type': 'application/json', 'x-webhook-signature': sig } });
const body = await posted.text();
console.log('webhook', posted.status, body.slice(0, 160));

const link = `${base}/download/${dbToken(tx, key)}/0`;
const dl = await fetch(link, { redirect: 'manual' });
const bytes = Buffer.from(await dl.arrayBuffer());
console.log('download', dl.status, dl.headers.get('content-type'), bytes.length + ' bytes', bytes.subarray(0, 5).toString() === '%PDF-' ? 'PDF ok' : 'not a PDF');
process.exit(posted.ok && dl.status === 200 && bytes.subarray(0, 5).toString() === '%PDF-' ? 0 : 1);
