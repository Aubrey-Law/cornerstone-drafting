-- A matter entering a stage audits itself.
--
-- A prompt that only runs when someone opens /prompts and picks a matter runs
-- on the matters someone already suspected. Firing on a stage entry is what
-- makes a prompt library something the firm's process applies rather than
-- something an attorney has to remember.
--
-- The trigger hangs off `matters.stage` rather than off the route that writes
-- it. transition_matter_stage_with_jobs (20261004000000) and the root app's
-- PATCH /api/admin/matters/[id]/stage both work today, and both are in the app
-- phase 15 deletes. A trigger on the column fires whichever app wrote the
-- change, and keeps firing when only one app is left.
--
-- What it records is a signal, not a run. Creating a run means resolving a
-- prompt's declared inputs against an allow-list and writing one pending step
-- per unit -- app logic with a zod schema behind it, not something to
-- reimplement here. The tick turns the signal into a run.

alter table public.prompts
  -- Which stage entries fire this prompt. Deliberately not `stages`, which
  -- means "offer this prompt for a matter at these stages": a large library
  -- will hold prompts worth offering at a stage but not worth a model call on
  -- every entry to it, and one column carrying both meanings cannot say so.
  --
  -- Empty by default, so nothing begins running on its own until a later
  -- migration says which prompt should.
  add column if not exists fires_on_stage_entry text[] not null default '{}';

create table if not exists public.prompt_stage_triggers (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  prompt_id uuid not null references public.prompts(id) on delete cascade,

  to_stage text not null,

  -- The matter's stage_entered_at at the moment of firing. Part of the
  -- uniqueness below, and the reason this trigger must fire AFTER the update:
  -- trg_matters_stage_entered_at (20260711000000) is a BEFORE trigger that
  -- sets this value, so an AFTER trigger sees the new one.
  stage_entered_at timestamptz not null,

  status text not null default 'pending'
    check (status = any (array['pending', 'claimed', 'done', 'skipped'])),

  -- The run this became, once it became one. Null while pending, and null
  -- forever for a trigger that was skipped.
  run_id uuid references public.workflow_runs(id) on delete set null,

  -- Why a trigger was skipped -- a matter with no design sheet, a required
  -- field nobody has filled in. A skip is not a failure and is recorded as
  -- neither.
  last_error text,

  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  settled_at timestamptz,

  -- Two writes of the same stage in one transition cannot fire twice. A
  -- matter genuinely re-entering `drafting` next week has a new
  -- stage_entered_at and does re-audit, which is the behaviour worth having:
  -- a sheet that has changed deserves a fresh look.
  unique (matter_id, prompt_id, stage_entered_at)
);

create index if not exists prompt_stage_triggers_pending_idx
  on public.prompt_stage_triggers (status, created_at)
  where status = 'pending';

comment on table public.prompt_stage_triggers is
  'One row per prompt that a matter''s stage entry fired. A signal the tick turns into a run; never a run itself.';

create or replace function public.trg_matters_fire_stage_prompts()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  insert into public.prompt_stage_triggers (matter_id, prompt_id, to_stage, stage_entered_at)
  select new.id, p.id, new.stage, new.stage_entered_at
  from public.prompts p
  where new.stage = any (p.fires_on_stage_entry)
  on conflict (matter_id, prompt_id, stage_entered_at) do nothing;

  return null;
end $$;

drop trigger if exists trg_matters_fire_stage_prompts on public.matters;

-- AFTER, and the `when` clause matters as much as the timing: an update that
-- writes the same stage back is not a stage entry, and firing on it would
-- audit a matter every time any unrelated field on it was saved.
create trigger trg_matters_fire_stage_prompts
  after update of stage on public.matters
  for each row
  when (new.stage is distinct from old.stage)
  execute function public.trg_matters_fire_stage_prompts();

-- Claim exactly one pending trigger, atomically. Same reasoning as
-- claim_workflow_run in 20261031000000: PostgREST cannot express
-- `for update skip locked`, and without it two ticks in the same second would
-- materialise the same signal into two runs of the same prompt on the same
-- matter.
create or replace function public.claim_prompt_stage_trigger(p_worker text)
returns public.prompt_stage_triggers language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_trigger public.prompt_stage_triggers;
begin
  with selected as (
    select id from public.prompt_stage_triggers
    where status = 'pending'
    order by created_at
    for update skip locked
    limit 1
  )
  update public.prompt_stage_triggers t
     set status = 'claimed',
         claimed_at = statement_timestamp()
    from selected
   where t.id = selected.id
  returning t.* into v_trigger;

  return v_trigger;
end $$;

revoke all on function public.claim_prompt_stage_trigger(text) from public, anon, authenticated;
grant execute on function public.claim_prompt_stage_trigger(text) to service_role;

alter table public.prompt_stage_triggers enable row level security;

drop policy if exists "Staff read stage triggers" on public.prompt_stage_triggers;
create policy "Staff read stage triggers" on public.prompt_stage_triggers
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );

notify pgrst, 'reload schema';
