-- Additive only (nothing is rewritten or dropped).
-- source_text: the original lesson as sanitized HTML, shown in the left "Source" panel of a lesson whose original is a text page
-- (Skool text lessons have no source video). NULL = no text original.
-- video_w/video_h/source_w/source_h: pixel size of our file and of the source file, so the page can size each player to its own
-- video before it loads. NULL = unknown (the page then reads videoWidth/videoHeight when the file's metadata loads).
ALTER TABLE videos ADD COLUMN source_text TEXT;
ALTER TABLE videos ADD COLUMN video_w INTEGER;
ALTER TABLE videos ADD COLUMN video_h INTEGER;
ALTER TABLE videos ADD COLUMN source_w INTEGER;
ALTER TABLE videos ADD COLUMN source_h INTEGER;
