-- Time entries on matters.
--
-- The ledger knows what was billed and what was paid, but not what the work
-- took. Flat-fee and legal-plan matters are not billed by the hour, yet the
-- firm still wants the hours: they are how it learns which matters pay.
--
-- time_entries holds the time, in whole minutes, one row per piece of work.
-- Entries come from the matter page (a timer, or typed in) and from a daily
-- pass that reads the previous day's matter activity and meetings and offers
-- one entry per matter through the delegation dial
-- (billing.time_entry.create). A suggestion carries suggestion_key, unique,
-- so a re-run or an approval after the fact never records the same day twice.
--
-- time_entry_timers holds at most one running timer per person, so a timer
-- started on the desk is still running on the phone.
--
-- Nothing here touches billing_items: time is recorded, not invoiced.

create table if not exists public.time_entries (
  id              uuid primary key default gen_random_uuid(),
  matter_id       uuid not null references public.matters(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  work_date       date not null,
  minutes         integer not null check (minutes between 1 and 1440),
  description     text not null check (length(description) between 1 and 2000),
  source          text not null default 'manual'
    check (source in ('timer', 'manual', 'suggested')),
  activity_ids    uuid[] not null default '{}',
  suggestion_key  text unique,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists time_entries_matter_idx
  on public.time_entries (matter_id, work_date desc);
create index if not exists time_entries_work_date_idx
  on public.time_entries (work_date);

alter table public.time_entries enable row level security;

drop policy if exists time_entries_staff_all on public.time_entries;
create policy time_entries_staff_all
  on public.time_entries for all to authenticated
  using (exists (select 1 from public.users u
      where u.id = (select auth.uid()) and u.role in ('attorney', 'admin')))
  with check (exists (select 1 from public.users u
      where u.id = (select auth.uid()) and u.role in ('attorney', 'admin')));

grant select, insert, update, delete on public.time_entries to authenticated;
grant all on public.time_entries to service_role;

comment on table public.time_entries is
  'Time recorded on a matter in whole minutes: from the matter page timer, typed in, '
  'or suggested from the activity log through the delegation dial. Not invoiced. '
  'See lib/timeEntries/.';

create table if not exists public.time_entry_timers (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  matter_id    uuid not null references public.matters(id) on delete cascade,
  started_at   timestamptz not null default now(),
  description  text
);

alter table public.time_entry_timers enable row level security;

drop policy if exists time_entry_timers_own on public.time_entry_timers;
create policy time_entry_timers_own
  on public.time_entry_timers for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.time_entry_timers to authenticated;
grant all on public.time_entry_timers to service_role;

comment on table public.time_entry_timers is
  'The one running timer per person; stopping it writes a time_entries row.';

insert into public.automation_rules (
  name, description, trigger_key, action_key, mode, approval_policy,
  system_key, origin, schedule_cron, schedule_timezone, locked
)
values
  ('Time entry suggestions', 'Each morning, reads yesterday''s matter activity and meetings and offers one time entry per matter that had work and no time logged, through the delegation dial.', 'schedule', 'system_job', 'live', 'automatic', 'system:time-entry-suggestions', 'system_schedule', '50 12 * * *', 'UTC', true)
on conflict (system_key) do update set
  name = excluded.name, description = excluded.description, trigger_key = excluded.trigger_key,
  action_key = excluded.action_key, origin = excluded.origin, schedule_cron = excluded.schedule_cron,
  schedule_timezone = excluded.schedule_timezone, locked = excluded.locked;

notify pgrst, 'reload schema';
