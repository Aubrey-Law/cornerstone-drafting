-- Solo-practice efficiency and billing foundation.
-- Additive only: existing charges and invoices are never converted or split.

alter table public.firm_settings
  add column if not exists billing_milestones_enabled boolean not null default false,
  add column if not exists durable_workflow_jobs_enabled boolean not null default false,
  add column if not exists probate_track_enabled boolean not null default false;

alter table public.billing_items add column if not exists incurred_at date;
update public.billing_items set incurred_at = created_at::date where kind = 'cost' and incurred_at is null;
alter table public.billing_items add constraint billing_items_cost_incurred_check
  check ((kind = 'cost' and incurred_at is not null and incurred_at <= current_date)
    or (kind <> 'cost' and incurred_at is null));

create or replace function public.create_billing_item(
  p_matter_id uuid, p_kind text, p_label text, p_plan text,
  p_amount_billed integer, p_actor_id uuid
)
returns public.billing_items language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_item public.billing_items; v_label text := btrim(coalesce(p_label, '')); begin
  perform public.assert_billing_actor(p_actor_id);
  if not exists (select 1 from public.matters where id = p_matter_id) then
    raise exception 'Matter not found' using errcode = 'P0002'; end if;
  if p_kind not in ('flat_fee', 'plan_claim', 'cost') or v_label = '' or p_amount_billed <= 0 then
    raise exception 'Valid charge details are required' using errcode = '22023'; end if;
  if (p_kind = 'plan_claim') <> (p_plan is not null) then
    raise exception 'A plan claim requires a legal plan, and only a plan claim carries one' using errcode = '22023'; end if;
  insert into public.billing_items (
    matter_id, kind, label, plan, amount_billed, status, source, incurred_at, created_by, updated_by
  ) values (
    p_matter_id, p_kind, v_label, p_plan, p_amount_billed, 'to_invoice', 'manual',
    case when p_kind = 'cost' then current_date else null end, p_actor_id, p_actor_id
  ) returning * into v_item;
  insert into public.billing_events (billing_item_id, event_type, actor_id, detail, metadata)
  values (v_item.id, 'item_created', p_actor_id,
    format('%s added: %s', initcap(replace(p_kind, '_', ' ')), v_label),
    jsonb_build_object('kind', p_kind, 'plan', p_plan, 'amount_billed', p_amount_billed,
      'incurred_at', v_item.incurred_at));
  return v_item;
end $$;
revoke all on function public.create_billing_item(uuid, text, text, text, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.create_billing_item(uuid, text, text, text, integer, uuid) to service_role;

create table public.service_packages (
  id uuid primary key default gen_random_uuid(),
  practice_area text not null,
  name text not null check (length(btrim(name)) > 0),
  scope_key text not null check (length(btrim(scope_key)) > 0),
  billing_strategy text not null check (billing_strategy in ('fixed_milestones', 'manual_phases', 'legal_plan')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (practice_area, scope_key)
);

create table public.service_package_milestones (
  id uuid primary key default gen_random_uuid(),
  service_package_id uuid not null references public.service_packages(id) on delete cascade,
  milestone_key text not null check (length(btrim(milestone_key)) > 0),
  label text not null check (length(btrim(label)) > 0),
  trigger_key text not null check (length(btrim(trigger_key)) > 0),
  percentage_bps integer check (percentage_bps between 1 and 10000),
  terms text not null default 'Due on receipt',
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (service_package_id, milestone_key),
  unique (service_package_id, position)
);

create table public.matter_fee_schedules (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  service_package_id uuid references public.service_packages(id) on delete set null,
  package_snapshot jsonb not null,
  agreed_total_cents integer not null check (agreed_total_cents > 0),
  state text not null default 'active' check (state in ('active', 'completed', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (matter_id)
);

create table public.matter_fee_milestones (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.matter_fee_schedules(id) on delete cascade,
  matter_id uuid not null references public.matters(id) on delete cascade,
  milestone_key text not null check (length(btrim(milestone_key)) > 0),
  label text not null check (length(btrim(label)) > 0),
  trigger_key text not null check (length(btrim(trigger_key)) > 0),
  terms text not null default 'Due on receipt',
  position integer not null check (position >= 0),
  amount_cents integer not null check (amount_cents > 0),
  state text not null default 'scheduled'
    check (state in ('scheduled', 'ready', 'invoiced', 'paid', 'waived')),
  released_at timestamptz,
  billing_item_id uuid unique references public.billing_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (matter_id, milestone_key)
);

create index matter_fee_milestones_ready_idx
  on public.matter_fee_milestones (state, released_at)
  where state = 'ready';

create table public.workflow_jobs (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid references public.matters(id) on delete cascade,
  job_type text not null check (job_type in (
    'seed_design_sheet', 'ensure_sla_plan', 'fire_stage_task',
    'release_billing_milestone', 'annual_review', 'prepare_invoice_reminders'
  )),
  dedupe_key text not null unique check (length(btrim(dedupe_key)) > 0),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workflow_jobs_claim_idx on public.workflow_jobs (available_at, created_at)
  where status = 'pending';
create index workflow_jobs_failed_idx on public.workflow_jobs (updated_at desc)
  where status = 'failed';

create table public.invoice_reminders (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  cadence_week date not null,
  escalation_level text not null check (escalation_level in ('friendly', 'firm', 'final')),
  recipient_email text not null check (position('@' in recipient_email) > 1),
  subject text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'suppressed')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  suppressed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, cadence_week)
);

create table public.billing_adjustments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  payment_group_id uuid,
  kind text not null check (kind in ('credit', 'refund', 'dispute', 'chargeback', 'correction')),
  amount_cents integer not null check (amount_cents > 0),
  balance_effect text not null check (balance_effect in ('credit', 'debit')),
  status text not null default 'posted' check (status in ('pending', 'posted', 'reversed')),
  reason text,
  provider text,
  external_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (provider, external_reference, kind)
);

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  payment_group_id uuid not null unique,
  status text not null default 'pending' check (status in ('pending', 'sent', 'suppressed')),
  sent_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.queue_manual_payment_receipt()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$ begin
  if new.created_by is not null and new.invoice_id is not null and new.method <> 'plan_eft' then
    insert into public.payment_receipts (invoice_id, payment_group_id)
    values (new.invoice_id, new.payment_group_id) on conflict (payment_group_id) do nothing;
  end if;
  return new;
end $$;
create trigger trg_queue_manual_payment_receipt after insert on public.billing_payments
for each row execute function public.queue_manual_payment_receipt();

create table public.matter_financial_exceptions (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  reason text not null check (length(btrim(reason)) >= 10),
  status text not null default 'active' check (status in ('active', 'revoked')),
  documented_by uuid not null references auth.users(id) on delete restrict,
  documented_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index matter_financial_exceptions_one_active_idx
  on public.matter_financial_exceptions (matter_id) where status = 'active';

alter table public.service_packages enable row level security;
alter table public.service_package_milestones enable row level security;
alter table public.matter_fee_schedules enable row level security;
alter table public.matter_fee_milestones enable row level security;
alter table public.workflow_jobs enable row level security;
alter table public.invoice_reminders enable row level security;
alter table public.billing_adjustments enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.matter_financial_exceptions enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'service_packages', 'service_package_milestones', 'matter_fee_schedules',
    'matter_fee_milestones', 'workflow_jobs', 'invoice_reminders',
    'billing_adjustments', 'payment_receipts', 'matter_financial_exceptions'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in (''attorney'', ''admin'')))',
      t || '_staff_select', t
    );
  end loop;
