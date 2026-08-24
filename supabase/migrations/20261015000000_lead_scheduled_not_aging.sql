-- A booked call is scheduled, not aging — and a clock cannot start in 1969.
--
-- Read off the board today: 27 of 39 lead rows red, 12 amber, none green. A
-- board that is never green has stopped being a signal, and three separate
-- mechanics were producing that:
--
-- 1. THE DISCOVERY CLOCK STARTS AT THE CALL. `ensure_lead_matter()`
--    (20260911000000) sets a lead's `stage_entered_at` to the milestone behind
--    the stage, which for `discovery_call` is the *scheduled* call — often days
--    in the future. `business_days_elapsed()` returns 0 for a future start, and
--    the amber rule below fires at 0, so a call booked for next Tuesday reads
--    as aging from the moment it is booked. Twelve rows sat amber at zero days.
--
-- 2. AMBER FIRED IMMEDIATELY ON A ONE-DAY SLA. `days >= sla_days - 1` means
--    `days >= 0` when the SLA is one day, which every row satisfies on arrival.
--    Amber is supposed to mean "approaching the limit"; for a one-day budget
--    there is no approach, only inside or outside.
--
-- 3. ONE BAD DATE RAN A CLOCK FOR FORTY YEARS. A lead carries a
--    `discovery_call_at` of 1969-09-02 — a typo'd year — which became its
--    stage clock and reported 14,864 days in stage, dragging the whole
--    `intake_completed` group's average to 1,498 days.
--
-- The first two are fixed here. The third is *surfaced* rather than corrected:
-- the clock falls back to the row's creation date so one typo cannot dominate
-- the board, and `stage_clock_suspect` marks the row so the date gets fixed at
-- source instead of being quietly absorbed.
--
-- MATTERS ARE UNCHANGED. `v_pipeline_aging` unions the two arms, so both must
-- carry the same columns; `v_matter_aging` gains `is_scheduled` and
-- `stage_clock_suspect` as constant false. A matter's `stage_entered_at` is
-- stamped `now()` by trigger when the stage changes, so neither case can arise
-- there. Every other value it reports is byte-identical to before.

drop view if exists public.v_pipeline_aging;

