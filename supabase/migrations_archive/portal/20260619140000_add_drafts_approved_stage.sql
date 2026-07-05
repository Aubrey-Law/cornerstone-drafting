/*
  # Add Drafts Approved matter stage after Client Review

  Inserts the drafts_approved stage into the workflow between client_review
  and signing. Client plan-review approval auto-advances matters from
  client_review/revision into drafts_approved; attorneys then advance to
  signing_scheduled once signing is booked.
*/

UPDATE public.matter_stage_rules
SET
  to_stage = 'drafts_approved',
  description = 'Client must approve drafts before moving to Drafts Approved',
  is_active = true
WHERE from_stage = 'client_review'
  AND rule_key = 'client_approved_drafts';

INSERT INTO public.matter_stage_rules (from_stage, to_stage, rule_key, description)
VALUES (
  'drafts_approved',
  'signing_scheduled',
  'signing_scheduled',
  'Schedule signing before advancing to Signing'
)
ON CONFLICT (from_stage, rule_key) DO UPDATE SET
  to_stage = EXCLUDED.to_stage,
  description = EXCLUDED.description,
  is_active = true;

INSERT INTO public.stage_task_templates (practice_area, stage, title, priority, default_status, sort_order)
SELECT 'EP', 'drafts_approved', 'Schedule signing appointment', 'high', 'todo', 75
WHERE NOT EXISTS (
  SELECT 1 FROM public.stage_task_templates
  WHERE practice_area = 'EP' AND stage = 'drafts_approved' AND title = 'Schedule signing appointment'
);

INSERT INTO public.stage_task_templates (practice_area, stage, title, priority, default_status, sort_order)
SELECT 'EP-LP', stage, title, priority, default_status, sort_order
FROM public.stage_task_templates
WHERE practice_area = 'EP'
  AND stage = 'drafts_approved'
  AND NOT EXISTS (
    SELECT 1 FROM public.stage_task_templates existing
    WHERE existing.practice_area = 'EP-LP'
      AND existing.stage = 'drafts_approved'
      AND existing.title = 'Schedule signing appointment'
  );
