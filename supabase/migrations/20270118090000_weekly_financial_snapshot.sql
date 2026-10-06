-- Weekly financial snapshot from the ledger.
--
-- The firm's money was only ever read live, on the Billing page, by whoever
-- opened it. Nothing came to the attorney on its own, and nothing remembered
-- last week, so "are we ahead or behind" meant opening the page and
-- guessing. Each Monday morning a run now reads the ledger for the week just
-- ended (Monday to Sunday), stores one row here, compares it with the week
-- before, and emails the firm the figures that matter: collected, billed,
-- costs, what is outstanding and overdue, the aging buckets, plan claims, and
-- year-to-date against the annual goal and the pace that goal implies.
--
-- One row per week; the unique key makes a second run on the same Monday an
-- update, not a second email. Aggregates only: no client names or amounts per
-- matter live here (the ledger has those).

create table if not exists public.billing_weekly_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  week_start            date not null unique,
  week_end              date not null,
  collected_cents       integer not null default 0 check (collected_cents >= 0),
  payment_count         integer not null default 0 check (payment_count >= 0),
  billed_cents          integer not null default 0 check (billed_cents >= 0),
  costs_cents           integer not null default 0 check (costs_cents >= 0),
  outstanding_cents     integer not null default 0 check (outstanding_cents >= 0),
  open_count            integer not null default 0 check (open_count >= 0),
  overdue_cents         integer not null default 0 check (overdue_cents >= 0),
  overdue_count         integer not null default 0 check (overdue_count >= 0),
  ytd_collected_cents   integer not null default 0 check (ytd_collected_cents >= 0),
  goal_cents            integer not null default 0 check (goal_cents >= 0),
  -- The whole snapshot as computed (aging, claims, pace, the prior week's
  -- collections), so the page and the email read the same figures.
  metrics               jsonb not null default '{}'::jsonb,
  email_status          text check (email_status in ('sent', 'redirected', 'suppressed', 'logged', 'error')),
  sent_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists billing_weekly_snapshots_week_idx
  on public.billing_weekly_snapshots (week_start desc);

comment on table public.billing_weekly_snapshots is
  'One row per Monday-to-Sunday week: the ledger''s headline figures as of the Monday after, '
  'compared week over week and emailed to the firm. Aggregates only. See lib/billing/weeklySnapshot.ts.';

alter table public.billing_weekly_snapshots enable row level security;
revoke all on table public.billing_weekly_snapshots from public, anon, authenticated;
grant select on table public.billing_weekly_snapshots to authenticated;
grant all on table public.billing_weekly_snapshots to service_role;

drop policy if exists billing_weekly_snapshots_staff_select on public.billing_weekly_snapshots;
create policy billing_weekly_snapshots_staff_select
  on public.billing_weekly_snapshots for select to authenticated
  using (exists (
    select 1 from public.users u
    where u.id = (select auth.uid()) and u.role in ('admin', 'attorney')
  ));

-- The Monday run, on the automation center's control.
insert into public.automation_rules (
  name, description, trigger_key, action_key, mode, approval_policy,
  system_key, origin, schedule_cron, schedule_timezone, locked
)
values
  ('Weekly financial snapshot', 'Each Monday morning, reads the ledger for the week just ended, stores the figures, compares them with the week before, and emails the firm: collected, billed, costs, outstanding and overdue, aging, plan claims, and year-to-date against the annual goal.', 'schedule', 'system_job', 'live', 'automatic', 'system:weekly-financial-snapshot', 'system_schedule', '10 12 * * 1', 'UTC', true)
on conflict (system_key) do update set
  name = excluded.name,
  description = excluded.description,
  trigger_key = excluded.trigger_key,
  action_key = excluded.action_key,
  origin = excluded.origin,
  schedule_cron = excluded.schedule_cron,
  schedule_timezone = excluded.schedule_timezone,
  locked = excluded.locked;

notify pgrst, 'reload schema';
