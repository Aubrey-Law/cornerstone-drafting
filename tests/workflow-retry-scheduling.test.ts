import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const database = process.env.VITEST_WORKFLOW_RETRY_DATABASE
const container = process.env.VITEST_WORKFLOW_RETRY_CONTAINER
function sql(statement: string) {
  if (!database?.startsWith('codex_lawmatics_final_') || !container?.startsWith('supabase_db_')) {
    throw new Error('An explicit disposable local workflow retry database is required')
  }
  return execFileSync('docker', ['exec', container, 'psql', '-X', '-U', 'postgres', '-d', database,
    '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim()
}
const signature = 'public.finish_workflow_job_v3(uuid,uuid,text,bigint)'
function requireRpc() { expect(sql(`select to_regprocedure('${signature}') is not null`)).toBe('t') }

describe.skipIf(!database)('workflow Retry-After scheduling in local Postgres', () => {
  beforeAll(() => {
    sql(`create table public.workflow_jobs (
      id uuid primary key default gen_random_uuid(), job_type text not null default 'lawmatics_sync_appointment',
      status text default 'pending', attempts integer default 0, max_attempts integer default 5,
      available_at timestamptz default now(), created_at timestamptz default now(), updated_at timestamptz default now(),
      locked_at timestamptz, locked_by text, last_error text, completed_at timestamptz);
      grant select,insert,update on public.workflow_jobs to service_role;
      ${readFileSync('supabase/migrations/20261123000000_workflow_job_leases.sql', 'utf8')}`)
    const path = 'supabase/migrations/20261205010000_workflow_retry_after.sql'
    if (existsSync(path)) sql(readFileSync(path, 'utf8'))
    // Replay the real local seed over inert exception tables. Its blanket table
    // grants must never undo the new RPC's service-only EXECUTE permissions.
    const seed = readFileSync('supabase/seed.sql', 'utf8')
    const names = [...new Set([...seed.matchAll(/public\.([a-z_]+)/g)].map(match => match[1]))]
    sql(names.map(name => `create table if not exists public.${name}(id integer);`).join('\n') + seed)
  })

  it.each([
    [1, '180000', 180], [3, '1000', 240], [1, '-1000', 60], [1, 'null', 60],
    [1, '9223372036854775807', 86400], [100, '1', 3600],
  ])('uses the later of exponential backoff and bounded provider delay: attempts=%i delay=%s', (attempts, delay, seconds) => {
    requireRpc()
    expect(sql(`do $$ declare j uuid; token uuid := gen_random_uuid(); started timestamptz := clock_timestamp(); due timestamptz;
      begin
        insert into public.workflow_jobs(status,attempts,max_attempts,claim_token,lease_expires_at)
        values ('running',${attempts},200,token,clock_timestamp()+interval '120 seconds') returning id into j;
        if not public.finish_workflow_job_v3(j,token,'safe failure',${delay}) then raise exception 'finish rejected'; end if;
        select available_at into due from public.workflow_jobs where id=j and status='pending' and claim_token is null;
        if due is null or due < started + interval '${seconds} seconds'
          or due > clock_timestamp() + interval '${seconds} seconds' then raise exception 'wrong delay'; end if;
      end $$; select true;`).split('\n').at(-1)).toBe('t')
  })

  it('retains claim fencing, terminal failure, success scheduling and the old RPC', () => {
    requireRpc()
    expect(sql(`do $$ declare j uuid; token uuid := gen_random_uuid(); due timestamptz := clock_timestamp()-interval '1 day';
      begin
        insert into public.workflow_jobs(status,attempts,max_attempts,claim_token,lease_expires_at,available_at)
          values ('running',1,5,token,clock_timestamp()+interval '120 seconds',due) returning id into j;
        if public.finish_workflow_job_v3(j,gen_random_uuid(),null,180000) then raise exception 'wrong token accepted'; end if;
        if not public.finish_workflow_job_v3(j,token,null,180000) then raise exception 'success rejected'; end if;
        if not exists(select from public.workflow_jobs where id=j and status='succeeded' and available_at=due and completed_at is not null)
          then raise exception 'success changed'; end if;
        if public.finish_workflow_job_v3(j,token,null,0) then raise exception 'double finish'; end if;
        update public.workflow_jobs set status='running',attempts=5,claim_token=token,lease_expires_at=clock_timestamp()+interval '120 seconds' where id=j;
        if not public.finish_workflow_job_v3(j,token,'safe failure',180000) then raise exception 'terminal rejected'; end if;
        if not exists(select from public.workflow_jobs where id=j and status='failed' and completed_at is not null) then raise exception 'terminal changed'; end if;
        update public.workflow_jobs set status='running',claim_token=token,lease_expires_at=clock_timestamp()-interval '1 second' where id=j;
        if public.finish_workflow_job_v3(j,token,null,0) then raise exception 'expired accepted'; end if;
        update public.workflow_jobs set lease_expires_at=clock_timestamp()+interval '120 seconds' where id=j;
        if not public.finish_workflow_job_v2(j,token,null) then raise exception 'legacy RPC changed'; end if;
      end $$; select true;`).split('\n').at(-1)).toBe('t')
  })

  it('allows only service-role execution with invoker permissions and a fixed search path', () => {
    requireRpc()
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(sql(`select has_function_privilege('${role}','${signature}','EXECUTE')`)).toBe(role === 'service_role' ? 't' : 'f')
    }
    expect(sql(`select not prosecdef and proconfig @> array['search_path=pg_catalog, public'] from pg_proc where oid='${signature}'::regprocedure`)).toBe('t')
    expect(sql(`set role service_role; select public.finish_workflow_job_v3(gen_random_uuid(),gen_random_uuid(),null,0)`)
      .split('\n').at(-1)).toBe('f')
  })
})
