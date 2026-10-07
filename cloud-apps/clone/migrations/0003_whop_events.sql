-- Stable transaction/event IDs prevent duplicate conversions across webhook retries.
-- A short atomic lease serializes delivery. Whop also deduplicates event_id.
CREATE TABLE IF NOT EXISTS clone_whop_events (
  event_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_status INTEGER,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS clone_whop_pending ON clone_whop_events(sent_at, lease_until);
