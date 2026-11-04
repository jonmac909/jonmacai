-- Track from the YouTube APIs (Jon, 2026-11-04): replaces the Studio scraper. Each channel is connected once with
-- read-only consent (src/youtube.js); the Worker fills yt_stats itself. Additive only.

-- One row per connected channel. The refresh token is AES-GCM encrypted with the YT_TOKEN_KEY secret, never plain.
CREATE TABLE IF NOT EXISTS yt_api (
  channel TEXT PRIMARY KEY, -- a CHANNELS slug
  channel_id TEXT NOT NULL, -- YouTube's UC… id, checked at connect
  name TEXT, -- the channel's title on YouTube
  token TEXT NOT NULL, -- base64(iv).base64(ciphertext)
  reach_job TEXT, -- Reporting API job for channel_reach_basic_a1
  subscribers INTEGER, views INTEGER, videos INTEGER, -- channel totals from the last sync
  sync_tried_at TEXT, -- set when a sync starts: the lease, so two page opens don't both sync
  synced_at TEXT, -- last sync that worked
  sync_error TEXT, -- last sync's problem, plain words; NULL = fine
  reach_tried_at TEXT, -- same lease for the 6-hourly impressions/CTR reports
  reach_after TEXT, -- createTime of the newest report already stored
  reach_as_of TEXT, -- newest day in the stored reports, YYYY-MM-DD
  reach_error TEXT,
  connected_at TEXT NOT NULL
);

-- Impressions and CTR per video per day, from the reach reports. ctr in percent, 4.7 = 4.7%.
CREATE TABLE IF NOT EXISTS yt_reach (
  youtube_id TEXT NOT NULL,
  day TEXT NOT NULL, -- YYYY-MM-DD
  channel TEXT NOT NULL,
  impressions INTEGER NOT NULL,
  ctr REAL,
  PRIMARY KEY (youtube_id, day)
);
CREATE INDEX IF NOT EXISTS yt_reach_channel ON yt_reach(channel);

-- One-use OAuth states from /youtube/connect, 30 minutes.
CREATE TABLE IF NOT EXISTS yt_oauth_states (
  state TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

ALTER TABLE yt_stats ADD COLUMN reach_as_of TEXT; -- the newest report day behind impressions and ctr
