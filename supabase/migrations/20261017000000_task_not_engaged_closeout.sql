-- A lead's checklist holds back the work nobody has bought yet.
--
-- `ensureLeadSlaTasks` generates the whole estate-planning template the day a
-- lead is created — 48 tasks, of which 11 are pre-engagement. The other 37 are
-- drafting, signing, funding and post-execution work for a plan that has not
-- been sold. Measured on 2026-08-24: 39 lead matters carried 1,021 of the
-- firm's 1,024 open tasks, 709 of them post-engagement, and 24 leads were
-- carrying post-execution tasks. That is what filled the Today queue and the
-- Tasks page with work no one could do.
--
-- Rather than generate less and reconcile at conversion, the plan is still
-- generated whole and the post-engagement half is archived behind a closeout
-- reason. 20261006000000 already built that mechanism for a matter that closes
-- and a lead that goes lost: `closeout_reason` marks the rows a sweep archived,
-- so the reopen path restores exactly those and leaves a hand-skipped task
-- skipped. Conversion is the same shape of event, so it reuses the same
-- machinery instead of growing a second one — and the dated plan stays whole,
-- which is what the Plan view reads.

alter table public.tasks
  drop constraint if exists tasks_closeout_reason_check;

alter table public.tasks
  add constraint tasks_closeout_reason_check
  check (closeout_reason is null or closeout_reason in (
    'matter_closed',
    'lead_lost',
    'lead_declined',
    'not_engaged'
  ));

comment on column public.tasks.closeout_reason is
  'Set when a task was archived automatically: its matter closed, its lead went '
  'lost/declined, or it is post-engagement work on a lead that has not converted '
  '(not_engaged). Non-null marks the row as restorable by the reopen and '
  'conversion paths; a hand-skipped task keeps this null and stays archived.';

notify pgrst, 'reload schema';
