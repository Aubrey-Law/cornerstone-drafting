-- Folders the attorney creates, alongside the derived ones.
--
-- `folders` and `matter_documents.folder_id` were dropped in
-- 20260806135231_drop_document_folders because nothing ever populated them:
-- the old model asked the app to file every document, and the app never did.
-- The workspace has filed documents by *derivation* since — provenance and
-- lifecycle produce "From client", "Signed & executed" and "Generated drafts"
-- with no column to maintain.
--
-- Derivation cannot express "Deed work", "MetLife claim" or "2026 tax
-- returns". This table adds those back as an explicit, per-matter thing the
-- attorney names, and nothing else: derived folders stay derived, and a
-- document with no `folder_id` still sits exactly where it sat before.
--
-- Deleting a folder must never take documents with it, so `folder_id` is
-- ON DELETE SET NULL — the files fall back to the root the way they would in
-- any file manager that empties a folder before removing it.

CREATE TABLE IF NOT EXISTS public.matter_document_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One "Deeds" per matter. Case-insensitive so "Deeds" and "deeds" cannot both
-- exist and leave the attorney guessing which one a file went into.
CREATE UNIQUE INDEX IF NOT EXISTS matter_document_folders_unique_name
  ON public.matter_document_folders (matter_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS matter_document_folders_matter_idx
  ON public.matter_document_folders (matter_id, created_at);

DROP TRIGGER IF EXISTS set_updated_at_matter_document_folders
  ON public.matter_document_folders;
CREATE TRIGGER set_updated_at_matter_document_folders
  BEFORE UPDATE ON public.matter_document_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.matter_documents
  ADD COLUMN IF NOT EXISTS folder_id uuid
    REFERENCES public.matter_document_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS matter_documents_folder_idx
  ON public.matter_documents (folder_id)
  WHERE folder_id IS NOT NULL;

ALTER TABLE public.matter_document_folders ENABLE ROW LEVEL SECURITY;

-- Firm staff only. The client portal has no folder view: a shared document is
-- shared whatever folder the firm filed it in, and the folder names are the
-- firm's working notes, not the client's.
DROP POLICY IF EXISTS matter_document_folders_staff_all ON public.matter_document_folders;
CREATE POLICY matter_document_folders_staff_all
  ON public.matter_document_folders FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_document_folders TO authenticated;

COMMENT ON TABLE public.matter_document_folders IS
  'Attorney-named folders for a matter''s documents. Derived folders (client '
  'uploads, executed, generated drafts) are computed in lib/documentWorkspace.ts '
  'and are not stored here.';

NOTIFY pgrst, 'reload schema';
