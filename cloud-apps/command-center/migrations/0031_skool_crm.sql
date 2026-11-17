-- Skool leads CRM, email check and 7-day email sequence (2026-11-16, src/skool.js, src/skoolcheck.js, src/skoolseq.js).
-- Additive only: new columns and new tables, nothing existing changes or is dropped.

-- What the email check said about each lead: valid | suggested | risky (null for leads captured before this).
ALTER TABLE skool_leads ADD COLUMN email_check TEXT;
-- The newest time this email was entered on this link (at stays the first time, so a sale never moves before its lead).
ALTER TABLE skool_leads ADD COLUMN last_at TEXT;
-- What the member paid, in dollars, when the Zapier zap sends an amount.
ALTER TABLE skool_sales ADD COLUMN amount REAL;

-- Master switches. skool_sequence_on = '1' means on; a missing row or any other value means OFF.
CREATE TABLE IF NOT EXISTS skool_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per email per sequence day: the claim that makes a send happen at most once.
-- status: sending (claimed, answer not yet known: never re-sent) | sent | failed (tried again until attempts reaches 3).
CREATE TABLE IF NOT EXISTS skool_seq_sends (
  email TEXT NOT NULL, -- lower case
  day INTEGER NOT NULL, -- 0 to 6
  slug TEXT, -- the video the lead came from
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  resend_id TEXT, -- Resend's email id
  sent_at TEXT,
  opened_at TEXT, -- from Resend's webhook, if open tracking is on
  error TEXT, -- short reason, never the key
  PRIMARY KEY (email, day)
);
CREATE INDEX IF NOT EXISTS skool_seq_sends_resend ON skool_seq_sends(resend_id);

-- An email on this list gets nothing more. reason: unsubscribed | bounced | complained.
CREATE TABLE IF NOT EXISTS skool_seq_stops (
  email TEXT PRIMARY KEY, -- lower case
  reason TEXT NOT NULL,
  at TEXT NOT NULL
);
