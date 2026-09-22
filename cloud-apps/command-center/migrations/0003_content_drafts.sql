CREATE TABLE IF NOT EXISTS content_drafts (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  day TEXT NOT NULL,
  platform TEXT NOT NULL,
  slot INTEGER NOT NULL,
  body TEXT,
  subject TEXT,
  first_line TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  source TEXT,
  error TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant, day, platform, slot)
);
