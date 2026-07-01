-- matter_documents: tracks files uploaded to Cloudflare R2 per matter
create table if not exists matter_documents (
  id           uuid primary key default gen_random_uuid(),
  matter_id    text not null,
  r2_key       text not null unique,
  name         text not null,
  size         bigint not null default 0,
  content_type text not null default 'application/octet-stream',
  folder       text not null default 'client',   -- 'draft'|'final'|'client'
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create index if not exists idx_matter_docs_matter on matter_documents(matter_id);

-- RLS
alter table matter_documents enable row level security;

-- Admins (scott@aubreylegal.com) can do everything
create policy "admin_all" on matter_documents
  using (
    (select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com'
  );

-- Clients can read non-draft documents belonging to their matter.
--
-- Wrapped in a DO block because on a fresh database v_matter_pipeline does
-- not exist yet (it's created in 20260427232404). On prod this migration
-- ran before the view existed and the policy was later replaced by
-- 20260425001000 + the view-creation cascades, so this policy is short-
-- lived in any history. The guard lets a fresh staging DB run migrations
-- in order without error.
do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'v_matter_pipeline' and n.nspname = 'public'
  ) then
    execute $policy$
      create policy "client_read_non_draft" on matter_documents
        for select
        using (
          folder != 'draft'
          and matter_id in (
            select matter_id::text from v_matter_pipeline
            where client_email = (select email from auth.users where id = auth.uid())
          )
        )
    $policy$;
  end if;
end $$;
