-- Sponsor memory (card t_dd14c08f25ea4179, 2026-11-21): one record per sponsor company, its partners@ threads and its
-- follow-ups. Additive only: three new tables, no existing table changed. Deals and invoices are NOT copied here:
-- they are read from the existing board (sponsor_deals + stage overrides) and the collections items when the page loads;
-- sponsor_mem.deals / .invoices hold only what the emails and facts/deals.md add on top.
-- Applied with `wrangler d1 execute --file` before the deploy, like 0029 to 0036.
CREATE TABLE IF NOT EXISTS sponsor_mem (
  id TEXT PRIMARY KEY,                    -- company slug, e.g. 'topview'
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',        -- lead | negotiating | active | paid | closed | skip
  contacts TEXT NOT NULL DEFAULT '[]',    -- JSON [{name, email, last}]
  rates TEXT NOT NULL DEFAULT '[]',       -- JSON [{amount, what, date, thread}] rates quoted in emails
  deals TEXT NOT NULL DEFAULT '[]',       -- JSON [{label, amount, stage, date, source}] beyond the board
  invoices TEXT NOT NULL DEFAULT '[]',    -- JSON [{no, amount, state: sent|paid|owed, date, thread}]
  summary TEXT NOT NULL DEFAULT '',
  last_contact TEXT,                      -- ISO time of the newest message
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sponsor_mem_threads (
  thread_id TEXT PRIMARY KEY,             -- Gmail thread id (hex)
  sponsor_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  first_at TEXT,
  last_at TEXT,
  who TEXT NOT NULL DEFAULT '',           -- who wrote last
  last_is_us INTEGER NOT NULL DEFAULT 0,
  n INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',       -- one line
  labels TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sponsor_mem_threads_by_sponsor ON sponsor_mem_threads (sponsor_id, last_at);
CREATE TABLE IF NOT EXISTS sponsor_followups (
  id TEXT PRIMARY KEY,                    -- stable key: <kind>:<thread or sponsor>:<marker>, so a re-scan updates, never doubles
  sponsor_id TEXT NOT NULL,
  thread_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,                     -- reply | chase | promise | payment | due
  text TEXT NOT NULL,
  due TEXT NOT NULL,                      -- YYYY-MM-DD, Kelowna
  status TEXT NOT NULL DEFAULT 'open',    -- open | closed
  closed_reason TEXT NOT NULL DEFAULT '',
  closed_by TEXT NOT NULL DEFAULT '',     -- auto | manual (a manual close is never reopened by a scan)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS sponsor_followups_open ON sponsor_followups (status, due);
