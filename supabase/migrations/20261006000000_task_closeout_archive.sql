-- Tasks stop mattering when the engagement does.
--
-- A matter that closes, or a lead that goes lost or declined, leaves its whole
-- checklist sitting in the firm queue forever. Archiving those rows is the fix,
-- but "archived" already means two other things in this table — a plan row the
-- user skipped as not applicable, and a stage task the engine retired — so an
-- automatic sweep needs a way to say *why* it archived a row.
--
-- `closeout_reason` is that marker, and it is what makes the sweep reversible:
-- reopening a matter or reactivating a lost lead restores exactly the rows the
-- sweep touched and leaves a hand-skipped task skipped.

alter table public.tasks
  add column if not exists closeout_reason text;

alter table public.tasks
  drop constraint if exists tasks_closeout_reason_check;

alter table public.tasks
  add constraint tasks_closeout_reason_check
  check (closeout_reason is null or closeout_reason in (
    'matter_closed',
    'lead_lost',
    'lead_declined'
  ));

comment on column public.tasks.closeout_reason is
  'Set when a task was archived automatically because its matter closed or its '
  'lead went lost/declined. Non-null marks the row as restorable by the reopen '
  'path; a hand-skipped task keeps this null and stays archived.';

-- The restore path reads "every closeout-archived row on this record", so the
-- index only has to cover the marked rows.
create index if not exists tasks_closeout_reason_idx
  on public.tasks (closeout_reason)
  where closeout_reason is not null;

notify pgrst, 'reload schema';
