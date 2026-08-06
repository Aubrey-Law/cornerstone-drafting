-- folder's three jobs now live in shared_at (visibility) and source
-- (provenance). folder_id and the folders table were never populated:
-- 0 rows in folders, 0 non-null folder_id across all matter_documents.

-- The Box export trigger fired on folder IN ('final','signed'). That column is
-- going away and the new model has no equivalent state, so the trigger is
-- retired here. box_private.enqueue_box_document_export() and
-- public.box_document_exports are deliberately KEPT: the queue has never had a
-- row and the integration can be restored with one create trigger statement.
drop trigger if exists matter_documents_enqueue_box_export on public.matter_documents;

drop policy if exists attorneys_all_folders on public.folders;
drop policy if exists clients_select_own_folders on public.folders;

alter table public.matter_documents
  drop column if exists folder,
  drop column if exists folder_id;

drop table if exists public.folders;;
