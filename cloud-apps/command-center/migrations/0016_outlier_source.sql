-- Outliers name the channel that posted them (the owners' Content CSVs, 2026-10-30). Additive.
ALTER TABLE yt_outliers ADD COLUMN source TEXT;
