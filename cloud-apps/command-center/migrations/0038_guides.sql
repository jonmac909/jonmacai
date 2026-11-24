-- Guide site (2026-11-23, src/guides.js): one open guide page per video at /guides/<slug>, the /lab home page,
-- counted Skool forwards (/go/skool) and the email-for-download box. Additive only: new tables, nothing existing changes.

-- One row per guide. json = the whole guide.json MacFrames publishes (section 3 of the guide-site spec).
CREATE TABLE IF NOT EXISTS guides (
  slug TEXT PRIMARY KEY, -- same slug as the video's tracking link (skool_links.slug)
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'unlisted', -- listed | unlisted (unlisted: live at its address, noindex, not in the index)
  updated TEXT NOT NULL, -- the guide's own date (YYYY-MM-DD)
  json TEXT NOT NULL,
  published_at TEXT NOT NULL -- UTC ISO of the latest publish
);
CREATE INDEX IF NOT EXISTS guides_state_updated ON guides(state, updated);

-- Counts per guide: visit | skool | download. pos = which Skool button (rail, end, top, home, bar) for kind skool.
CREATE TABLE IF NOT EXISTS guide_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT, -- null when the Skool click came from no guide
  kind TEXT NOT NULL,
  pos TEXT,
  at TEXT NOT NULL -- UTC ISO
);
CREATE INDEX IF NOT EXISTS guide_events_slug_kind ON guide_events(slug, kind);

-- Every email given on a guide: a download (file set) or the footer newsletter box (file null).
-- The email also goes into skool_leads, the list /s/ feeds. newsletter = 1 only when the visitor ticked the box themselves.
CREATE TABLE IF NOT EXISTS guide_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  email TEXT NOT NULL, -- lower case, never logged
  newsletter INTEGER NOT NULL DEFAULT 0,
  terms INTEGER NOT NULL DEFAULT 0,
  file TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS guide_emails_email ON guide_emails(email);
CREATE INDEX IF NOT EXISTS guide_emails_slug ON guide_emails(slug);
