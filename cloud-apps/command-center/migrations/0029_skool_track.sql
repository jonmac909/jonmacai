-- Skool tracker (2026-11-16, src/skool.js): jonmac.ai/s/<slug> short links to the Skool group, their clicks,
-- and paid members sent in by Jon's Zapier zaps. Additive only: new tables, nothing existing changes.
CREATE TABLE IF NOT EXISTS skool_links (
  slug TEXT PRIMARY KEY, -- a-z, 0-9 and dashes, 2 to 40 characters
  title TEXT NOT NULL, -- the video's title
  youtube_url TEXT, -- the video on YouTube, optional
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skool_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  at TEXT NOT NULL, -- UTC ISO
  referrer TEXT, -- host and path only, 200 characters max
  country TEXT -- Cloudflare's 2-letter country
);
CREATE INDEX IF NOT EXISTS skool_clicks_slug_at ON skool_clicks(slug, at);
CREATE INDEX IF NOT EXISTS skool_clicks_at ON skool_clicks(at);

-- One row per paid member (Zapier "New Paid Member"). Attribution is worked out on read, so an answer that
-- arrives after the sale still counts.
CREATE TABLE IF NOT EXISTS skool_sales (
  id TEXT PRIMARY KEY, -- Skool's transaction ID, or email + date when Zapier sends none
  email TEXT, -- lower case
  name TEXT,
  at TEXT NOT NULL, -- UTC ISO
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS skool_sales_at ON skool_sales(at);

-- Membership-question answers (Zapier "Answered Membership Questions"), by email.
CREATE TABLE IF NOT EXISTS skool_answers (
  email TEXT PRIMARY KEY, -- lower case
  answer TEXT NOT NULL, -- 500 characters max
  at TEXT NOT NULL
);