create or replace view public.v_matter_aging
with (security_invoker = true)
as
with matter_totals as (
  -- Re-aggregated to engine keys: `intake` + `intake_review` are one
  -- `design_input` phase, and a visit to either is a visit to it.
  select
    t.matter_id,
    public.map_matter_stage_to_engine(t.stage) as stage_key,
    sum(t.visits)::int as visits,
    sum(t.business_days)::int as cumulative_days
  from public.v_matter_stage_totals t
  where public.map_matter_stage_to_engine(t.stage) is not null
  group by t.matter_id, public.map_matter_stage_to_engine(t.stage)
), measured as (
  select
    m.id,
    m.name,
    m.track,
    ci.first_name,
    ci.last_name,
    ci.email as client_email,
    ci.phone as client_phone,
    public.map_matter_stage_to_engine(m.stage) as current_stage,
    s.stage_order,
    s.owner,
    s.sla_days,
    s.escalation_offset,
    s.cumulative_sla_days,
    coalesce(m.stage_entered_at, m.created_at) as stage_entered_at,
    public.business_days_elapsed(coalesce(m.stage_entered_at, m.created_at)) as days_in_stage,
    -- No history recorded falls back to the current visit, so the total can
    -- never read lower than what the board already shows.
    coalesce(mt.cumulative_days, public.business_days_elapsed(coalesce(m.stage_entered_at, m.created_at))) as cumulative_days,
    coalesce(mt.visits, 1) as stage_visits
  from public.matters m
  left join public.client_intake ci on ci.id = m.client_intake_id
  join public.stage_sla s
    on s.stage_key = public.map_matter_stage_to_engine(m.stage)
   and s.track = coalesce(nullif(m.track, ''), 'DEFAULT')
   and s.entity = 'matter'
  left join matter_totals mt
    on mt.matter_id = m.id
   and mt.stage_key = public.map_matter_stage_to_engine(m.stage)
  where m.status = 'active'
    and m.relationship_status = 'hired'
    and public.map_matter_stage_to_engine(m.stage) is not null
    and public.map_matter_stage_to_engine(m.stage) <> 'matter_closed'
), base as (
  select
    'matter'::text as entity,
    x.id::text as id,
    coalesce(nullif(trim(x.name), ''), nullif(trim(concat_ws(' ', x.first_name, x.last_name)), '')) as client_name,
    x.client_email,
    x.client_phone,
    coalesce(nullif(x.track, ''), 'DEFAULT') as track,
    x.current_stage,
    x.stage_order,
    x.owner,
    x.stage_entered_at,
    x.days_in_stage,
    x.sla_days,
    x.escalation_offset,
    x.stage_visits,
    x.cumulative_days,
    x.cumulative_sla_days,
    (x.cumulative_sla_days is not null and x.cumulative_days > x.cumulative_sla_days) as is_cumulative_overdue,
    (
      (x.sla_days is not null and x.days_in_stage > x.sla_days)
      or (x.cumulative_sla_days is not null and x.cumulative_days > x.cumulative_sla_days)
    ) as is_overdue,
    (x.escalation_offset is not null and x.days_in_stage >= x.escalation_offset) as needs_outreach,
    case
      when x.sla_days is null and x.cumulative_sla_days is null then 'green'
      when x.sla_days is not null and x.days_in_stage > x.sla_days then 'red'
      when x.cumulative_sla_days is not null and x.cumulative_days > x.cumulative_sla_days then 'red'
      when x.escalation_offset is not null and x.days_in_stage >= x.escalation_offset then 'red'
      when x.sla_days is not null and x.days_in_stage >= (x.sla_days - 1) then 'amber'
      else 'green'
    end as raw_health,
    case when x.sla_days is null then null else x.days_in_stage - x.sla_days end as days_over_sla
  from measured x
)
select
  b.entity, b.id, b.client_name, b.client_email, b.client_phone, b.track,
  b.current_stage, b.stage_order, b.owner, b.stage_entered_at, b.days_in_stage,
  b.sla_days, b.escalation_offset,
  case when sn.id is not null then false else b.is_overdue end as is_overdue,
  case when sn.id is not null then false else b.needs_outreach end as needs_outreach,
  case when sn.id is not null then 'green'::text else b.raw_health end as health,
  b.raw_health, b.days_over_sla, sn.id as snooze_id, sn.snoozed_until,
  sn.reason as snooze_reason, (sn.id is not null) as is_snoozed,
  b.stage_visits, b.cumulative_days, b.cumulative_sla_days,
  case when sn.id is not null then false else b.is_cumulative_overdue end as is_cumulative_overdue,
  -- Constant for a matter: its stage clock is stamped now() on every stage
  -- change, so it can neither start in the future nor predate the row.
  false as is_scheduled,
  false as stage_clock_suspect
from base b
left join public.pipeline_aging_snooze sn
  on sn.entity = 'matter' and sn.entity_id = b.id and sn.stage_key = b.current_stage
 and sn.snoozed_until > now();

