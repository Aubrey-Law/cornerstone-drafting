-- Internal run ledger. Clients access it only through attorney/admin API routes.
create table if not exists public.draft_generation_runs (
  id uuid primary key,
  matter_id uuid not null references public.matters(id) on delete cascade,
  created_by uuid not null,
  source_revision text not null,
  request_hash text not null,
  requested_documents text[] not null,
  status text not null check (status in ('running', 'partial', 'completed', 'failed')),
  outcomes jsonb not null default '[]'::jsonb,
  worker_token uuid not null,
  lease_expires_at timestamptz not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.draft_generation_runs enable row level security;
revoke all on public.draft_generation_runs from public, anon, authenticated;
grant select, insert, update on public.draft_generation_runs to service_role;
create index if not exists draft_generation_runs_matter_created on public.draft_generation_runs(matter_id, created_at desc);

create or replace function public.claim_draft_generation_run(
  p_id uuid, p_matter_id uuid, p_actor_id uuid, p_revision text,
  p_request_hash text, p_documents text[], p_worker_token uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.draft_generation_runs;
begin
  -- One lock per matter prevents two different request IDs running together.
  perform pg_advisory_xact_lock(hashtextextended(p_matter_id::text, 0));
  select * into r from public.draft_generation_runs where id = p_id for update;
  if found then
    if r.matter_id <> p_matter_id or r.request_hash <> p_request_hash then
      raise exception 'Run request does not match its original source and documents';
    end if;
    if r.status = 'completed' or (r.status = 'running' and r.lease_expires_at > now()) then
      return to_jsonb(r);
    end if;
  end if;
  if exists(select 1 from public.draft_generation_runs where matter_id = p_matter_id and status = 'running' and lease_expires_at > now() and id <> p_id) then
    raise exception 'Another draft run is active for this matter. Open its status before starting another.';
  end if;
  -- Expired workers are fenced by the document trigger below and cannot register output.
  update public.draft_generation_runs set status = 'failed', error = 'Run interrupted. Check saved documents and retry.', updated_at = now()
    where matter_id = p_matter_id and status = 'running' and lease_expires_at <= now();
  insert into public.draft_generation_runs(id, matter_id, created_by, source_revision, request_hash, requested_documents, status, worker_token, lease_expires_at)
    values(p_id, p_matter_id, p_actor_id, p_revision, p_request_hash, p_documents, 'running', p_worker_token, now() + interval '6 minutes')
  on conflict(id) do update set status = 'running', worker_token = excluded.worker_token, lease_expires_at = excluded.lease_expires_at, error = null, updated_at = now()
  returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.claim_draft_generation_run(uuid,uuid,uuid,text,text,text[],uuid) from public, anon, authenticated;
grant execute on function public.claim_draft_generation_run(uuid,uuid,uuid,text,text,text[],uuid) to service_role;

-- Limit uniqueness to the new run namespace; historical generations are untouched.
alter table public.matter_documents add column if not exists draft_run_output text;
create unique index if not exists draft_run_output_identity on public.matter_documents(generation_id, draft_run_output)
  where draft_run_output is not null;
create or replace function public.guard_draft_run_output() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare r public.draft_generation_runs;
begin
  if new.r2_key like 'matters/%/draft-runs/%' then
    new.draft_run_output := split_part(new.r2_key, '/', 6);
    -- Key: matters/<matter>/draft-runs/<run>/<worker>/<filename>.
    select * into r from public.draft_generation_runs where id = new.generation_id for update;
    if not found or r.matter_id::text <> new.matter_id or r.status <> 'running' or r.lease_expires_at <= now()
      or split_part(new.r2_key, '/', 4) <> r.id::text
      or split_part(new.r2_key, '/', 5) <> r.worker_token::text then
      raise exception 'Draft execution lease expired; output was not registered';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_draft_run_output() from public, anon, authenticated;
grant execute on function public.guard_draft_run_output() to service_role;
drop trigger if exists guard_draft_run_output on public.matter_documents;
create trigger guard_draft_run_output before insert on public.matter_documents for each row execute function public.guard_draft_run_output();
notify pgrst, 'reload schema';

-- Aggregate existing operational records; no client content or external telemetry.
create or replace function public.draft_generation_metrics(p_matter_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'runs', count(*),
    'completed', count(*) filter(where status = 'completed'),
    'needsAttention', count(*) filter(where status in ('failed','partial') or (status='running' and lease_expires_at <= now())),
    'averageRunSeconds', avg(extract(epoch from updated_at-created_at)) filter(where status='completed'),
    'reviewedDocuments', (select count(*) from public.matter_documents d where d.matter_id=p_matter_id::text and d.generation_id is not null and d.created_at >= now()-interval '30 days' and d.reviewed_at is not null and d.superseded_at is null),
    'averageReviewSeconds', (select avg(greatest(0,extract(epoch from d.reviewed_at-d.created_at))) from public.matter_documents d where d.matter_id=p_matter_id::text and d.generation_id is not null and d.created_at >= now()-interval '30 days' and d.reviewed_at is not null and d.superseded_at is null)
  ) from public.draft_generation_runs where matter_id=p_matter_id and created_at >= now()-interval '30 days';
$$;
revoke all on function public.draft_generation_metrics(uuid) from public, anon, authenticated;
grant execute on function public.draft_generation_metrics(uuid) to service_role;
