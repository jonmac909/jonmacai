-- Calendar videos get a posting time (PT, HH:MM) for the owners' CSV schedules (2026-10-30). Additive.
ALTER TABLE yt_calendar ADD COLUMN time_pt TEXT;
