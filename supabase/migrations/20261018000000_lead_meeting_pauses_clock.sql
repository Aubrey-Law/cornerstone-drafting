-- A meeting the firm has booked is a wait, not a delay.
--
-- 20261015000000 made a lead "scheduled" when its stage clock had not started
-- yet -- `stage_entered_at > now()`. That catches a discovery call booked for
-- next week, because `ensure_lead_matter()` stamps the stage clock with the
-- call. It does not catch the other meeting in the lead funnel: the Peace of
-- Mind Planning Session, which lives in `matters.pmps_at` and never touches
-- `stage_entered_at`.
--
-- So a lead sits in `intake_completed` -- the stage the board labels "Planning
-- Session" -- ageing against a two-day SLA while the session it is named after
-- is a fortnight away. On 2026-08-24 every one of the ten leads in that stage
-- read red, and the only one whose session had not happened yet was red for a
-- meeting nine days out.
--
-- Two changes, both about which instant the clock starts.
--
-- 1. THE STAGE'S OWN MEETING ANCHORS IT. `discovery_call` reads
--    `discovery_call_at`, `intake_completed` reads `pmps_at`. The other three
--    lead stages wait on a person rather than on a date and keep the clock
--    they have. The anchor only ever moves the clock forward (`greatest`), so
--    a meeting already held cannot rewind a stage entered after it.
--
-- 2. THE PAUSE ENDS AT THE MEETING, NOT AT STAGE ENTRY. Reading green while
--    the meeting is ahead is half a fix: if the clock still ran from stage
--    entry underneath, the row would go from green to a fortnight late the
--    morning after the session. Measured from the meeting, the SLA says what
--    it means -- two days to act once the planning session has happened.
--
-- A date can now be wrong in a second direction, so the suspicion widens to
-- match. A meeting more than a year out is ignored the way a milestone more
-- than a year before the record is, rather than parking the lead as
-- permanently scheduled and hiding it from the board for good.
--
-- MATTERS ARE UNCHANGED, and `v_matter_aging` is not touched: a matter's
-- stage clock is stamped now() by trigger and it has no meeting columns.

drop view if exists public.v_pipeline_aging;

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

grant select on public.v_pipeline_aging to authenticated, service_role;

notify pgrst, 'reload schema';

comment on view public.v_pipeline_aging is
  'Matter and lead rows for the aging board. A lead stage that waits on a '
  'meeting -- discovery_call on discovery_call_at, intake_completed on '
  'pmps_at -- runs its clock from that meeting: green and is_scheduled while '
  'it is ahead, ageing from the meeting itself once it has happened. A date '
  'more than a year before the record or more than a year ahead is ignored '
  'and reads stage_clock_suspect.';
