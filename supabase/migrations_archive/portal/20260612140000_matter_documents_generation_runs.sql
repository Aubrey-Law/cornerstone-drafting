-- Generation-run provenance, supersede tracking, and attorney-review state for
-- generated draft documents.
--
-- Before this, every draft generation appended new timestamped files to the
-- drafts folder, so regenerating a plan left stale drafts mixed with current
-- ones and nothing recorded which engine produced a file. Drafts are still
-- never deleted on regeneration (audit requirement) — instead the prior run's
-- rows are marked superseded so the UI can show the current set by default.
--
-- Columns:
--   generation_id     groups every document produced by one generation run;
--                     null for uploads and pre-migration rows.
--   generation_engine which generator produced the file (node | supabase |
--                     python_fallback).
--   marker_count      unresolved-marker count from lib/drafting/markerScan
--                     (`[TODO:`, `[[ MISSING ]]`, leftover template tags); 0 is
--                     clean. Powers the WP3 attorney review gate.
--   missing_count     count of `[[ MISSING: field ]]` holes specifically.
--   superseded_at     set when a later run replaces this draft; non-null rows
--                     are hidden from the default draft list but kept in R2.
--   reviewed_at /     attorney sign-off before a draft may be promoted to a
--   reviewed_by       client-visible folder (consumed by WP3).
--
-- All columns are nullable so existing insert sites (document upload, engagement
-- attachments) keep working without change.

ALTER TABLE public.matter_documents
  ADD COLUMN IF NOT EXISTS generation_id     uuid,
  ADD COLUMN IF NOT EXISTS generation_engine text
    CHECK (generation_engine IS NULL OR generation_engine IN ('node', 'supabase', 'python_fallback')),
  ADD COLUMN IF NOT EXISTS marker_count      integer,
  ADD COLUMN IF NOT EXISTS missing_count     integer,
  ADD COLUMN IF NOT EXISTS superseded_at     timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- All documents from one generation run, for grouping in the review UI.
CREATE INDEX IF NOT EXISTS idx_matter_docs_generation
  ON public.matter_documents (matter_id, generation_id);

-- The hot path: the current (non-superseded) drafts for a matter.
CREATE INDEX IF NOT EXISTS idx_matter_docs_active_drafts
  ON public.matter_documents (matter_id)
  WHERE folder = 'draft' AND superseded_at IS NULL;

COMMENT ON COLUMN public.matter_documents.generation_id IS
  'Groups all documents produced by one draft-generation run; null for uploads.';
COMMENT ON COLUMN public.matter_documents.superseded_at IS
  'Set when a later generation run replaces this draft; file is retained in R2.';
COMMENT ON COLUMN public.matter_documents.marker_count IS
  'Unresolved-marker count (markerScan) — 0 is clean; gates promotion to client folders.';