create or replace view public.v_pipeline_aging
with (security_invoker = true)
as
with lead_measured as (
  select
    m.id,
    m.track,
    ci.id as intake_id,
    ci.full_name,
    ci.first_name,
    ci.last_name,
    ci.email as client_email,
    ci.phone as client_phone,
    m.stage as current_stage,
    s.stage_order,
    s.owner,
    s.sla_days,
    s.escalation_offset,
    s.cumulative_sla_days,
    -- A lead's clock is the milestone behind its stage, which the intake can
    -- set to anything. Two of those anythings are not clocks: a date before
    -- the row existed (a typo'd year), and a date still to come (a booked
    -- call). The first falls back to creation, the second is flagged and left
    -- alone so the board can say "scheduled" rather than colour it.
    case
      when m.stage_entered_at is null then m.created_at
      when m.stage_entered_at < m.created_at - interval '1 year' then m.created_at
      else m.stage_entered_at
    end as stage_entered_at,
    (m.stage_entered_at is not null and m.stage_entered_at > now()) as is_scheduled,
    (m.stage_entered_at is not null
      and m.stage_entered_at < m.created_at - interval '1 year') as stage_clock_suspect,
    public.business_days_elapsed(
      case
        when m.stage_entered_at is null then m.created_at
        when m.stage_entered_at < m.created_at - interval '1 year' then m.created_at
        else m.stage_entered_at
      end
    ) as days_in_stage,
    -- Lead stages are the raw `matters.stage`, so totals match without
    -- regrouping. A suspect clock is excluded from the total as well as from
    -- the current visit: the same 1969 date reaches this row twice, once
    -- through `stage_entered_at` above and once through the history row the
    -- stage change wrote, where it totalled 14,860 business days and turned
    -- the row red through the cumulative rule instead.
    case
      when m.stage_entered_at is not null
       and m.stage_entered_at < m.created_at - interval '1 year'
      then public.business_days_elapsed(m.created_at)
      else coalesce(t.business_days, public.business_days_elapsed(
        case
          when m.stage_entered_at is null then m.created_at
          else m.stage_entered_at
        end
      ))
    end as cumulative_days,
    coalesce(t.visits, 1) as stage_visits
  from public.matters m
  join public.client_intake ci on ci.id = m.client_intake_id
  join public.stage_sla s
    on s.stage_key = m.stage
   and s.track = coalesce(nullif(m.track, ''), 'DEFAULT')
   and s.entity = 'lead'
  left join public.v_matter_stage_totals t
    on t.matter_id = m.id and t.stage = m.stage
  where m.status = 'active' and m.relationship_status = 'lead'
), lead_base as (
  select
    'lead'::text as entity,
    x.intake_id::text as id,
    coalesce(nullif(trim(x.full_name), ''), nullif(trim(concat_ws(' ', x.first_name, x.last_name)), ''), x.client_email) as client_name,
    x.client_email,
    x.client_phone,
    coalesce(nullif(x.track, ''), 'DEFAULT') as track,
    x.current_stage,
    x.stage_order,
    x.owner,
    x.stage_entered_at,
    x.days_in_stage,
    x.sla_days,
    x.escalation_offset,
    x.stage_visits,
    x.cumulative_days,
    x.cumulative_sla_days,
    x.is_scheduled,
    x.stage_clock_suspect,
    (not x.is_scheduled
      and x.cumulative_sla_days is not null
      and x.cumulative_days > x.cumulative_sla_days) as is_cumulative_overdue,
    (
      not x.is_scheduled and (
        (x.sla_days is not null and x.days_in_stage > x.sla_days)
        or (x.cumulative_sla_days is not null and x.cumulative_days > x.cumulative_sla_days)
      )
    ) as is_overdue,
    (not x.is_scheduled
      and x.escalation_offset is not null
      and x.days_in_stage >= x.escalation_offset) as needs_outreach,
    case
      -- Nothing is owed on a lead whose next step is an appointment that has
      -- not happened yet. The board says when, not how late.
      when x.is_scheduled then 'green'
      when x.sla_days is null and x.cumulative_sla_days is null then 'green'
      when x.sla_days is not null and x.days_in_stage > x.sla_days then 'red'
      when x.cumulative_sla_days is not null and x.cumulative_days > x.cumulative_sla_days then 'red'
      when x.escalation_offset is not null and x.days_in_stage >= x.escalation_offset then 'red'
      -- Amber means approaching the limit. A one-day budget has no approach,
      -- so this fired on arrival for every new_lead and discovery_call row.
      when x.sla_days is not null and x.sla_days > 1 and x.days_in_stage >= (x.sla_days - 1) then 'amber'
      else 'green'
    end as raw_health,
    case when x.sla_days is null then null else x.days_in_stage - x.sla_days end as days_over_sla
  from lead_measured x
), lead_aging as (
  select
    b.entity, b.id, b.client_name, b.client_email, b.client_phone, b.track,
    b.current_stage, b.stage_order, b.owner, b.stage_entered_at, b.days_in_stage,
    b.sla_days, b.escalation_offset,
    case when sn.id is not null then false else b.is_overdue end as is_overdue,
    case when sn.id is not null then false else b.needs_outreach end as needs_outreach,
    case when sn.id is not null then 'green'::text else b.raw_health end as health,
    b.raw_health, b.days_over_sla, sn.id as snooze_id, sn.snoozed_until,
    sn.reason as snooze_reason, (sn.id is not null) as is_snoozed,
    b.stage_visits, b.cumulative_days, b.cumulative_sla_days,
    case when sn.id is not null then false else b.is_cumulative_overdue end as is_cumulative_overdue,
    b.is_scheduled,
    b.stage_clock_suspect
  from lead_base b
  left join public.pipeline_aging_snooze sn
    on sn.entity = 'lead' and sn.entity_id = b.id and sn.stage_key = b.current_stage
   and sn.snoozed_until > now()
)
select * from public.v_matter_aging
union all
select * from lead_aging;

grant select on public.v_matter_aging to authenticated, service_role;
grant select on public.v_pipeline_aging to authenticated, service_role;

notify pgrst, 'reload schema';

comment on view public.v_pipeline_aging is
  'Matter and lead rows for the aging board. A lead whose stage clock is an '
  'appointment still ahead reads is_scheduled and green; one whose clock '
  'predates its own row by more than a year reads stage_clock_suspect and is '
  'measured from creation instead.';
