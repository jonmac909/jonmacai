-- Review stage (2026-10-30): tasks now go qc → review (QC passed) → done, and only Jon sets done.
-- Bot tasks a bot marked done under the old rule move to review, so Jon approves them too. Jon's own
-- tasks stay done. done_at is cleared: it now means "Jon approved", and his approval sets it again.
-- One history row per moved task, written first with the same WHERE, so only moved rows get one.
-- Safe to run again: it moves only tasks still done that Jon never approved from review, so a rerun
-- moves nothing and never undoes his approvals. Nothing is deleted. Applied with `wrangler d1 execute --file`.
INSERT INTO bot_task_events (id, task_id, at, "by", kind, detail)
SELECT 'e_' || lower(hex(randomblob(8))), t.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'developer', 'status', 'status done → review (Review stage added)'
FROM bot_tasks t
WHERE t.status = 'done' AND t.owner != 'jon'
  AND NOT EXISTS (SELECT 1 FROM bot_task_events e WHERE e.task_id = t.id AND e.detail LIKE 'status review → done%');

UPDATE bot_tasks SET status = 'review', done_at = NULL, updated_by = 'developer', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'done' AND owner != 'jon'
  AND NOT EXISTS (SELECT 1 FROM bot_task_events e WHERE e.task_id = bot_tasks.id AND e.detail LIKE 'status review → done%');
