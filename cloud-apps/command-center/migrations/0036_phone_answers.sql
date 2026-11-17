-- Ana phones Jon (2026-11-17): Jon answers a keypad question; Twilio posts the digit to /twilio/answer?q=<id>
-- and Ana's script reads it back. Additive only: one new table, no existing table changed. First digit per
-- question wins (a Twilio retry of the same webhook changes nothing). Applied with `wrangler d1 execute --file`
-- before the deploy, like 0029 to 0035.
CREATE TABLE IF NOT EXISTS phone_answers (
  q TEXT PRIMARY KEY, -- the question id Ana's script made (hex), also in the call's action URL
  digit INTEGER NOT NULL,
  at TEXT NOT NULL
);
