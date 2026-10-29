-- Bot access (2026-10-29, dashboard plan step 1). Each bot writes one row at a time with its
-- own token under /dashboard/api/v1. Additive only: no existing table is changed. Every row
-- names the bot that wrote it. Applied with `wrangler d1 execute --file` like 0005 and 0006.
CREATE TABLE IF NOT EXISTS bot_tokens (
  token_hash TEXT PRIMARY KEY, -- SHA-256 hex of the raw token; the raw token never reaches D1
  bot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS bot_tokens_bot ON bot_tokens(bot);

CREATE TABLE IF NOT EXISTS bot_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo', -- todo | doing | waiting_on_jon | qc | done
  note TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  idem_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  done_at TEXT,
  UNIQUE (created_by, idem_key)
);
CREATE INDEX IF NOT EXISTS bot_tasks_owner ON bot_tasks(owner, status);
CREATE INDEX IF NOT EXISTS bot_tasks_status ON bot_tasks(status, updated_at);

CREATE TABLE IF NOT EXISTS bot_proofs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- render | url | pdf | test
  link TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | passed | failed (set by QC)
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  checked_by TEXT,
  checked_at TEXT,
  check_note TEXT
);
CREATE INDEX IF NOT EXISTS bot_proofs_task ON bot_proofs(task_id);
CREATE INDEX IF NOT EXISTS bot_proofs_status ON bot_proofs(status, created_at);

CREATE TABLE IF NOT EXISTS bot_questions (
  id TEXT PRIMARY KEY,
  asked_by TEXT NOT NULL,
  question TEXT NOT NULL,
  context TEXT,
  options TEXT, -- JSON array of strings
  task_id TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | answered | closed
  answer TEXT,
  answered_by TEXT,
  answered_at TEXT,
  closed_by TEXT,
  closed_at TEXT,
  idem_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (asked_by, idem_key)
);
CREATE INDEX IF NOT EXISTS bot_questions_status ON bot_questions(status, created_at);

CREATE TABLE IF NOT EXISTS bot_approvals (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL, -- e.g. send_pitches, publish_draft, post_clips, spotify_batch
  title TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}', -- JSON object
  task_id TEXT,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | done | cancelled
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  done_by TEXT, -- done_* records who closed it: carried out (done) or withdrawn (cancelled)
  done_at TEXT,
  done_note TEXT,
  idem_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (requested_by, idem_key)
);
CREATE INDEX IF NOT EXISTS bot_approvals_status ON bot_approvals(status, action, created_at);

CREATE TABLE IF NOT EXISTS bot_runs (
  id TEXT PRIMARY KEY,
  bot TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL, -- running | ok | failed
  tokens INTEGER,
  error TEXT,
  task_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_runs_bot ON bot_runs(bot, started_at);
CREATE INDEX IF NOT EXISTS bot_runs_started ON bot_runs(started_at);
