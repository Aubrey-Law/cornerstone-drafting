-- Aggregate-only rollout evidence for the canonical work graph. The ledger
-- intentionally excludes titles, message bodies, legal facts, and work keys.

alter table public.firm_settings
  add column if not exists command_center_v2_enabled_at timestamptz,
  add column if not exists command_center_v2_enabled_by uuid references auth.users(id) on delete set null;

create table public.work_graph_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  firm_date date not null,
  trigger text not null check (trigger in ('manual', 'cron', 'activation')),
  idempotency_key text not null unique,
  generated_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  legacy_count integer not null check (legacy_count >= 0),
  canonical_count integer not null check (canonical_count >= 0),
  mapped_count integer not null check (mapped_count >= 0),
  coverage_percent numeric(5,2) not null check (coverage_percent between 0 and 100),
  omitted_count integer not null check (omitted_count >= 0),
  duplicate_count integer not null check (duplicate_count >= 0),
  differently_ranked_count integer not null check (differently_ranked_count >= 0),
  additional_count integer not null check (additional_count >= 0),
  critical_count integer not null check (critical_count >= 0),
  critical_misclassified_count integer not null check (critical_misclassified_count >= 0),
  ownership_violation_count integer not null check (ownership_violation_count >= 0),
  source_error_codes text[] not null default '{}',
  source_counts jsonb not null default '{}'::jsonb,
  readiness_passed boolean not null default false,
  created_at timestamptz not null default now()
);

create index work_graph_reconciliation_user_recent_idx
  on public.work_graph_reconciliation_runs (user_id, created_at desc);
create index work_graph_reconciliation_date_idx
  on public.work_graph_reconciliation_runs (firm_date desc, created_at desc);

comment on table public.work_graph_reconciliation_runs is
  'Aggregate command-center rollout measurements only; no client content, legal facts, or work identifiers.';
comment on column public.work_graph_reconciliation_runs.source_counts is
  'Counts keyed by allowlisted work source type; never source payloads or identifiers.';

alter table public.work_graph_reconciliation_runs enable row level security;
revoke all on table public.work_graph_reconciliation_runs from public, anon, authenticated;
grant select on table public.work_graph_reconciliation_runs to authenticated;
grant all on table public.work_graph_reconciliation_runs to service_role;

create policy work_graph_reconciliation_staff_select
on public.work_graph_reconciliation_runs
for select to authenticated
using (exists (
  select 1 from public.users u
  where u.id = (select auth.uid()) and u.role in ('admin', 'attorney')
));

notify pgrst, 'reload schema';
