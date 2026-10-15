-- homeguidepress.com: orders (one row per Commas transaction), webhook log, clicks and page views.

-- One row per paid transaction. The primary key is the dedupe key: a repeated
-- webhook for the same transaction can never create a second row or email.
CREATE TABLE IF NOT EXISTS orders (
  transaction_id TEXT PRIMARY KEY,
  slug TEXT,                       -- product slug (angelo, steve, ...); NULL when the Commas product ID is unknown
  product_id TEXT,                 -- Commas data.item.id
  email TEXT NOT NULL,             -- lower-cased buyer email
  name TEXT,
  amount_cents INTEGER,
  currency TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  src TEXT,                        -- attribution carried through checkout, when Commas returns it
  created_at TEXT NOT NULL,
  email_claimed_at TEXT,           -- set while one sender holds the email; stops webhook and cron sending twice
  email_sent_at TEXT,
  email_id TEXT,                   -- Resend email ID of the delivery email
  email_error TEXT,
  last_link_sent_at TEXT,          -- last fresh-link email (rate limit)
  revoked_at TEXT,
  revoke_reason TEXT,
  downloads INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS orders_email ON orders (email);
CREATE INDEX IF NOT EXISTS orders_unsent ON orders (email_sent_at, slug);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  transaction_id TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  result TEXT
);

CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- 'view' (landing page) or 'buy' (checkout button)
  slug TEXT NOT NULL,
  src TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  referrer_host TEXT,
  country TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS clicks_slug ON clicks (slug, kind, created_at);
