-- Bot feeds (2026-10-29, dashboard plan step 2). Small documents a bot posts for the Today page:
-- Ana's morning summary and Claude usage, Home Guide Press ebook sales. Append-only; the page
-- reads the newest entry per name. Additive only. Applied with `wrangler d1 execute --file`.
CREATE TABLE IF NOT EXISTS bot_feed_entries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, -- morning_summary | claude_usage | ebook_sales
  bot TEXT NOT NULL,
  data TEXT NOT NULL, -- JSON object, checked per name in src/bots.js
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_feed_entries_name ON bot_feed_entries(name, created_at);
