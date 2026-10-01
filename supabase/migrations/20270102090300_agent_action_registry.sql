-- Phase 3: harden action proposals and executions as the common mutation gate.
-- Inputs stay reference-oriented; user-facing previews are recomputed from the
-- authoritative source immediately before an execution is claimed.

alter table public.action_proposals
  add column source text not null default 'api'
    check (source in ('api', 'today', 'record', 'assistant', 'automation')),
  add column preview_digest text,
  add column confirmation_policy text not null default 'one_click'
    check (confirmation_policy in ('automatic', 'one_click', 'explicit', 'never')),
  add column rejected_at timestamptz;

alter table public.action_proposals
  add constraint action_proposals_preview_digest_check
  check (preview_digest is null or preview_digest ~ '^[0-9a-f]{64}$');

alter table public.action_executions
  drop constraint if exists action_executions_status_check;

alter table public.action_executions
  alter column status set default 'running',
  add constraint action_executions_status_check
    check (status in ('running', 'succeeded', 'failed')),
  add column source text not null default 'api'
    check (source in ('api', 'today', 'record', 'assistant', 'automation')),
  add column confirmation_digest text,
  add column before_state jsonb,
  add column after_state jsonb,
  add column started_at timestamptz not null default now(),
  add column completed_at timestamptz;

alter table public.action_executions
  add constraint action_executions_confirmation_digest_check
  check (confirmation_digest is null or confirmation_digest ~ '^[0-9a-f]{64}$');

create index action_executions_actor_started_idx
  on public.action_executions (actor_id, started_at desc);

-- Proposal rows are created and changed only by the server-side action
-- service. Browser sessions may inspect their own approval and audit rows but
-- cannot rewrite an action key, reference payload, risk, or approval state.
revoke select, insert, update, delete on table public.action_proposals from authenticated;
grant select (
  id, actor_id, action_key, risk, status, record_type, record_id,
  display_summary, idempotency_key, expires_at, accepted_at, executed_at,
  created_at, updated_at, source, preview_digest, confirmation_policy,
  rejected_at
) on table public.action_proposals to authenticated;
drop policy if exists action_proposals_insert on public.action_proposals;
drop policy if exists action_proposals_update on public.action_proposals;
drop policy if exists action_proposals_delete on public.action_proposals;

create or replace function public.prevent_action_identity_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
    or new.actor_id is distinct from old.actor_id
    or new.action_key is distinct from old.action_key
    or new.risk is distinct from old.risk
    or new.record_type is distinct from old.record_type
    or new.record_id is distinct from old.record_id
    or new.reference_payload is distinct from old.reference_payload
    or new.idempotency_key is distinct from old.idempotency_key
    or new.source is distinct from old.source
    or new.preview_digest is distinct from old.preview_digest
    or new.confirmation_policy is distinct from old.confirmation_policy
    or new.created_at is distinct from old.created_at
  then
    raise exception using errcode = '22023', message = 'Action proposal identity is immutable';
  end if;
  return new;
end;
$$;

create trigger protect_action_proposal_identity
before update on public.action_proposals
for each row execute function public.prevent_action_identity_change();

-- Claiming is a single transaction: it locks the proposal, verifies the exact
-- preview the user approved, and reserves the idempotency key before any
-- external side effect begins.
create or replace function public.claim_action_execution(
  p_proposal_id uuid,
  p_actor_id uuid,
  p_preview_digest text,
  p_confirmation_digest text default null
)
returns table(execution_id uuid, execution_status text, duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.action_proposals%rowtype;
  v_execution public.action_executions%rowtype;
begin
  select * into v_proposal
  from public.action_proposals
  where id = p_proposal_id
  for update;

  if not found or v_proposal.actor_id <> p_actor_id then
    raise exception using errcode = 'P0002', message = 'Action proposal not found';
  end if;

  select * into v_execution
  from public.action_executions
  where idempotency_key = v_proposal.idempotency_key;

  if found then
    return query select v_execution.id, v_execution.status, true;
    return;
  end if;

  if v_proposal.status <> 'pending' then
    raise exception using errcode = '55000', message = 'Action proposal is not executable';
  end if;
  if v_proposal.expires_at <= now() then
    update public.action_proposals set status = 'expired' where id = v_proposal.id;
    raise exception using errcode = '22023', message = 'Action proposal expired';
  end if;
  if v_proposal.preview_digest is null or v_proposal.preview_digest <> p_preview_digest then
    raise exception using errcode = '40001', message = 'Action preview is stale';
  end if;
  if v_proposal.confirmation_policy = 'never' then
    raise exception using errcode = '42501', message = 'This action cannot be executed';
  end if;
  if v_proposal.confirmation_policy = 'explicit'
    and (p_confirmation_digest is null or p_confirmation_digest <> p_preview_digest)
  then
    raise exception using errcode = '42501', message = 'Exact preview confirmation is required';
  end if;

  update public.action_proposals
  set status = 'accepted', accepted_at = now()
  where id = v_proposal.id;

  insert into public.action_executions (
    proposal_id, actor_id, action_key, risk, status, idempotency_key,
    record_type, record_id, before_digest, source, confirmation_digest
  ) values (
    v_proposal.id, v_proposal.actor_id, v_proposal.action_key,
    v_proposal.risk, 'running', v_proposal.idempotency_key,
    v_proposal.record_type, v_proposal.record_id, p_preview_digest,
    v_proposal.source, p_confirmation_digest
  )
  returning * into v_execution;

  return query select v_execution.id, v_execution.status, false;
end;
$$;

create or replace function public.finish_action_execution(
  p_execution_id uuid,
  p_actor_id uuid,
  p_status text,
  p_before_state jsonb default null,
  p_after_state jsonb default null,
  p_after_digest text default null,
  p_error_code text default null,
  p_error_summary text default null
)
returns public.action_executions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_execution public.action_executions%rowtype;
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception using errcode = '22023', message = 'Invalid terminal action status';
  end if;

  select * into v_execution
  from public.action_executions
  where id = p_execution_id and actor_id = p_actor_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Action execution not found';
  end if;
  if v_execution.status <> 'running' then
    return v_execution;
  end if;

  update public.action_executions
  set status = p_status,
      before_state = p_before_state,
      after_state = p_after_state,
      after_digest = p_after_digest,
      error_code = p_error_code,
      error_summary = left(p_error_summary, 500),
      completed_at = now()
  where id = p_execution_id
  returning * into v_execution;

  update public.action_proposals
  set status = case when p_status = 'succeeded' then 'executed' else 'failed' end,
      executed_at = case when p_status = 'succeeded' then now() else executed_at end
  where id = v_execution.proposal_id;

  return v_execution;
end;
$$;

revoke all on function public.claim_action_execution(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finish_action_execution(uuid, uuid, text, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_action_execution(uuid, uuid, text, text) to service_role;
grant execute on function public.finish_action_execution(uuid, uuid, text, jsonb, jsonb, text, text, text) to service_role;

comment on column public.action_proposals.preview_digest is
  'SHA-256 of the normalized server preview. Execution is refused when current state no longer matches.';
comment on column public.action_proposals.reference_payload is
  'Minimal allowlisted execution input. Browser SELECT is denied; communication bodies and confirmed legal facts should remain in source tables and be referenced by id.';
comment on column public.action_executions.before_state is
  'Allowlisted, non-sensitive audit projection; message bodies and legal facts are excluded.';
comment on function public.claim_action_execution(uuid, uuid, text, text) is
  'Atomically verifies approval and reserves the idempotency key before a side effect.';