end $$;

grant select on public.service_packages, public.service_package_milestones,
  public.matter_fee_schedules, public.matter_fee_milestones, public.workflow_jobs,
  public.invoice_reminders, public.billing_adjustments, public.payment_receipts, public.matter_financial_exceptions
  to authenticated;
revoke insert, update, delete on public.service_packages, public.service_package_milestones,
  public.matter_fee_schedules, public.matter_fee_milestones, public.workflow_jobs,
  public.invoice_reminders, public.billing_adjustments, public.payment_receipts, public.matter_financial_exceptions
  from anon, authenticated;
grant all on public.service_packages, public.service_package_milestones,
  public.matter_fee_schedules, public.matter_fee_milestones, public.workflow_jobs,
  public.invoice_reminders, public.billing_adjustments, public.payment_receipts, public.matter_financial_exceptions
  to service_role;

insert into public.service_packages (practice_area, name, scope_key, billing_strategy)
values
  ('EP', 'Estate Planning - Standard 50/50', 'estate-planning-standard', 'fixed_milestones'),
  ('CP', 'College Preparation - Standard 50/50', 'college-prep-standard', 'fixed_milestones'),
  ('Probate', 'Probate - Configurable Phases', 'probate-standard', 'manual_phases'),
  ('EP', 'Estate Planning - Legal Plan', 'estate-planning-legal-plan', 'legal_plan')
on conflict (practice_area, scope_key) do nothing;

insert into public.service_package_milestones
  (service_package_id, milestone_key, label, trigger_key, percentage_bps, terms, position)
select p.id, m.milestone_key, m.label, m.trigger_key, m.percentage_bps, 'Due on receipt', m.position
from public.service_packages p
cross join (values
  ('engagement', 'Engagement phase fee', 'engagement_completed', 5000, 0),
  ('drafts-approved', 'Draft approval phase fee', 'drafts_approved', 5000, 1)
) as m(milestone_key, label, trigger_key, percentage_bps, position)
where p.scope_key in ('estate-planning-standard', 'college-prep-standard')
on conflict (service_package_id, milestone_key) do nothing;

insert into public.service_package_milestones
  (service_package_id, milestone_key, label, trigger_key, percentage_bps, terms, position)
