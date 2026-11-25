-- One-word video links from data (2026-11-24, src/skoolwords.js): jonmac.ai/<word> plus its five platform variants.
-- Registered through POST /track/api/words (secret LINK_REGISTER_TOKEN). Additive only: one new table. The worker also
-- creates it lazily on the first register, so it works before this file is applied. "neon" stays a code seed.
CREATE TABLE IF NOT EXISTS skool_words (
  word TEXT PRIMARY KEY, -- a-z then a-z/0-9, 2 to 31 characters, no dash
  title TEXT NOT NULL, -- the video's title
  youtube_url TEXT, -- the video on YouTube, optional
  created_at TEXT NOT NULL
);
