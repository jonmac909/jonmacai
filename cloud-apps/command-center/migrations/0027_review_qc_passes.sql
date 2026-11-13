-- The Factory's own QC passes (Jon, 2026-11-12: "yes" to "May the Factory mark its own review pages as QC-passed once its
-- final checks pass, so the Approve button shows?"). The Factory has no card, so no proof of its passes; it marks a review
-- version passed through the review Worker (POST /api/review/<slug>/qc-pass -> /dashboard/api/review-hook/qc-pass), and
-- src/reviewhook.js counts these rows beside passed proofs. Additive: one row per pass, never changed.
CREATE TABLE IF NOT EXISTS review_qc_passes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  video_key TEXT,             -- the review version's file the pass was for
  passed_by TEXT NOT NULL,    -- who passed it (e.g. factory)
  note TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL            -- ISO time of the pass
);
CREATE INDEX IF NOT EXISTS review_qc_passes_by_slug ON review_qc_passes(slug, at);
