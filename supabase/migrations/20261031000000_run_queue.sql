-- A run spans as many invocations as it needs.
--
-- A unit takes about ten seconds and maxDuration is 300, so roughly thirty fit
-- in one invocation. The ~40-prompt library is coming, and a forty-unit run is
-- four hundred seconds of work -- it cannot finish in one, and the failure
-- would be a run dying at the ceiling with no way to resume.
--
-- No queue table. `workflow_runs.status = 'queued'` already means there is work
-- to do and `workflow_run_steps` already says which units remain; a parallel
-- jobs row would be a second source of truth about the same work, and the two
-- would drift the first time one was written without the other.

alter table public.workflow_runs
  -- The heartbeat. A worker stamps this after every unit, so a run whose
  -- worker was killed mid-flight is distinguishable from one still going --
  -- without it, `running` means both, and the reaper has nothing to read.
  add column if not exists last_tick_at timestamptz,

  -- Which worker holds it. A claim that is only implied by `running` cannot
  -- be debugged when two of them disagree.
  add column if not exists locked_by text,

  -- How many times the reaper has handed this run back. A run that kills
  -- every worker it touches must stop being handed to the next one, or one
  -- bad run becomes a permanent load on the queue.
  add column if not exists reclaims integer not null default 0;

create index if not exists workflow_runs_queued_idx
  on public.workflow_runs (status, started_at)
  where status in ('queued', 'running');

-- Claim exactly one queued run, atomically.
--
-- `for update skip locked` is the whole reason this is a function: PostgREST
-- cannot express it, and without it two ticks firing in the same second would
-- claim the same run and do its work twice -- two model calls per unit, two
-- findings racing for one (run_id, rule_number). Same shape as
-- claim_workflow_jobs in 20261004000000.
create or replace function public.claim_workflow_run(p_worker text)
returns public.workflow_runs language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_run public.workflow_runs;
begin
  with selected as (
    select id from public.workflow_runs
    where status = 'queued'
    order by started_at
    for update skip locked
    limit 1
  )
  update public.workflow_runs r
     set status = 'running',
         locked_by = p_worker,
         last_tick_at = statement_timestamp()
    from selected
   where r.id = selected.id
  returning r.* into v_run;

  return v_run;
end $$;

revoke all on function public.claim_workflow_run(text) from public, anon, authenticated;
grant execute on function public.claim_workflow_run(text) to service_role;

notify pgrst, 'reload schema';
