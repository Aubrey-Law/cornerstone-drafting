-- Text layers and citations: the storage behind a checkable AI assertion.
--
-- A finding that says "the indemnity is one-sided" is worth nothing on its own.
-- A finding that says so *and points at the words* is a different product, and
-- these two tables are what make the pointing durable.
--
-- Three decisions here are load-bearing, and each is a specific bug avoided.
--
-- 1. Citations reference a document *version*, never `matter_documents.id`.
--    Applying a redline creates a new version and shifts every offset in the
--    document. Anchoring to the mutable document would leave every previously
--    written citation quietly pointing at the wrong words — the kind of failure
--    that surfaces months later, in front of a client.
--
-- 2. `page` is nullable and derived. `block_index` / `char_start` / `char_end`
--    is the authoritative anchor; page and bbox are display convenience. A DOCX
--    has no page concept in its markup at all, so a schema that required one
--    would be describing a document format that does not exist.
--
-- 3. `verification` is stored rather than assumed. Nothing that is not
--    'verified' reaches an export. Writing the state down means the exclusion
--    is enforceable by query instead of by remembering to check.
--
-- The canonical `text` is stored exactly as the extractor read it — no
-- whitespace collapsing, no quote or ligature folding. Matching normalizes in
-- memory and maps back (lib/textLayer/match.ts). Normalizing on the way in is
-- how stored offsets stop addressing the characters they name.

create table if not exists public.document_text_layers (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null
    references public.document_versions(id) on delete cascade,
  source_kind text not null
    check (source_kind = any (array['docx', 'pdf', 'plain'])),
  status text not null default 'ok'
    check (status = any (array['ok', 'no_text'])),
  extractor text not null,
  extractor_version text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  page_count integer,
  text text not null,
  blocks jsonb not null default '[]'::jsonb,
  spans jsonb not null default '[]'::jsonb,
  -- For a DOCX reviewed through its PDF rendition: which layer's offsets this
  -- one was aligned against. Null when the layer stands alone.
  aligned_to_layer_id uuid references public.document_text_layers(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (document_version_id, source_kind)
);

comment on table public.document_text_layers is
  'Extracted text with character offsets. Built by lib/textLayer/{pdf,docx}.ts; every citation offset indexes this table''s `text`.';
comment on column public.document_text_layers.text is
  'Canonical and untransformed. Normalization for matching happens in memory with an index map back to these offsets, never on the way in.';
comment on column public.document_text_layers.status is
  'no_text marks a scan. Reported explicitly because an empty layer read as healthy means "a document with nothing wrong in it".';
comment on column public.document_text_layers.source_sha256 is
  'sha256 of the source bytes, so re-extraction is idempotent and a changed source is visible rather than silently re-anchored.';
comment on column public.document_text_layers.extractor_version is
  'Bumped when a change could move an offset, so citations written under an older extractor are identifiable rather than silently trusted.';

create index if not exists document_text_layers_version
  on public.document_text_layers (document_version_id);

create table if not exists public.workflow_citations (
  id uuid primary key default gen_random_uuid(),
  text_layer_id uuid not null
    references public.document_text_layers(id) on delete cascade,
  document_version_id uuid not null
    references public.document_versions(id) on delete cascade,
  block_index integer not null,
  char_start integer not null check (char_start >= 0),
  char_end integer not null,
  page integer,
  bbox jsonb,
  quote text not null,
  verification text not null default 'unverified'
    check (verification = any (array['verified', 'unverified', 'stale'])),
  created_at timestamptz not null default now(),
  check (char_end > char_start)
);

comment on table public.workflow_citations is
  'Verified spans of a document version. The quote stored here is always the document''s own text sliced at these offsets, never the model''s rendition of it.';
comment on column public.workflow_citations.page is
  'Derived display convenience, null for DOCX. The offsets above are authoritative.';
comment on column public.workflow_citations.verification is
  'Only "verified" may reach an export. Stored rather than assumed so the exclusion is a query, not a convention.';

create index if not exists workflow_citations_layer
  on public.workflow_citations (text_layer_id);
create index if not exists workflow_citations_version
  on public.workflow_citations (document_version_id);

-- Staff read; writes go through the service-role admin client, matching every
-- other document-adjacent table here.
alter table public.document_text_layers enable row level security;
alter table public.workflow_citations enable row level security;

drop policy if exists "Staff read document text layers" on public.document_text_layers;
create policy "Staff read document text layers" on public.document_text_layers
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );

drop policy if exists "Staff read workflow citations" on public.workflow_citations;
create policy "Staff read workflow citations" on public.workflow_citations
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );
