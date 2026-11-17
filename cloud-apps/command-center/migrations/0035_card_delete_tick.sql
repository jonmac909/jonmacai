-- Cards page: Jon ticks a card done himself and deletes a card (2026-11-17). Additive only: three nullable columns on
-- bot_tasks, no row changed. A delete is soft: the card keeps its row, proofs and history and gets status 'deleted'
-- (every board and list already filters by status, so it drops out of all of them). The columns remember where to
-- go back to: tick_prev = the status before Jon ticked it done (untick), deleted_prev = the status before the delete
-- (undo). Applied with `wrangler d1 execute --file` before the deploy, like 0029 to 0031.
ALTER TABLE bot_tasks ADD COLUMN tick_prev TEXT;
ALTER TABLE bot_tasks ADD COLUMN deleted_prev TEXT;
ALTER TABLE bot_tasks ADD COLUMN deleted_at TEXT;
