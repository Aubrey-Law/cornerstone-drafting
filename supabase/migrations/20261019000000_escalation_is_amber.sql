-- The nudge is not the breach.
--
-- `escalation_offset` is the "reach out before this goes late" marker: it is
-- `sla_days - 1` on ten of the twelve stages that carry an SLA, and the column
-- it feeds is called `needs_outreach`. The health `case` painted it **red**,
-- and tested it before the amber arm below it. Two consequences, on every one
-- of those stages:
--
-- 1. A row went red one business day *before* its SLA was breached, so the
--    colour and the numbers disagreed: red while `is_overdue` was false and
--    `days_over_sla` read -1. Most visible on `intake_completed`, where a lead
--    turned red the morning after its planning session against a two-day
--    promise.
-- 2. Amber was unreachable. Where `escalation_offset = sla_days - 1`, the red
--    arm fires on exactly the threshold the amber arm was written for and sits
--    above it, so the arm below could never be reached. The board carried
--    **zero amber rows** across 79 leads and matters on 2026-08-24 — a
--    two-colour board that had been given three.
--
-- Both arms move to amber, in both entities. Red keeps the one meaning it
-- should have had: the promise is broken — `days_in_stage > sla_days`, or the
-- cumulative budget blown. `needs_outreach` and `is_overdue` are untouched;
-- only which colour the escalation marker paints has changed.
--
-- Small on today's data, which is the point: 57 of the 58 red rows are red
-- because they really are past their SLA, and exactly one becomes amber.

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
      -- Amber, not red: this is the nudge, not the breach. See the header.
      when x.escalation_offset is not null and x.days_in_stage >= x.escalation_offset then 'amber'
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
with lead_row as (
  select
    m.id,
    m.track,
    m.stage,
    m.client_intake_id,
    m.created_at,
    m.stage_entered_at,
    -- The appointment this stage is waiting on, and only for the stages that
    -- wait on one. `intake_sent` waits on the client's organizer and
    -- `engagement_sent` on their signature; neither has a date that says when
    -- the wait ends, so neither is anchored here.
    case m.stage
      when 'discovery_call' then m.discovery_call_at
      when 'intake_completed' then m.pmps_at
    end as meeting_at
  from public.matters m
  where m.status = 'active' and m.relationship_status = 'lead'
), lead_dated as (
  select
    r.*,
    -- A clock that predates the record it belongs to is a typo'd year, not
    -- forty years in a stage.
    (r.stage_entered_at is not null
      and r.stage_entered_at < r.created_at - interval '1 year') as stage_suspect,
    -- And so is a meeting a year out. Left in, it would read as scheduled for
    -- ever and take the lead off the board entirely.
    (r.meeting_at is not null
      and (r.meeting_at < r.created_at - interval '1 year'
        or r.meeting_at > now() + interval '1 year')) as meeting_suspect
  from lead_row r
), lead_anchored as (
  select
    d.*,
    -- greatest() ignores nulls, so a stage with no meeting keeps its own clock
    -- and a stage with one starts at whichever came later.
    greatest(
      case when d.stage_entered_at is null or d.stage_suspect then d.created_at else d.stage_entered_at end,
      case when d.meeting_suspect then null else d.meeting_at end
    ) as clock_at,
    (d.meeting_at is not null
      and not d.meeting_suspect
      and d.meeting_at >= case when d.stage_entered_at is null or d.stage_suspect then d.created_at else d.stage_entered_at end
    ) as clock_from_meeting
  from lead_dated d
), lead_measured as (
  select
    a.id,
    a.track,
    ci.id as intake_id,
    ci.full_name,
    ci.first_name,
    ci.last_name,
    ci.email as client_email,
    ci.phone as client_phone,
    a.stage as current_stage,
    s.stage_order,
    s.owner,
    s.sla_days,
    s.escalation_offset,
    s.cumulative_sla_days,
    a.clock_at as stage_entered_at,
    (a.clock_at > now()) as is_scheduled,
    (a.stage_suspect or a.meeting_suspect) as stage_clock_suspect,
    public.business_days_elapsed(a.clock_at) as days_in_stage,
    -- Measured from the same instant as the current visit whenever the row's
    -- own dates displaced that instant. The history total counts from stage
    -- entry, and the days before a booked meeting were a scheduled wait --
    -- counted here they would turn the row red through the cumulative rule
    -- the morning after the meeting, which is the bug this migration is
    -- about. The 1969 case is the same shape: that date reached the row twice,
    -- once as its clock and once through the history row it wrote.
    case
      when a.stage_suspect or a.clock_from_meeting
        then public.business_days_elapsed(a.clock_at)
      else coalesce(t.business_days, public.business_days_elapsed(a.clock_at))
    end as cumulative_days,
    coalesce(t.visits, 1) as stage_visits
  from lead_anchored a
  join public.client_intake ci on ci.id = a.client_intake_id
  join public.stage_sla s
    on s.stage_key = a.stage
   and s.track = coalesce(nullif(a.track, ''), 'DEFAULT')
   and s.entity = 'lead'
  left join public.v_matter_stage_totals t
    on t.matter_id = a.id and t.stage = a.stage
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
      -- Amber, not red: this is the nudge, not the breach. See the header.
      when x.escalation_offset is not null and x.days_in_stage >= x.escalation_offset then 'amber'
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
  'Matter and lead rows for the aging board. Red means the promise is broken: '
  'past sla_days in the stage, or past the cumulative budget. Amber means '
  'approaching it -- escalation_offset (needs_outreach), or the last day of a '
  'multi-day SLA. A lead stage that waits on a meeting -- discovery_call on '
  'discovery_call_at, intake_completed on pmps_at -- runs its clock from that '
  'meeting: green and is_scheduled while it is ahead, ageing from the meeting '
  'itself once it has happened. A date more than a year before the record or '
  'more than a year ahead is ignored and reads stage_clock_suspect.';
