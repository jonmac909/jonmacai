-- Studio's readable pages give a scheduled video's date but not its time.
ALTER TABLE yt_stats ADD COLUMN scheduled_date TEXT;
