/*
  # Task template due-date offsets

  due_days_offset: calendar days after the task is created from a template (null = no due date).
*/

ALTER TABLE public.stage_task_templates
  ADD COLUMN IF NOT EXISTS due_days_offset integer;

ALTER TABLE public.stage_task_templates
  DROP CONSTRAINT IF EXISTS stage_task_templates_due_days_offset_check;

ALTER TABLE public.stage_task_templates
  ADD CONSTRAINT stage_task_templates_due_days_offset_check
  CHECK (due_days_offset IS NULL OR due_days_offset >= 0);

ALTER TABLE public.lead_task_templates
  ADD COLUMN IF NOT EXISTS due_days_offset integer;

ALTER TABLE public.lead_task_templates
  DROP CONSTRAINT IF EXISTS lead_task_templates_due_days_offset_check;

ALTER TABLE public.lead_task_templates
  ADD CONSTRAINT lead_task_templates_due_days_offset_check
  CHECK (due_days_offset IS NULL OR due_days_offset >= 0);
