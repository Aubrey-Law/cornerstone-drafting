-- Add matter_number column referenced by hireMatter() and the sidebar editor.
-- Stored format: "YYYY-N-LASTNAME" (e.g. "2026-5-AUBREY") but free-form text
-- so the attorney can override with a custom identifier.

ALTER TABLE matters
  ADD COLUMN IF NOT EXISTS matter_number text;

CREATE UNIQUE INDEX IF NOT EXISTS matters_matter_number_unique_idx
  ON matters (matter_number)
  WHERE matter_number IS NOT NULL;

COMMENT ON COLUMN matters.matter_number IS
  'Human-readable matter identifier shown in the sidebar. Auto-generated on hireMatter (YYYY-N-LASTNAME) but editable by attorney. Unique when set.';
