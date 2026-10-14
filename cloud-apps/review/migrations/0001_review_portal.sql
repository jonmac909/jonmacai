-- jonmac.ai/review: channels, video versions and timestamped review comments.
CREATE TABLE IF NOT EXISTS channels (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS videos (
  slug TEXT PRIMARY KEY,
  channel TEXT NOT NULL REFERENCES channels(slug),
  video TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (status IN ('needs_review', 'changes_requested', 'approved')),
  video_key TEXT NOT NULL,
  video_size INTEGER,
  video_sha256 TEXT,
  source_key TEXT,
  duration REAL,
  chapters TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS videos_by_channel ON videos(channel, video, created_at);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL REFERENCES videos(slug) ON DELETE CASCADE,
  author TEXT NOT NULL,
  t REAL NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS comments_by_video ON comments(slug, resolved, t);

-- The seven AI channels (names from the GPU1 remake folders; rename in place if needed).
INSERT OR IGNORE INTO channels (slug, name, sort) VALUES
  ('aria', 'Aria', 10),
  ('max', 'Max', 20),
  ('mina', 'Mina', 30),
  ('sienna', 'Sienna', 40),
  ('theo', 'Theo', 50),
  ('viktor', 'Viktor', 60),
  ('zane', 'Zane', 70);
