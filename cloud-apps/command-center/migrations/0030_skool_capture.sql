-- Optional email step per Skool short link (2026-11-16, src/skool.js). Additive only.
-- capture = 1: /s/<slug> asks for an email before forwarding; Jon switches it on per link on /track. Default off.
ALTER TABLE skool_links ADD COLUMN capture INTEGER NOT NULL DEFAULT 0;

-- One row per email per link (the newest visit wins). Never written to logs. A paid member whose email is here
-- is attributed to that link exactly.
CREATE TABLE IF NOT EXISTS skool_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  email TEXT NOT NULL, -- lower case
  at TEXT NOT NULL, -- UTC ISO
  UNIQUE (slug, email)
);
CREATE INDEX IF NOT EXISTS skool_leads_email ON skool_leads(email);
CREATE INDEX IF NOT EXISTS skool_leads_slug_at ON skool_leads(slug, at);
