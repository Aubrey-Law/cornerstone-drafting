-- Cornerstone — a `discovery_call` lead stage.
--
-- A lead that had held its discovery call sat in `new_lead` — a 1-day attorney
-- SLA — until the organizer went out, so the aging board reported a breach for
-- work nobody was late on. Discovery existed only as an anchor column and three
-- tasks inside the `new_lead` phase; it had no stage of its own, and nothing
-- recomputed `matters.stage` when the anchor was set.
--
-- The clock is pinned to the call date rather than to the moment the booking is
-- recorded. `business_days_elapsed` generates an empty series for a future
-- start and returns 0, so a lead booked ahead reads green until the day of the
-- call and only then starts counting toward the post-discovery email.

-- ── The stage ───────────────────────────────────────────────────────────────

-- sla_days 1 matches the v3 plan: "Send post-discovery email (PMPS link +
-- estate plan organizer)" and "Determine fit" are both due at discovery_call+0.
insert into public.stage_sla
  (stage_key, track, entity, owner, sla_days, escalation_offset, stage_order)
values
  ('discovery_call', 'DEFAULT', 'lead', 'attorney', 1, 1, 2)
on conflict (stage_key, track) do update set
  entity      = excluded.entity,
  owner       = excluded.owner,
  stage_order = excluded.stage_order;

-- Renumber the stages discovery now sits ahead of. Only stage_order moves:
-- sla_days and escalation_offset are editable in Settings, and re-seeding them
-- with literals would silently revert whatever the firm had tuned them to.
update public.stage_sla set stage_order = 3
  where stage_key = 'intake_sent' and track = 'DEFAULT' and entity = 'lead';
update public.stage_sla set stage_order = 4
  where stage_key = 'intake_completed' and track = 'DEFAULT' and entity = 'lead';
update public.stage_sla set stage_order = 5
  where stage_key = 'engagement_sent' and track = 'DEFAULT' and entity = 'lead';

-- ── stage_entered_at stops overwriting a deliberate value ───────────────────
--
-- This trigger assigned NOW() on every stage change, which meant no caller
-- could ever set the stage entry date itself. Two consequences: the date
-- `ensure_lead_matter()` computes by coalescing the intake timestamps has
-- never survived, on either the insert or the update path, and the discovery
-- clock below could not be pinned to the call date. Stamp NOW() only when the
-- caller stayed silent.
--
-- Existing callers are unaffected: app/api/intake/route.ts and
-- lib/lawmatics/importMatter.ts already pass now(), so honouring their value
-- instead of replacing it microseconds later changes nothing.
create or replace function public.trg_matters_stage_entered_at()
returns trigger language plpgsql as $$
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

-- ── Setting the anchor moves the stage ──────────────────────────────────────
--
-- Fires on discovery_call_at rather than on stage, which is what keeps the two
-- triggers out of each other's way: `trg_matters_stage_entered_at` is
-- BEFORE UPDATE OF stage, and that fires off the statement's SET list, which
-- names only the anchor columns here. Should a future caller update both at
-- once, both triggers run in name order — this one first — and the hardened
-- guard above then sees a deliberate stage_entered_at and leaves it alone.
create or replace function public.stamp_lead_discovery_stage()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.discovery_call_at is not distinct from old.discovery_call_at then
    return new;
  end if;

  if new.relationship_status <> 'lead' then
    return new;
  end if;

  -- Forward-only. A lead that already sent the organizer is past discovery, and
  -- recording the call date late must not drag it backwards.
  if new.stage is null or new.stage not in ('new_lead', 'discovery_call') then
    return new;
  end if;

  if new.discovery_call_at is not null then
    new.stage := 'discovery_call';
    -- The call date, not now(): business_days_elapsed returns 0 for a future
    -- start, so a lead booked ahead stays green until the day it happens.
    new.stage_entered_at := new.discovery_call_at;
  else
    new.stage := 'new_lead';
    new.stage_entered_at := coalesce(new.created_at, now());
  end if;

  return new;
end;
$$;

revoke execute on function public.stamp_lead_discovery_stage() from public, anon, authenticated;

drop trigger if exists stamp_lead_discovery_stage on public.matters;
create trigger stamp_lead_discovery_stage
before update of discovery_call_at on public.matters
for each row execute function public.stamp_lead_discovery_stage();
