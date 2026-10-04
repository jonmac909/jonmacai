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
service ID, with `amount_cents` on `/customers/:id/charge`. **Recurring upsells stay gated
until the sandbox end-to-end run confirms the service-ID request field, ID format
and subscription creation.** The public charge reference
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

The installed D1 database is `jonmacai-clone-upsells`. The production Worker
and webhook remain in place; sandbox needs its own webhook subscription. Existing secrets remain on `jonmac-agency`; the release
adds `CLONE_TOKEN_SECRET` (random 32-byte signing key). Never put keys, raw Commas
responses or card data into browser code, Git or logs.

## Activation and fallback

Ana reported that Felipe confirmed manual rebill **ON** for `jon@thejonmac.com`
in Slack on October 4, 2026 at 2:59 PM. The Slack timestamp has no timezone, so
`CLONE_REBILL_ENABLED_AT="2026-10-04T21:14:20Z"` conservatively uses the time
Ana's confirmation was received and processed. This is an eligibility cutoff,
not a claim about the exact provider activation time. All pre-October-4
purchases, and purchases at or before this cutoff, remain on hosted checkout.

Production now sets `CLONE_REBILL_ENABLED="true"` and keeps
`CLONE_SUBSCRIPTIONS_ENABLED="false"`. Verified purchases after the cutoff can
use saved-card one-click billing for the $497 audit and $297 lifetime vault.
The $97 software subscription, $99 vault payment plan and free trial still use
their existing hosted checkouts. The YES buttons automatically open hosted
checkout while unavailable, unverified, missing a saved card or when Commas
explicitly rejects rebilling/authorization. Other explicit charge failures show
a message and a blue hosted checkout button. No thanks
continues through software → audit → vault → welcome → survey; the existing
software and vault exit popups remain, and their final No thanks links continue.

Manual rebill activation is confirmed; no additional activation approval is
needed. Keep the conservative cutoff unless Commas supplies a precise timestamp
with timezone. Enable `CLONE_SUBSCRIPTIONS_ENABLED`
only after confirming service-ID behavior in the sandbox end-to-end run. Jon
has selected sandbox validation; do not prepare or run a live-card test.
The free seven-day trial always uses its own hosted service `2J89z`: the charge
API requires at least one cent and documents no free-trial enrollment mechanism.
The $99 vault option uses `jJYvv`, three monthly payments, not an unlimited plan.

