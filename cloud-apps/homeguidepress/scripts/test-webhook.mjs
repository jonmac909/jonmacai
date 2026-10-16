// Sends a signed test webhook in the real Commas envelope shape to the TEST path.
// The secret comes from HGP_TEST_WEBHOOK_SECRET (never printed). Test orders may only
// email TEST_RECIPIENTS (default delivered@resend.dev), so Jon's inbox is never used.
// Usage: node scripts/test-webhook.mjs <paid|refund> <transactionId> <productId> [email] [eventId] [baseUrl]
import { createHmac, randomUUID } from 'node:crypto';

const [kind, tx, productId, email = 'delivered@resend.dev', eventId = randomUUID(), base = 'https://homeguidepress.com'] = process.argv.slice(2);
const secret = process.env.HGP_TEST_WEBHOOK_SECRET;
if (!secret || !['paid', 'refund'].includes(kind) || !tx || !productId) {
  console.error('usage: HGP_TEST_WEBHOOK_SECRET=... node scripts/test-webhook.mjs <paid|refund> <transactionId> <productId> [email] [eventId] [baseUrl]');
  process.exit(2);
}
const now = new Date().toISOString();
const payload = kind === 'paid'
  ? { id: eventId, type: 'payment.succeeded', created_at: now, data: {
      transaction_history_id: tx, payment_id: tx, status: 'succeeded', amount: 19, currency: 'USD', quantity: 1, created_at: now,
      item: { id: productId, type: 'onetime' }, buyer: { id: 'user_simulated01', email, name: 'Simulated Buyer' }, api_metadata: { data: {} } } }
  : { id: eventId, type: 'refund.created', created_at: now, data: {
      refund_id: 'simulated-' + tx, refund_transaction_id: 'simulated', amount: 19, status: 'success', refund_type: 'full', reason: 'simulated',
      item: { id: productId }, buyer: { email } } };
const raw = JSON.stringify(payload);
const response = await fetch(base + '/api/commas/test-webhook', { method: 'POST', body: raw, headers: {
  'content-type': 'application/json', 'x-webhook-signature': createHmac('sha256', secret).update(raw).digest('hex') } });
console.log(response.status, await response.text());
