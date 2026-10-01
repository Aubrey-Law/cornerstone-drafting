-- Phase 4: one operational control plane for deployment schedules and
-- allowlisted firm rules.  A run records identifiers and bounded summaries,
-- never message bodies or client legal facts.

alter table public.automation_rules
  add column origin text not null default 'custom_rule'
    check (origin in ('system_schedule', 'rule_template', 'custom_rule')),
  add column schedule_cron text,
  add column schedule_timezone text not null default 'UTC',
  add column next_run_at timestamptz,
  add column last_started_at timestamptz,
  add column last_success_at timestamptz,
  add column last_failure_at timestamptz,
  add column consecutive_failures integer not null default 0
    check (consecutive_failures between 0 and 1000000),
  add column max_attempts integer not null default 3
    check (max_attempts between 1 and 20),
  add column kill_switch boolean not null default false,
  add column locked boolean not null default false;

-- Rule mutations are mediated by authenticated staff APIs using the service
-- role. Direct browser writes would bypass allowlist and risk validation.
revoke insert, update, delete on table public.automation_rules from authenticated;
grant select on table public.automation_rules to authenticated;

-- Phase 0 used system_key for the bundled templates. Prefix those keys so the
-- deployment-managed schedules can use the same registry without collisions.
update public.automation_rules
set system_key = 'template:' || system_key,
    origin = 'rule_template'
where system_key is not null and system_key not like 'template:%';

alter table public.automation_runs
  drop constraint if exists automation_runs_status_check;

alter table public.automation_runs
  add constraint automation_runs_status_check
    check (status in ('running', 'dry_run', 'succeeded', 'failed', 'cancelled', 'skipped')),
  add column trigger_key text,
  add column actor_id uuid references auth.users(id) on delete set null,
  add column lease_expires_at timestamptz,
  add column retry_of uuid references public.automation_runs(id) on delete set null,
  add column retry_requested_at timestamptz,
  add column output jsonb not null default '{}'::jsonb,
  add column proposed_action_keys text[] not null default '{}',
  add column executed_action_keys text[] not null default '{}';

create index automation_runs_retry_due_idx
  on public.automation_runs (next_retry_at)
  where status = 'failed' and next_retry_at is not null;

create index automation_runs_active_lease_idx
  on public.automation_runs (rule_id, lease_expires_at)
  where status = 'running';

alter table public.action_proposals
  add column automation_run_id uuid references public.automation_runs(id) on delete set null;

alter table public.action_executions
  add column automation_run_id uuid references public.automation_runs(id) on delete set null;

create index action_proposals_automation_run_idx
  on public.action_proposals (automation_run_id, created_at desc)
  where automation_run_id is not null;

create index action_executions_automation_run_idx
  on public.action_executions (automation_run_id, started_at desc)
  where automation_run_id is not null;

insert into public.automation_rules (
  name, description, trigger_key, action_key, mode, approval_policy,
  system_key, origin, schedule_cron, schedule_timezone, locked
)
values
  ('Command center shadow audit', 'Reconciles the canonical work graph against legacy queues.', 'schedule', 'system_job', 'live', 'automatic', 'system:work-graph-shadow', 'system_schedule', '45 11 * * 1-5', 'UTC', true),
  ('Daily digest', 'Builds and sends the deterministic weekday work digest.', 'schedule', 'system_job', 'live', 'automatic', 'system:daily-digest', 'system_schedule', '0 12 * * 1-5', 'UTC', true),
  ('SLA task nudges', 'Prepares or sends due SLA task nudges under existing policy.', 'schedule', 'system_job', 'live', 'automatic', 'system:sla-task-nudges', 'system_schedule', '0 12 * * 1-5', 'UTC', true),
  ('Appointment reminders', 'Sends configured appointment reminders.', 'schedule', 'system_job', 'live', 'automatic', 'system:appointment-reminders', 'system_schedule', '0 * * * *', 'UTC', true),
  ('Calendar week review', 'Produces the weekly calendar review.', 'schedule', 'system_job', 'live', 'automatic', 'system:calendar-week-review', 'system_schedule', '0 * * * 0', 'UTC', true),
  ('Scheduled emails', 'Delivers previously approved scheduled email.', 'schedule', 'system_job', 'live', 'automatic', 'system:scheduled-emails', 'system_schedule', '* * * * *', 'UTC', true),
  ('Workflow run queue', 'Processes the drafting and review run queue.', 'schedule', 'system_job', 'live', 'automatic', 'system:run-queue', 'system_schedule', '* * * * *', 'UTC', true),
  ('Durable workflow jobs', 'Claims and processes durable workflow jobs.', 'schedule', 'system_job', 'live', 'automatic', 'system:workflow-jobs', 'system_schedule', '*/5 * * * *', 'UTC', true),
  ('Invoice reminders', 'Prepares invoice reminders for approval.', 'schedule', 'system_job', 'live', 'automatic', 'system:invoice-reminders', 'system_schedule', '15 * * * *', 'UTC', true),
  ('Email triage', 'Scans the mailbox for client and lead mail needing attention.', 'schedule', 'system_job', 'live', 'automatic', 'system:email-triage', 'system_schedule', '30 11 * * 1-5,15 12 * * 1-5', 'UTC', true),
  ('E-sign reconciliation', 'Reconciles in-flight engagement agreements.', 'schedule', 'system_job', 'live', 'automatic', 'system:esign-reconcile', 'system_schedule', '*/10 * * * *', 'UTC', true),
  ('Lawmatics calendar sync', 'Reconciles appointment changes from Lawmatics.', 'schedule', 'system_job', 'live', 'automatic', 'system:lawmatics-calendar', 'system_schedule', '*/10 * * * *', 'UTC', true),
  ('Rule automation runner', 'Evaluates explicitly enabled allowlisted firm rules.', 'schedule', 'system_job', 'live', 'automatic', 'system:automation-rules', 'system_schedule', '*/5 * * * *', 'UTC', true)
