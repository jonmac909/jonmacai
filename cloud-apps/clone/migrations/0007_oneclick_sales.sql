-- When the saved card was actually charged. Commas refuses a second charge on the
-- same customer within ~30 s, so the Worker paces charges from this time.
ALTER TABLE clone_upsell_claims ADD COLUMN charged_at INTEGER;
ALTER TABLE clone_sandbox_upsell_claims ADD COLUMN charged_at INTEGER;

-- One-click sales of recurring offers. Commas' saved-card charge cannot create a
-- subscription, so Jon sets each one up by hand from this list.
CREATE TABLE IF NOT EXISTS clone_manual_subscriptions (
  charge_ref TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  offer TEXT NOT NULL,
  plan TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  charged_at INTEGER NOT NULL,
  billing_starts_on TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'to_create'
);
CREATE TABLE IF NOT EXISTS clone_sandbox_manual_subscriptions (
  charge_ref TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  offer TEXT NOT NULL,
  plan TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  charged_at INTEGER NOT NULL,
  billing_starts_on TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'to_create'
);
