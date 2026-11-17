# Skool leads CRM, email check and 7-day email sequence (2026-11-16)

Code: `src/skool.js` (links, pop-over, routes), `src/skoolcheck.js` (email check), `src/skoolcrm.js` (Leads page, CSV, preview page),
`src/skoolmail.js` (the 7 emails), `src/skoolseq.js` (switch, cron sender, unsubscribe, Resend webhook, test send). Migration `0031_skool_crm.sql` (additive).

## Email check (the pop-over on `/s/<slug>`)
Port of the checks of github.com/AfterShip/email-verifier and github.com/umuterturk/email-verifier (MIT). No SMTP, no third-party API.
Order: syntax, "Did you mean" typo suggestion, disposable domain, role address (admin@, info@, noreply@ ...), then Cloudflare DNS-over-HTTPS
(`cloudflare-dns.com/dns-query`, 1.5 s, MX then A/AAAA). A bad email re-shows the pop-over with a short error and nothing is stored.
DNS timeout or SERVFAIL fails open. Each lead stores `email_check`: `valid`, `suggested` (visitor kept a likely typo) or `risky` (no MX but an A record, or DNS unchecked).
Lists are vendored in `src/data/` with the licence note in each file header (disposable 75,258 domains, free providers, role names).

## Leads on /track (signed in)
`/track/leads`: one row per email (first video, all videos, first/last seen, check, sale yes/amount/date from `skool_sales`, sequence status), search box, filter, CSV at `/track/leads.csv`.
`/track` keeps the per-video table (the Leads column is the number of emails captured on that link). Nav links: Videos and sales, Leads, Email sequence.
Zapier's sale zap may send `amount`; it is stored when present.

## The sequence
`skool_sequence_on` in `skool_settings` is the master switch: OFF unless Jon clicks On (on `/track` or `/track/emails`; session + `X-CC`).
The cron `*/15 * * * *` (`SEQ_CRON`) sends at most 8 emails per run: day 0 right after the email is entered, each next day 24 hours after the previous one was sent.
One row per email + day in `skool_seq_sends` is claimed before the send (no double sends); a failed send is retried up to 3 times.
It stops for an email that is in `skool_sales`, in `skool_seq_stops` (unsubscribed, bounced, complained). Leads whose check is `suggested`, and leads older than 30 days when the sequence is on, are not enrolled.
Unsubscribe: `/track/unsub?e=<email>&t=<hmac>` (GET or the one-click POST) stops all mail to that address.
Resend webhook: `POST /track/api/resend` (Svix signature, secret `RESEND_WEBHOOK_SECRET`): opened, bounced (not Transient), complained. Only emails sent by this sequence are acted on.
`/track/emails` shows all 7 emails as they will look and has the "Send me a test" button: all seven to jon@thejonmac.com only, `[TEST day N of 6]` in the subject, at most once per 2 minutes.

## Before Jon switches it on
1. Worker secrets: `RESEND_API_KEY` (a key allowed to send from the sender domain), `RESEND_WEBHOOK_SECRET`. In Resend add a webhook to `https://jonmac.ai/track/api/resend` for email.opened, email.bounced, email.complained.
2. Vars: `SKOOL_ADDRESS` (the real mailing address; real sends stay paused while it is unset or `[ADDRESS]`), optional `SKOOL_FROM` (default `Jon Mac <support@viralview.io>`), `SKOOL_BUSINESS` (default Ecomm House Inc.), `SKOOL_REPLY_TO` (default jon@thejonmac.com).
3. Read the 7 emails on `/track/emails` and check the price line (`PRICE_LINE` in `skoolmail.js`) against the Skool page.
4. The pop-over does not tell visitors they will get emails. Jon decides whether to add a line (consent rules, for example CASL for Canadians).
