-- Cornerstone operating system foundation.
--
-- Work items themselves remain a read model over the existing operational
-- tables.  These tables persist only a user's preferences and decisions, a
-- dated plan, and the audit/control state needed by later action and
-- automation phases.

alter table public.firm_settings
  add column if not exists command_center_v2_enabled boolean not null default false;

comment on column public.firm_settings.command_center_v2_enabled is
  'Use the canonical work graph and ADHD-focused Daily Command Center on /admin.';

create table public.user_work_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  max_must_do integer not null default 3 check (max_must_do between 1 and 10),
  focus_capacity_minutes integer not null default 240
    check (focus_capacity_minutes between 30 and 720),
  interruption_buffer_percent integer not null default 20
    check (interruption_buffer_percent between 0 and 60),
  focus_block_minutes integer not null default 50
    check (focus_block_minutes between 15 and 120),
  max_focus_block_minutes integer not null default 60
    check (max_focus_block_minutes between 15 and 180),
  admin_batch_minutes integer not null default 30
    check (admin_batch_minutes in (15, 30)),
  workday_start time not null default '09:00',
  workday_end time not null default '17:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (workday_end > workday_start),
  check (focus_block_minutes <= max_focus_block_minutes)
);

create trigger set_updated_at_user_work_preferences
before update on public.user_work_preferences
for each row execute function public.set_updated_at();

create table public.work_item_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_key text not null check (length(btrim(work_key)) between 3 and 300),
  state text not null default 'open'
    check (state in ('open', 'blocked', 'waiting', 'snoozed')),
  snoozed_until timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_key),
  check (state = 'snoozed' or snoozed_until is null)
);

create index work_item_overrides_active_idx
  on public.work_item_overrides (user_id, state, snoozed_until);

create trigger set_updated_at_work_item_overrides
before update on public.work_item_overrides
for each row execute function public.set_updated_at();

create table public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'committed', 'closed')),
  capacity_minutes integer not null check (capacity_minutes between 0 and 720),
  planned_minutes integer not null default 0 check (planned_minutes between 0 and 1440),
  interruption_buffer_percent integer not null default 20
    check (interruption_buffer_percent between 0 and 60),
  generated_at timestamptz not null default now(),
  committed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plan_date)
);

create index daily_plans_user_recent_idx
  on public.daily_plans (user_id, plan_date desc);

create trigger set_updated_at_daily_plans
before update on public.daily_plans
for each row execute function public.set_updated_at();

create table public.daily_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.daily_plans(id) on delete cascade,
  work_key text not null check (length(btrim(work_key)) between 3 and 300),
  source_type text not null,
  record_type text not null check (record_type in ('lead', 'matter', 'firm')),
  record_id uuid,
  lane text not null
    check (lane in ('now', 'must_do', 'suggested', 'communication', 'later')),
  position integer not null check (position >= 0),
  estimate_minutes integer not null check (estimate_minutes between 1 and 720),
  priority_band integer not null check (priority_band between 0 and 4),
  reason_codes text[] not null default '{}',
  block_start timestamptz,
  block_end timestamptz,
  status text not null default 'planned'
    check (status in ('planned', 'started', 'completed', 'skipped')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, work_key),
  unique (plan_id, position),
  check (
    (block_start is null and block_end is null)
    or (block_start is not null and block_end is not null and block_end > block_start)
  )
);

create index daily_plan_items_plan_lane_idx
  on public.daily_plan_items (plan_id, lane, position);

create trigger set_updated_at_daily_plan_items
before update on public.daily_plan_items
for each row execute function public.set_updated_at();

