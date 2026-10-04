# Clone funnel payments

Production: `https://jonmac.ai/clone/`, existing Cloudflare Worker `jonmac-agency`.
The current Clone pages and embedded modal were deployed from local Clone feature
branches before those branches reached GitHub main. This release includes that
existing production source, preserving its copy, schedule, design and blue CTAs.

The modal creates a random browser checkout reference in a signed, HttpOnly,
Secure, SameSite=Lax cookie. The SDK passes that reference as
`metadata.clone_checkout_ref` and saves its success transaction ID for the next
page. A fresh checkout clears any previous signed buyer cookie. The existing
Commas webhook at `/clone/api/purchase` verifies the raw-body HMAC and records
only a recent, successful $47 `nmGzE` payment correlated to that reference.

`POST /clone/api/buyer-session` requires that browser's signed checkout cookie
and its signed webhook proof. It verifies the completed transaction through
Commas (product, amount, email hash, date, no refunds), then resolves the exact
email to a unique numeric customer ID. Webhook order IDs and SDK transaction
hashids differ; when direct lookup does not resolve, the last 100 transactions
for the seat product are reconciled against the signed proof. Missing proof,
ambiguous identity or an unverifiable transaction uses hosted checkout. Buyer
cookies expire after 30 minutes. Client customer IDs never authorize billing.

`POST /clone/api/upsell {offer}` accepts only `software`, `trial`, `audit`,
`vault`, or `vault_plan`. Prices, service IDs and next-page URLs are server-owned.
Before billing, it verifies the current service terms and obtains the customer's
saved card server-side. `service_id` uses the numeric ID resolved from the public
service ID, with `amount_cents` on `/customers/:id/charge`. **Commas must confirm
the exact service-ID request field, ID format, product association and recurring
subscription behavior before activating rebills.** The public charge reference
currently does not document `service_id`; the subscription capability was
reported by Commas support, and has been implemented and tested with mocks only.

The D1 primary key `(buyer_id, offer_group)` atomically claims the order before
the charge. Software/trial and vault/plan each share a group. This prevents
double billing across simultaneous requests, refreshes, new sessions and choice
of alternative plans. Claims never expire. Also send a stable `Idempotency-Key`
to Commas, whose own duplicate protection lasts only ten minutes. An explicit
rejection permits hosted checkout; timeout, HTTP 409/5xx, malformed success or
failure to persist the successful charge stays locked. The page offers **Check
Payment Status**, never another checkout for an uncertain payment. Such claims
need manual reconciliation with Commas; no automatic charge retry exists. A
browser pending marker survives refreshes and prevents an expired session from
offering another checkout. An authentic expired buyer token can inspect an
existing claim, but cannot authorize a new charge.

The installed D1 database is `jonmacai-clone-upsells`. No new Worker or webhook
subscription is needed. Existing secrets remain on `jonmac-agency`; the release
adds `CLONE_TOKEN_SECRET` (random 32-byte signing key). Never put keys, raw Commas
responses or card data into browser code, Git or logs.

## Activation and fallback

Production ships with `CLONE_REBILL_ENABLED="false"`,
`CLONE_SUBSCRIPTIONS_ENABLED="false"`, and an empty
`CLONE_REBILL_ENABLED_AT`. The YES buttons automatically open their existing
hosted checkout while unavailable, unverified or missing a saved card. Explicit
charge failures show a message and a blue hosted checkout button. No thanks
continues through software → audit → vault → welcome → survey; the existing
software and vault exit popups remain, and their final No thanks links continue.

After Commas confirms Card on File/manual rebilling is enabled on Viral View
`org_8dfMp4cmF3MG`, record its exact enablement time as ISO UTC in
`CLONE_REBILL_ENABLED_AT` and set `CLONE_REBILL_ENABLED="true"`. Purchases before
that time stay on hosted checkout. Enable `CLONE_SUBSCRIPTIONS_ENABLED` only
for Jon's approved live test after confirming service-ID behavior; keep recurring
rebills disabled outside that test until it passes.
The free seven-day trial always uses its own hosted service `2J89z`: the charge
API requires at least one cent and documents no free-trial enrollment mechanism.
The $99 vault option uses `jJYvv`, three monthly payments, not an unlimited plan.

[Commas API reference](https://commasdocs.com/#charge-customer) documents saved
cards, numeric customer IDs, positive `amount_cents`, and charge preconditions.
Its [sandbox](https://commasdocs.com/#environments) uses
`https://api-sandbox.commas.net` and a separate key from the sandbox dashboard.
No sandbox key is provisioned in the supplied environment; all billing tests use
mocks. No real card was charged during implementation or verification.

## Validation and deployment

```powershell
node --test cloud-apps/clone/test/*.test.mjs
node <installed-wrangler-cli> d1 migrations apply jonmacai-clone-upsells --remote --config cloud-apps/clone/wrangler.jsonc
node <installed-wrangler-cli> deploy --dry-run --config cloud-apps/clone/wrangler.jsonc
node <installed-wrangler-cli> deploy --config cloud-apps/clone/wrangler.jsonc
```

Validation passed: 16 mocked backend/SQLite tests; browser checks for spinner,
disabled buttons, double-click suppression, explicit rejection, ambiguous
response across refresh/expired identity, next-page navigation, decline links,
automatic hosted fallback and mobile layout. Run the browser smoke test with
`CLONE_BROWSER_CLI` set to the installed `agent-browser.js`, using
`node cloud-apps/clone/test/browser-smoke.mjs` against the local Wrangler server
at port 8796. Screenshots are written to the OS temp directory as
`clone-upsell-fallback.png` and `clone-upsell-mobile.png`.

## Single live test — prepared only; Jon's approval required

1. Wait for Commas' written activation confirmation and exact enablement time.
   Confirm `service_id` name/ID format, whether it associates one-time products,
   whether $97 creates a 30-day recurring subscription, and whether the vault
   plan stops after its configured three payments. Keep trial hosted.
2. Obtain Jon's explicit approval for **one $47 purchase plus one $97 software
   upsell ($144 total), refunding both and canceling the created subscription**.
   Use only Jon's approved test buyer/card; do not reuse an older purchase.
3. In a fresh browser, buy the $47 seat once through `/clone/`. Confirm the
   signed webhook/browser binding and buyer cookie; never record card details.
   With the service-ID contract confirmed, temporarily enable recurring rebills
   for this approved test. If the purchase cannot be verified, stop; do not
   complete another hosted purchase as part of this test.
4. Click the $97 YES once. Confirm no card entry, one $97 charge, advancement to
   audit, and an active `wg0E8` subscription with its next $97 billing date in
   30 days. Repeat the same endpoint request and reload/revisit: expect cached
   success and exactly one $97 charge. Skip audit and vault to reach welcome
   and survey. Do not purchase other offers.
5. Refund the $47 and $97 transactions, cancel the new recurring subscription,
   and verify refunds/cancellation in Commas. Record transaction/subscription
   IDs, results and any nonrefundable processing fees. Restore the gates if any
   condition fails; an ambiguous charge must be reconciled before another
   checkout. Only release recurring billing after this test passes.