select p.id, m.milestone_key, m.label, m.trigger_key, null, 'Due on receipt', m.position
from public.service_packages p
cross join (values
  ('opening', 'Probate opening phase', 'manual', 0),
  ('administration', 'Probate administration phase', 'manual', 1),
  ('closing', 'Probate closing phase', 'manual', 2)
) as m(milestone_key, label, trigger_key, position)
where p.scope_key = 'probate-standard'
on conflict (service_package_id, milestone_key) do nothing;

create or replace function public.release_matter_fee_milestone_internal(
  p_milestone_id uuid,
  p_actor_id uuid default null
)
returns public.matter_fee_milestones
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_milestone public.matter_fee_milestones; v_item_id uuid;
begin
  select * into v_milestone from public.matter_fee_milestones
  where id = p_milestone_id for update;
  if not found then raise exception 'Fee milestone not found' using errcode = 'P0002'; end if;
  if v_milestone.state <> 'scheduled' then return v_milestone; end if;

  insert into public.billing_items (
    matter_id, kind, label, amount_billed, status, source, created_by, updated_by
  ) values (
    v_milestone.matter_id, 'flat_fee', v_milestone.label,
    v_milestone.amount_cents, 'to_invoice', 'workflow', p_actor_id, p_actor_id
  ) returning id into v_item_id;

  update public.matter_fee_milestones set
    state = 'ready', released_at = statement_timestamp(), billing_item_id = v_item_id,
    updated_at = statement_timestamp()
  where id = p_milestone_id returning * into v_milestone;

  insert into public.billing_events (billing_item_id, event_type, actor_id, detail, metadata)
  values (v_item_id, 'milestone_released', p_actor_id, 'Fee milestone ready to invoice',
    jsonb_build_object('milestone_id', p_milestone_id));
  return v_milestone;
end $$;

create or replace function public.create_matter_fee_schedule(
  p_matter_id uuid,
  p_package_id uuid,
  p_agreed_total_cents integer,
  p_actor_id uuid,
  p_manual_milestones jsonb default null
)
returns public.matter_fee_schedules
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_package public.service_packages;
  v_schedule public.matter_fee_schedules;
  v_row record;
  v_amount integer;
  v_allocated integer := 0;
  v_count integer;
  v_index integer := 0;
  v_first uuid;
begin
  if p_actor_id is not null then perform public.assert_billing_actor(p_actor_id); end if;
  if p_agreed_total_cents is null or p_agreed_total_cents <= 0 then
    raise exception 'Agreed fee must be positive' using errcode = '22003';
  end if;
  if exists (select 1 from public.matter_fee_schedules where matter_id = p_matter_id) then
    raise exception 'Matter already has a fee schedule' using errcode = '23505';
  end if;
  if exists (select 1 from public.billing_items where matter_id = p_matter_id) then
    raise exception 'Historical billing exists; use attorney-approved manual conversion' using errcode = '22023';
  end if;
  select * into v_package from public.service_packages where id = p_package_id and is_active;
  if not found then raise exception 'Active service package not found' using errcode = 'P0002'; end if;
  if v_package.billing_strategy = 'legal_plan' then
    raise exception 'Legal-plan claims cannot create client fee schedules' using errcode = '22023';
  end if;

  insert into public.matter_fee_schedules
    (matter_id, service_package_id, package_snapshot, agreed_total_cents, created_by)
  values (
    p_matter_id, v_package.id,
    jsonb_build_object('practice_area', v_package.practice_area, 'name', v_package.name,
      'scope_key', v_package.scope_key, 'billing_strategy', v_package.billing_strategy),
    p_agreed_total_cents, p_actor_id
  ) returning * into v_schedule;

  if v_package.billing_strategy = 'manual_phases' then
    if p_manual_milestones is null or jsonb_typeof(p_manual_milestones) <> 'array' then
      raise exception 'Probate schedules require phase amounts' using errcode = '22023';
    end if;
    insert into public.matter_fee_milestones
      (schedule_id, matter_id, milestone_key, label, trigger_key, terms, position, amount_cents)
    select v_schedule.id, p_matter_id,
      btrim(x->>'key'), btrim(x->>'label'), coalesce(nullif(btrim(x->>'trigger'), ''), 'manual'),
      coalesce(nullif(btrim(x->>'terms'), ''), 'Due on receipt'), ordinality - 1,
      (x->>'amount_cents')::integer
    from jsonb_array_elements(p_manual_milestones) with ordinality as rows(x, ordinality);
    select coalesce(sum(amount_cents), 0) into v_allocated
    from public.matter_fee_milestones where schedule_id = v_schedule.id;
    if v_allocated <> p_agreed_total_cents then
      raise exception 'Probate phase amounts must equal the agreed total' using errcode = '22003';
    end if;
  else
    select count(*) into v_count from public.service_package_milestones
      where service_package_id = v_package.id;
    for v_row in select * from public.service_package_milestones
      where service_package_id = v_package.id order by position
    loop
      v_index := v_index + 1;
      v_amount := case when v_index = v_count then p_agreed_total_cents - v_allocated
        else floor(p_agreed_total_cents * v_row.percentage_bps / 10000.0)::integer end;
      insert into public.matter_fee_milestones
        (schedule_id, matter_id, milestone_key, label, trigger_key, terms, position, amount_cents)
      values (v_schedule.id, p_matter_id, v_row.milestone_key, v_row.label,
        v_row.trigger_key, v_row.terms, v_row.position, v_amount)
      returning id into v_first;
      v_allocated := v_allocated + v_amount;
      if v_index = 1 then perform public.release_matter_fee_milestone_internal(v_first, p_actor_id); end if;
    end loop;
  end if;
  return v_schedule;