create table public.action_proposals (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  action_key text not null check (length(btrim(action_key)) between 3 and 120),
  risk text not null
    check (risk in ('read', 'prepare', 'internal_write', 'external_write', 'legal_financial', 'prohibited')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired', 'executed', 'failed')),
  record_type text check (record_type in ('lead', 'matter', 'firm')),
  record_id uuid,
  -- References and non-sensitive parameters only. Message bodies and legal
  -- facts stay in their authoritative feature tables.
  reference_payload jsonb not null default '{}'::jsonb,
  display_summary text not null check (length(btrim(display_summary)) > 0),
  idempotency_key text not null unique,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  accepted_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index action_proposals_actor_pending_idx
  on public.action_proposals (actor_id, created_at desc)
  where status = 'pending';

create trigger set_updated_at_action_proposals
before update on public.action_proposals
for each row execute function public.set_updated_at();

create table public.action_executions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.action_proposals(id) on delete set null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action_key text not null,
  risk text not null
    check (risk in ('read', 'prepare', 'internal_write', 'external_write', 'legal_financial')),
  status text not null check (status in ('succeeded', 'failed')),
  idempotency_key text not null unique,
  record_type text check (record_type in ('lead', 'matter', 'firm')),
  record_id uuid,
  before_digest text,
  after_digest text,
  error_code text,
  error_summary text,
  created_at timestamptz not null default now()
);

create index action_executions_record_idx
  on public.action_executions (record_type, record_id, created_at desc);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text,
  trigger_key text not null,
  action_key text not null,
  conditions jsonb not null default '{}'::jsonb,
  action_config jsonb not null default '{}'::jsonb,
  mode text not null default 'dry_run' check (mode in ('dry_run', 'live', 'paused')),
  approval_policy text not null default 'required'
    check (approval_policy in ('automatic', 'required', 'prohibited')),
  system_key text unique,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at_automation_rules
before update on public.automation_rules
for each row execute function public.set_updated_at();

insert into public.automation_rules
  (name, description, trigger_key, action_key, mode, approval_policy, system_key)
values
  ('New lead intake', 'Create intake and follow-up work and prepare the intake message.', 'lead_created', 'create_task', 'paused', 'automatic', 'new-lead-intake'),
  ('Appointment preparation', 'Build preparation work and identify missing information.', 'appointment_booked', 'create_task', 'paused', 'automatic', 'appointment-preparation'),
  ('Overdue intake reminder', 'Prepare the correct reminder without sending it.', 'intake_overdue', 'draft_message', 'paused', 'automatic', 'overdue-intake'),
  ('Engagement onboarding', 'Propose conversion and onboarding work after signature.', 'engagement_signed', 'enqueue_workflow', 'paused', 'required', 'engagement-onboarding'),
  ('Stage entry checklist', 'Seed the allowlisted checklist for the entered stage.', 'stage_entered', 'create_task', 'paused', 'automatic', 'stage-entry'),
  ('Stale lead follow-up', 'Prepare a follow-up for stale open leads.', 'lead_stale', 'draft_message', 'paused', 'automatic', 'stale-lead-follow-up'),
  ('Unanswered client message', 'Surface unanswered inbound communication in Today.', 'communication_unanswered', 'create_task', 'paused', 'automatic', 'unanswered-message'),
  ('Signing closeout', 'Create closeout and funding work after signing.', 'signing_completed', 'enqueue_workflow', 'paused', 'required', 'signing-closeout'),
  ('Annual review', 'Create the annual review plan when due.', 'annual_review_due', 'create_task', 'paused', 'automatic', 'annual-review'),
  ('Overdue invoice reminder', 'Prepare the approved collection message.', 'invoice_overdue', 'draft_message', 'paused', 'automatic', 'overdue-invoice')
on conflict (system_key) do nothing;

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.automation_rules(id) on delete set null,
  system_key text,
  status text not null
    check (status in ('running', 'dry_run', 'succeeded', 'failed', 'cancelled')),
  idempotency_key text not null unique,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  next_retry_at timestamptz,
  attempt integer not null default 1 check (attempt between 1 and 20),
  proposed_count integer not null default 0 check (proposed_count >= 0),
  executed_count integer not null default 0 check (executed_count >= 0),
  error_code text,
  error_summary text,
  created_at timestamptz not null default now()
);

create index automation_runs_rule_recent_idx
  on public.automation_runs (rule_id, started_at desc);
create index automation_runs_failed_idx
  on public.automation_runs (started_at desc)
  where status = 'failed';

-- Public is an exposed schema. Explicit grants are required by newer
-- Supabase Data API defaults, and RLS is still enabled as defense in depth.
alter table public.user_work_preferences enable row level security;
alter table public.work_item_overrides enable row level security;
alter table public.daily_plans enable row level security;
alter table public.daily_plan_items enable row level security;
alter table public.action_proposals enable row level security;
alter table public.action_executions enable row level security;
alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;

revoke all on table
  public.user_work_preferences,
  public.work_item_overrides,
  public.daily_plans,
  public.daily_plan_items,
  public.action_proposals,
  public.action_executions,
  public.automation_rules,
  public.automation_runs
from anon, authenticated;

grant select, insert, update, delete on table
  public.user_work_preferences,
  public.work_item_overrides,
  public.daily_plans,
  public.daily_plan_items,
  public.action_proposals
to authenticated;

