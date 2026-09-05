-- Prompts become versioned objects, and a run stops assuming a document.
--
-- Review and field-audit prompts have lived as text in the codebase. That
-- meant editing one meant a deploy, and a workflow_run had no durable record
-- of which wording produced its findings beyond a slug and an integer that
-- could be edited out from under it. This gives prompts the same shape the
-- clause library already proved out in 20260715210000: a subject, immutable
-- versions carrying a content hash, and a publication pointer with a
-- composite foreign key so a publication can only point at a version that
-- actually belongs to its subject.
--
-- It also lets workflow_runs stop requiring a document. Phase 3 built runs
-- around review, where a document is the whole point -- see the comment on
-- workflow_runs in 20261027000000. A field audit runs against a matter's
-- declared facts, which plenty of matters have before any document is filed,
-- and the old NOT NULL made that state unrepresentable.

create table if not exists public.prompts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  kind text not null check (kind = any (array['review', 'field_audit'])),
  stages text[] not null default '{}',
  matter_types text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),

  -- The composite target for prompt_versions' foreign key below: a version
  -- carries its own `kind`, and this is what lets that value be checked
  -- against the prompt instead of merely copied from it.
  unique (id, kind)
);

comment on table public.prompts is
  'A versioned prompt object: one row per slug, immutable versions underneath, a publication pointer at the current one.';

create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.prompts(id) on delete cascade,

  -- Denormalised from prompts.kind and enforced against it, not merely
  -- copied: the foreign key below fails to resolve if this ever names a
  -- different kind than the prompt it belongs to. That failure -- not
  -- anyone remembering to check -- is what stops a review prompt from
  -- acquiring a field-audit body.
  kind text not null check (kind = any (array['review', 'field_audit'])),

  version_number integer not null check (version_number > 0),
  body jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  change_summary text,
  validation_status text not null default 'valid'
    check (validation_status = any (array['valid', 'invalid'])),
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,

  unique (prompt_id, version_number),

  -- A review prompt must not be able to acquire a field-audit body. That is
  -- not asserted anywhere against the jsonb body itself -- it is enforced
  -- here, by the reference failing to resolve when this row's kind and its
  -- prompt_id don't name a real (id, kind) pair on prompts.
  foreign key (prompt_id, kind) references public.prompts(id, kind),

  -- The composite target for prompt_publications' foreign key below, so a
  -- publication can be checked against the prompt it claims to belong to,
  -- the same way estate_clause_publications checks against estate_clauses.
  unique (id, prompt_id)
);

create index if not exists prompt_versions_prompt_idx on public.prompt_versions (prompt_id);

comment on table public.prompt_versions is
  'Immutable prompt bodies. A version is never edited in place; a change is a new version_number with its own content_hash.';

create table if not exists public.prompt_publications (
  -- Primary key, not a unique constraint bolted onto a separate id column:
  -- one current version per prompt is guaranteed by the row's shape, not by
  -- a rule someone has to remember to enforce.
  prompt_id uuid primary key references public.prompts(id) on delete cascade,
  version_id uuid not null,
  published_at timestamptz not null default now(),
  published_by uuid references public.users(id) on delete set null,

  -- Mirrors estate_clause_publications' foreign key into estate_clause_revisions:
  -- the version published for a prompt must be a version of that same prompt,
  -- and this is what makes publishing the wrong prompt's version fail to
  -- insert instead of failing silently the first time someone reads it back.
  foreign key (version_id, prompt_id)
    references public.prompt_versions(id, prompt_id) on delete restrict
);

comment on table public.prompt_publications is
  'The current version of each prompt. One row per prompt because the primary key is prompt_id, not because anyone checked.';

-- A run is no longer definitionally about a document. See the header comment
-- above for why; the rest of this block is the mechanics of getting there.

alter table public.workflow_runs
  add column if not exists prompt_version_id uuid references public.prompt_versions(id);

-- Denormalised from the prompt on purpose. A check constraint cannot join,
-- so workflow_runs_review_needs_document below cannot read prompt_version_id
-- through to prompt_versions.kind at insert time -- it needs a kind sitting
-- on this row to check against. That constraint is the one that has to hold;
-- this column exists to give it something to hold against.
alter table public.workflow_runs
  add column if not exists kind text not null default 'review'
    check (kind = any (array['review', 'field_audit']));

-- A field audit runs against a matter's declared facts, not a filed
-- document, so the column-level NOT NULL that made sense when every run was
-- a review no longer holds for every run.
alter table public.workflow_runs
  alter column document_version_id drop not null;

alter table public.workflow_runs
  drop constraint if exists workflow_runs_review_needs_document;

-- A review run with no document is still a bug: there is nothing it could
-- have reviewed. A field audit with no document is normal -- it runs against
-- the matter's declared facts, and plenty of matters have no filed document
-- yet. Same shape as workflow_runs_status_matches_failures in
-- 20261027000000: one constraint carrying the invariant a NOT NULL column
-- can no longer carry on its own.
alter table public.workflow_runs
  add constraint workflow_runs_review_needs_document
    check (kind <> 'review' or (document_version_id is not null and text_layer_id is not null));

-- Superseded by prompt_version_id. Which rules ran, at which wording, is now
-- answerable by following a foreign key to an immutable prompt_versions row
-- instead of trusting a slug and an integer that could point at a version
-- already edited out from under the run they describe.
alter table public.workflow_runs drop column if exists playbook_slug;
alter table public.workflow_runs drop column if exists playbook_version;

create table if not exists public.workflow_field_references (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.workflow_findings(id) on delete cascade,
  field_key text not null,
  claimed_value text,
  actual_value text,

  -- The dotted/indexed path to the leaf inside the field that satisfied the
  -- claim, e.g. `children[0].dob`. Only meaningful for a structured
  -- (jsonb array-of-objects) field: the verifier matches a claim against any
  -- scalar leaf reachable inside the value, and a leaf carries no record of
  -- which object it came from on its own, so a date that really is in
  -- `children` can be matched against the wrong child without the verifier
  -- being able to tell. This is what lets a reader catch that misattribution
  -- themselves. Null for a scalar field, an emptiness claim, and whenever
  -- verification failed. See FieldReference in
  -- packages/citations/src/fieldAudit/types.ts, which this column exists to
  -- store without losing.
  matched_path text,

  verification text not null
    check (verification = any (array['verified', 'unverified', 'stale'])),
  created_at timestamptz not null default now()
);

create index if not exists workflow_field_references_finding_idx
  on public.workflow_field_references (finding_id);

comment on table public.workflow_field_references is
  'A field-audit finding''s evidence: a claimed value checked against an actual one. Kept separate from workflow_citations rather than added as columns to it, because a citation is offsets into a text layer and a field reference is a value in a row -- one table would be half-null in every row and would describe neither check well.';

-- Staff read; writes go through the service-role admin client, matching
-- every other workflow_* and prompt table.
alter table public.prompts enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.prompt_publications enable row level security;
alter table public.workflow_field_references enable row level security;

drop policy if exists "Staff read prompts" on public.prompts;
create policy "Staff read prompts" on public.prompts
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );

drop policy if exists "Staff read prompt versions" on public.prompt_versions;
create policy "Staff read prompt versions" on public.prompt_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );

drop policy if exists "Staff read prompt publications" on public.prompt_publications;
create policy "Staff read prompt publications" on public.prompt_publications
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );

drop policy if exists "Staff read workflow field references" on public.workflow_field_references;
create policy "Staff read workflow field references" on public.workflow_field_references
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );
