-- Drawings and voice notes on comments (Jon, 2026-10-30). Additive only.
-- drawing: vector JSON {"v":1,"shapes":[{"tool":"pen|arrow|box","color":"#rrggbb","points":[[x,y],...]}]},
-- x and y from 0 to 1 across the video picture, checked and rewritten by the Worker (parseDrawing).
ALTER TABLE comments ADD COLUMN drawing TEXT;
-- A voice note's R2 key (review/<slug>/voice/<comment id>.<ext>) and MIME type (audio/webm, audio/mp4 or audio/ogg).
ALTER TABLE comments ADD COLUMN audio_key TEXT;
ALTER TABLE comments ADD COLUMN audio_type TEXT;
-- The voice note as text: Parakeet on GPU1 (scripts/review_voice.mjs) posts it back.
ALTER TABLE comments ADD COLUMN transcript TEXT;
