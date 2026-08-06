drop policy if exists client_read_visible_matter_documents on public.matter_documents;
create policy client_read_visible_matter_documents
  on public.matter_documents for select
  to authenticated
  using (
    (shared_at is not null or uploaded_by = auth.uid())
    and (
      exists (select 1 from matters m where m.id::text = matter_documents.matter_id and m.client_id = auth.uid())
      or exists (
        select 1 from v_matter_pipeline v
        where v.matter_id::text = matter_documents.matter_id
          and v.client_email = (select u.email from auth.users u where u.id = auth.uid())::text
      )
    )
  );

drop policy if exists client_insert_own_client_folder_documents on public.matter_documents;
drop policy if exists client_insert_own_documents on public.matter_documents;
create policy client_insert_own_documents
  on public.matter_documents for insert
  to authenticated
  with check (
    source = 'client'
    and (
      exists (select 1 from matters m where m.id::text = matter_documents.matter_id and m.client_id = auth.uid())
      or exists (
        select 1 from v_matter_pipeline v
        where v.matter_id::text = matter_documents.matter_id
          and v.client_email = (select users.email from auth.users where users.id = auth.uid())::text
      )
    )
  );;
