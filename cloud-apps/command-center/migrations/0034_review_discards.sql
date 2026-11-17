-- Review "Discard" (Jon, 2026-11-17). Additive only: one new table, nothing existing is changed or dropped.
-- A discarded Review item keeps its row here with status 'discarded' (restored: 'restored'). Nothing is deleted:
-- files, renders, proofs and cards stay. For a card in Review the card itself goes to cancelled (note "Discarded by Jon
-- on Review"); `undo` holds what Undo needs to put it back (JSON: the card's old note and updated_at, and the open
-- questions and pending approvals that closed with it).
CREATE TABLE IF NOT EXISTS review_discards (
  item TEXT PRIMARY KEY,               -- the Review item id: t:<card>, a:<approval>, q:<question> or d:<sponsor draft>
  kind TEXT NOT NULL,                  -- t | a | q | d
  status TEXT NOT NULL DEFAULT 'discarded', -- discarded | restored
  card_id TEXT,                        -- the dashboard card cancelled with it, if any
  undo TEXT,
  discarded_by TEXT NOT NULL DEFAULT 'jon',
  discarded_at TEXT NOT NULL,
  restored_at TEXT
);
CREATE INDEX IF NOT EXISTS review_discards_status ON review_discards(status, discarded_at);
