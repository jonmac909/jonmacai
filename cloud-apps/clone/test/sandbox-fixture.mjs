import { OFFERS } from '../src/payment-config.js';

export const sandboxIds = { seat: 'SBseat', software: 'SBsoftware', trial: 'SBtrial', audit: 'SBaudit', vault: 'SBvault', vault_plan: 'SBplan' };
export const sandboxUrls = Object.fromEntries(Object.entries(sandboxIds).map(([n, id]) => [n, 'https://sandbox.commas.net/checkout/' + id]));
export function sandboxSettings() { return {
  COMMAS_ENV: 'sandbox', COMMAS_API_KEY: 'mock-production-key', COMMAS_SANDBOX_API_KEY: 'mock-sandbox-key',
  COMMAS_SANDBOX_CREATOR_ID: 'mock-sandbox-creator', COMMAS_SANDBOX_PRODUCT_IDS: JSON.stringify(sandboxIds),
  COMMAS_SANDBOX_CHECKOUT_URLS: JSON.stringify(sandboxUrls), COMMAS_WEBHOOK_SECRET: 'mock-production-hook',
  COMMAS_SANDBOX_WEBHOOK_SECRET: 'mock-sandbox-hook', CLONE_TOKEN_SECRET: 'mock-signing-secret',
  CLONE_SANDBOX_ACCESS_TOKEN: 'mock-only-access-token-32-characters-long',
  CLONE_REBILL_ENABLED: 'true', CLONE_SUBSCRIPTIONS_ENABLED: 'false',
  CLONE_REBILL_ENABLED_AT: new Date(Date.now() - 60000).toISOString(),
  CLONE_SANDBOX_REBILL_ENABLED: 'true', CLONE_SANDBOX_SUBSCRIPTIONS_ENABLED: 'true',
  CLONE_SANDBOX_REBILL_ENABLED_AT: new Date(Date.now() - 60000).toISOString(),
}; }
export function mockProduct(name) {
  const offer = OFFERS[name];
  return { product: { id: 9000 + Object.keys(sandboxIds).indexOf(name) },
    amount_cents: offer?.trial ? 9700 : offer?.cents || 4700, type: offer?.recurring || offer?.trial ? 'subscription' : 'onetime',
    subscription: { frequency_days: 30, free_trial_days: offer?.trial ? 7 : null, auto_expire_after_x_periods: name === 'vault_plan' ? 2 : null } };
}
