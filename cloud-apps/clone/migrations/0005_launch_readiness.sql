-- First-party aggregate ledger: no email, phone, IP or campaign identifiers.
CREATE TABLE IF NOT EXISTS clone_session_events (
  event_id TEXT PRIMARY KEY,
  session_date TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('visit', 'payment', 'refund')),
  offer TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  transaction_ref TEXT,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS clone_session_date ON clone_session_events(session_date);
CREATE INDEX IF NOT EXISTS clone_session_transaction ON clone_session_events(transaction_ref);

CREATE VIEW IF NOT EXISTS clone_session_scorecard AS
SELECT session_date,
  SUM(kind = 'visit') AS lander_visits,
  SUM(kind = 'payment' AND offer = 'seat' AND amount_cents = 4700) AS seat_purchases,
  SUM(kind = 'payment' AND offer = 'software') AS software_purchases,
  SUM(kind = 'payment' AND offer = 'trial') AS trial_payments,
  SUM(kind = 'payment' AND offer = 'audit') AS audit_purchases,
  SUM(kind = 'payment' AND offer = 'vault') AS vault_purchases,
  SUM(kind = 'payment' AND offer = 'vault_plan') AS vault_plan_payments,
  SUM(kind = 'refund') AS refunds_observed,
  SUM(CASE WHEN kind = 'refund' THEN amount_cents ELSE 0 END) AS refund_cents,
  SUM(CASE WHEN kind = 'payment' THEN amount_cents ELSE 0 END) AS gross_cash_cents,
  SUM(CASE WHEN kind = 'payment' THEN amount_cents WHEN kind = 'refund' THEN -amount_cents ELSE 0 END) AS net_cash_cents,
  NULL AS ad_spend_cents, NULL AS impressions, NULL AS link_clicks,
  NULL AS live_attendees, NULL AS peak_concurrent, NULL AS attendees_at_pitch,
  NULL AS audit_bookings
FROM clone_session_events GROUP BY session_date;
