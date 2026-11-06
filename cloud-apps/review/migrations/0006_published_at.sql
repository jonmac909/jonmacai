-- When the current file was published (Jon's QC gate, 2026-11-05): a QC pass counts only if it was checked after this,
-- so a re-upload onto a passed slug waits for a new pass. Older rows stay NULL and keep their passes. Additive only.
ALTER TABLE videos ADD COLUMN published_at TEXT;
