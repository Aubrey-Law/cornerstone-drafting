-- `tasks.source` learns 'fiduciary': a task the deterministic fiduciary matrix
-- created, not a prompt run and not a person.
--
-- The matrix has found these gaps since it was written -- 39 of 72 chains with
-- no successor, as measured on 2026-09-07 -- and rendered them on /fiduciary,
-- where somebody has to remember to look. This is what lets them reach the
-- queue instead.
--
-- A distinct source rather than reusing 'stage' or 'sla', because
-- lib/fiduciary/tasks.ts's withdrawal rule narrows on it: a tool may withdraw
-- its own suggestion and must never touch a task another source is tracking.
-- Reusing an existing value would make that rule unable to tell them apart.
--
-- Same shape as 20261029000000_prompt_task_source.sql, which added 'prompt'.

alter table public.tasks
  drop constraint if exists tasks_source_check;

alter table public.tasks
  add constraint tasks_source_check
  check (source in ('manual', 'stage', 'template', 'cadence', 'sla', 'prompt', 'fiduciary'));

notify pgrst, 'reload schema';
