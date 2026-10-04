-- Only browser-correlated, signed payment proofs. No card details or email addresses.
CREATE TABLE IF NOT EXISTS clone_purchase_proofs (
  checkout_ref TEXT PRIMARY KEY,
  transaction_ref TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  paid_at INTEGER NOT NULL
);

-- A permanent, atomic claim precedes the charge. Never delete/retry ambiguous claims.
-- Grouping alternatives prevents buying both software plans or both vault plans.
CREATE TABLE IF NOT EXISTS clone_upsell_claims (
  buyer_id INTEGER NOT NULL,
  offer_group TEXT NOT NULL,
  offer TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'charged', 'fallback', 'unknown')),
  charge_ref TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (buyer_id, offer_group)
);