end $$;

-- New engagements use a schedule only when the firm explicitly enables it.
-- The legacy one-charge behavior remains the fallback, and any matter with
-- billing history is left untouched.
create or replace function public.seed_engagement_billing_item()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_enabled boolean := false;
  v_package_id uuid;
  v_item public.billing_items;
  v_area text;
begin
  if new.engagement_signed is not true or new.flat_fee_amount is null or new.flat_fee_amount <= 0
    or coalesce(new.fee_payment_status, 'unpaid') <> 'unpaid' then return new; end if;
  if exists (select 1 from public.billing_items where matter_id = new.client_id::uuid)
    or exists (select 1 from public.matter_fee_schedules where matter_id = new.client_id::uuid) then
    return new;
  end if;
  select billing_milestones_enabled into v_enabled from public.firm_settings where id = 1;
  v_area := case
    when upper(coalesce(new.practice_area, '')) in ('CP', 'COLLEGE PREP', 'COLLEGE PREPARATION') then 'CP'
    when upper(coalesce(new.practice_area, '')) = 'PROBATE' then 'Probate'
    else 'EP' end;
  if coalesce(v_enabled, false)
    and v_area <> 'Probate'
    and lower(coalesce(new.billing_type, 'flat_fee')) not in ('metlife', 'legalease', 'arag', 'legal_plan') then
    select id into v_package_id from public.service_packages
      where practice_area = v_area and billing_strategy = 'fixed_milestones' and is_active
      order by created_at limit 1;
    if v_package_id is not null then
      perform public.create_matter_fee_schedule(
        new.client_id::uuid, v_package_id, round(new.flat_fee_amount * 100)::integer, null, null
      );
      return new;
    end if;
  end if;

  insert into public.billing_items (
    matter_id, kind, label, plan, amount_billed, status, invoiced_at, source, created_at, updated_at
  ) values (
    new.client_id::uuid, 'flat_fee',
    'Flat fee - ' || coalesce(nullif(btrim(new.plan_type), ''), nullif(btrim(new.practice_area), ''), 'Matter'),
    null, round(new.flat_fee_amount * 100)::integer, 'to_invoice', null, 'engagement',
    coalesce(new.engagement_signed_at, statement_timestamp()), statement_timestamp()
  ) on conflict (matter_id) where source = 'engagement' do nothing returning * into v_item;
  if v_item.id is not null then
    insert into public.billing_events (billing_item_id, event_type, detail, metadata)
    values (v_item.id, 'item_seeded', 'Engagement fee added to billing', jsonb_build_object('source', 'engagement'));
  end if;
  return new;
end $$;

create or replace function public.release_matter_fee_milestone(p_milestone_id uuid, p_actor_id uuid)
returns public.matter_fee_milestones language plpgsql security definer set search_path = pg_catalog, public
as $$ begin
  perform public.assert_billing_actor(p_actor_id);
  return public.release_matter_fee_milestone_internal(p_milestone_id, p_actor_id);
end $$;

create or replace function public.sync_fee_milestone_from_billing_item()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$ begin
  update public.matter_fee_milestones set
    state = case when new.status = 'paid' then 'paid'
      when new.status in ('invoiced', 'partial') or new.invoice_id is not null then 'invoiced'
      else state end,
    updated_at = statement_timestamp()
  where billing_item_id = new.id and state <> 'waived';
  return new;
end $$;
create trigger trg_sync_fee_milestone_from_billing_item
after update of status, invoice_id on public.billing_items
for each row execute function public.sync_fee_milestone_from_billing_item();

create or replace function public.enqueue_workflow_job(
  p_job_type text, p_dedupe_key text, p_matter_id uuid, p_payload jsonb, p_actor_id uuid
)
returns public.workflow_jobs language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_job public.workflow_jobs;
begin
  if p_actor_id is not null then perform public.assert_billing_actor(p_actor_id); end if;
  insert into public.workflow_jobs (job_type, dedupe_key, matter_id, payload, created_by)
  values (p_job_type, p_dedupe_key, p_matter_id, coalesce(p_payload, '{}'::jsonb), p_actor_id)
  on conflict (dedupe_key) do update set dedupe_key = excluded.dedupe_key
  returning * into v_job;
  return v_job;
end $$;

