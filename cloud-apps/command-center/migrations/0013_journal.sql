-- Journal (2026-10-30): Jon's own links and ideas for later. Only Jon reads and writes it (his
-- session); the API refuses bot tokens. Additive only. Applied with `wrangler d1 execute --file`.
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY, -- j_…
  title TEXT NOT NULL, -- 1 to 300 characters
  link TEXT, -- http(s) only
  note TEXT,
  tags TEXT NOT NULL DEFAULT '[]', -- JSON array of lowercase tags
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_entries_created ON journal_entries(created_at);
