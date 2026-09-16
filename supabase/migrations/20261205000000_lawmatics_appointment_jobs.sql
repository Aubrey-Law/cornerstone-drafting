-- Scaffolded with `supabase migration new lawmatics_appointment_jobs`, then
-- allocated after the approved 20261204000000 migration. Sync remains disabled.
begin;

alter table public.workflow_jobs drop constraint workflow_jobs_job_type_check;
alter table public.workflow_jobs add constraint workflow_jobs_job_type_check check (job_type in (
  'seed_design_sheet', 'ensure_sla_plan', 'fire_stage_task',
  'release_billing_milestone', 'annual_review', 'prepare_invoice_reminders',
  'lawmatics_sync_appointment'
));

-- Job dedupe keys contain source versions. Serialize provider mutations across
-- those versions using one short, service-only lease per provider/entity.
create table public.integration_entity_leases (
  provider text not null check (provider in ('lawmatics', 'statular')),
  entity_type text not null check (entity_type in ('lead', 'matter', 'appointment')),
  entity_id uuid not null,
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  primary key (provider, entity_type, entity_id)
);
alter table public.integration_entity_leases enable row level security;
revoke all on table public.integration_entity_leases from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_entity_leases to service_role;

create function public.acquire_integration_entity_lease(p_provider text, p_entity_type text, p_entity_id uuid)
returns uuid language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare v_token uuid;
begin
  -- 120 seconds exceeds the two bounded 30-second Lawmatics requests and the
  -- workflow worker's 50-second execution budget. Callers cannot extend it.
  insert into public.integration_entity_leases as leases
    (provider, entity_type, entity_id, lease_token, lease_expires_at)
  values (p_provider, p_entity_type, p_entity_id, gen_random_uuid(), clock_timestamp() + interval '120 seconds')
  on conflict (provider, entity_type, entity_id) do update
    set lease_token = excluded.lease_token,
        lease_expires_at = clock_timestamp() + interval '120 seconds'
    where leases.lease_expires_at <= clock_timestamp()
  returning lease_token into v_token;
  return v_token;
end $$;

create function public.release_integration_entity_lease(
  p_provider text, p_entity_type text, p_entity_id uuid, p_lease_token uuid
)
returns boolean language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare v_rows integer;
begin
  delete from public.integration_entity_leases
  where provider = p_provider and entity_type = p_entity_type and entity_id = p_entity_id
    and lease_token = p_lease_token;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;

revoke all on function public.acquire_integration_entity_lease(text, text, uuid),
  public.release_integration_entity_lease(text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_integration_entity_lease(text, text, uuid),
  public.release_integration_entity_lease(text, text, uuid, uuid) to service_role;

-- Explicit repair only: normal enqueue remains idempotent, including terminal
-- jobs. Future provider migrations must explicitly extend this type allowlist.
create function public.reopen_integration_workflow_job(p_job_type text, p_dedupe_key text)
returns uuid language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare v_id uuid; v_now timestamptz := clock_timestamp();
begin
  if p_job_type not in ('lawmatics_sync_appointment') then return null; end if;
  update public.workflow_jobs set status = 'pending', attempts = 0, available_at = v_now,
    locked_at = null, locked_by = null, claim_token = null, lease_expires_at = null,
    last_error = null, completed_at = null, updated_at = v_now
  where job_type = p_job_type and dedupe_key = p_dedupe_key and status in ('succeeded', 'failed')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.reopen_integration_workflow_job(text, text) from public, anon, authenticated;
grant execute on function public.reopen_integration_workflow_job(text, text) to service_role;

notify pgrst, 'reload schema';
commit;
