-- New affiliate channels (2026-11-04): dash.py registers every channel that has a Calendar or Content CSV, so a
-- new clone imports without a code change. Additive only: rows with a label are channels beyond src/channels.js.
ALTER TABLE yt_channels ADD COLUMN label TEXT;
ALTER TABLE yt_channels ADD COLUMN grp TEXT;
