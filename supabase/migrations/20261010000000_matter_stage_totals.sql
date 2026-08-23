-- Total time in a stage, across every visit to it.
--
-- The aging board measures a matter from `matters.stage_entered_at`, and that
-- column is reset to now() every time the stage changes
-- (`trg_matters_stage_entered_at`). Re-entering a stage therefore restarts the
-- clock, which is exactly what happens in the revision loop: a matter bounced
-- from Client Review to Revision and back arrives in Client Review looking
-- brand new. It can churn for months without the SLA ever turning it red,
-- because no single visit is ever long.
--
-- `matter_stage_history` (20261009000000) is the only record of the earlier
-- visits, so this view is what makes that churn visible: per matter and stage,
-- how many times it has been entered and the total business days spent there.
--
-- Business days, via the same `business_days_elapsed` the aging board already
-- uses, so the total and the board's "days in stage" are the same unit and can
-- sit next to each other without misleading. That function takes an explicit
-- end, weekends and `firm_holidays` excluded.
--
-- `client_intake_id` rides along because the aging board keys lead rows by the
-- intake id and matter rows by the matter id (`v_pipeline_aging` unions the
-- two), so a caller needs to join by either without a second round trip.

create or replace view public.v_matter_stage_totals
with (security_invoker = true)
as
with ordered as (
  select
    h.matter_id,
    h.to_stage as stage,
    h.entered_at,
    -- The next transition is when this visit ended; the newest row is still open.
    lead(h.entered_at) over (
      partition by h.matter_id
      order by h.entered_at, h.id
    ) as exited_at
  from public.matter_stage_history h
)
select
  o.matter_id,
  m.client_intake_id,
  o.stage,
  count(*)::int as visits,
  sum(public.business_days_elapsed(o.entered_at, coalesce(o.exited_at, now())))::int as business_days,
  min(o.entered_at) as first_entered_at,
  max(o.entered_at) as last_entered_at
from ordered o
join public.matters m on m.id = o.matter_id
group by o.matter_id, m.client_intake_id, o.stage;

comment on view public.v_matter_stage_totals is
  'Per matter and stage: how many times the stage was entered and the total '
  'business days spent across all visits, from matter_stage_history. Exists '
  'because matters.stage_entered_at resets on re-entry, so the aging board '
  'cannot see a matter churning through a revision loop.';

grant select on public.v_matter_stage_totals to authenticated, service_role;

notify pgrst, 'reload schema';
