-- A stage trigger nobody finished is retried, and then given up on out loud.
--
-- claim_prompt_stage_trigger selected `status = 'pending'` and nothing else, so
-- a trigger claimed by a tick that then died stayed `claimed` for ever: no run,
-- no last_error, and nothing that would ever look at it again. The matter was
-- simply never audited, and no screen anywhere said so.
--
-- Measured 2026-09-09. Six triggers were queued across six matters; the tick
-- claimed one a minute exactly on schedule and settled four. Two threw inside
-- runMatterAudit and were stranded, and the only reason anybody noticed is that
-- six triggers had produced four results. Resetting them to pending reproduced
-- it twice.
--
-- WHY THIS ALONE WOULD HAVE BEEN WORSE. That throw was deterministic -- a
-- design sheet whose slot contact_id held the sentinel __design_sheet_client__
-- rather than a uuid, which Postgres rejects at a uuid column. A reclaim
-- without a cap would have re-claimed and re-failed those two matters once a
-- minute, indefinitely, turning a silent loss into a silent loop. The cause is
-- fixed (#436) and a throw now settles the trigger rather than escaping, so
-- this is defence for the next unanticipated exception -- a process killed
-- mid-flight, which no try/catch can cover -- and not for that one.
--
-- Hence the cap, and hence the giving up being visible. Over-cap rows are
-- settled `skipped` with a reason, not abandoned in `claimed`: the whole defect
-- was a row that meant "someone is working on this" while nobody was.
--
-- The numbers match the run reaper's, in lib/runs/reaper.ts: stale after ten
-- minutes, three reclaims. A tick that claims a trigger settles it in the same
-- request, so ten minutes is already far beyond any honest slowness -- and the
-- same reasoning applied to runs, which is why the two agree rather than each
-- inventing its own patience.

alter table public.prompt_stage_triggers
  add column if not exists reclaims integer not null default 0;

comment on column public.prompt_stage_triggers.reclaims is
  'How many times this trigger has been re-claimed after a worker abandoned '
  'it. Capped at 3 by claim_prompt_stage_trigger, which then settles the row '
  'skipped rather than leaving it claimed for ever. Mirrors '
  'workflow_runs.reclaims and lib/runs/reaper.ts''s MAX_RECLAIMS.';

create or replace function public.claim_prompt_stage_trigger(p_worker text)
returns public.prompt_stage_triggers language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_trigger public.prompt_stage_triggers;
  v_stale_after constant interval := interval '10 minutes';
  v_max_reclaims constant integer := 3;
begin
  -- Give up out loud, before claiming anything. A row that has been abandoned
  -- this many times is not going to succeed on the next pass, and leaving it
  -- `claimed` is the exact failure this migration exists to end.
  update public.prompt_stage_triggers
     set status = 'skipped',
         settled_at = statement_timestamp(),
         last_error = 'Abandoned by ' || v_max_reclaims || ' workers without settling. '
                   || 'A tick claims and settles a trigger in one request, so this row was '
                   || 'most likely orphaned by a process that died mid-flight.'
   where status = 'claimed'
     and claimed_at < statement_timestamp() - v_stale_after
     and reclaims >= v_max_reclaims;

  with selected as (
    select id from public.prompt_stage_triggers
    -- Either never started, or started by a worker that never came back.
    where status = 'pending'
       or (
            status = 'claimed'
        and claimed_at < statement_timestamp() - v_stale_after
        and reclaims < v_max_reclaims
       )
    -- Oldest first, so a reclaim never starves a fresh signal or vice versa.
    order by created_at
    for update skip locked
    limit 1
  )
  update public.prompt_stage_triggers t
     set status = 'claimed',
         claimed_at = statement_timestamp(),
         -- Only a reclaim counts. A first claim leaves this at zero, so the
         -- cap measures abandonment rather than attempts.
         reclaims = t.reclaims + case when t.status = 'claimed' then 1 else 0 end
    from selected
   where t.id = selected.id
  returning t.* into v_trigger;

  return v_trigger;
end $$;

revoke all on function public.claim_prompt_stage_trigger(text) from public, anon, authenticated;
grant execute on function public.claim_prompt_stage_trigger(text) to service_role;

notify pgrst, 'reload schema';
