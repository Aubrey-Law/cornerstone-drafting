-- Phase 5: aggregate-only evidence for the ten-business-day parallel run and
-- an explicit final cutover stamp. This table intentionally stores no work
-- keys, client identifiers, titles, message content, or legal facts.

alter table public.firm_settings
  add column command_center_cutover_at timestamptz,
  add column command_center_cutover_by uuid references auth.users(id) on delete set null;

comment on column public.firm_settings.command_center_cutover_at is
  'Final Command Center cutover after the ten-business-day parity gate passes.';

create table public.command_center_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  firm_date date not null,
  command_center_open_count integer not null default 0 check (command_center_open_count >= 0),
  legacy_today_open_count integer not null default 0 check (legacy_today_open_count >= 0),
  plan_generated_count integer not null default 0 check (plan_generated_count >= 0),
  plan_replanned_count integer not null default 0 check (plan_replanned_count >= 0),
  plan_committed_count integer not null default 0 check (plan_committed_count >= 0),
  plan_closed_count integer not null default 0 check (plan_closed_count >= 0),
  work_started_count integer not null default 0 check (work_started_count >= 0),
  work_completed_count integer not null default 0 check (work_completed_count >= 0),
  work_snoozed_count integer not null default 0 check (work_snoozed_count >= 0),
  work_blocked_count integer not null default 0 check (work_blocked_count >= 0),
  planning_seconds integer check (planning_seconds between 0 and 86400),
  first_choice_seconds integer check (first_choice_seconds between 0 and 86400),
  first_opened_at timestamptz,
  last_event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, firm_date)
);

create index command_center_usage_recent_idx
  on public.command_center_usage_daily (firm_date desc, user_id);

comment on table public.command_center_usage_daily is
  'Aggregate daily Command Center adoption and outcome counts only; contains no client content or work identifiers.';

alter table public.command_center_usage_daily enable row level security;
revoke all on table public.command_center_usage_daily from public, anon, authenticated;
grant select on table public.command_center_usage_daily to authenticated;
grant all on table public.command_center_usage_daily to service_role;

create policy command_center_usage_staff_select
on public.command_center_usage_daily
for select to authenticated
using (exists (
  select 1 from public.users u
  where u.id = (select auth.uid()) and u.role in ('admin', 'attorney')
));

create or replace function public.record_command_center_usage(
  p_user_id uuid,
  p_firm_date date,
  p_event text,
  p_duration_seconds integer default null
)
returns public.command_center_usage_daily
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.command_center_usage_daily%rowtype;
begin
  if p_user_id is null or p_firm_date is null then
    raise exception using errcode = '22023', message = 'User and firm date are required';
  end if;
  if p_event not in (
    'command_center_opened', 'legacy_today_opened',
    'plan_generated', 'plan_replanned', 'plan_committed', 'plan_closed',
    'work_started', 'work_completed', 'work_snoozed', 'work_blocked'
  ) then
    raise exception using errcode = '22023', message = 'Unsupported Command Center usage event';
  end if;
  if p_duration_seconds is not null and (p_duration_seconds < 0 or p_duration_seconds > 86400) then
    raise exception using errcode = '22023', message = 'Duration is outside the allowed range';
  end if;

  insert into public.command_center_usage_daily (user_id, firm_date)
  values (p_user_id, p_firm_date)
  on conflict (user_id, firm_date) do nothing;

  update public.command_center_usage_daily
  set command_center_open_count = command_center_open_count + case when p_event = 'command_center_opened' then 1 else 0 end,
      legacy_today_open_count = legacy_today_open_count + case when p_event = 'legacy_today_opened' then 1 else 0 end,
      plan_generated_count = plan_generated_count + case when p_event = 'plan_generated' then 1 else 0 end,
      plan_replanned_count = plan_replanned_count + case when p_event = 'plan_replanned' then 1 else 0 end,
      plan_committed_count = plan_committed_count + case when p_event = 'plan_committed' then 1 else 0 end,
      plan_closed_count = plan_closed_count + case when p_event = 'plan_closed' then 1 else 0 end,
      work_started_count = work_started_count + case when p_event = 'work_started' then 1 else 0 end,
      work_completed_count = work_completed_count + case when p_event = 'work_completed' then 1 else 0 end,
      work_snoozed_count = work_snoozed_count + case when p_event = 'work_snoozed' then 1 else 0 end,
      work_blocked_count = work_blocked_count + case when p_event = 'work_blocked' then 1 else 0 end,
      planning_seconds = case
        when p_event = 'plan_committed' and p_duration_seconds is not null
          then coalesce(planning_seconds, p_duration_seconds)
        else planning_seconds
      end,
      first_choice_seconds = case
        when p_event = 'work_started' and p_duration_seconds is not null
          then coalesce(first_choice_seconds, p_duration_seconds)
        else first_choice_seconds
      end,
      first_opened_at = case
        when p_event = 'command_center_opened' then coalesce(first_opened_at, clock_timestamp())
        else first_opened_at
      end,
      last_event_at = clock_timestamp()
  where user_id = p_user_id and firm_date = p_firm_date
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.record_command_center_usage(uuid, date, text, integer)
  from public, anon, authenticated;
grant execute on function public.record_command_center_usage(uuid, date, text, integer)
  to service_role;

notify pgrst, 'reload schema';
