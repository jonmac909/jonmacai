-- Sandbox customer IDs can collide with production. Separate tables preserve
-- permanent production claims and keep test data out of live buyer identities.
CREATE TABLE IF NOT EXISTS clone_sandbox_purchase_proofs (
  checkout_ref TEXT PRIMARY KEY,
  transaction_ref TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  paid_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clone_sandbox_upsell_claims (
  buyer_id INTEGER NOT NULL,
  offer_group TEXT NOT NULL,
  offer TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'charged', 'fallback', 'unknown')),
  charge_ref TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (buyer_id, offer_group)
);