grant select on table
  public.action_executions,
  public.automation_runs
to authenticated;

grant select, insert, update, delete on table public.automation_rules to authenticated;

create policy user_work_preferences_select on public.user_work_preferences
for select to authenticated using ((select auth.uid()) = user_id);
create policy user_work_preferences_insert on public.user_work_preferences
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy user_work_preferences_update on public.user_work_preferences
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy user_work_preferences_delete on public.user_work_preferences
for delete to authenticated using ((select auth.uid()) = user_id);

create policy work_item_overrides_select on public.work_item_overrides
for select to authenticated using ((select auth.uid()) = user_id);
create policy work_item_overrides_insert on public.work_item_overrides
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy work_item_overrides_update on public.work_item_overrides
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy work_item_overrides_delete on public.work_item_overrides
for delete to authenticated using ((select auth.uid()) = user_id);

create policy daily_plans_select on public.daily_plans
for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_plans_insert on public.daily_plans
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy daily_plans_update on public.daily_plans
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy daily_plans_delete on public.daily_plans
for delete to authenticated using ((select auth.uid()) = user_id);

create policy daily_plan_items_select on public.daily_plan_items
for select to authenticated using (exists (
  select 1 from public.daily_plans p
  where p.id = daily_plan_items.plan_id and p.user_id = (select auth.uid())
));
create policy daily_plan_items_insert on public.daily_plan_items
for insert to authenticated with check (exists (
  select 1 from public.daily_plans p
  where p.id = daily_plan_items.plan_id and p.user_id = (select auth.uid())
));
create policy daily_plan_items_update on public.daily_plan_items
for update to authenticated using (exists (
  select 1 from public.daily_plans p
  where p.id = daily_plan_items.plan_id and p.user_id = (select auth.uid())
)) with check (exists (
  select 1 from public.daily_plans p
  where p.id = daily_plan_items.plan_id and p.user_id = (select auth.uid())
));
create policy daily_plan_items_delete on public.daily_plan_items
for delete to authenticated using (exists (
  select 1 from public.daily_plans p
  where p.id = daily_plan_items.plan_id and p.user_id = (select auth.uid())
));

create policy action_proposals_select on public.action_proposals
for select to authenticated using ((select auth.uid()) = actor_id);
create policy action_proposals_insert on public.action_proposals
for insert to authenticated with check ((select auth.uid()) = actor_id);
create policy action_proposals_update on public.action_proposals
for update to authenticated using ((select auth.uid()) = actor_id)
with check ((select auth.uid()) = actor_id);
create policy action_proposals_delete on public.action_proposals
for delete to authenticated using ((select auth.uid()) = actor_id);

create policy action_executions_select on public.action_executions
for select to authenticated using ((select auth.uid()) = actor_id);

-- Automation configuration is firm operational data. Staff roles may manage
-- it; clients and anonymous users cannot see it.
create policy automation_rules_staff_select on public.automation_rules
for select to authenticated using (exists (
  select 1 from public.users u
  where u.id = (select auth.uid()) and u.role in ('admin', 'attorney')
));
create policy automation_rules_staff_insert on public.automation_rules
for insert to authenticated with check (exists (
  select 1 from public.users u
  where u.id = (select auth.uid()) and u.role in ('admin', 'attorney')
));
create policy automation_rules_staff_update on public.automation_rules
for update to authenticated using (exists (
  select 1 from public.users u
  where u.id = (select auth.uid()) and u.role in ('admin', 'attorney')
)) with check (exists (
  select 1 from public.users u
  where u.id = (select auth.uid()) and u.role in ('admin', 'attorney')
));
create policy automation_rules_staff_delete on public.automation_rules
for delete to authenticated using (exists (
  select 1 from public.users u
  where u.id = (select auth.uid()) and u.role in ('admin', 'attorney')
));
create policy automation_runs_staff_select on public.automation_runs
for select to authenticated using (exists (
  select 1 from public.users u
  where u.id = (select auth.uid()) and u.role in ('admin', 'attorney')
));

grant all on table
  public.user_work_preferences,
  public.work_item_overrides,
  public.daily_plans,
  public.daily_plan_items,
  public.action_proposals,
  public.action_executions,
  public.automation_rules,
  public.automation_runs
to service_role;

comment on table public.daily_plan_items is
  'Stable references to computed work items. Source content is not duplicated here.';
comment on column public.action_proposals.reference_payload is
  'Identifiers and non-sensitive parameters only; message bodies and legal facts remain in source tables.';
