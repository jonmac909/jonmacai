-- Ours-to-source sync segments [ours_start, ours_end, source_start, source_end], first match wins.
ALTER TABLE videos ADD COLUMN sync_map TEXT;
