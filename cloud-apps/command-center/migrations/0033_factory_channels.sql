-- Factory page channel list (Jon, 2026-11-17): the page shows only the channels listed here as visible, in `sort` order.
-- Additive only: one new table, nothing existing changes or is dropped. A hidden channel keeps all its data (the board feed,
-- its videos, cards and history are untouched); the Factory page just does not show it.
-- To unhide a channel:  UPDATE factory_channels SET visible = 1, sort = <place> WHERE id = '<channel id>';
-- To hide one:          UPDATE factory_channels SET visible = 0 WHERE id = '<channel id>';
-- With no visible row at all the page shows the board exactly as posted (no filter).
CREATE TABLE IF NOT EXISTS factory_channels (
  id TEXT PRIMARY KEY,             -- the board's channel id (video_line feed: channels[].id and jobs[].channel)
  label TEXT NOT NULL,             -- the name the Factory page shows
  note TEXT,                       -- shown on the quiet row of a channel with no video (else the board's own note)
  sort INTEGER NOT NULL DEFAULT 100,
  visible INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO factory_channels (id, label, note, sort, visible) VALUES
  ('jon-mac', 'Jon Mac', 'Not in the video program yet', 1, 1),
  ('jonmacai', 'Jon Mac AI', 'Not in the video program yet', 2, 1),
  ('jon-mac-ig', 'Jon Mac IG', 'Not in the video program yet', 3, 1),
  ('jon-mac-tt', 'Jon Mac TT', 'Not in the video program yet', 4, 1),
  ('naomi', 'Naomi Takeda Japan', NULL, 10, 0),
  ('giovanni', 'Giovanni Moretti', NULL, 11, 0),
  ('nora', 'Nora Fairweather Cats', NULL, 12, 0),
  ('rosa-house', 'Rosa''s House Hacks', NULL, 13, 0);
