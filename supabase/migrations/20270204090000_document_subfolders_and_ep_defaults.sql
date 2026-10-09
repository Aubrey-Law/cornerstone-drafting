-- Subfolders, and a starter set of folders on every estate-planning matter.
--
-- 1. `parent_id` lets an attorney-created folder sit inside another one.
--    A NULL parent is the workspace root, exactly where every folder sat before
--    this migration, so existing folders need no backfill.
--
--    Deleting a folder takes its subfolders with it (ON DELETE CASCADE), but
--    never their documents: `matter_documents.folder_id` is already ON DELETE
--    SET NULL, so everything filed anywhere in the removed branch falls back to
--    the root.
--
--    A parent must belong to the same matter. The API enforces that when it
--    creates a subfolder, and folders cannot be moved, so there is no path to
--    a cycle.
--
-- 2. Names are now unique among siblings rather than across the whole matter:
--    "Drafts" may live under both "Trust" and "Will".
--
-- 3. EP and EP-LP matters start with Intake, Design, Drafts and Signed
--    Documents. Practice area lives on `matter_details`, and several paths
--    create a matter (the atomic create RPC, the lead trigger, the Lawmatics
--    import, the engagement route), so the seed hangs off `matter_details`
--    rather than any one of them. It also fires when a matter's practice area
--    changes *into* estate planning, which is when a lead booked under another
--    area gets them. Existing matters are not backfilled.

ALTER TABLE public.matter_document_folders
  ADD COLUMN IF NOT EXISTS parent_id uuid
    REFERENCES public.matter_document_folders(id) ON DELETE CASCADE;

ALTER TABLE public.matter_document_folders
  DROP CONSTRAINT IF EXISTS matter_document_folders_not_own_parent;
ALTER TABLE public.matter_document_folders
  ADD CONSTRAINT matter_document_folders_not_own_parent
    CHECK (parent_id IS NULL OR parent_id <> id);

DROP INDEX IF EXISTS public.matter_document_folders_unique_name;
CREATE UNIQUE INDEX matter_document_folders_unique_name
  ON public.matter_document_folders (
    matter_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name))
  );

CREATE INDEX IF NOT EXISTS matter_document_folders_parent_idx
  ON public.matter_document_folders (parent_id)
  WHERE parent_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.seed_estate_planning_document_folders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.practice_area IS NULL OR NEW.practice_area NOT IN ('EP', 'EP-LP') THEN
    RETURN NULL;
  END IF;
  -- EP → EP-LP is the same plan on a different fee basis; the attorney may
  -- have reshaped the folders by then, so only a move *into* estate planning
  -- seeds them.
  IF TG_OP = 'UPDATE' AND coalesce(OLD.practice_area, '') IN ('EP', 'EP-LP') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.matter_document_folders (matter_id, name)
  SELECT NEW.client_id, seed.name
  FROM unnest(ARRAY['Intake', 'Design', 'Drafts', 'Signed Documents']) AS seed(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.matter_document_folders existing
    WHERE existing.matter_id = NEW.client_id
      AND existing.parent_id IS NULL
      AND lower(btrim(existing.name)) = lower(seed.name)
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_estate_planning_document_folders() FROM PUBLIC;

DROP TRIGGER IF EXISTS seed_estate_planning_document_folders ON public.matter_details;
CREATE TRIGGER seed_estate_planning_document_folders
  AFTER INSERT OR UPDATE OF practice_area ON public.matter_details
  FOR EACH ROW EXECUTE FUNCTION public.seed_estate_planning_document_folders();

COMMENT ON COLUMN public.matter_document_folders.parent_id IS
  'The folder this one sits inside, or NULL for the root of the matter''s workspace.';

NOTIFY pgrst, 'reload schema';
