-- Probate deadlines from rules the attorney confirms.
--
-- A probate matter runs on statutory clocks that start from facts on the
-- record. Until now each due date (claims period, inventory, M-706, 706) was
-- worked out by hand and typed into the matter. probate_deadline_rules holds
-- each clock once: an anchor date, an offset, an optional condition, and the
-- matter date field it keeps filled. lib/probateDeadlines computes every
-- probate matter's dates from the confirmed rules and writes one task per rule
-- (tasks.source = 'deadline').
--
-- The four seed rules below are drafts. They compute nothing until the
-- attorney checks the period against the citation and confirms it in
-- Settings -> Workflow -> Probate deadlines; changing a confirmed rule's
-- timing returns it to draft.

-- Two anchors the record could not hold before.
alter table public.matter_details
  add column if not exists pb_letters_issued_date date,
  add column if not exists pb_petition_filed_date date;

create table if not exists public.probate_deadline_rules (
  key            text primary key check (key ~ '^[a-z0-9_]{1,64}$'),
  title          text not null check (length(title) between 1 and 200),
  description    text,
  anchor         text not null
    check (anchor in ('date_of_death', 'appointment_date', 'letters_issued_date', 'petition_filed_date')),
  offset_months  integer not null default 0 check (offset_months between 0 and 120),
  offset_days    integer not null default 0 check (offset_days between -366 and 3660),
  applies_when   text not null default 'always'
    check (applies_when in ('always', 'federal_estate_tax', 'state_estate_tax')),
  roll_weekend   boolean not null default false,
  target_field   text
    check (target_field is null or target_field in (
      'pb_claims_period_end_date', 'pb_inventory_due_date', 'pb_m706_due_date',
      'pb_706_due_date', 'pb_fiduciary_return_due_date')),
  citation       text,
  active         boolean not null default true,
  confirmed_at   timestamptz,
  confirmed_by   uuid references auth.users(id) on delete set null,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.probate_deadline_rules enable row level security;

drop policy if exists probate_deadline_rules_staff_select on public.probate_deadline_rules;
create policy probate_deadline_rules_staff_select
  on public.probate_deadline_rules for select to authenticated
  using (exists (select 1 from public.users u
      where u.id = (select auth.uid()) and u.role in ('attorney', 'admin')));

grant select on public.probate_deadline_rules to authenticated;
grant all on public.probate_deadline_rules to service_role;

comment on table public.probate_deadline_rules is
  'Probate deadline rules the attorney authors and confirms: anchor date plus offset. '
  'Unconfirmed rules compute nothing. See lib/probateDeadlines/.';

insert into public.probate_deadline_rules
  (key, title, description, anchor, offset_months, offset_days, applies_when, roll_weekend, target_field, citation, sort_order)
values
  ('creditor_claims_period', 'Creditor claims period ends',
   'Claims against the estate not presented by this date are barred. Check pending claims and any notice given before it passes.',
   'date_of_death', 12, 0, 'always', false, 'pb_claims_period_end_date',
   'M.G.L. c. 190B, section 3-803(a): one year after the date of death. Confirm before relying on it.', 10),
  ('inventory_due', 'Inventory due',
   'The personal representative prepares the inventory of the estate.',
   'appointment_date', 3, 0, 'always', false, 'pb_inventory_due_date',
   'M.G.L. c. 190B, section 3-706: within three months after appointment. Confirm before relying on it.', 20),
  ('m706_due', 'Massachusetts estate tax return (M-706) due',
   'File the M-706 and pay the tax, or file for an extension.',
   'date_of_death', 9, 0, 'state_estate_tax', true, 'pb_m706_due_date',
   'M.G.L. c. 65C, section 14: nine months after the date of death. Confirm before relying on it.', 30),
  ('federal_706_due', 'Federal estate tax return (Form 706) due',
   'File Form 706 and pay the tax, or file Form 4768 for an extension.',
   'date_of_death', 9, 0, 'federal_estate_tax', true, 'pb_706_due_date',
   'IRC section 6075(a) and 7503: nine months after the date of death, next business day if it falls on a weekend. Confirm before relying on it.', 40)
on conflict (key) do nothing;

-- Deadline tasks are a fifth automatic task source.
alter table public.tasks
  drop constraint if exists tasks_source_check;

alter table public.tasks
  add constraint tasks_source_check
  check (source in ('manual', 'stage', 'template', 'cadence', 'sla', 'prompt', 'fiduciary', 'identity', 'deadline'));

comment on column public.tasks.source is
  'What created this task: a person (manual), the stage engine (stage), a '
  'template or cadence, the SLA plan (sla), a prompt run (prompt), the '
  'fiduciary matrix (fiduciary), the matter-name check (identity), or a '
  'confirmed probate deadline rule (deadline).';

notify pgrst, 'reload schema';
