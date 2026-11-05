-- Daily checklists (2026-10-29). The owning bot ticks one of its project's daily items (from the
-- daily_checklists feed) with a proof link. One row per item per America/Vancouver day; ticking
-- again that day updates it. Additive only. Applied with `wrangler d1 execute --file`.
CREATE TABLE IF NOT EXISTS bot_daily_ticks (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL, -- YYYY-MM-DD in Vancouver
  project TEXT NOT NULL,
  item TEXT NOT NULL, -- the item's exact text in the feed
  bot TEXT NOT NULL,
  link TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (day, project, item)
);
