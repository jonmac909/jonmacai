# Sponsor memory

One record per sponsor company: contacts, every partners@ thread (subject, date, who wrote last, one line), rates quoted,
deals, invoices and the next follow-up date. It shows on the Money page (`/dash/#money`, card "Sponsor memory") and feeds
a follow-up list that Florence reads instead of the whole inbox. Card t_dd14c08f25ea4179.

## Data (D1, migration 0037, additive)
- `sponsor_mem`: one row per company (slug = the name with letters and digits only). Contacts, rates quoted and invoices
  seen in mail are JSON columns; `deals` holds what facts/deals.md adds.
- `sponsor_mem_threads`: one row per Gmail thread (id, subject, first/last time, who wrote last, one-line summary, labels).
- `sponsor_followups`: one row per follow-up (`reply`, `chase`, `promise`, `payment`, `due`) with a due date (Kelowna).
  The id is stable (`<kind>:<thread>:<message>`), so a re-scan updates a row and never doubles it.
- Deals and invoices are not copied: the card shows the board deals (sponsor_deals + stage overrides) and the collections
  items that match the sponsor, read when the page loads.

## Routes (all under `/dashboard/api`)
- `GET /sponsor-memory` (Jon's session): the cards and the open follow-up count.
- `GET /sponsor-memory/followups[?through=YYYY-MM-DD]` (GPU1 machine token): open follow-ups, soonest first.
- `GET /sponsor-memory/source` (GPU1): the collections items and board deals, for the follow-ups that come from deals.
- `POST /sponsor-memory/ingest` (GPU1): `{sponsors, threads, followups, close}`; a close with `by: "manual"` is never reopened by a scan.

## Filling it (GPU1, `D:\AgentTeam\tools`)
- `sponsor_memory.py sync [--days N]`: reads partners@ (Gmail GET only), rules not a model, posts. Default N=3 plus every
  thread that still has an open follow-up; `--days 120` is the backfill. A local cache (`state\sponsor_memory_cache.json`)
  keeps each thread's facts so a short scan still rebuilds whole sponsor records.
- `sponsor_followups.py due`: today's due and overdue items in under 40 lines (Florence). `list`, `done <id> [why]`, `add`.

## How a follow-up opens and closes
- Opens: they wrote last (reply, due the next day); we wrote last (chase, 5 days later, 10 for the second, then stop); a
  commitment sentence with a date in any message (promise); money owed on the sheet (payment, due now); a date in a deal's
  next step or blocker (due).
- Closes by itself on the next scan: a reply went out, the sponsor answered, the promise was kept by a later message,
  the money landed (owed is 0), the date left the deal. Closed, lost and bad-fit threads ask for nothing.
