-- A review group: an ordered list of video slugs shown stacked on one page, /review/g/<name> (Jon, 2026-11-16: a batch
-- of lessons or reels on one page, one player per video). slugs is a JSON array in page order.
CREATE TABLE IF NOT EXISTS review_groups (
  name TEXT PRIMARY KEY,
  title TEXT,
  slugs TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