create or replace function public.claim_workflow_jobs(p_limit integer, p_worker text)
returns setof public.workflow_jobs language plpgsql security definer set search_path = pg_catalog, public
as $$ begin
  return query
  with selected as (
    select id from public.workflow_jobs
    where status = 'pending' and available_at <= statement_timestamp()
    order by available_at, created_at for update skip locked limit least(greatest(p_limit, 1), 50)
  )
  update public.workflow_jobs j set status = 'running', attempts = attempts + 1,
    locked_at = statement_timestamp(), locked_by = p_worker, updated_at = statement_timestamp()
  from selected where j.id = selected.id returning j.*;
end $$;

create or replace function public.finish_workflow_job(p_job_id uuid, p_error text default null)
returns public.workflow_jobs language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_job public.workflow_jobs;
begin
  select * into v_job from public.workflow_jobs where id = p_job_id for update;
  if not found then raise exception 'Workflow job not found' using errcode = 'P0002'; end if;
  update public.workflow_jobs set
    status = case when p_error is null then 'succeeded'
      when attempts >= max_attempts then 'failed' else 'pending' end,
    last_error = p_error,
    available_at = case when p_error is null then available_at
      else statement_timestamp() + make_interval(mins => least(60, (2 ^ greatest(attempts - 1, 0))::integer)) end,
    completed_at = case when p_error is null then statement_timestamp() else null end,
    locked_at = null, locked_by = null, updated_at = statement_timestamp()
  where id = p_job_id returning * into v_job;
  return v_job;
end $$;

create or replace function public.retry_workflow_job(p_job_id uuid, p_actor_id uuid)
returns public.workflow_jobs language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_job public.workflow_jobs; begin
  perform public.assert_billing_actor(p_actor_id);
  update public.workflow_jobs set status = 'pending', attempts = 0, available_at = statement_timestamp(),
    locked_at = null, locked_by = null, last_error = null, completed_at = null,
    updated_at = statement_timestamp()
  where id = p_job_id and status = 'failed' returning * into v_job;
  if not found then raise exception 'Failed workflow job not found' using errcode = 'P0002'; end if;
  return v_job;
end $$;