on conflict (system_key) do update set
  name = excluded.name,
  description = excluded.description,
  trigger_key = excluded.trigger_key,
  action_key = excluded.action_key,
  origin = excluded.origin,
  schedule_cron = excluded.schedule_cron,
  schedule_timezone = excluded.schedule_timezone,
  locked = excluded.locked;

create or replace function public.prevent_locked_automation_rule_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.locked and (
    new.id is distinct from old.id
    or new.name is distinct from old.name
    or new.description is distinct from old.description
    or new.trigger_key is distinct from old.trigger_key
    or new.action_key is distinct from old.action_key
    or new.conditions is distinct from old.conditions
    or new.action_config is distinct from old.action_config
    or new.approval_policy is distinct from old.approval_policy
    or new.system_key is distinct from old.system_key
    or new.origin is distinct from old.origin
    or new.schedule_cron is distinct from old.schedule_cron
    or new.schedule_timezone is distinct from old.schedule_timezone
    or new.locked is distinct from old.locked
  ) then
    raise exception using errcode = '22023', message = 'System automation identity is locked';
  end if;
  return new;
end;
$$;

create trigger protect_locked_automation_rule_identity
before update on public.automation_rules
for each row execute function public.prevent_locked_automation_rule_identity_change();

revoke all on function public.prevent_locked_automation_rule_identity_change() from public, anon, authenticated;

create or replace function public.claim_automation_run(
  p_rule_id uuid,
  p_idempotency_key text,
  p_status text default 'running',
  p_actor_id uuid default null,
  p_retry_of uuid default null,
  p_lease_seconds integer default 300
)
returns table(run_id uuid, run_status text, duplicate boolean, claim_reason text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rule public.automation_rules%rowtype;
  v_existing public.automation_runs%rowtype;
  v_run public.automation_runs%rowtype;
begin
  if p_status not in ('running', 'dry_run') then
    raise exception using errcode = '22023', message = 'Invalid automation run status';
  end if;

  select * into v_rule
  from public.automation_rules
  where id = p_rule_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Automation rule not found';
  end if;

  select * into v_existing
  from public.automation_runs
  where idempotency_key = p_idempotency_key;

  if found then
    return query select v_existing.id, v_existing.status, true, 'duplicate'::text;
    return;
  end if;

  if p_status = 'running' and (v_rule.kill_switch or v_rule.mode = 'paused') then
    return query select null::uuid, 'skipped'::text, false, 'paused'::text;
    return;
  end if;

  if p_status = 'running' and v_rule.mode <> 'live' then
    return query select null::uuid, 'skipped'::text, false, 'not_live'::text;
    return;
  end if;

  update public.automation_runs
  set status = 'failed',
      finished_at = clock_timestamp(),
      lease_expires_at = null,
      error_code = 'lease_expired',
      error_summary = 'The previous run did not finish before its lease expired',
      next_retry_at = clock_timestamp()
  where rule_id = p_rule_id
    and status = 'running'
    and lease_expires_at <= clock_timestamp();

  select * into v_existing
  from public.automation_runs
  where rule_id = p_rule_id
    and status = 'running'
    and lease_expires_at > clock_timestamp()
  order by started_at desc
  limit 1;

  if found then
    return query select v_existing.id, v_existing.status, true, 'busy'::text;
    return;
  end if;

  insert into public.automation_runs (
    rule_id, system_key, status, idempotency_key, actor_id, retry_of,
    attempt, trigger_key, lease_expires_at
  ) values (
    v_rule.id, v_rule.system_key, p_status, p_idempotency_key, p_actor_id, p_retry_of,
    case when p_retry_of is null then 1 else coalesce((select attempt + 1 from public.automation_runs where id = p_retry_of), 2) end,
    v_rule.trigger_key,
    case when p_status = 'running' then clock_timestamp() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600))) else null end
  ) returning * into v_run;

  if p_retry_of is not null then
    update public.automation_runs
    set retry_requested_at = coalesce(retry_requested_at, clock_timestamp())
    where id = p_retry_of and status = 'failed';
  end if;

  update public.automation_rules
  set last_started_at = clock_timestamp()
  where id = v_rule.id;

  return query select v_run.id, v_run.status, false, 'claimed'::text;
