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

-- Superseding also needs its own closeout reason. `tasks_closeout_reason_check`
-- allowed five values, and 'prompt_superseded' is the only one that means "a
-- tool withdrew its own earlier suggestion" -- but it says a *prompt run* did
-- it, and no prompt run ever created a fiduciary task. Reusing it would put a
-- claim in the record that is simply untrue, and `closeout_reason` is read by
-- the reopen and conversion paths as well as by a person looking at why a task
-- closed. 'fiduciary_superseded' names the fiduciary sweep
-- (apps/workbench/lib/fiduciary/sweep.ts) distinctly, and reuses the archived +
-- `skipped_at` pair exactly as 20261029000000 did rather than reopening the
-- question of a second 'skipped' status.

alter table public.tasks
  drop constraint if exists tasks_source_check;

alter table public.tasks
  add constraint tasks_source_check
  check (source in ('manual', 'stage', 'template', 'cadence', 'sla', 'prompt', 'fiduciary'));

alter table public.tasks
  drop constraint if exists tasks_closeout_reason_check;

alter table public.tasks
  add constraint tasks_closeout_reason_check
  check (closeout_reason is null or closeout_reason in (
    'matter_closed',
    'lead_lost',
    'lead_declined',
    'not_engaged',
    'prompt_superseded',
    'fiduciary_superseded'
  ));

-- Same reason as the `source` comment below: 20261029000000 enumerated the
-- five values it knew about, and adding a sixth without saying so would leave
-- the column documenting a rule the constraint no longer has.
comment on column public.tasks.closeout_reason is
  'Set when a task was archived automatically: its matter closed, its lead '
  'went lost/declined, it is post-engagement work on a lead that has not '
  'converted (not_engaged), a newer prompt run superseded the finding that '
  'created it (prompt_superseded), or the fiduciary sweep found the gap it '
  'named no longer stands (fiduciary_superseded -- see '
  'apps/workbench/lib/fiduciary/sweep.ts). Non-null marks the row as '
  'restorable by the reopen, conversion, and re-run paths; a hand-skipped '
  'task keeps this null and stays archived.';

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