[Commas API reference](https://commasdocs.com/#charge-customer) documents saved
cards, numeric customer IDs, positive `amount_cents`, and charge preconditions.
Its [sandbox](https://commasdocs.com/#environments) uses
`https://api-sandbox.commas.net` and a separate key from the sandbox dashboard.
The separate sandbox key and products are pending from Jon. Mock tests validate
the implementation; provider acceptance remains pending the sandbox end-to-end run.
No real card was charged during implementation or verification.

## Validation and deployment

```powershell
node --test cloud-apps/clone/test/*.test.mjs
node <installed-wrangler-cli> d1 migrations apply jonmacai-clone-upsells --remote --config cloud-apps/clone/wrangler.jsonc
node <installed-wrangler-cli> deploy --dry-run --config cloud-apps/clone/wrangler.jsonc
node <installed-wrangler-cli> deploy --config cloud-apps/clone/wrangler.jsonc
```

Validation passed: 26 mocked backend/SQLite tests; seven-case sandbox browser
runner with mocked Commas/SDK (eight paid upsells, three verified/cancelled
subscriptions, and rejection when subscription creation is missing); browser checks for spinner,
disabled buttons, double-click suppression, explicit rejection, ambiguous
response across refresh/expired identity, next-page navigation, decline links,
automatic hosted fallback and mobile layout. Run the browser smoke test with
`CLONE_BROWSER_CLI` set to the installed `agent-browser.js`, using
`node cloud-apps/clone/test/browser-smoke.mjs` against the local Wrangler server
at port 8796. Screenshots are written to the OS temp directory as
`clone-upsell-fallback.png` and `clone-upsell-mobile.png`.

## Protected sandbox - provisioning pending

Jon selected **sandbox end-to-end validation only**. Do not prepare or run a
live-card test. Public `/clone/` always uses production, even when
`COMMAS_ENV=sandbox` enables the protected test path. The server accepts sandbox
requests only with `?sandbox=1` and a valid 30-minute HttpOnly access cookie.

Provision only inside the separate account at https://sandbox.commas.net:

| Map name | Sandbox product terms | Production reference (do not reuse) |
| --- | --- | --- |
| `seat` | $47, one-time | `nmGzE` |
| `software` | $97 every 30 days, no trial | `wg0E8` |
| `trial` | $97 every 30 days, free seven-day trial | `2J89z` |
| `audit` | $497, one-time | `XXYMA` |
| `vault` | $297, one-time lifetime access | `O9gZr` |
| `vault_plan` | $99 every 30 days, initial payment + two renewals | `jJYvv` |

Need **six short public product/service IDs**, their **six full sandbox hosted
checkout URLs**, and the sandbox seller/creator handle. Numeric product IDs are
resolved server-side and never copied from production. Configure these Worker
variables (JSON maps use the names above):

- `COMMAS_ENV=sandbox` enables protected test requests only.
- `COMMAS_SANDBOX_CREATOR_ID` = sandbox seller handle.
- `COMMAS_SANDBOX_PRODUCT_IDS` = JSON object containing all six short IDs.
- `COMMAS_SANDBOX_CHECKOUT_URLS` = JSON object containing all six URLs. Only
  `https://sandbox.commas.net/checkout/<id>` or sandbox
  `/agency-checkout/<handle>/<id>` URLs are accepted. Supply the actual sandbox
  URLs; never derive them by replacing the host in a production URL. Configure
  sandbox product success redirects back to the corresponding next Clone page
  with `?sandbox=1` (seat to software, software/trial to audit, audit to vault,
  vault/plan to welcome).
- `CLONE_SANDBOX_REBILL_ENABLED=true` once sandbox manual rebill is enabled.
- `CLONE_SANDBOX_REBILL_ENABLED_AT` = sandbox activation timestamp in UTC.
- `CLONE_SANDBOX_SUBSCRIPTIONS_ENABLED=true` for sandbox validation of the
  support-reported `service_id` contract. Production subscription gate stays
  disabled until this sandbox run proves subscription creation and plan terms.

Set separate secrets on the existing `jonmac-agency` Worker using Cloudflare
secret storage: `COMMAS_SANDBOX_API_KEY`, `COMMAS_SANDBOX_WEBHOOK_SECRET`, and
`CLONE_SANDBOX_ACCESS_TOKEN` (random 32+ characters). Register a **sandbox-only**
`payment.succeeded` webhook to `https://jonmac.ai/clone/api/sandbox/purchase`,
and store its signing secret in `COMMAS_SANDBOX_WEBHOOK_SECRET`. The runner
checks that an active matching webhook exists before submitting checkout. No production
webhook needs modification. Missing settings, a reused production key/ID, or a
production fallback URL reject sandbox access before making any provider call.
The sandbox webhook and lead endpoint skip production lead/email automation.
Sandbox and production have separate session caches, signed cookie names and
kinds, session storage keys, D1 proof/claim tables, and provider idempotency keys.

**Never select sandbox using the production key or Commas CLI.** Commas persists
its selected environment server-side per API key, shared across clients. This
implementation invokes no environment-selection API or CLI command. It sends
sandbox requests directly to `https://api-sandbox.commas.net/public-api`, using
only the dedicated sandbox key, and sets the Embedded SDK environment to
`'sandbox'`. The currently published SDK resolves this to its older
`embedded-checkout.qa.dev-fan-basis.com` embed hostname; do not change the SDK
value to `'qa'` or substitute production credentials. The provider run will
verify the actual sandbox checkout/session compatibility.

For a browser, enter `/clone/?sandbox=1&token=<access-token>`; the Worker sets the
access cookie and immediately redirects to strip the secret before assets load.
Prefer `POST /clone/api/sandbox/access` with `{ "token": "..." }` and same-origin
headers, as the runner does, to keep the token out of URLs. Funnel navigation
preserves `?sandbox=1`; pages use private/no-store, no-referrer and noindex headers.
Returning to a URL without `sandbox=1` selects the normal production funnel.

## Sandbox end-to-end runner

```powershell
npm ci --prefix cloud-apps/clone
node cloud-apps/clone/node_modules/playwright/cli.js install chromium
npm run test:sandbox --prefix cloud-apps/clone
```

The last command prints the prepared sandbox plan only. After provisioning the
Worker settings/webhook above, set `COMMAS_ENV=sandbox`,
`COMMAS_SANDBOX_API_KEY`, and `CLONE_SANDBOX_ACCESS_TOKEN` in the runner's process
environment, then run:

```powershell
npm run test:sandbox --prefix cloud-apps/clone -- --run
```

`CLONE_SANDBOX_URL` defaults to `https://jonmac.ai/clone/`. Only that target and
loopback mock servers are allowed. The provider API host is fixed to sandbox;
production checkout hosts are blocked by the browser. The runner never uses
`COMMAS_API_KEY`. No screenshots, traces, raw provider bodies, keys or card
fields are logged. Optional `CLONE_SANDBOX_SELECTORS` JSON can adapt the card
field selectors if the sandbox iframe differs; missing/ambiguous fields stop
before payment submission. Do not set a real card: the runner uses only the
[official sandbox Visa test card](https://commasdocs.com/#environments), a future
expiry and test CVC.

Default coverage is seven fresh $47 sandbox purchases with unique test buyers:
full software to audit to vault funnel; software replay; audit replay; vault replay;
three-payment vault plan; trial fallback; and alternative vault-plan suppression.
For each paid upsell it verifies no card form opens, exactly one matching provider
transaction, concurrent API repeats plus refresh/UI repeats without another
charge, and the expected next page retaining sandbox mode. Recurring offers
must create exactly one new active monthly subscription with its first renewal
30 days out; the vault product must stop after two renewals. Created test
subscriptions are cancelled at the end, including on failure after discovery.
The trial is verified as **sandbox hosted fallback**, without submitting another
card: the rebill API has no documented free-trial enrollment and requires a
positive charge. A successful charge without a resulting subscription fails the
runner; it never retries the payment through hosted checkout.

For offline verification, `npm run test:sandbox:mock --prefix cloud-apps/clone`
uses the actual Worker, HTMLRewriter, D1 and browser with a mocked provider/SDK
and blocked external resources. It runs the same seven-case script, verifies
production tables stay empty, and proves the runner rejects a successful charge
that fails to create a subscription. This does not replace provider acceptance.
The real sandbox run has **not** been executed: key, products and webhook remain
pending. No live-card test is planned or authorized.
