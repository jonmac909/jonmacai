-- Questions for Jon (2026-10-24). Ana's questions.json is pushed with the rest; Jon's
-- typed answer is stored here at once and collected later by pull_answers.py.
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  asked_at TEXT,
  asker TEXT,
  project TEXT,
  question TEXT NOT NULL,
  context TEXT,
  options TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT,
  updated_at TEXT NOT NULL,
  answer TEXT,
  answered_at TEXT,
  collected_at TEXT
);
CREATE INDEX IF NOT EXISTS questions_status ON questions(status, asked_at);
