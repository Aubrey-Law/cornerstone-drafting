-- A task's working due date, as a column the database can sort on.
--
-- `effectiveDueAt()` in lib/tasks/types.ts reads due_at, then soft_due_at, then
-- hard_due_at, and every grouping and sort in the app runs off that one value.
-- The database could not: PostgREST orders by columns, not expressions, so
-- every capped task read returned an arbitrary slice rather than the most
-- urgent rows. On 2026-08-24 that meant the Today queue showed 1 of the firm's
-- 27 overdue tasks (docs/architecture-review-leads-crm.md §6a).
--
-- The due-window reads were already fixed by filtering on the three columns in
-- precedence order. This is what the remaining two reads need — the CRM Tasks
-- card and the stage-task read both want "the most urgent N", which is an
-- ordering question, not a filtering one.
--
-- Stored rather than virtual: the sort has to be indexable, and `coalesce` over
-- three columns of the same type is immutable, which a generated column
-- requires.

alter table public.tasks
  add column if not exists effective_due_at timestamptz
    generated always as (coalesce(due_at, soft_due_at, hard_due_at)) stored;

comment on column public.tasks.effective_due_at is
  'Working due date: coalesce(due_at, soft_due_at, hard_due_at). Mirrors effectiveDueAt() in lib/tasks/types.ts — tests/task-effective-due-parity.test.ts holds the two together.';

-- Leading on `owner` rather than `status`, which is what the reads actually do:
-- every queue read fixes owner ('firm' — a client's "sign the engagement" task
-- is not the attorney's work) and takes a *range* of statuses, and a leading
-- column under an inequality cannot order the rows behind it. With owner fixed
-- the index returns effective_due_at already sorted, which is the whole point
-- of having the column.
create index if not exists tasks_open_effective_due
  on public.tasks (owner, effective_due_at)
  where status <> 'done';

-- 20260729132012_unified_tasks.sql created this for exactly this sort, written
-- as `(status, (coalesce(due_at, soft_due_at, hard_due_at)))`. Nothing queries
-- the expression form any more.
drop index if exists tasks_open_due;
