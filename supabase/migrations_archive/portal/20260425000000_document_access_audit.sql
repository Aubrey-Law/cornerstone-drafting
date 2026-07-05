-- Audit every signed URL issued for matter documents.
create table if not exists document_access_audit (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid references matter_documents(id) on delete set null,
  matter_id   text not null,
  user_id     uuid references auth.users(id) on delete set null,
  user_email  text,
  action      text not null check (action in ('view', 'download')),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_document_access_audit_document_id
  on document_access_audit(document_id, created_at desc);

create index if not exists idx_document_access_audit_matter_id
  on document_access_audit(matter_id, created_at desc);

create index if not exists idx_document_access_audit_user_id
  on document_access_audit(user_id, created_at desc);

alter table document_access_audit enable row level security;

create policy "attorney_select_document_access_audit"
  on document_access_audit
  for select
  to authenticated
  using (
    (select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com'
  );
