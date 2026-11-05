-- Card comments and task history (2026-10-29). Jon comments on a task in the Projects card modal and
-- its owner bot answers in the same thread; every task change writes one history row. Additive only.
CREATE TABLE IF NOT EXISTS bot_task_comments (
  id TEXT PRIMARY KEY, -- c_…
  task_id TEXT NOT NULL,
  author TEXT NOT NULL, -- jon or a bot slug
  body TEXT NOT NULL, -- trimmed, 1 to 4000 characters
  created_at TEXT NOT NULL,
  wake_status TEXT -- Jon's comments only: 202, 200, an HTTP error code, unreachable or not configured
);
CREATE INDEX IF NOT EXISTS bot_task_comments_task ON bot_task_comments(task_id, created_at);

CREATE TABLE IF NOT EXISTS bot_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  at TEXT NOT NULL,
  "by" TEXT NOT NULL, -- jon or a bot slug
  kind TEXT NOT NULL, -- created | status | owner | project | due | proof | check | tick | comment
  detail TEXT -- short, e.g. "status doing → qc"
);
CREATE INDEX IF NOT EXISTS bot_task_events_task ON bot_task_events(task_id, at);
