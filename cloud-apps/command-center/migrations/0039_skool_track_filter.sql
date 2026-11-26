-- /track shows real visitors only (Jon, 2026-11-26): new clicks and email sign-ups keep the visitor's IP and user agent,
-- so team traffic and bots can be hidden (src/trackfilter.js). ADD COLUMN only: no existing row is changed.
ALTER TABLE skool_clicks ADD COLUMN ip TEXT;
ALTER TABLE skool_clicks ADD COLUMN ua TEXT;
ALTER TABLE skool_leads ADD COLUMN ip TEXT;
ALTER TABLE skool_leads ADD COLUMN ua TEXT;
