-- Manual Track syncs per Pacific day (src/youtube.js), so refreshes can't use up the YouTube quota the hourly cron needs. Additive only.
CREATE TABLE IF NOT EXISTS yt_sync_budget (day TEXT PRIMARY KEY, syncs INTEGER NOT NULL);
