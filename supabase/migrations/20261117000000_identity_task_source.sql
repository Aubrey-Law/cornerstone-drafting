-- A fourth automatic task source: the matter-name check.
--
-- `tasks_source_check` enumerates its values, so the database rejects a new
-- source until it is named here. Same shape as
-- 20261105000000_fiduciary_task_source.sql, which added 'fiduciary', and
-- 20261029000000, which added 'prompt'.
--
-- Its own closeout reason, for the reason 'fiduciary' needed one:
-- 'prompt_superseded' says a prompt run withdrew the finding, and no prompt run
-- ever created an identity task. Reusing it would put a claim in the record
-- that is untrue, and `closeout_reason` is read by the reopen and conversion
-- paths as well as by a person asking why a task closed. 'identity_resolved'
-- says what actually happened: the two names now agree.
--
-- What this is for: a matter filed as "Can Cheng — Estate Planning" whose
-- design sheet drafts for "Jie Cheng", with the sheet's own notes calling it an
-- unresolved identity discrepancy. A document generated from client_name would
-- carry the wrong name and nothing noticed. The design-sheet audit cannot
-- notice -- "these two names may be one person" is not one of its outcomes, and
-- two runs answered it two different ways -- so the check is deterministic code
-- rather than a seventh prompt check.

alter table public.tasks
  drop constraint if exists tasks_source_check;

alter table public.tasks
  add constraint tasks_source_check
  check (source in ('manual', 'stage', 'template', 'cadence', 'sla', 'prompt', 'fiduciary', 'identity'));

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
    'fiduciary_superseded',
    'identity_resolved'
  ));

comment on column public.tasks.source is
  'What created this task: a person (manual), the stage engine (stage), a '
  'template or cadence, the SLA plan (sla), a prompt run (prompt), the '
  'fiduciary matrix (fiduciary), or the matter-name check (identity).';

comment on column public.tasks.closeout_reason is
  'Set when a task was archived automatically: its matter closed, its lead '
  'went lost/declined, it is post-engagement work on a lead that has not '
  'converted (not_engaged), a newer prompt run superseded the finding that '
  'created it (prompt_superseded), the fiduciary sweep found the gap it '
  'reported was filled (fiduciary_superseded), or the name check found the '
  'two names now agree (identity_resolved).';

notify pgrst, 'reload schema';
