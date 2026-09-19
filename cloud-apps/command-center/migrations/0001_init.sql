CREATE TABLE snapshots (source TEXT PRIMARY KEY, data TEXT NOT NULL, collected_at TEXT NOT NULL, received_at TEXT NOT NULL);
CREATE TABLE actions (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL,
  payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  result TEXT, idem_key TEXT UNIQUE, created_at TEXT NOT NULL, claimed_at TEXT, finished_at TEXT);
CREATE INDEX actions_target_status ON actions(target, status);
CREATE TABLE checklist (day TEXT NOT NULL, item TEXT NOT NULL, done_at TEXT, how TEXT, PRIMARY KEY (day, item));
CREATE TABLE habits (day TEXT NOT NULL, kind TEXT NOT NULL, done INTEGER NOT NULL, note TEXT, PRIMARY KEY (day, kind));
CREATE TABLE ideas (id TEXT PRIMARY KEY, title TEXT, body TEXT, area TEXT, verdict TEXT, status TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE deal_stage_overrides (deal_id TEXT PRIMARY KEY, stage TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE posts (id TEXT PRIMARY KEY, platform TEXT NOT NULL, posted_at TEXT NOT NULL, url TEXT, first_line TEXT, source TEXT);
CREATE TABLE alert_rules (id TEXT PRIMARY KEY, label TEXT, symbol TEXT, kind TEXT, threshold REAL, enabled INTEGER DEFAULT 1);
CREATE TABLE login_failures (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start TEXT NOT NULL);
