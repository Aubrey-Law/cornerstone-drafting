-- Splits matter_documents.folder into its two real jobs:
--   shared_at = client visibility (the only enforced rule)
--   source    = provenance, set automatically, gates nothing
-- folder and folder_id remain until the cleanup migration.

alter table public.matter_documents
  add column if not exists shared_at timestamptz,
  add column if not exists source text not null default 'firm';

alter table public.matter_documents
  drop constraint if exists matter_documents_source_check;

alter table public.matter_documents
  add constraint matter_documents_source_check
  check (source in ('firm', 'client', 'meeting-notes'));

update public.matter_documents
  set shared_at = created_at
  where folder in ('review', 'signed', 'final')
    and shared_at is null;

update public.matter_documents
  set source = 'client'
  where folder in ('client', 'intake');

update public.matter_documents
  set source = 'meeting-notes'
  where folder = 'meeting-notes';

create index if not exists matter_documents_matter_shared_idx
  on public.matter_documents (matter_id, shared_at);

create index if not exists matter_documents_matter_source_idx
  on public.matter_documents (matter_id, source);
