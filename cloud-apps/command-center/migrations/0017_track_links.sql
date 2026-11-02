-- Track page (2026-11-02): one tracked link per calendar video, jonmac.ai/v/<code>, and what YouTube reports
-- for a video. Additive only: no existing column changes.
ALTER TABLE yt_channels ADD COLUMN landing TEXT; -- http(s) only; NULL = its links can't redirect yet
ALTER TABLE yt_calendar ADD COLUMN youtube_id TEXT; -- the channel's own upload; NULL = none yet

-- Not a second video list: titles and plans stay in yt_calendar. A row outlives its calendar row, so a link
-- already in a YouTube description keeps working if the video leaves the CSV.
CREATE TABLE IF NOT EXISTS yt_links (
  code TEXT PRIMARY KEY, -- 10 hex characters
  video_id TEXT NOT NULL UNIQUE, -- yt_calendar.id
  channel TEXT NOT NULL,
  landing TEXT, -- this video's landing page, over its channel's; http(s) only
  clicks INTEGER NOT NULL DEFAULT 0, -- a plain count: no visitor data is kept
  created_at TEXT NOT NULL
);

-- What the YouTube Studio script posts, by YouTube video. Separate from yt_calendar so a calendar import can't reach it,
-- and the pages prefer it on read. No titles: a video shows only through its calendar row.
CREATE TABLE IF NOT EXISTS yt_stats (
  youtube_id TEXT PRIMARY KEY,
  impressions INTEGER,
  ctr REAL, -- click-through rate in percent, 4.7 = 4.7%
  views INTEGER,
  scheduled_at TEXT, -- UTC
  status TEXT, -- scheduled, live, private, unlisted
  updated_at TEXT NOT NULL -- when the script last posted this video
);
CREATE INDEX IF NOT EXISTS yt_stats_scheduled ON yt_stats(scheduled_at);
CREATE INDEX IF NOT EXISTS yt_calendar_youtube ON yt_calendar(youtube_id);

INSERT OR IGNORE INTO yt_links (code, video_id, channel, created_at)
  SELECT lower(hex(randomblob(5))), id, channel, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM yt_calendar;

-- Landing pages on record in the team's channel facts, each checked live on 2026-11-02. Only the new column
-- changes on a channel that already has a row. Jon's own channels and Eleanor Whitfield have none on record.
-- As VALUES: D1 refuses a compound SELECT of more than 5 terms.
INSERT INTO yt_channels (slug, landing, updated_by, updated_at)
  SELECT column1, column2, 'developer', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM (VALUES
    ('theo-creates', 'https://viralview.io'),
    ('sienna-creates', 'https://viralview.io'),
    ('zane-creates', 'https://viralview.io'),
    ('aria-creates', 'https://viralview.io'),
    ('ash-creates', 'https://viralview.io'),
    ('mina-creates', 'https://viralview.io'),
    ('max-creates', 'https://viralview.io'),
    ('peter-collins', 'https://homeguidepress.com/drivers-bundle'),
    ('jack-mercer', 'https://homeguidepress.com/ready-at-home'),
    ('rosa-cooks', 'https://homeguidepress.com/the-hand-me-down-kitchen'),
    ('rosas-clean-home', 'https://homeguidepress.com/the-old-way-to-a-clean-house'),
    ('rosas-house-hacks', 'https://homeguidepress.com/fix-it-like-family-did'),
    ('giovanni-moretti', 'https://homeguidepress.com/finally-written-down'),
    ('frank-bennett-dogs', 'https://homeguidepress.com/the-long-life-dog'),
    ('ruth-calder', 'https://homeguidepress.com/the-dark-house-plan'),
    ('dale-whitaker-pitbulls', 'https://homeguidepress.com/the-pitbull-playbook'),
    ('nora-fairweather-cats', 'https://homeguidepress.com/reading-your-cat'),
    ('gail-merriman-golf', 'https://homeguidepress.com/yards-back'),
    ('naomi-takeda-japan', 'https://homeguidepress.com/japan-before-you-go'),
    ('walter-brandt-dogs', 'https://homeguidepress.com/the-good-old-dog')
  ) WHERE true
  ON CONFLICT (slug) DO UPDATE SET landing = excluded.landing;
