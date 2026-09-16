-- Provider-neutral persistence for scheduler integrations. Both connectors remain
-- explicitly disabled until an authorized administrator configures and enables them.

create table public.integration_settings (
  id integer primary key default 1 check (id = 1),
  lawmatics_appointment_sync_enabled boolean not null default false,
  lawmatics_event_type_id_map jsonb not null default '{}'::jsonb
    check (jsonb_typeof(lawmatics_event_type_id_map) = 'object'),
  lawmatics_location_id_map jsonb not null default '{}'::jsonb
    check (jsonb_typeof(lawmatics_location_id_map) = 'object'),
  lawmatics_user_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(lawmatics_user_ids) = 'array'),
  lawmatics_last_checked_at timestamptz,
  lawmatics_last_check_error text
    check (
      lawmatics_last_check_error is null
      or lawmatics_last_check_error = 'Lawmatics connection check failed.'
    ),
  statular_sync_enabled boolean not null default false,
  statular_doc_id_map jsonb not null default '{}'::jsonb
    check (jsonb_typeof(statular_doc_id_map) = 'object'),
  statular_drafter_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table public.integration_external_records (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('lawmatics', 'statular')),
  internal_entity_type text not null check (internal_entity_type in ('lead', 'matter', 'appointment')),
  internal_entity_id uuid not null,
  external_record_type text not null check (external_record_type in ('prospect', 'event', 'client', 'matter')),
  external_id text,
  status text not null default 'pending' check (status in ('pending', 'synced', 'attention', 'disabled')),
  source_version text not null,
  idempotency_key text not null,
  request_snapshot jsonb,
  request_hash text,
  last_error_code text,
  last_error_message text,
  last_attempt_at timestamptz,
  last_succeeded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, internal_entity_type, internal_entity_id, external_record_type)
);

create unique index integration_external_records_external_id_idx
  on public.integration_external_records (provider, external_record_type, external_id)
  where external_id is not null;

create trigger set_updated_at_integration_settings
  before update on public.integration_settings
  for each row execute function public.set_updated_at();

create trigger set_updated_at_integration_external_records
  before update on public.integration_external_records
  for each row execute function public.set_updated_at();

alter table public.integration_settings enable row level security;
alter table public.integration_external_records enable row level security;

revoke all on table public.integration_settings from public, anon, authenticated;
revoke all on table public.integration_external_records from public, anon, authenticated;
grant all on table public.integration_settings to service_role;
grant all on table public.integration_external_records to service_role;

insert into public.integration_settings (id)
values (1)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