create or replace function public.transition_matter_stage_with_jobs(
  p_matter_id uuid,
  p_stage text,
  p_stage_label text,
  p_actor_id uuid,
  p_actor_email text,
  p_actor_name text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_previous text;
  v_entered_at timestamptz;
  v_jobs_enabled boolean;
  v_milestones_enabled boolean;
  v_milestone_id uuid;
begin
  perform public.assert_billing_actor(p_actor_id);
  select stage into v_previous from public.matters
    where id = p_matter_id and relationship_status = 'hired' for update;
  if not found then raise exception 'Matter not found' using errcode = 'P0002'; end if;
  if v_previous = p_stage then
    return jsonb_build_object('matterId', p_matter_id, 'stage', p_stage,
      'previousStage', v_previous, 'unchanged', true, 'durableJobs', false);
  end if;

  update public.matters set stage = p_stage where id = p_matter_id
    returning stage_entered_at into v_entered_at;
  insert into public.matter_activity (
    matter_id, event_type, title, detail, metadata,
    actor_id, actor_email, actor_name
  ) values (
    p_matter_id::text, 'stage_changed', 'Stage changed to ' || p_stage_label,
    'From ' || coalesce(v_previous, 'unassigned') || ' to ' || p_stage,
    jsonb_build_object('from', v_previous, 'to', p_stage),
    p_actor_id, p_actor_email, p_actor_name
  );

  select durable_workflow_jobs_enabled, billing_milestones_enabled
    into v_jobs_enabled, v_milestones_enabled from public.firm_settings where id = 1;
  if coalesce(v_jobs_enabled, false) then
    perform public.enqueue_workflow_job(
      'fire_stage_task',
      format('stage-task:%s:%s:%s', p_matter_id, p_stage, v_entered_at),
      p_matter_id, jsonb_build_object('stage', p_stage), p_actor_id
    );
    if p_stage = 'drafts_approved' and coalesce(v_milestones_enabled, false) then
      perform public.enqueue_workflow_job(
        'release_billing_milestone',
        format('billing-milestone:%s:drafts_approved', p_matter_id),
        p_matter_id, jsonb_build_object('trigger', 'drafts_approved'), p_actor_id
      );
    end if;
  end if;
  if p_stage = 'drafts_approved' and coalesce(v_milestones_enabled, false)
    and not coalesce(v_jobs_enabled, false) then
    select id into v_milestone_id from public.matter_fee_milestones
      where matter_id = p_matter_id and trigger_key = 'drafts_approved' and state = 'scheduled'
      order by position limit 1;
    if v_milestone_id is not null then
      perform public.release_matter_fee_milestone_internal(v_milestone_id, p_actor_id);
    end if;
  end if;
  return jsonb_build_object('matterId', p_matter_id, 'stage', p_stage,
    'previousStage', v_previous, 'unchanged', false, 'durableJobs', coalesce(v_jobs_enabled, false));
end $$;

create or replace function public.document_matter_financial_exception(
  p_matter_id uuid, p_reason text, p_actor_id uuid
)
returns public.matter_financial_exceptions
language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_exception public.matter_financial_exceptions; begin
  perform public.assert_billing_actor(p_actor_id);
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A meaningful exception reason is required' using errcode = '22023';
  end if;
  update public.matter_financial_exceptions set status = 'revoked', revoked_at = statement_timestamp()
    where matter_id = p_matter_id and status = 'active';
  insert into public.matter_financial_exceptions (matter_id, reason, documented_by)
    values (p_matter_id, btrim(p_reason), p_actor_id) returning * into v_exception;
  return v_exception;
end $$;

create or replace function public.transition_matter_status_with_closeout(
  p_matter_id uuid,
  p_status text,
  p_hold_reason text,
  p_status_label text,
  p_actor_id uuid,
  p_actor_email text,
  p_actor_name text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_previous text;
  v_jobs_enabled boolean;
  v_direct_balance integer := 0;
  v_open_claims integer := 0;
  v_ready integer := 0;
  v_payment_exceptions integer := 0;
  v_has_exception boolean := false;
  v_practice_area text;
begin
  perform public.assert_billing_actor(p_actor_id);
  select status into v_previous from public.matters
    where id = p_matter_id and relationship_status = 'hired' for update;
  if not found then raise exception 'Matter not found' using errcode = 'P0002'; end if;
  if v_previous = p_status then
    return jsonb_build_object('matterId', p_matter_id, 'status', p_status,
      'previousStatus', v_previous, 'unchanged', true);
  end if;

  if p_status = 'closed' then
    -- Start with the authoritative item ledger, then apply posted invoice
    -- adjustments. Credits reduce what remains; refunds and corrections reopen
    -- the balance even though the original payment rows stay immutable.
    select greatest(
      coalesce(sum(greatest(bi.amount_billed - coalesce(bp.collected, 0), 0)), 0)
      + coalesce((
        select sum(case when ba.balance_effect = 'debit' then ba.amount_cents else -ba.amount_cents end)
        from public.billing_adjustments ba
        join public.invoices i on i.id = ba.invoice_id
        where i.matter_id = p_matter_id and ba.status = 'posted'
      ), 0),
      0
    )::integer
      into v_direct_balance
    from public.billing_items bi
    left join (
      select billing_item_id, sum(amount)::integer collected
      from public.billing_payments group by billing_item_id
    ) bp on bp.billing_item_id = bi.id
    where bi.matter_id = p_matter_id and bi.kind <> 'plan_claim' and bi.status <> 'paid';
    select count(*) into v_open_claims from public.billing_items
      where matter_id = p_matter_id and kind = 'plan_claim' and status <> 'paid';
    select count(*) into v_ready from public.matter_fee_milestones
      where matter_id = p_matter_id and state = 'ready';
    select count(*) into v_payment_exceptions from public.billing_adjustments
      where invoice_id in (select id from public.invoices where matter_id = p_matter_id)
        and status = 'pending';
    select exists(select 1 from public.matter_financial_exceptions
      where matter_id = p_matter_id and status = 'active') into v_has_exception;

    if not v_has_exception and (v_direct_balance > 0 or v_open_claims > 0 or v_ready > 0 or v_payment_exceptions > 0) then
      raise exception 'Resolve billing before close-out: balance %, open claims %, ready milestones %, payment exceptions %',
        v_direct_balance, v_open_claims, v_ready, v_payment_exceptions using errcode = 'P0001';
    end if;
  end if;

  update public.matters set status = p_status,
    hold_reason = case when p_status = 'on_hold' then nullif(btrim(p_hold_reason), '') else null end
  where id = p_matter_id;
  insert into public.matter_activity (
    matter_id, event_type, title, detail, metadata,
    actor_id, actor_email, actor_name
  ) values (
    p_matter_id::text, 'status_changed', 'Matter ' || lower(p_status_label),
    'From ' || coalesce(v_previous, 'unassigned') || ' to ' || p_status,
    jsonb_build_object('from', v_previous, 'to', p_status, 'hold_reason', p_hold_reason),
    p_actor_id, p_actor_email, p_actor_name
  );

  select durable_workflow_jobs_enabled into v_jobs_enabled from public.firm_settings where id = 1;
  if p_status = 'closed' and coalesce(v_jobs_enabled, false) then
    select practice_area into v_practice_area from public.matter_details where client_id = p_matter_id;
    if upper(coalesce(v_practice_area, 'EP')) in ('EP', 'ESTATE PLANNING') then
      perform public.enqueue_workflow_job(
        'annual_review', format('annual-review:%s:%s', p_matter_id, current_date), p_matter_id,
        jsonb_build_object('actorId', p_actor_id), p_actor_id
      );
    end if;
  end if;
  return jsonb_build_object('matterId', p_matter_id, 'status', p_status,
    'previousStatus', v_previous, 'unchanged', false,
    'financialException', v_has_exception);
end $$;

create or replace function public.approve_invoice_reminder(p_reminder_id uuid, p_actor_id uuid)
returns public.invoice_reminders
language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_reminder public.invoice_reminders; begin
  perform public.assert_billing_actor(p_actor_id);
  update public.invoice_reminders set status = 'approved', approved_by = p_actor_id,
    approved_at = statement_timestamp(), updated_at = statement_timestamp()
  where id = p_reminder_id and status = 'draft'
  returning * into v_reminder;
  if not found then raise exception 'Reminder draft not found' using errcode = 'P0002'; end if;
  return v_reminder;
end $$;

create or replace function public.issue_invoice_credit_note(
  p_invoice_id uuid, p_amount_cents integer, p_reason text, p_actor_id uuid
)
returns public.invoices
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_original public.invoices;
  v_credit public.invoices;
  v_paid integer;
  v_credited integer;
  v_year integer := extract(year from current_date)::integer;
  v_number text;
begin
  perform public.assert_billing_actor(p_actor_id);
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Credit amount must be positive' using errcode = '22003';
  end if;
  select * into v_original from public.invoices where id = p_invoice_id for update;
  if not found or v_original.kind <> 'invoice' or v_original.status in ('draft', 'void') then
    raise exception 'An issued invoice is required' using errcode = '22023';
  end if;
  select coalesce(sum(amount), 0)::integer into v_paid from public.billing_payments
    where invoice_id = p_invoice_id;
  select coalesce(sum(amount_cents), 0)::integer into v_credited from public.billing_adjustments
    where invoice_id = p_invoice_id and kind = 'credit' and status = 'posted';
  if p_amount_cents > v_original.subtotal_cents - v_credited then
    raise exception 'Credit exceeds the invoice amount available to credit' using errcode = '22003';
  end if;
  v_number := public.next_invoice_number(v_year);
  insert into public.invoices (
    matter_id, number, number_year, kind, credit_of_invoice_id, status,
    subtotal_cents, issue_date, issued_at, paid_at, notes, terms,
    bill_to_name, bill_to_email, created_by, updated_by
  ) values (
    v_original.matter_id, v_number, v_year, 'credit_note', v_original.id, 'paid',
    p_amount_cents, current_date, statement_timestamp(), statement_timestamp(),
    btrim(p_reason), 'Credit applied', v_original.bill_to_name, v_original.bill_to_email,
    p_actor_id, p_actor_id
  ) returning * into v_credit;
  insert into public.invoice_items (
    invoice_id, billing_item_id, position, kind, description, amount_cents
  ) values (v_credit.id, null, 0, 'flat_fee', 'Credit - ' || btrim(p_reason), p_amount_cents);
  insert into public.billing_adjustments (
    invoice_id, kind, amount_cents, balance_effect, reason, created_by
  ) values (v_original.id, 'credit', p_amount_cents, 'credit', btrim(p_reason), p_actor_id);
  insert into public.billing_events (invoice_id, event_type, actor_id, detail, metadata)
  values (v_original.id, 'credit_note_issued', p_actor_id,
    format('Credit note %s issued', v_number),
    jsonb_build_object('credit_note_id', v_credit.id, 'amount_cents', p_amount_cents));
  return v_credit;
end $$;

create or replace function public.record_payment_adjustment(
  p_invoice_id uuid, p_payment_group_id uuid, p_kind text, p_amount_cents integer,
  p_balance_effect text, p_reason text, p_provider text, p_external_reference text,
  p_metadata jsonb, p_actor_id uuid default null
)
returns public.billing_adjustments
language plpgsql security definer set search_path = pg_catalog, public
as $$ declare v_adjustment public.billing_adjustments; begin
  if p_actor_id is not null then perform public.assert_billing_actor(p_actor_id); end if;
  if p_kind not in ('refund', 'dispute', 'chargeback', 'correction')
    or p_balance_effect not in ('credit', 'debit') or p_amount_cents <= 0 then
    raise exception 'Invalid payment adjustment' using errcode = '22023';
  end if;
  insert into public.billing_adjustments (
    invoice_id, payment_group_id, kind, amount_cents, balance_effect, reason,
    provider, external_reference, metadata, created_by, status
  ) values (
    p_invoice_id, p_payment_group_id, p_kind, p_amount_cents, p_balance_effect,
    nullif(btrim(p_reason), ''), p_provider, p_external_reference,
    coalesce(p_metadata, '{}'::jsonb), p_actor_id,
    case when p_kind in ('dispute', 'chargeback') and p_balance_effect = 'debit'
      then 'pending' else 'posted' end
  ) on conflict (provider, external_reference, kind) do update
    set metadata = excluded.metadata, updated_at = statement_timestamp()
  returning * into v_adjustment;
  insert into public.billing_events (invoice_id, event_type, actor_id, detail, metadata)
  values (p_invoice_id,
    case when p_kind = 'refund' then 'refund_recorded'
      when p_kind in ('dispute', 'chargeback') and p_balance_effect = 'debit' then 'dispute_opened'
      when p_kind in ('dispute', 'chargeback') then 'dispute_closed'
      else 'payment_corrected' end,
    p_actor_id, initcap(p_kind) || ' recorded',
    jsonb_build_object('adjustment_id', v_adjustment.id, 'amount_cents', p_amount_cents,
      'balance_effect', p_balance_effect, 'provider', p_provider));
  return v_adjustment;
end $$;

alter table public.billing_events drop constraint if exists billing_events_event_type_check;
alter table public.billing_events add constraint billing_events_event_type_check check (event_type in (
  'item_seeded', 'item_created', 'item_updated', 'invoice_marked_sent', 'payment_recorded',
  'reminder_recorded', 'invoice_drafted', 'invoice_updated', 'invoice_issued', 'invoice_sent',
  'invoice_voided', 'invoice_reminder_sent', 'invoice_payment_recorded', 'checkout_session_created',
  'checkout_session_completed', 'milestone_released', 'credit_note_issued', 'refund_recorded',
  'dispute_opened', 'dispute_closed', 'payment_corrected', 'receipt_sent'
));

revoke all on function public.release_matter_fee_milestone_internal(uuid, uuid),
  public.create_matter_fee_schedule(uuid, uuid, integer, uuid, jsonb),
  public.release_matter_fee_milestone(uuid, uuid),
  public.enqueue_workflow_job(text, text, uuid, jsonb, uuid),
  public.claim_workflow_jobs(integer, text), public.finish_workflow_job(uuid, text),
  public.retry_workflow_job(uuid, uuid),
  public.transition_matter_stage_with_jobs(uuid, text, text, uuid, text, text),
  public.document_matter_financial_exception(uuid, text, uuid),
  public.transition_matter_status_with_closeout(uuid, text, text, text, uuid, text, text),
  public.approve_invoice_reminder(uuid, uuid),
  public.issue_invoice_credit_note(uuid, integer, text, uuid),
  public.record_payment_adjustment(uuid, uuid, text, integer, text, text, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.release_matter_fee_milestone_internal(uuid, uuid),
  public.create_matter_fee_schedule(uuid, uuid, integer, uuid, jsonb),
  public.release_matter_fee_milestone(uuid, uuid),
  public.enqueue_workflow_job(text, text, uuid, jsonb, uuid),
  public.claim_workflow_jobs(integer, text), public.finish_workflow_job(uuid, text),
  public.retry_workflow_job(uuid, uuid),
  public.transition_matter_stage_with_jobs(uuid, text, text, uuid, text, text),
  public.document_matter_financial_exception(uuid, text, uuid),
  public.transition_matter_status_with_closeout(uuid, text, text, text, uuid, text, text),
  public.approve_invoice_reminder(uuid, uuid),
  public.issue_invoice_credit_note(uuid, integer, text, uuid),
  public.record_payment_adjustment(uuid, uuid, text, integer, text, text, text, text, jsonb, uuid)
  to service_role;
revoke all on function public.sync_fee_milestone_from_billing_item() from public, anon, authenticated;
revoke all on function public.queue_manual_payment_receipt() from public, anon, authenticated;

-- Dedicated probate track. It intentionally uses fixed phases, not timekeeping.
insert into public.sla_task_templates (
  template_name, description, target_days, target_days_pre_engagement, target_days_engagement, tasks
) values (
  'probate_sla_v1',
  'Probate administration track from engagement through closing. Phase fees are released manually unless a configured stage trigger is designated.',
  180, 14, 166,
  '[
    {"phase":"new_lead","name":"Collect death certificate and initial family information","due_offset_days":0,"relative_to":"discovery_call","assignee":"client","pre_engagement":true},
    {"phase":"intake","name":"Confirm probate court, interested persons, original will, and asset inventory","due_offset_days":3,"assignee":"attorney"},
    {"phase":"intake","name":"Prepare opening petition and required notices","due_offset_days":10,"assignee":"attorney"},
    {"phase":"design","name":"File opening documents and calendar citation or notice deadlines","due_offset_days":14,"assignee":"attorney"},
    {"phase":"drafting","name":"Track appointment and obtain fiduciary letters","due_offset_days":35,"assignee":"attorney"},
    {"phase":"client_review","name":"Complete asset inventory and creditor review","due_offset_days":75,"assignee":"attorney"},
    {"phase":"revision","name":"Prepare administration accounting and distributions","due_offset_days":140,"assignee":"attorney"},
    {"phase":"post_execution","name":"Prepare closing statement or final account","due_offset_days":175,"assignee":"attorney"},
    {"phase":"closed","name":"Confirm distributions, receipts, billing, and court close-out","due_offset_days":180,"assignee":"attorney"}
  ]'::jsonb
) on conflict (template_name) do update set
  description = excluded.description, target_days = excluded.target_days,
  target_days_pre_engagement = excluded.target_days_pre_engagement,
  target_days_engagement = excluded.target_days_engagement,
  tasks = excluded.tasks, updated_at = now();

-- Replace obsolete external-billing task actions with a deep-link instruction
-- understood by Cornerstone's task UI.
update public.sla_task_templates
set tasks = replace(tasks::text, '"skill": "qbo-invoice"', '"skill": "cornerstone-billing"')::jsonb,
    updated_at = now()
where tasks::text like '%qbo-invoice%';

notify pgrst, 'reload schema';
