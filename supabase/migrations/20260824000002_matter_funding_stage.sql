-- Cornerstone — a `funding` stage between post-execution and closed.
--
-- Trust funding is the one part of the estate planning SLA that the existing
-- stage list has nowhere to put. Everything else in the SLA lands on a stage
-- that already exists; funding is open-ended monitoring — retitling, beneficiary
-- changes, waiting on the county to return recorded deeds — that runs on a
-- 30-day check-in cycle for as long as it takes.
--
-- Folding it into `post_execution` would work mechanically but would light up
-- the aging board: that stage maps to `closeout`, which carries a 3-day SLA, so
-- a matter waiting three months on a county clerk would sit permanently red for
-- a delay nobody at the firm can act on. Funding therefore gets its own engine
-- key with a null SLA, exactly as `signing_scheduled` already does for
-- client-scheduled waiting.

create or replace function public.map_matter_stage_to_engine(p_stage text)
returns text
language sql
immutable
as $$
  SELECT CASE p_stage
    WHEN 'intake' THEN 'design_input'
    WHEN 'intake_review' THEN 'design_input'
    WHEN 'design' THEN 'design_input'
    WHEN 'drafting' THEN 'drafting'
    WHEN 'client_review' THEN 'client_review'
    WHEN 'revision' THEN 'revisions'
    WHEN 'drafts_approved' THEN 'approved'
    WHEN 'signing_scheduled' THEN 'signing_scheduled'
    WHEN 'signing_complete' THEN 'signing_scheduled'
    WHEN 'post_execution' THEN 'closeout'
    WHEN 'funding' THEN 'funding'
    WHEN 'closed' THEN 'matter_closed'
    ELSE NULL
  END;
$$;

-- Null sla_days keeps funding matters on the pipeline board without an overdue
-- clock; the 30-day check-in cadence is driven by the task's own nudge date.
insert into public.stage_sla
  (stage_key, track, entity, owner, sla_days, escalation_offset, stage_order)
values
  ('funding', 'DEFAULT', 'matter', 'attorney', null, null, 8)
on conflict (stage_key, track) do update set
  entity            = excluded.entity,
  owner             = excluded.owner,
  sla_days          = excluded.sla_days,
  escalation_offset = excluded.escalation_offset,
  stage_order       = excluded.stage_order;

notify pgrst, 'reload schema';
