export const OFFERS = Object.freeze({
  software: { group: 'software', service: 'wg0E8', cents: 9700, recurring: true, description: 'Viral View Pro — $97/month', next: '/clone/audit.html', hosted: 'https://commas.com/checkout/wg0E8nj4FjdaJ6L' },
  trial: { group: 'software', service: '2J89z', cents: 0, trial: true, next: '/clone/audit.html', hosted: 'https://commas.com/checkout/2J89z1C1sozSM3' },
  audit: { group: 'audit', service: 'XXYMA', cents: 49700, description: 'TikTok Shop Audit — $497', next: '/clone/vault.html', hosted: 'https://commas.com/checkout/XXYMA1NymVQ5wpc' },
  vault: { group: 'vault', service: 'O9gZr', cents: 29700, description: 'The Vault — lifetime access — $297', next: '/clone/welcome.html', hosted: 'https://commas.com/checkout/O9gZrPCEazKZx1I' },
  vault_plan: { group: 'vault', service: 'jJYvv', cents: 9900, recurring: true, description: 'The Vault — 3 monthly payments of $99', next: '/clone/welcome.html', hosted: 'https://commas.com/checkout/jJYvvwCNDeq7PMsh' },
});

// Only the Worker access gate may select this internal mode. COMMAS_ENV enables
// the protected test path; it never changes the public funnel's default.
export function isSandbox(env) { return env.CLONE_PAYMENT_MODE === 'sandbox'; }
export function table(env, name) { return (isSandbox(env) ? 'clone_sandbox_' : 'clone_') + name; }
export function cookieName(env, kind) { return '__Secure-clone-' + (isSandbox(env) ? 'sandbox-' : '') + kind; }
export function tokenKind(env, kind) { return (isSandbox(env) ? 'sandbox-' : '') + kind; }

export function paymentConfig(env) {
  if (!isSandbox(env)) return {
    environment: 'production', base: 'https://www.fanbasis.com/public-api', apiKey: env.COMMAS_API_KEY,
    creator: 'viralview', seat: 'nmGzE', hostedSeat: 'https://commas.com/checkout/nmGzEY7RCWcGOKl', offers: OFFERS,
  };
  if (env.COMMAS_ENV !== 'sandbox' || !env.COMMAS_SANDBOX_API_KEY ||
      env.COMMAS_SANDBOX_API_KEY === env.COMMAS_API_KEY || !env.COMMAS_SANDBOX_CREATOR_ID) throw new Error('sandbox_unconfigured');
  let ids, urls;
  try { ids = JSON.parse(env.COMMAS_SANDBOX_PRODUCT_IDS); urls = JSON.parse(env.COMMAS_SANDBOX_CHECKOUT_URLS); }
  catch { throw new Error('sandbox_unconfigured'); }
  const productionIds = new Set(['nmGzE', ...Object.values(OFFERS).map(o => o.service)]);
  const names = ['seat', ...Object.keys(OFFERS)];
  for (const name of names) {
    if (!/^[A-Za-z0-9]{3,100}$/.test(ids?.[name] || '') || productionIds.has(ids[name]) ||
        !/^https:\/\/sandbox\.commas\.net\/(?:checkout\/[A-Za-z0-9]+|agency-checkout\/[A-Za-z0-9_-]+\/[A-Za-z0-9]+)$/.test(urls?.[name] || '')) throw new Error('sandbox_unconfigured');
  }
  if (new Set(names.map(n => ids[n])).size !== names.length) throw new Error('sandbox_unconfigured');
  return {
    environment: 'sandbox', base: 'https://api-sandbox.commas.net/public-api', apiKey: env.COMMAS_SANDBOX_API_KEY,
    creator: env.COMMAS_SANDBOX_CREATOR_ID, seat: ids.seat, hostedSeat: urls.seat,
    offers: Object.fromEntries(Object.entries(OFFERS).map(([name, offer]) => [name, {
      ...offer, service: ids[name], hosted: urls[name], next: offer.next + '?sandbox=1',
    }])),
  };
}
