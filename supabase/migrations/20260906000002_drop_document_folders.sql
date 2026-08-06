-- folder's three jobs now live in shared_at (visibility) and source
-- (provenance). folder_id and the folders table were never populated:
-- 0 rows in folders, 0 non-null folder_id across all matter_documents.

drop policy if exists attorneys_all_folders on public.folders;
drop policy if exists clients_select_own_folders on public.folders;

alter table public.matter_documents
  drop column if exists folder,
  drop column if exists folder_id;

drop table if exists public.folders;
