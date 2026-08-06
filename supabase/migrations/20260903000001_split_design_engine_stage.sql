-- Cornerstone — `design` becomes its own engine stage.
--
-- Until now intake, intake_review and design all mapped to `design_input`, a
-- client-owned stage with a 5-day SLA. That measured the wrong thing: the clock
-- started when the questionnaire went out and kept running through the design
-- meeting, so the attorney's own design work was timed against how long the
-- client took to fill in a form. Splitting `design` out gives that work its own
-- attorney-owned SLA, starting at the design meeting.

create or replace function public.map_matter_stage_to_engine(p_stage text)
returns text
language sql
immutable
as $$
  SELECT CASE p_stage
    WHEN 'intake' THEN 'design_input'
    WHEN 'intake_review' THEN 'design_input'
    WHEN 'design' THEN 'design'
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

-- `design` slots between design_input and drafting, so the matter stages
-- renumber to keep stage_order strictly increasing in pipeline order. Order 1
-- is left free for the lead-side engagement stage.
insert into public.stage_sla
  (stage_key, track, entity, owner, sla_days, escalation_offset, stage_order)
values
  ('design_input',      'DEFAULT', 'matter', 'client',   5,    4,    2),
  ('design',            'DEFAULT', 'matter', 'attorney', 5,    2,    3),
  ('drafting',          'DEFAULT', 'matter', 'attorney', 5,    4,    4),
  ('client_review',     'DEFAULT', 'matter', 'client',   5,    4,    5),
  ('revisions',         'DEFAULT', 'matter', 'attorney', 3,    2,    6),
  ('approved',          'DEFAULT', 'matter', 'client',   5,    4,    7),
  ('signing_scheduled', 'DEFAULT', 'matter', 'client',   null, null, 8),
  ('closeout',          'DEFAULT', 'matter', 'attorney', 3,    2,    9),
  ('funding',           'DEFAULT', 'matter', 'attorney', null, null, 10)
on conflict (stage_key, track) do update set
  entity            = excluded.entity,
  owner             = excluded.owner,
  sla_days          = excluded.sla_days,
  escalation_offset = excluded.escalation_offset,
  stage_order       = excluded.stage_order;

-- Re-pin the matters already sitting in design. Their stage_entered_at was
-- measuring a client wait against a client SLA; carrying it straight over would
-- report an attorney design breach that never happened. The design clock starts
-- when this ships, and from here on stage entry stamps it honestly.
update public.matters
set stage_entered_at = now()
where stage = 'design'
  and stage_entered_at is not null
  and stage_entered_at < now();

-- Any open stage task pinned to the old key follows the matter to the new one,
-- so a matter in design does not end up with two tasks for the same work.
update public.tasks
set stage_key = 'design'
where source = 'stage'
  and stage_key = 'design_input'
  and status = 'open'
  and matter_id in (select id from public.matters where stage = 'design');

notify pgrst, 'reload schema';
