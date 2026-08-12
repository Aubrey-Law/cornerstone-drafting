-- Cornerstone — restore the search_path pin on trg_matters_stage_entered_at.
--
-- 20260909000000_pmps_booking_lead_stage.sql declared this function with
-- `set search_path = pg_catalog, public`. 20260910000000_lead_discovery_stage.sql
-- then rewrote the same function through `create or replace` without restating
-- that line. `create or replace function` replaces the entire definition,
-- configuration included: a `SET` clause the new text omits is dropped, not
-- inherited. Discovery sorts second, so it applied last and cleared the pin.
--
-- This is not a hypothetical read of the file order. In the firm database
-- every sibling in this chain — stamp_lead_discovery_stage, stamp_lead_pmps_stage,
-- ensure_lead_matter, pipeline_stage_rank — carries
-- proconfig = {search_path=pg_catalog, public}; trg_matters_stage_entered_at
-- alone carries null.
--
-- Nothing here is security definer, so this is hardening rather than an open
-- door: the function runs as its invoker, and `now()` is the only thing it
-- calls. What the pin buys is that the resolution of that call cannot be
-- steered by whatever search_path the calling session happens to carry — the
-- same reason every other function in the chain sets it.
--
-- The body is 20260910's, character for character. That migration's behaviour
-- is the current intent and this file is not the place to revise it; the only
-- change is the configuration line that went missing.
--
-- Both source files are applied to the firm database, so neither can be edited
-- in place — the correction has to arrive as a new migration
-- (supabase/migrations/README.md).
--
-- Grants need no restatement: `create or replace` preserves them, and the
-- recorded ACL is already {postgres=X/postgres,service_role=X/postgres} — the
-- shape 20260813000002_revoke_trigger_function_execute established.

create or replace function public.trg_matters_stage_entered_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.stage_entered_at is null then
      new.stage_entered_at := now();
    end if;
  elsif new.stage is distinct from old.stage then
    if new.stage_entered_at is not distinct from old.stage_entered_at then
      new.stage_entered_at := now();
    end if;
  end if;
  return new;
end;
$$;

comment on function public.trg_matters_stage_entered_at() is
  'Stamps matters.stage_entered_at on entry to a new stage, unless the caller supplied one.';
