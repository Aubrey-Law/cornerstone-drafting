-- Reviews of documents that are not filed on a matter.
--
-- Until now a review could only be recorded against a filed document version
-- (`workflow_runs.document_version_id`), and filed documents live in
-- `matter_documents`, whose `matter_id` is required. An uploaded draft —
-- a plan another attorney drafted, a prior will a new client brought in —
-- could be reviewed but not kept: no run, no findings, no dispositions, and
-- nothing to come back to.
--
-- `matter_documents.matter_id` stays required. The documents tab, the portal
-- and document security all read that table as "a matter's documents", and a
-- row with no matter would be a document nobody's screen shows and nobody's
-- access rule covers. Instead an unfiled upload gets its own small table, and
-- each of the three tables a recorded review writes to — text layers,
-- citations, runs — may anchor to either a filed version or an upload, never
-- both and never neither.
--
-- Safe against the release already running (see supabase/migrations/README.md):
-- a new table, new nullable columns, and constraints loosened only as far as an
-- upload needs. Code that predates this still writes a document version on
-- every row, which every constraint below still accepts.

create table if not exists public.review_uploads (
  id uuid primary key default gen_random_uuid(),
  -- What the attorney called it ("Smith — 2019 will from prior counsel").
  label text not null check (length(btrim(label)) > 0),
  filename text not null,
  file_kind text not null check (file_kind = any (array['docx', 'pdf'])),
  r2_key text not null unique,
  size_bytes integer not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.review_uploads is
  'A document reviewed in the workbench that is not filed on a matter. Review runs, text layers and citations anchor to it in place of a document version.';

alter table public.review_uploads enable row level security;

drop policy if exists "Staff read review uploads" on public.review_uploads;
create policy "Staff read review uploads" on public.review_uploads
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );

-- Text layers ----------------------------------------------------------------

alter table public.document_text_layers
  alter column document_version_id drop not null;

alter table public.document_text_layers
  add column if not exists review_upload_id uuid references public.review_uploads(id) on delete cascade;

alter table public.document_text_layers
  drop constraint if exists document_text_layers_one_source;
alter table public.document_text_layers
  add constraint document_text_layers_one_source
    check (num_nonnulls(document_version_id, review_upload_id) = 1);

-- The counterpart of unique (document_version_id, source_kind): one layer per
-- upload per extractor kind. NULLs are distinct, so version rows never collide
-- here, and a plain constraint (not a partial index) is what an upsert's
-- on_conflict can name.
alter table public.document_text_layers
  drop constraint if exists document_text_layers_review_upload_id_source_kind_key;
alter table public.document_text_layers
  add constraint document_text_layers_review_upload_id_source_kind_key
    unique (review_upload_id, source_kind);

-- Citations ------------------------------------------------------------------

alter table public.workflow_citations
  alter column document_version_id drop not null;

alter table public.workflow_citations
  add column if not exists review_upload_id uuid references public.review_uploads(id) on delete cascade;

alter table public.workflow_citations
  drop constraint if exists workflow_citations_one_source;
alter table public.workflow_citations
  add constraint workflow_citations_one_source
    check (num_nonnulls(document_version_id, review_upload_id) = 1);

-- Runs -----------------------------------------------------------------------

alter table public.workflow_runs
  add column if not exists review_upload_id uuid references public.review_uploads(id) on delete cascade;

create index if not exists workflow_runs_review_upload_idx on public.workflow_runs (review_upload_id);

-- A review of an unfiled upload belongs to no matter. Every other run still
-- does: a field audit reads a matter's design sheet, and a review of a filed
-- document has that document's matter.
alter table public.workflow_runs
  alter column matter_id drop not null;

alter table public.workflow_runs
  drop constraint if exists workflow_runs_matter_unless_upload;
alter table public.workflow_runs
  add constraint workflow_runs_matter_unless_upload
    check (matter_id is not null or review_upload_id is not null);

-- Replaces 20261028000000's version, which required a document version. A
-- review still needs exactly one thing it reviewed and the layer its citations
-- index; the thing may now be an upload.
alter table public.workflow_runs
  drop constraint if exists workflow_runs_review_needs_document;
alter table public.workflow_runs
  add constraint workflow_runs_review_needs_document
    check (
      kind <> 'review'
      or (text_layer_id is not null and num_nonnulls(document_version_id, review_upload_id) = 1)
    );

-- A field audit is about a matter and never about an upload.
alter table public.workflow_runs
  drop constraint if exists workflow_runs_field_audit_needs_matter;
alter table public.workflow_runs
  add constraint workflow_runs_field_audit_needs_matter
    check (kind <> 'field_audit' or (matter_id is not null and review_upload_id is null));
