-- Needs you "Not now" (Jon, 2026-11-11): an item (card t_, question q_ or approval a_ id) leaves Jon's work list,
-- the rail count and Blockers until `until`. Additive: the old Worker never reads it.
CREATE TABLE IF NOT EXISTS needs_later (
  item TEXT PRIMARY KEY,
  until TEXT NOT NULL,
  "by" TEXT NOT NULL,
  at TEXT NOT NULL
);
