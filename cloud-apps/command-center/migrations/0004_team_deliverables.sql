-- Team roster and deliverables pushed by Ana, plus Jon's approvals (2026-10-23).
-- The dashboard only displays these; approving records a row and publishes nothing.
CREATE TABLE IF NOT EXISTS team_bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  team TEXT,
  task TEXT,
  status TEXT,
  updated_at TEXT,
  source TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner TEXT,
  kind TEXT,
  url TEXT,
  finished_at TEXT,
  source TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS deliverables_finished ON deliverables(finished_at);

CREATE TABLE IF NOT EXISTS approvals (
  deliverable_id TEXT PRIMARY KEY,
  approved_at TEXT NOT NULL,
  approved_by TEXT
);
CREATE INDEX IF NOT EXISTS approvals_at ON approvals(approved_at);
