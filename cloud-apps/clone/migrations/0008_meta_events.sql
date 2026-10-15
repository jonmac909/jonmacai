-- Meta Conversions API purchases, exactly once per event_id (retried by the cron).
CREATE TABLE IF NOT EXISTS clone_meta_events (
  event_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER,
  last_status INTEGER
);
-- Sandbox: log only, never sent.
CREATE TABLE IF NOT EXISTS clone_sandbox_meta_events (
  event_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
