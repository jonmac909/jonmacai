# Sponsor income

**Rule (Jon, 2026-10-22):** sponsor income for a month is every deposit into the RBC USD account that month, gross (wire fees are not deducted). It includes payouts that are not sponsor invoices, such as Commas / DIVISIBLE. Own-account transfers and FX conversions are not income.

October 2026 on this rule: Oct 2 TopView $734.37, Oct 16 TopView $1,984.38, Oct 16 InVideo $4,200.00, Oct 16 DIVISIBLE $970.00, Oct 19 Schalumov (Viktor) $1,000.00 = **$8,888.75**.

## What the dashboard shows

| Where | Value | Source |
| --- | --- | --- |
| Home goal card "Sponsors · {month}" | month deposits, cents kept | `buildCash` |
| Home strip "Cash in, {month}" | same | `buildCash` |
| Sponsors page "Collected in {month}" tile, "{month} so far" bar row | same | `buildCash` via `buildSponsorsPage(..., cash)` |
| Sponsors page "Cash received" card | same, plus the deposit rows that make the total | `public/js/cash.js` |
| Sponsors page "Owed to you", "Money to collect", deal board | invoices still open | `sponsors` feed (collections.json) |

Invoices owed never count as income. When no deposit data is available the Sponsors page falls back to the hand-recorded month total in collections.json and says so ("Recorded source total, unverified against deposit ledger").

## Deposit feeds

`src/cash.js` `buildCash(sponsorsCashRow, sponsorsRow, nowMs, moneyclawRow)` merges two feeds:

1. **MoneyClaw `income` block** (bank transactions, authoritative for the dates it covers). Shape inside the MoneyClaw dashboard summary:

   ```json
   "income": {
     "since": "2026-10-01",
     "asOf": "2026-10-21",
     "deposits": [{ "date": "2026-10-16", "amount": 4200.0, "description": "INVIDEO IN ..." }]
   }
   ```

   - Credits into the RBC USD account only, in USD, posted (not pending).
   - `since` and `asOf` (YYYY-MM-DD, America/Vancouver) are the first and last day the feed vouches for. A day with no deposit inside the window means no deposit. A feed without both dates is ignored, and an `asOf` later than today (Vancouver) is clamped to today.
   - Exclude own-account transfers, FX conversion legs and vendor refunds, the same way `expenseReport.mjs` does.
   - No account number or mask in the payload.
2. **`sponsors_cash`** from `cash_ledger.csv` on GPU2 (`collectors/gpu2/sources/cash.py`), kept by hand. Used for every date the bank feed does not cover.

Merge rule: ledger rows dated inside `[since, asOf]` are dropped and the bank deposits replace them, so nothing counts twice. Ledger rows outside the window stay.

Until MoneyClaw ships the `income` block, the ledger is the only feed. That is how October went wrong.

## Staleness

Nothing reads RBC for the ledger, so a missed deposit is invisible unless someone edits the file. The dashboard now says so:

- Ledger not edited for more than `LEDGER_STALE_DAYS` (3), or no edit time reported: the Home goal card shows an amber warning, the "Counted from" line says stale, and the Sponsors page shows a Stale pill with the same note.
- Bank feed `asOf` older than `FEED_STALE_DAYS` (2) days or its row older than that: same treatment.

## Who updates what

| File | Where | Updated by |
| --- | --- | --- |
| `cash_ledger.csv` | GPU2 `C:\Users\partn\my-agent\state\sponsors\cash_ledger.csv` | by hand. Columns: date, sponsor, invoice, amount_usd, amount_cad, evidence, status. The collector sends only date, sponsor, invoice, usd, status and the file's edit time, never the evidence column. |
| `collections.json` | Mac mini `/Users/jonmac/Projects/2026/YouTube/sponsor-kanban/data/collections.json` | by hand or by Ana. Holds invoice paid/owed per sponsor and the month totals used when no deposit data exists. |

GPU2 task `CommandCenterCollect` ships both every 5 minutes.

## Incident, 2026-10-22

The dashboard showed $1,734.37 for October against $8,888.75 of deposits. The ledger was last edited Oct 15 and collections.json on Oct 3, so the Oct 16 and Oct 19 deposits were never entered, and the Oct 15 ledger row held a $1,000 manual Commas entry. Two pages disagreed ($1,734 and $750) and neither warned that its input was days old. Fixes: the data was corrected, both pages now read one deposit total, and stale inputs are flagged. The remaining gap is the MoneyClaw `income` block above.
