-- Track matches Studio (Jon, 2026-11-04): lifetime views, average view duration and net subscribers from YouTube Analytics.
ALTER TABLE yt_stats ADD COLUMN avd REAL; -- average view duration of the video, seconds
ALTER TABLE yt_api ADD COLUMN studio_views INTEGER; -- the channel's lifetime Analytics views, what Studio shows
ALTER TABLE yt_api ADD COLUMN studio_subs INTEGER; -- lifetime subscribers gained minus lost
ALTER TABLE yt_api ADD COLUMN studio_avd REAL; -- the channel's average view duration, seconds
