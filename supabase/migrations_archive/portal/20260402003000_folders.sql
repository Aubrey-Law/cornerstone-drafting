-- Folder management for matter documents stored in Cloudflare R2.
-- Folders are scoped per matter (not per client user).

-- ── folders ───────────────────────────────────────────────────────────────────

-- Drop and recreate to ensure schema is correct on re-runs (safe: dev-only table).
DROP TABLE IF EXISTS folders CASCADE;

CREATE TABLE folders (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id        uuid        NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  parent_folder_id uuid        REFERENCES folders(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folders_matter_id ON folders(matter_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent    ON folders(parent_folder_id);

COMMENT ON TABLE folders IS
  'Virtual folder hierarchy for organising matter documents. Files live in R2; '
  'this table tracks folder names and nesting per matter.';

COMMENT ON COLUMN folders.matter_id IS
  'The matter this folder belongs to.';

COMMENT ON COLUMN folders.parent_folder_id IS
  'Parent folder UUID, or NULL for a top-level folder. '
  'ON DELETE RESTRICT prevents deleting a folder that still has children.';

-- ── matter_documents: add folder_id ──────────────────────────────────────────

ALTER TABLE matter_documents
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_folder_id ON matter_documents(folder_id);

COMMENT ON COLUMN matter_documents.folder_id IS
  'Optional folder this document is filed under. NULL = unfiled / root.';

-- ── RLS on folders ────────────────────────────────────────────────────────────

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

-- Clients may read folders for their own matter.
CREATE POLICY "clients_select_own_folders"
  ON folders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM matters m
      WHERE m.id = folders.matter_id AND m.client_id = auth.uid()
    )
  );

-- Attorney has full read access to all folders.
CREATE POLICY "attorney_select_all_folders"
  ON folders
  FOR SELECT
  TO authenticated
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'scott@aubreylegal.com'
  );

-- Attorney has full write access (INSERT / UPDATE / DELETE).
CREATE POLICY "attorney_all_folders"
  ON folders
  FOR ALL
  TO authenticated
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'scott@aubreylegal.com'
  )
  WITH CHECK (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'scott@aubreylegal.com'
  );
