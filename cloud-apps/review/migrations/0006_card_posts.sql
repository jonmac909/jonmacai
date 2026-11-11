-- Approvals and change requests reach the video's dashboard card (Jon, 2026-11-09). Additive only: the submissions
-- table stays append-only, so the lock on new versions is read from it and nothing in it is changed.
-- The dashboard card a video belongs to, when its publisher names it (POST /api/review/<slug>/publish {task_id}).
CREATE TABLE IF NOT EXISTS video_tasks (
  slug TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (slug, task_id)
);
-- One row per try at posting a submission to its card: posted (task_id set), no_card, skipped (backfill: card done)
-- or error <status>. A submission with a posted row is never posted again.
CREATE TABLE IF NOT EXISTS card_posts (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  task_id TEXT,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS card_posts_by_submission ON card_posts(submission_id, created_at);
