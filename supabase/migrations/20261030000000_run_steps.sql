-- What each unit of a run actually did, so a failure costs one unit and not the run.
--
-- A run that lost one rule of forty had one remedy: run all forty again. That
-- re-pays for thirty-nine successful model calls to fix one failure and throws
-- away work that was correct. A row per unit makes retry surgical.
--
-- It also changes when a run becomes visible. Both paths used to run the engine
-- to completion and insert everything afterwards, so a run that died mid-flight
-- left nothing at all -- neither the work nor any evidence of why. A step
-- written as its unit settles needs a run_id to reference, so the run row is
-- inserted first, as `running`, and finalised at the end.

create table if not exists public.workflow_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.workflow_runs(id) on delete cascade,

  -- The rule number or check number, matching workflow_findings.rule_number.
  -- Text rather than an integer because a playbook numbers its rules however
  -- it likes -- "4a" is a rule.
  unit_id text not null,

  -- The order the unit ran in, so a run reads in playbook order rather than in
  -- whatever order the steps happened to settle.
  sequence integer not null,

  status text not null
    check (status = any (array['pending', 'running', 'succeeded', 'failed'])),

  attempts integer not null default 0,
  last_error text,

  started_at timestamptz,
  finished_at timestamptz,

  -- What this step produced. `on delete set null` and not cascade: a retry
  -- deletes the superseded finding, and the step must outlive it -- the
  -- attempt count and the error that preceded it are the record of what
  -- happened, and losing them would hide the very thing steps exist to show.
  finding_id uuid references public.workflow_findings(id) on delete set null,

  unique (run_id, unit_id)
);

create index if not exists workflow_run_steps_run_idx
  on public.workflow_run_steps (run_id);

comment on table public.workflow_run_steps is
  'One row per unit of a run -- a rule against a document, a check against a matter. Retry re-runs only the failed ones.';

-- The evidence a field audit ran against, pinned.
--
-- The review path has always had this: text_layer_id fixes the exact extracted
-- text, so a citation's character offsets index the text they were measured
-- against. A field audit read design_sheets live and had no equivalent, which
-- only becomes visible with retry -- replaying a step an hour later against an
-- edited sheet would produce a run holding one check judged on one version of
-- the matter and another on a different one, with nothing on either finding
-- saying so. Retry replays from this column and never re-reads the sheet; a
-- fresh run is how you audit the current one.
alter table public.workflow_runs
  add column if not exists resolved_inputs jsonb;

alter table public.workflow_run_steps enable row level security;

drop policy if exists "Staff read run steps" on public.workflow_run_steps;
create policy "Staff read run steps" on public.workflow_run_steps
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );

notify pgrst, 'reload schema';
