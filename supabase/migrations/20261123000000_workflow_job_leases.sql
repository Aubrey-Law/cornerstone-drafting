-- Created with `supabase migration new workflow_job_leases`, then allocated
-- after the verified local/remote 20261122000000 history for clean replay.
-- Additive preparation only. Does not enable durable_workflow_jobs_enabled.
alter table public.workflow_jobs
  add column if not exists claim_token uuid,
  add column if not exists lease_expires_at timestamptz;

create index if not exists workflow_jobs_expired_lease_idx
  on public.workflow_jobs (lease_expires_at) where status = 'running';

create or replace function public.claim_workflow_jobs_v2(p_limit integer, p_worker text, p_lease_seconds integer default 120)
returns setof public.workflow_jobs
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare v_now timestamptz := clock_timestamp();
begin
  if nullif(btrim(p_worker), '') is null then raise exception 'Worker identity required'; end if;
  update public.workflow_jobs set status = 'failed',
    last_error = 'Attempt limit exhausted', completed_at = v_now,
    locked_at = null, locked_by = null, claim_token = null, lease_expires_at = null, updated_at = v_now
  where attempts >= max_attempts and (
    status = 'pending' or (status = 'running' and coalesce(lease_expires_at, locked_at + interval '120 seconds') <= v_now)
  );
  return query with selected as (
    select id from public.workflow_jobs
    where attempts < max_attempts and (
      (status = 'pending' and available_at <= v_now)
      or (status = 'running' and coalesce(lease_expires_at, locked_at + interval '120 seconds') <= v_now)
    )
    order by available_at, created_at, id for update skip locked
    limit least(greatest(coalesce(p_limit, 1), 1), 50)
  )
  update public.workflow_jobs j set status = 'running', attempts = j.attempts + 1,
    locked_at = v_now, locked_by = p_worker, claim_token = gen_random_uuid(),
    lease_expires_at = v_now + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 120), 5), 300)),
    completed_at = null, updated_at = v_now
  from selected where j.id = selected.id returning j.*;
end $$;

create or replace function public.finish_workflow_job_v2(p_job_id uuid, p_claim_token uuid, p_error text default null)
returns boolean
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare v_now timestamptz := clock_timestamp(); v_rows integer;
begin
  update public.workflow_jobs set
    status = case when p_error is null then 'succeeded' when attempts >= max_attempts then 'failed' else 'pending' end,
    last_error = p_error,
    available_at = case when p_error is null then available_at
      else v_now + make_interval(mins => least(60, (2 ^ greatest(attempts - 1, 0))::integer)) end,
    completed_at = case when p_error is null or attempts >= max_attempts then v_now else null end,
    locked_at = null, locked_by = null, claim_token = null, lease_expires_at = null, updated_at = v_now
  where id = p_job_id and status = 'running' and claim_token = p_claim_token and lease_expires_at > v_now;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;

revoke all on function public.claim_workflow_jobs_v2(integer, text, integer),
  public.finish_workflow_job_v2(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_workflow_jobs_v2(integer, text, integer),
  public.finish_workflow_job_v2(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
