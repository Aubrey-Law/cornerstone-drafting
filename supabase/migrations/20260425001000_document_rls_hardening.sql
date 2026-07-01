-- Database-side document visibility guardrails.
-- This mirrors the API rules: clients can read only their own non-draft
-- matter documents, and Draft/Drafts virtual folders stay hidden from clients.

drop policy if exists "client_read_non_draft" on matter_documents;

-- Wrapped: v_matter_pipeline is created in 20260427232404, after this
-- migration. On fresh DBs the policy is recreated later by the
-- view-bootstrap migrations (20260428, 20260506, 20260515) which run
-- CASCADE on the view drop and then re-create both view and policy.
do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'v_matter_pipeline' and n.nspname = 'public'
  ) then
    execute $policy$
      create policy "client_read_visible_matter_documents"
        on matter_documents
        for select
        to authenticated
        using (
          lower(coalesce(folder, '')) not in ('draft', 'drafts')
          and (
            folder_id is null
            or not exists (
              select 1
              from folders f
              where f.id = matter_documents.folder_id
                and lower(f.name) in ('draft', 'drafts')
            )
          )
          and (
            exists (
              select 1
              from matters m
              where m.id::text = matter_documents.matter_id
                and m.client_id = auth.uid()
            )
            or exists (
              select 1
              from v_matter_pipeline v
              where v.matter_id::text = matter_documents.matter_id
                and v.client_email = (
                  select email from auth.users where id = auth.uid()
                )
            )
          )
        )
    $policy$;
  end if;
end $$;

drop policy if exists "clients_select_own_folders" on folders;

create policy "clients_select_visible_own_folders"
  on folders
  for select
  to authenticated
  using (
    lower(name) not in ('draft', 'drafts')
    and exists (
      select 1
      from matters m
      where m.id = folders.matter_id
        and m.client_id = auth.uid()
    )
  );
