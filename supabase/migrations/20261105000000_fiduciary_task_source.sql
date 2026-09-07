-- `tasks.source` learns 'fiduciary': a task the deterministic fiduciary matrix
-- created, not a prompt run and not a person.
--
-- The matrix has found these gaps since it was written -- 39 of 72 chains with
-- no successor, as measured on 2026-09-07 -- and rendered them on /fiduciary,
-- where somebody has to remember to look. This is what lets them reach the
-- queue instead.
--
-- A distinct source rather than reusing 'stage' or 'sla', because
-- apps/workbench/lib/fiduciary/tasks.ts's withdrawal rule narrows on it: a tool may withdraw
-- its own suggestion and must never touch a task another source is tracking.
-- Reusing an existing value would make that rule unable to tell them apart.
--
-- Same shape as 20261029000000_prompt_task_source.sql, which added 'prompt'.

alter table public.tasks
  drop constraint if exists tasks_source_check;

alter table public.tasks
  add constraint tasks_source_check
  check (source in ('manual', 'stage', 'template', 'cadence', 'sla', 'prompt', 'fiduciary'));

-- The column's own comment enumerates the allowed values, and adding a seventh
-- without updating it would leave the database's documentation contradicting
-- its own constraint. 20261029000000 is the only migration that ever set this,
-- and it stopped at six.
comment on column public.tasks.source is
  'Who or what created this task: manual (hand-added), stage (the pipeline '
  'engine), template (a plan row), cadence (a recurring rule), sla (the '
  'estate-planning SLA plan), prompt (a field-audit run -- see '
  'apps/workbench/lib/fieldAudit/tasks.ts), or fiduciary (a gap the '
  'deterministic fiduciary matrix found -- see '
  'apps/workbench/lib/fiduciary/tasks.ts).';

notify pgrst, 'reload schema';
