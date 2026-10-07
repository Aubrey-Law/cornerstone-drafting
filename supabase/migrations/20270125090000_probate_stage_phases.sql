-- Probate stages: file the probate checklist under probate's own stages.
--
-- `probate_sla_v1` was written before probate had stages of its own, so its
-- nine tasks borrowed estate-planning phase names: "File opening documents"
-- sat under Design, "Obtain fiduciary letters" under Drafting, "Complete asset
-- inventory" under Client Review. A probate matter has no design meeting,
-- drafts or signing, so the checklist read as an estate plan.
--
-- Probate's stage is now read from the dates on the record
-- (lib/probateStages/model.ts): Opening, Petition filed, Appointed, Inventory
-- filed, Claims period over, Distributed, Closed. The checklist is filed under
-- the stage each task is done in. `matters.stage` is untouched: the probate
-- stage is derived, never stored.
--
-- The one pre-engagement task (`new_lead`) keeps its phase, so the lead plan
-- still holds it back until the matter is hired.

-- Old phase -> the probate stage the work is done in.
--   intake          -> probate_opening      (confirm court, interested persons; prepare petition)
--   design          -> probate_opening      (file the opening documents)
--   drafting        -> probate_petition_filed  (track appointment, obtain letters)
--   client_review   -> probate_appointed    (inventory and creditor review)
--   revision        -> probate_claims_closed   (accounting and distributions)
--   post_execution  -> probate_distributed  (closing statement or final account)
--   closed          -> probate_closed       (confirm receipts and court close-out)

update public.sla_task_templates
set tasks = (
      select jsonb_agg(
        case task->>'phase'
          when 'intake' then jsonb_set(task, '{phase}', '"probate_opening"')
          when 'design' then jsonb_set(task, '{phase}', '"probate_opening"')
          when 'drafting' then jsonb_set(task, '{phase}', '"probate_petition_filed"')
          when 'client_review' then jsonb_set(task, '{phase}', '"probate_appointed"')
          when 'revision' then jsonb_set(task, '{phase}', '"probate_claims_closed"')
          when 'post_execution' then jsonb_set(task, '{phase}', '"probate_distributed"')
          when 'closed' then jsonb_set(task, '{phase}', '"probate_closed"')
          else task
        end
        order by ordinality
      )
      from jsonb_array_elements(tasks) with ordinality as element(task, ordinality)
    ),
    updated_at = now()
where template_name = 'probate_sla_v1'
  and jsonb_typeof(tasks) = 'array';

-- Tasks already generated from the probate template move with it, open or
-- finished, so the matter's checklist and the template agree.
update public.tasks t
set phase = case t.phase
      when 'intake' then 'probate_opening'
      when 'design' then 'probate_opening'
      when 'drafting' then 'probate_petition_filed'
      when 'client_review' then 'probate_appointed'
      when 'revision' then 'probate_claims_closed'
      when 'post_execution' then 'probate_distributed'
      when 'closed' then 'probate_closed'
    end
from public.sla_task_templates s
where t.plan_template_id = s.id
  and s.template_name = 'probate_sla_v1'
  and t.phase in ('intake', 'design', 'drafting', 'client_review', 'revision', 'post_execution', 'closed');

notify pgrst, 'reload schema';
