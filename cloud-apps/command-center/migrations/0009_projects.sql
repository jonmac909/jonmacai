-- Projects page (2026-10-29). Each task, question and approval names its project (a slug from
-- PROJECTS in src/projects.js; NULL is Unsorted) and how many minutes it takes Jon. A task owned by
-- `jon` may have a due day (YYYY-MM-DD). Additive only. Applied with `wrangler d1 execute --file`.
ALTER TABLE bot_tasks ADD COLUMN project TEXT;
ALTER TABLE bot_tasks ADD COLUMN minutes INTEGER;
ALTER TABLE bot_tasks ADD COLUMN due TEXT;
ALTER TABLE bot_questions ADD COLUMN project TEXT;
ALTER TABLE bot_questions ADD COLUMN minutes INTEGER;
ALTER TABLE bot_approvals ADD COLUMN project TEXT;
ALTER TABLE bot_approvals ADD COLUMN minutes INTEGER;