end;
$$;

create or replace function public.finish_automation_run(
  p_run_id uuid,
  p_status text,
  p_proposed_count integer default 0,
  p_executed_count integer default 0,
  p_output jsonb default '{}'::jsonb,
  p_proposed_action_keys text[] default '{}',
  p_executed_action_keys text[] default '{}',
  p_error_code text default null,
  p_error_summary text default null,
  p_next_retry_at timestamptz default null
)
returns public.automation_runs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.automation_runs%rowtype;
begin
  if p_status not in ('dry_run', 'succeeded', 'failed', 'cancelled', 'skipped') then
    raise exception using errcode = '22023', message = 'Invalid terminal automation status';
  end if;

  update public.automation_runs
  set status = p_status,
      finished_at = clock_timestamp(),
      lease_expires_at = null,
      proposed_count = greatest(0, p_proposed_count),
      executed_count = greatest(0, p_executed_count),
      output = coalesce(p_output, '{}'::jsonb),
      proposed_action_keys = coalesce(p_proposed_action_keys, '{}'),
      executed_action_keys = coalesce(p_executed_action_keys, '{}'),
      error_code = p_error_code,
      error_summary = left(p_error_summary, 500),
      next_retry_at = p_next_retry_at
  where id = p_run_id and status in ('running', 'dry_run')
  returning * into v_run;

  if not found then
    select * into v_run from public.automation_runs where id = p_run_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'Automation run not found';
    end if;
    return v_run;
  end if;

  update public.automation_rules
  set last_success_at = case when p_status = 'succeeded' then clock_timestamp() else last_success_at end,
      last_failure_at = case when p_status = 'failed' then clock_timestamp() else last_failure_at end,
      consecutive_failures = case when p_status = 'failed' then consecutive_failures + 1 else 0 end,
      next_run_at = case when p_status = 'failed' and p_next_retry_at is not null then p_next_retry_at else next_run_at end
  where id = v_run.rule_id;

  return v_run;
end;
$$;

-- Keep the Phase 3 claim RPC unchanged. A narrow invoker trigger copies the
-- run link onto its immutable execution row inside the same transaction.
create or replace function public.populate_action_execution_automation_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.automation_run_id is null and new.proposal_id is not null then
    select proposal.automation_run_id into new.automation_run_id
    from public.action_proposals proposal
    where proposal.id = new.proposal_id;
  end if;
  return new;
end;
$$;

create trigger populate_action_execution_automation_run
before insert on public.action_executions
for each row execute function public.populate_action_execution_automation_run();

revoke all on function public.populate_action_execution_automation_run() from public, anon, authenticated;

revoke all on function public.claim_automation_run(uuid, text, text, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.finish_automation_run(uuid, text, integer, integer, jsonb, text[], text[], text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_automation_run(uuid, text, text, uuid, uuid, integer) to service_role;
grant execute on function public.finish_automation_run(uuid, text, integer, integer, jsonb, text[], text[], text, text, timestamptz) to service_role;

comment on column public.automation_rules.kill_switch is
  'Immediate per-rule stop. Claiming refuses both scheduled and manual live runs while enabled.';
comment on column public.automation_runs.output is
  'Bounded operational summary only; message bodies and legal facts are prohibited.';
comment on function public.claim_automation_run(uuid, text, text, uuid, uuid, integer) is
  'Atomically enforces pause state, duplicate suppression, stale-lease recovery, and one active run per rule.';
