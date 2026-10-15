# homeguidepress.com (JON-59)

One Cloudflare Worker (`homeguidepress`) for the Home Guide Press storefront:
landing pages for the 7 affiliate guides, checkout click tracking, the Commas
payment webhook and Resend delivery of a signed download link to a PDF in the
private R2 bucket `homeguidepress-books`. D1 database: `homeguidepress`.

## Pages

| Path | What |
|---|---|
| `/` | Index of the 7 guides |
| `/<book-path>` | Landing page (`/finally-written-down` for Angelo; others use their key until the title is final). `/<key>` redirects there |
| `/go/<key>` | Counts a buy click, then 302 to the Commas checkout link with `src`/`utm_*` kept |
| `/thanks?p=<key>` | Commas success URL: "check your email" plus the fresh-link form |
| `/download/<token>` | Download page; `/download/<token>/<n>` streams file n from R2 |
| `/privacy`, `/terms`, `/refunds` | Policies (30-day refund) |

Every page sends `noindex` and `robots.txt` disallows all until `INDEXING` is `"true"`.
Products: `src/products.js`. Persona names only from `my-agent/state/affiliate/personas.json`;
a missing one shows `[persona name pending]`. No reviews, counts, countdowns or credentials.

## Checkout

`CHECKOUT_URLS` (var) maps key to the Commas link. A key without a link shows
"Checkout opens soon" and no buy link. The webhook maps `data.item.id` to a key
through `PRODUCT_IDS`, or by the checkout link path, which starts with the product ID.
Success URL for each Commas product: `https://homeguidepress.com/thanks?p=<key>`.

## Delivery

`POST /api/commas/webhook` checks `x-webhook-signature` (hex HMAC-SHA256 of the raw
body, same as `cloud-apps/clone`). `payment.succeeded` / `product.purchased` insert an
order keyed on `transaction_history_id`; the key plus a claim column means a repeated
webhook never sends a second email. The email has a 7-day signed link, reply-to
partners@thejonmac.com. `refund.created` and `dispute.created` revoke the link
(matched on order ID, else buyer email + product, as refunds carry no order ID).
Commas never retries a webhook, so a cron every 10 minutes retries failed sends.
The fresh-link form answers the same way for every email and sends at most one
link per order per 10 minutes.

`POST /api/commas/test-webhook` exists only while the `COMMAS_TEST_WEBHOOK_SECRET`
secret is set. Its orders are marked test and may only email `TEST_RECIPIENTS`
(`delivered@resend.dev`). Send one with `scripts/test-webhook.mjs`.

Secrets: `COMMAS_WEBHOOK_SECRET`, `RESEND_API_KEY` (sending-only, homeguidepress.com),
`LINK_SECRET`, `COMMAS_TEST_WEBHOOK_SECRET`. Sender: `books@homeguidepress.com`
(Resend domain in Jon's account).

## Files

Upload PDFs with `npx wrangler r2 object put homeguidepress-books/<key>/<file>.pdf --file <path> --remote --content-type application/pdf`.
The object names are in `files` in `src/products.js` (or the `FILES` var).

## Commands

```powershell
npm test --prefix cloud-apps/homeguidepress
npm run shots --prefix cloud-apps/homeguidepress     # phone + desktop screenshots
npm run stats --prefix cloud-apps/homeguidepress     # views, buy clicks, sales by product and source
cd cloud-apps/homeguidepress; npx wrangler d1 migrations apply homeguidepress --remote; npx wrangler deploy
```

Deploy from a local checkout with the existing wrangler login. No GitHub Actions, never Vercel or Netlify.
