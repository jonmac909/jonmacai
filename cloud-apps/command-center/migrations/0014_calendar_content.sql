-- Calendar and Content pages (2026-10-30). One tab per YouTube channel Jon owns (CHANNELS in
-- src/channels.js). The channel bots (CHANNEL_WRITERS in src/bots.js) post each channel's posting
-- schedule, its calendar videos and the outlier videos found for it; Jon only toggles "selected" on
-- an outlier. Additive only. Applied with `wrangler d1 execute --file`.
CREATE TABLE IF NOT EXISTS yt_channels (
  slug TEXT PRIMARY KEY, -- a CHANNELS slug
  schedule TEXT, -- e.g. "Tue and Fri 9 am PT"; NULL shows "not set"
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS yt_calendar (
  id TEXT PRIMARY KEY, -- v_…
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  day TEXT NOT NULL, -- YYYY-MM-DD (PT)
  status TEXT NOT NULL, -- planned | scheduled | published
  link TEXT, -- http(s) only
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  idem_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (created_by, idem_key)
);
CREATE INDEX IF NOT EXISTS yt_calendar_day ON yt_calendar(day, channel);

CREATE TABLE IF NOT EXISTS yt_outliers (
  id TEXT PRIMARY KEY, -- o_…
  channel TEXT NOT NULL, -- the channel it was found for
  title TEXT NOT NULL,
  link TEXT NOT NULL, -- http(s) only
  thumb TEXT, -- http(s) only
  views INTEGER NOT NULL,
  avg_views INTEGER NOT NULL, -- its own channel's average views, at least 1
  published TEXT NOT NULL, -- YYYY-MM-DD
  selected INTEGER NOT NULL DEFAULT 0, -- 1 = selected for production
  selected_by TEXT, -- who last changed selected
  selected_at TEXT,
  created_by TEXT NOT NULL,
  idem_key TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (created_by, idem_key)
);
CREATE INDEX IF NOT EXISTS yt_outliers_channel ON yt_outliers(channel);
