-- Dashboard 3 Home: Jon's saved schedule tasks (src/home.js). Additive.
-- home_tasks is one row per task or repeating series; home_task_days is one row per occurrence Jon touched
-- (ticked, moved "just this one", or removed for that day). Deleting a series only sets deleted = 1, so the
-- standing rules seeded below are never re-added.
CREATE TABLE home_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  cat TEXT NOT NULL,                      -- factory | sponsors | personal | pnl
  start_min INTEGER NOT NULL,             -- minutes after midnight, Vancouver time
  end_min INTEGER NOT NULL,
  rep TEXT NOT NULL DEFAULT 'none',       -- none | daily | weekdays | weekly | monthly
  days TEXT NOT NULL DEFAULT '',          -- weekly: weekdays as digits, 0 = Monday ("024")
  day TEXT,                               -- none: the date; monthly: a date whose day of month repeats
  from_day TEXT NOT NULL,                 -- a repeating task has no occurrence before this date
  miss TEXT NOT NULL DEFAULT 'next',      -- next | retry | makeup | none
  retry_min INTEGER,                      -- miss = retry: the same-day retry start
  rem TEXT NOT NULL DEFAULT 'none',       -- none | 0 | 10 | 30 | 60 (minutes before)
  text_me INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',          -- workout | date_night: ticks also write the habit log; emails: shows the waiting count
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE home_task_days (
  task_id TEXT NOT NULL,
  day TEXT NOT NULL,                      -- the occurrence's own date
  done INTEGER NOT NULL DEFAULT 0,
  done_on TEXT,                           -- the date it was ticked (later than day when it was carried over)
  skip INTEGER NOT NULL DEFAULT 0,        -- removed for this day only
  move_day TEXT,                          -- "just this one": the date it was moved to
  start_min INTEGER,
  end_min INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, day)
);

-- Goals Jon adds himself with "+ Add goal" (the built-in ones come from the feeds).
CREATE TABLE home_goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cat TEXT NOT NULL,                      -- factory | sponsors | personal | pnl
  sub TEXT NOT NULL DEFAULT '',           -- sub-category, free text
  per TEXT NOT NULL,                      -- today | week | month
  type TEXT NOT NULL,                     -- count | money | pile | spend | once | checklist | percent | habit
  target REAL,
  due TEXT,                               -- once, checklist
  steps TEXT NOT NULL DEFAULT '[]',       -- checklist: JSON list of step names
  time_min INTEGER,                       -- habit
  days TEXT NOT NULL DEFAULT '',          -- weekdays as digits, 0 = Monday
  track TEXT NOT NULL DEFAULT 'log',      -- log | auto
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- What Jon logged against one: step -1 is the goal's own number for that day, 0.. are checklist steps.
-- "Do once" and checklist marks never reset, so they sit on the day '0000-00-00'.
CREATE TABLE home_goal_logs (
  goal_id TEXT NOT NULL,
  day TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT -1,
  value REAL NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (goal_id, day, step)
);

-- The handover's standing rules (section 5), from Monday 9 Nov 2026.
INSERT INTO home_tasks (id, title, cat, start_min, end_min, rep, days, day, from_day, miss, retry_min, kind, created_at, updated_at) VALUES
  ('r-garbage',  'Garbage out',             'personal', 480,  495,  'weekly',   '1',    NULL, '2026-11-09', 'none',   NULL, '',           '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('r-emails',   'Sponsor emails',          'sponsors', 540,  570,  'weekdays', '',     NULL, '2026-11-09', 'none',   NULL, 'emails',     '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('r-meals',    'Plan meals for the week', 'personal', 630,  660,  'weekly',   '6',    NULL, '2026-11-09', 'none',   NULL, '',           '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('r-workout',  'Workout',                 'personal', 660,  720,  'weekly',   '024',  NULL, '2026-11-09', 'retry',  900,  'workout',    '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('r-lunch',    'Cook lunch',              'personal', 690,  735,  'weekly',   '1356', NULL, '2026-11-09', 'none',   NULL, '',           '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('r-lunch-wo', 'Cook lunch',              'personal', 720,  765,  'weekly',   '024',  NULL, '2026-11-09', 'none',   NULL, '',           '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('r-review',   'Friday review',           'pnl',      930,  990,  'weekly',   '4',    NULL, '2026-11-09', 'next',   NULL, '',           '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('r-date',     'Date night · happy hour', 'personal', 960,  1140, 'weekly',   '3',    NULL, '2026-11-09', 'makeup', NULL, 'date_night', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z'),
  ('r-dinner',   'Dinner',                  'personal', 1020, 1080, 'weekly',   '012456', NULL, '2026-11-09', 'none', NULL, '',           '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z');

-- The handover's one checklist goal (section 4): Book trip.
INSERT INTO home_goals (id, name, cat, sub, per, type, target, due, steps, time_min, days, track, created_at) VALUES
  ('g-trip', 'Book trip', 'personal', 'Trips', 'week', 'checklist', NULL, NULL, '["Book flights","Book hotel","Book car rental"]', NULL, '', 'log', '2026-11-12T00:00:00.000Z');
