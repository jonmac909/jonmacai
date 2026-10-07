-- Permanent transaction/step records outlive Resend's 24-hour idempotency window.
CREATE TABLE IF NOT EXISTS clone_webinar_sessions (
  transaction_ref TEXT PRIMARY KEY,
  payment_ref TEXT,
  email TEXT NOT NULL,
  purchased_at INTEGER NOT NULL,
  session_at TEXT NOT NULL,
  session_label TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'active',
  complete INTEGER NOT NULL DEFAULT 0,
  initialized INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS clone_webinar_email ON clone_webinar_sessions(email);
CREATE TABLE IF NOT EXISTS clone_webinar_steps (
  transaction_ref TEXT NOT NULL,
  step TEXT NOT NULL,
  scheduled_at TEXT,
  payload TEXT NOT NULL,
  attempted_at INTEGER,
  email_id TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY (transaction_ref, step)
);
CREATE TABLE IF NOT EXISTS clone_webinar_refunds (
  transaction_ref TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS clone_webinar_preferences (
  email TEXT PRIMARY KEY,
  unsubscribed INTEGER NOT NULL DEFAULT 1
);
