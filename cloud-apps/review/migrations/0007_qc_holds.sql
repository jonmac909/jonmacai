-- The QC gate (Jon, 2026-11-09: "never put videos on review page before QC"). Additive only: no existing row changes.
-- One row per published video file: that version is QC-only (off Jon's list, no Approve, never linked to him) until QC
-- passes its dashboard proof after created_at. Publishing a new file for a slug adds a new row.
CREATE TABLE IF NOT EXISTS qc_holds (
  slug TEXT NOT NULL,
  video_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (slug, video_key)
);
-- Every version that exists now is held too: a QC pass after it was made releases it. Reading videos, writing only here.
INSERT OR IGNORE INTO qc_holds (slug, video_key, created_at) SELECT slug, video_key, created_at FROM videos;
