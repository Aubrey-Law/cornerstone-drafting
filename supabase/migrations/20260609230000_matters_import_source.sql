-- Tag imported matters (e.g., from Clio) so the UI can render them as
-- read-only historical records without breaking client/search/reporting views.

ALTER TABLE matters
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS clio_matter_id text,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

-- Idempotent re-imports: one row per Clio matter id.
CREATE UNIQUE INDEX IF NOT EXISTS matters_clio_matter_id_unique_idx
  ON matters (clio_matter_id)
  WHERE clio_matter_id IS NOT NULL;

-- Filter active vs imported quickly on /admin/matters.
CREATE INDEX IF NOT EXISTS matters_source_idx
  ON matters (source)
  WHERE source <> 'native';

COMMENT ON COLUMN matters.source IS
  'Origin of the matter row. ''native'' = created through the app; ''clio_import'' = bulk-imported historical matter from Clio. UI hides intake/stage/drafting affordances for non-native rows.';
COMMENT ON COLUMN matters.clio_matter_id IS
  'External Clio matter identifier. Unique when set; enables idempotent re-imports.';
COMMENT ON COLUMN matters.imported_at IS
  'When this matter was bulk-imported. NULL for native matters.';
