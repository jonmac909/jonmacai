-- Dashboard 3 Home (2026-11-17, src/home.js). Additive only: two new tables, nothing existing changes or is dropped.

-- A tick on a Google Calendar meeting, per day: the calendar event's id plus the date it was shown on.
-- Unticking keeps the row with done = 0. One row per event per day.
CREATE TABLE IF NOT EXISTS home_meeting_ticks (
  event_id TEXT NOT NULL,
  day TEXT NOT NULL, -- YYYY-MM-DD in Vancouver
  done INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, day)
);

-- Dashboard settings Jon sets himself. key 'nav_order' = the sidebar order as a JSON list of page ids; no row = the built-in order.
CREATE TABLE IF NOT EXISTS dash_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
