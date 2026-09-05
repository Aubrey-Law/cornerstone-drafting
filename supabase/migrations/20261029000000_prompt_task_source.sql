-- A field-audit finding becomes a task, and a tool can withdraw its own
-- stale suggestions -- so `tasks` needs a way to say a row came from a
-- prompt run, distinctly from every other way a task gets created.
--
-- `tasks.source` allowed five values: manual, stage, template, cadence, sla.
-- None of them mean "a prompt run created this on its own initiative", and
-- reusing one -- 'template', say -- would make a prompt-created task
-- indistinguishable from an attorney's own hand-added plan row. That
-- distinction is load-bearing, not cosmetic:
-- apps/workbench/lib/fieldAudit/tasks.ts's `tasksToSupersede` withdraws a
-- stale task only when its `source` is exactly this new value, precisely so
-- a tool can retract its own earlier suggestion and never touch a task a
-- person created by another route, or one the stage engine or the SLA plan
-- is tracking. That has to be a fact the database enforces, not a
-- convention a query merely assumes.
--
-- Superseding also needs its own closeout reason. 20261006000000 built
-- `closeout_reason` for a matter closing or a lead going lost/declined, and
-- 20261017000000 added `not_engaged` for a lead that has not converted --
-- every value so far names something that happened to the *matter or lead*.
-- A newer field-audit run superseding an older one is a different kind of
-- event: the matter is unchanged, but the finding that produced this task no
-- longer stands. `prompt_superseded` names that distinctly from a task an
-- attorney skipped by hand, which keeps `closeout_reason` null exactly as it
-- already does for the other reasons.
--
-- `status` is left alone on purpose. The estate-planning SLA table this one
-- absorbed (20260823000000) did have a `skipped` status, but
-- 20261003000000 folded it into `archived` + `skipped_at` on the way in --
-- see that migration's CASE mapping and `lib/tasks/types.ts`'s
-- `isTaskSkipped`, which already defines "skipped" as exactly that pair.
-- Adding a second, parallel meaning of "skipped" back to `status` would
-- silently stop being true for a prompt-superseded row. Superseding a task
-- reuses the existing pair instead of reopening that question.

alter table public.tasks
  drop constraint if exists tasks_source_check;

alter table public.tasks
  add constraint tasks_source_check
  check (source in ('manual', 'stage', 'template', 'cadence', 'sla', 'prompt'));

alter table public.tasks
  drop constraint if exists tasks_closeout_reason_check;

alter table public.tasks
  add constraint tasks_closeout_reason_check
  check (closeout_reason is null or closeout_reason in (
    'matter_closed',
    'lead_lost',
    'lead_declined',
    'not_engaged',
    'prompt_superseded'
  ));

comment on column public.tasks.source is
  'Who or what created this task: manual (hand-added), stage (the pipeline '
  'engine), template (a plan row), cadence (a recurring rule), sla (the '
  'estate-planning SLA plan), or prompt (a field-audit run -- see '
  'apps/workbench/lib/fieldAudit/tasks.ts).';

comment on column public.tasks.closeout_reason is
  'Set when a task was archived automatically: its matter closed, its lead '
  'went lost/declined, it is post-engagement work on a lead that has not '
  'converted (not_engaged), or a newer prompt run superseded the finding '
  'that created it (prompt_superseded). Non-null marks the row as '
  'restorable by the reopen, conversion, and re-run paths; a hand-skipped '
  'task keeps this null and stays archived.';

notify pgrst, 'reload schema';
