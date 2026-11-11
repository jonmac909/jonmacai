-- Stage on cards (Jon's design 2026-11, section 11 item 2): the stage a staged card is in (brief, script, pack, edit,
-- publish ...) and when it entered it. The dispatcher sets both on each hand-off (dash.py task-update --stage).
-- Adds two nullable columns only: no row is changed, old cards read stage null.
ALTER TABLE bot_tasks ADD COLUMN stage TEXT;
ALTER TABLE bot_tasks ADD COLUMN stage_since TEXT;
