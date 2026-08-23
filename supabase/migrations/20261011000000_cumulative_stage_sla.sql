-- Let cumulative time in a stage breach the SLA, not just the current visit.
--
-- `stage_entered_at` resets on every stage change, so the aging board has only
-- ever measured the latest visit. A matter cycling through the revision loop —
-- Client Review to Revision and back — arrives looking new each time and can
-- churn indefinitely without any single visit growing long enough to turn red.
-- 20261010000000 made that total visible; this makes it count.
--
-- Two things change:
--
-- 1. `stage_sla` gains `cumulative_sla_days`, a second threshold measured across
--    every visit to the stage. Seeded at twice the per-visit SLA — a matter that
--    has consumed double its stage budget in total is behind however the time
--    was distributed — and editable per stage like the others. Null means the
--    cumulative rule is not enforced for that stage, which is what the stages
--    with no `sla_days` (signing_scheduled, funding) get.
--
-- 2. The aging views fold it in: `is_overdue` and `health` now go red when
--    *either* the current visit exceeds `sla_days` or the total exceeds
--    `cumulative_sla_days`. Amber is deliberately unchanged — it warns that the
--    current visit is nearly due, which is still a per-visit question.
--
-- `needs_outreach` is also deliberately unchanged. It drives when a client is
-- chased, and `escalation_offset` is an absolute count that fires *before* the
-- SLA; nudging someone because of time their earlier round consumed would be
-- wrong when the current round is only days old.
--
-- The join fixes a real defect. `v_matter_stage_totals` is keyed by the raw
-- `matters.stage`, while the aging board keys matter rows by the *engine* stage
-- from `map_matter_stage_to_engine()`. Those differ for half the vocabulary —
-- raw `revision` is engine `revisions`, `intake` and `intake_review` both fold
-- into `design_input` — so matching them directly silently found nothing for
-- exactly the revision loop the totals were added for. Matter rows now
-- re-aggregate totals by engine key, which also correctly sums the two raw
-- stages that share one engine key. Lead rows key on the raw stage, which is
-- what their arm of the view already uses.

-- ── 1. The second threshold ─────────────────────────────────────────────────

alter table public.stage_sla
  add column if not exists cumulative_sla_days int;

-- Twice the per-visit budget, for stages that have one. Only fills nulls, so
-- re-running cannot overwrite a value tuned in the settings UI.
update public.stage_sla
set cumulative_sla_days = sla_days * 2
where sla_days is not null and cumulative_sla_days is null;

comment on column public.stage_sla.cumulative_sla_days is
  'Business days allowed in this stage across every visit to it, from '
  'v_matter_stage_totals. Breaching it turns the row red even when the current '
  'visit is well inside sla_days — the case stage_entered_at cannot see, since '
  'it resets on re-entry. Null disables the cumulative rule for the stage.';

-- ── 2. The aging views ──────────────────────────────────────────────────────
-- `v_pipeline_aging` selects * from `v_matter_aging`, so it is dropped first and
-- rebuilt after; its UNION is positional, and the new columns are appended in
-- the same order to both arms.

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
  case when sn.id is not null then false else b.is_cumulative_overdue end as is_cumulative_overdue
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
    coalesce(m.stage_entered_at, m.created_at) as stage_entered_at,
    public.business_days_elapsed(coalesce(m.stage_entered_at, m.created_at)) as days_in_stage,
    -- Lead stages are the raw `matters.stage`, so totals match without regrouping.
    coalesce(t.business_days, public.business_days_elapsed(coalesce(m.stage_entered_at, m.created_at))) as cumulative_days,
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
    case when sn.id is not null then false else b.is_cumulative_overdue end as is_cumulative_overdue
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
