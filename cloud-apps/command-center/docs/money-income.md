# Money page: Income this month (Jon, 2026-11-17)

`jonmac.ai/dash/#money`, the "Income this month" card under the four tiles. Read only: it never edits a transaction.

- **Rows:** every incoming payment of one calendar month in Kelowna time (America/Vancouver), newest first: date, payer (cleaned: TopView, InVideo, Commas/DIVISIBLE), amount with currency, account (Business USD, Business CAD, Personal; "Other bank (not RBC)" for a hand-kept ledger row at TD).
- **Totals on top, per currency.** No FX is invented. A CAD equivalent shows only when the data carries one for every payment of that currency (feed field `amountCad`).
- **Month switcher:** previous and next month. This month only counts days that have happened. A later month is not offered.
- **Other credits:** a credit the data does not mark as income, or that reads like a refund, reversal, interest or own-account move, is listed under "Other credits" and counted nowhere. Credits the feed marks as own transfers or card payments are left out and only counted ("excluded").
- **Same numbers as Home:** the USD total uses the same feeds and merge as Home's "Cash in" and the Sponsors page (`docs/sponsor-income.md`, rule of 2026-10-22: every RBC USD deposit, gross, Commas/DIVISIBLE included). Staleness warnings are the same.

## API

`GET /dashboard/api/money-income?month=YYYY-MM` (Jon's session; signed out 401). A missing, malformed or future month means this month. No database: 503. Code: `src/income.js`; page: `incomeListHtml` in `public/d3/js/money.js`. No migration, no new table.

## Data today, and what is missing

MoneyClaw's `income` block (`/api/internal/dashboard-summary`) holds posted credits of the RBC **USD business** account only (mask filter and USD filter in `cloudflare/dashboard-internal.mjs`), with no currency or account field. So the page shows that account, plus the hand-kept ledger, and says so: "Business CAD and personal credits are not in the bank feed yet".

To show those, MoneyClaw's `sponsorIncome()` must also send the other accounts' credits. The dashboard already reads these optional fields on each deposit (additive, none required): `currency` (3 letters, default USD), `account` (`business-usd` | `business-cad` | `personal`), `type` (`income` default), `kind` (`transfer`, `card_payment`, `refund`, `reversal`, `conversion` are excluded), `isTransfer`, `amountCad`. A non-USD deposit never reaches the USD totals on Home or Sponsors.
