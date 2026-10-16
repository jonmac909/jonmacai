-- "Submit changes" / "Approve": each press snapshots the open, unsent comments and is picked up by
-- the GPU2 router, which sends them to the agent that made the video (delivered_at/delivered_to).
-- dedupe_key (slug|kind|sorted comment ids) makes a double tap land on the same row.
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES videos(slug) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('changes', 'approve')),
  created_at TEXT NOT NULL,
  comment_ids TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  delivered_at TEXT,
  delivered_to TEXT,
  result_slug TEXT
);
CREATE INDEX IF NOT EXISTS submissions_by_slug ON submissions(slug, created_at);
CREATE INDEX IF NOT EXISTS submissions_undelivered ON submissions(delivered_at, created_at);

-- Set once a comment has been sent in a submission; it then no longer counts toward the next one.
ALTER TABLE comments ADD COLUMN submission_id TEXT;
