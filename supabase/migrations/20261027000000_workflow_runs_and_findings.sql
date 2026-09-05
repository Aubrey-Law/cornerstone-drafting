-- A review that survives closing the tab.
--
-- Phase 3 built the citation and text-layer tables and left the findings in
-- memory, so a review was a page you read once. This is the provenance half:
-- which rules ran, at which version, against which document version, what they
-- concluded, and what the attorney decided about each one.
--
-- Names follow the plan's `workflow_*` rather than `review_*`. Only review runs
-- use them today, and the run/finding shape is meant to carry the other prompt
-- types when they arrive — the alternative is renaming these tables later or
-- keeping two of everything.

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),

  -- Both required, and that is the load-bearing decision. A run can only be
  -- recorded against a document that is *filed*: an uploaded draft has no
  -- durable identity, so a saved run about one would carry citations anchored
  -- to nothing. Reviewing an upload stays ephemeral, and the screen says so.
  matter_id uuid not null references public.matters(id) on delete cascade,
  document_version_id uuid not null
    references public.document_versions(id) on delete cascade,

  -- The offsets in every citation index this layer's text. Without it a stored
  -- citation is a pair of numbers with nothing to measure against.
  text_layer_id uuid references public.document_text_layers(id) on delete set null,

  -- Which rules ran. A finding is only interpretable against the version of the
  -- playbook that produced it, and playbooks change.
  playbook_slug text not null,
  playbook_version integer not null,
  model text,

  status text not null
    check (status = any (array['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'])),

  rule_total integer not null default 0,
  finding_count integer not null default 0,
  failed_count integer not null default 0,
  -- Which rules never ran, and why. A rule that failed its call is not a rule
  -- that found nothing, and a run reporting only findings would overstate its
  -- own coverage.
  failures jsonb not null default '[]'::jsonb,

  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references public.users(id) on delete set null,

  -- The status and the failure count must agree. `partial` is the honest word
  -- when some rules ran and some did not, and `completed` may not be used to
  -- describe a run that lost a rule — that would overstate its coverage in the
  -- one field a reader skims.
  constraint workflow_runs_status_matches_failures check (
    (status = 'partial' and failed_count > 0)
    or (status = 'completed' and failed_count = 0)
    or status in ('queued', 'running', 'failed', 'cancelled')
  )
);

create index if not exists workflow_runs_matter_idx on public.workflow_runs (matter_id);
create index if not exists workflow_runs_version_idx on public.workflow_runs (document_version_id);

comment on table public.workflow_runs is
  'One run of one playbook against one document version. Only recorded for filed documents: an upload has no identity to anchor citations to.';

create table if not exists public.workflow_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.workflow_runs(id) on delete cascade,

  rule_number text not null,
  outcome text not null
    check (outcome = any (array['compliant', 'deviation', 'absent', 'not_applicable'])),
  severity text
    check (severity is null or severity = any (array['blocker', 'high', 'medium', 'low'])),

  rationale text not null default '',
  proposed_language text,

  -- Why a finding carries no citation, and what it tried to quote. The share of
  -- citations that survive verification is the measure this design is judged
  -- by, and acting on a poor one needs the words the model reached for.
  citation_refusal text,
  attempted_quote text,

  disposition text not null default 'open'
    check (disposition = any (array['open', 'accepted', 'rejected', 'deferred'])),
  disposition_note text,
  disposition_by uuid references public.users(id) on delete set null,
  disposition_at timestamptz,

  created_at timestamptz not null default now(),

  unique (run_id, rule_number),

  -- A decision with no time on it is not a record of a decision.
  constraint workflow_findings_disposition_has_time
    check (disposition = 'open' or disposition_at is not null),
  -- An attempted quote only means something beside a refusal.
  constraint workflow_findings_attempt_needs_refusal
    check (citation_refusal is not null or attempted_quote is null)
);

create index if not exists workflow_findings_run_idx on public.workflow_findings (run_id);

comment on column public.workflow_findings.attempted_quote is
  'The words the model could not support, kept only on refusal. Lets a paraphrase be told from a verifier being too strict.';

-- Citations were standalone. A citation belongs to the finding it supports, and
-- dies with it: a finding removed leaves no floating claim about a document.
alter table public.workflow_citations
  add column if not exists finding_id uuid
    references public.workflow_findings(id) on delete cascade;

create index if not exists workflow_citations_finding_idx
  on public.workflow_citations (finding_id);

-- Cost per run, answerable. `callAnthropic` and the workbench's caller already
-- write a row per call; this is the join that turns them into a figure.
alter table public.ai_usage
  add column if not exists workflow_run_id uuid
    references public.workflow_runs(id) on delete set null;

create index if not exists ai_usage_workflow_run_idx
  on public.ai_usage (workflow_run_id) where workflow_run_id is not null;

-- Staff read; writes go through the service-role admin client, matching every
-- other matter-adjacent table here.
alter table public.workflow_runs enable row level security;
alter table public.workflow_findings enable row level security;

drop policy if exists "Staff read workflow runs" on public.workflow_runs;
create policy "Staff read workflow runs" on public.workflow_runs
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );

drop policy if exists "Staff read workflow findings" on public.workflow_findings;
create policy "Staff read workflow findings" on public.workflow_findings
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );
