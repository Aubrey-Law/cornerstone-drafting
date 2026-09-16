-- Scaffolded with `supabase migration new workflow_retry_after`, then allocated
-- after the approved Lawmatics jobs migration. Existing finish RPCs stay intact.
begin;

create function public.finish_workflow_job_v3(
  p_job_id uuid, p_claim_token uuid, p_error text default null, p_retry_after_ms bigint default null
)
returns boolean
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare v_now timestamptz := clock_timestamp(); v_rows integer;
begin
  update public.workflow_jobs set
    status = case when p_error is null then 'succeeded' when attempts >= max_attempts then 'failed' else 'pending' end,
    last_error = p_error,
    available_at = case when p_error is null then available_at
      else v_now + make_interval(secs => greatest(
        -- Clamp the exponent before converting to prevent integer overflow.
        60 * least(60, (2 ^ least(greatest(attempts - 1, 0), 6))::integer),
        -- Provider advice can extend, never shorten, generic backoff. Cap at a
        -- day in SQL as well as the worker, including direct service-role calls.
        least(greatest(coalesce(p_retry_after_ms, 0), 0), 86400000)::double precision / 1000
      )) end,
    completed_at = case when p_error is null or attempts >= max_attempts then v_now else null end,
    locked_at = null, locked_by = null, claim_token = null, lease_expires_at = null, updated_at = v_now
  where id = p_job_id and status = 'running' and claim_token = p_claim_token and lease_expires_at > v_now;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;

revoke all on function public.finish_workflow_job_v3(uuid, uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.finish_workflow_job_v3(uuid, uuid, text, bigint) to service_role;

notify pgrst, 'reload schema';
commit;
