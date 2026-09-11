-- Disposable PostgreSQL 17 fixture only. Apply to an EMPTY local test database.
-- Deliberately incomplete: never apply to a Supabase or firm database.

do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key);
create table public.matters(id uuid primary key);
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


alter table public.workflow_jobs enable row level security;
grant usage on schema public to service_role;
grant all on public.workflow_jobs to service_role;

create table public.tasks(id uuid primary key default gen_random_uuid(), title text, owner text, status text, priority text, source text, assignee_id uuid, completed_at timestamptz, effective_due_at timestamptz, created_at timestamptz default now());
create table public.lead_fixture(id uuid primary key default gen_random_uuid(), lead_status text, is_open boolean, needs_attention boolean, has_pending_agreement boolean, awaiting_intake boolean, engagement_fee_quoted numeric);
create view public.v_lead_list as select * from public.lead_fixture;
grant select on public.tasks, public.v_lead_list, public.lead_fixture to service_role;

alter table public.matters add column client_intake_id uuid, add column portal_uploads_reviewed_at timestamptz, add column matter_number text, add column relationship_status text default 'hired';
create table public.client_intake(id uuid primary key default gen_random_uuid(),uploads_reviewed_at timestamptz);
create table public.intake_documents(id uuid primary key default gen_random_uuid(),client_intake_id uuid,created_at timestamptz);
create table public.matter_documents(id uuid primary key default gen_random_uuid(),matter_id text,source text,created_at timestamptz);
create table public.matter_fixture(matter_id uuid primary key, matter_name text,stage text,status text,matter_created timestamptz,client_name text,client_email text,client_phone text,practice_area text,intake_status text,intake_submitted_at timestamptz,drafts_sent_at timestamptz,documents_executed_at timestamptz,signing_date timestamptz);
create view public.v_matter_pipeline as select f.* from public.matter_fixture f join public.matters m on m.id=f.matter_id where m.relationship_status='hired';
grant select on public.client_intake,public.intake_documents,public.matter_documents,public.matter_fixture,public.v_matter_pipeline to service_role;

alter table public.matters add column name text;
alter table public.matter_fixture add column plan_type text;
-- Recreate only this disposable fixture view so the new field is visible.
drop view public.v_matter_pipeline;
create view public.v_matter_pipeline as select f.* from public.matter_fixture f join public.matters m on m.id=f.matter_id where m.relationship_status='hired';
create table public.matter_details(client_id uuid primary key,practice_area text,plan_type text,legal_plan text);
create table public.invoices(id uuid primary key default gen_random_uuid(),number text,due_date date);
create table public.billing_items(id uuid primary key default gen_random_uuid(),matter_id uuid,kind text,label text,plan text,amount_billed bigint,status text,invoiced_at timestamptz,source text,last_reminded_at timestamptz,created_at timestamptz,invoice_id uuid);
create table public.billing_payments(id uuid primary key default gen_random_uuid(),billing_item_id uuid,amount bigint,method text,note text,received_at timestamptz,invoice_id uuid,payment_group_id uuid);
grant select on public.v_matter_pipeline,public.matter_details,public.invoices,public.billing_items,public.billing_payments to service_role;

alter table public.invoices add column status text;
grant select on all tables in schema public to service_role;
