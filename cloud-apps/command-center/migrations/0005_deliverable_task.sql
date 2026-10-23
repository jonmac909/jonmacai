-- A deliverable may name the tasks.json task it belongs to (2026-10-23). While that
-- task is still doing, the Team lanes and Deliverables tab treat it as in progress,
-- not ready for review, so status follows Ana's list and not a bot's own claim.
ALTER TABLE deliverables ADD COLUMN task_id TEXT;
