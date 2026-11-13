-- The Personal page (Jacqueline's handover, section 11; Jon, 2026-11-13: "add all these to live").
-- personal_store: one JSON document per key, Jon's own edits: 'meals' (Meal 1-7 recipes and what is ticked onto the
-- grocery lists), 'prices' (grocery prices he changed), 'trips' (trips, stops, bookings), 'rules' (workout and date-night
-- choices the schedule has no field for). expense_tags: one tag per MoneyClaw charge id (Approved, Fixed, One-off, Odd
-- charge, New, Add to subs, Cancel, Refund). Additive only.
CREATE TABLE IF NOT EXISTS personal_store (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_tags (
  id TEXT PRIMARY KEY,
  tag TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The two grocery days on the schedule (Monday for Meals 1-4, Thursday for Meals 5-7), 8:00-9:00, before the walk.
INSERT OR IGNORE INTO home_tasks (id, title, cat, start_min, end_min, rep, days, day, from_day, miss, retry_min, kind, created_at, updated_at) VALUES
  ('r-groc-mon', 'Groceries · Meals 1–4', 'personal', 480, 540, 'weekly', '0', NULL, '2026-11-09', 'none', NULL, '', '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z'),
  ('r-groc-thu', 'Groceries · Meals 5–7', 'personal', 480, 540, 'weekly', '3', NULL, '2026-11-09', 'none', NULL, '', '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z');
