-- File generated drafts into the matter's "Drafts" folder.
--
-- 20270204090000 gives every EP and EP-LP matter a top-level "Drafts" folder,
-- but the drafting engine never sets `folder_id`, so its output kept landing
-- in the derived "Generated drafts" folder beside it. This files a generated
-- document into a top-level "Drafts" folder at insert, when the matter has
-- one and nothing else already chose a folder.
--
-- It hangs off the table rather than the drafting code because several paths
-- insert generated rows (the draft route, persistGeneratedDocument, workflow
-- artifacts, PDF conversion), and it stays a real filing: the attorney can
-- move a draft out and it stays out.
--
-- The rule mirrors `documentFolderKey` in lib/documentWorkspace.ts, which
-- checks a client upload and a signed/executed name before a generation id;
-- those keep their derived folders.

CREATE OR REPLACE FUNCTION public.file_generated_draft_into_drafts_folder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.generation_id IS NULL
     OR NEW.folder_id IS NOT NULL
     OR NEW.source = 'client'
     OR NEW.name ~* '\m(signed|executed|notariz\w*|conformed)\M' THEN
    RETURN NEW;
  END IF;

  SELECT f.id INTO NEW.folder_id
  FROM public.matter_document_folders f
  WHERE f.matter_id::text = NEW.matter_id
    AND f.parent_id IS NULL
    AND lower(btrim(f.name)) = 'drafts'
  LIMIT 1;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.file_generated_draft_into_drafts_folder() FROM PUBLIC;

DROP TRIGGER IF EXISTS file_generated_draft_into_drafts_folder ON public.matter_documents;
CREATE TRIGGER file_generated_draft_into_drafts_folder
  BEFORE INSERT ON public.matter_documents
  FOR EACH ROW EXECUTE FUNCTION public.file_generated_draft_into_drafts_folder();

-- Drafts already generated on a matter that has the folder. Only the EP
-- matters created since 20270204090000 can have one, so this is small.
UPDATE public.matter_documents d
SET folder_id = f.id
FROM public.matter_document_folders f
WHERE f.matter_id::text = d.matter_id
  AND f.parent_id IS NULL
  AND lower(btrim(f.name)) = 'drafts'
  AND d.generation_id IS NOT NULL
  AND d.folder_id IS NULL
  AND d.source IS DISTINCT FROM 'client'
  AND d.name !~* '\m(signed|executed|notariz\w*|conformed)\M';
