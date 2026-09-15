-- Provider-neutral e-signature persistence.
--
-- Cornerstone signs engagement agreements through one vendor (Firma). This
-- migration generalises the persistence so a second provider can be selected
-- without another schema change, per
-- docs/superpowers/specs/2026-08-22-esignature-enhancement-design.md.
--
-- Every statement here is additive and replay-safe. The Firma columns and
-- firma_webhook_events stay for the compatibility window: code dual-writes the
-- generic and Firma columns while Firma is a provider, so this release is safe
-- against the previous one (migrations and code ship on the same push in no
-- guaranteed order). Dropping them needs a production data audit and is not
-- part of this change.

-- ---------------------------------------------------------------------------
-- Generic provider identity on the agreement and its recipients
-- ---------------------------------------------------------------------------

alter table public.engagement_agreements
  add column if not exists provider text not null default 'firma',
  add column if not exists external_request_id text,
  add column if not exists last_provider_sync_at timestamptz,
  add column if not exists provider_sync_error text,
  add column if not exists provider_sync_error_at timestamptz;

-- Backfill from the Firma-specific column so existing in-flight agreements are
-- addressable by (provider, external_request_id) immediately.
update public.engagement_agreements
set external_request_id = firma_request_id
where external_request_id is null
  and firma_request_id is not null;

-- Partial, so the many agreements that have not been sent yet do not collide.
create unique index if not exists engagement_agreements_provider_request_key
  on public.engagement_agreements (provider, external_request_id)
  where external_request_id is not null;

alter table public.engagement_agreement_recipients
  add column if not exists external_recipient_id text,
  add column if not exists last_reminded_at timestamptz;

update public.engagement_agreement_recipients
set external_recipient_id = firma_recipient_id
where external_recipient_id is null
  and firma_recipient_id is not null;

-- ---------------------------------------------------------------------------
-- Provider-neutral webhook idempotency
-- ---------------------------------------------------------------------------

-- Keyed on (provider, event_id) rather than event_id alone: two providers can
-- legitimately issue the same event id, and a global unique would let one
-- silently swallow the other's delivery.
create table if not exists public.esign_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  external_request_id text,
  event_type text not null,
  payload jsonb not null,
  agreement_id uuid references public.engagement_agreements(id) on delete set null,
  processing_started_at timestamptz,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

create index if not exists esign_webhook_events_request_idx
  on public.esign_webhook_events (provider, external_request_id);

-- Mirrors claim_firma_webhook_event, keyed by (provider, event_id). Returns
-- 'claimed' | 'duplicate' | 'in_progress'. The five-minute stale window lets a
-- delivery whose handler died be retried rather than wedged in_progress
-- forever.
create or replace function public.claim_esign_webhook_event(
  p_provider text,
  p_event_id text,
  p_external_request_id text,
  p_event_type text,
  p_payload jsonb,
  p_agreement_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claim_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if nullif(btrim(p_provider), '') is null then
    raise exception 'provider required';
  end if;
  if nullif(btrim(p_event_id), '') is null then
    raise exception 'event id required';
  end if;

  insert into public.esign_webhook_events (
    provider,
    event_id,
    external_request_id,
    event_type,
    payload,
    agreement_id,
    processing_started_at,
    error
  )
  values (
    p_provider,
    p_event_id,
    p_external_request_id,
    p_event_type,
    p_payload,
    p_agreement_id,
    statement_timestamp(),
    null
  )
  on conflict (provider, event_id) do update
  set
    external_request_id = excluded.external_request_id,
    event_type = excluded.event_type,
    payload = excluded.payload,
    agreement_id = excluded.agreement_id,
    processing_started_at = statement_timestamp(),
    error = null
  where public.esign_webhook_events.processed_at is null
    and (
      public.esign_webhook_events.error is not null
      or public.esign_webhook_events.processing_started_at is null
      or public.esign_webhook_events.processing_started_at
        < statement_timestamp() - interval '5 minutes'
    )
  returning 'claimed' into claim_status;

  if claim_status is not null then
    return claim_status;
  end if;

  select case
    when processed_at is not null then 'duplicate'
    else 'in_progress'
  end
  into claim_status
  from public.esign_webhook_events
  where provider = p_provider and event_id = p_event_id;

  return coalesce(claim_status, 'in_progress');
end;
$$;

revoke execute on function public.claim_esign_webhook_event(text, text, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_esign_webhook_event(text, text, text, text, jsonb, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Durable evidence metadata
-- ---------------------------------------------------------------------------

-- Providers return a combined PDF, separate signed/certificate PDFs, or both.
-- One row per durable artifact keeps the signed agreement and its audit
-- certificate distinguishable instead of collapsing them into one URL.
create table if not exists public.engagement_esign_artifacts (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.engagement_agreements(id) on delete cascade,
  kind text not null check (kind in ('signed_pdf', 'audit_certificate', 'combined_evidence')),
  provider text not null,
  external_request_id text,
  r2_key text not null unique,
  sha256 text not null,
  byte_size bigint not null check (byte_size >= 0),
  mime_type text not null default 'application/pdf',
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (agreement_id, kind)
);

create index if not exists engagement_esign_artifacts_agreement_idx
  on public.engagement_esign_artifacts (agreement_id);

-- ---------------------------------------------------------------------------
-- RLS — same staff-manage shape as the other engagement tables
-- ---------------------------------------------------------------------------

alter table public.esign_webhook_events enable row level security;
alter table public.engagement_esign_artifacts enable row level security;

drop policy if exists "Staff manage esign webhook events" on public.esign_webhook_events;
create policy "Staff manage esign webhook events" on public.esign_webhook_events for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')));

drop policy if exists "Staff manage engagement esign artifacts" on public.engagement_esign_artifacts;
create policy "Staff manage engagement esign artifacts" on public.engagement_esign_artifacts for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')));

notify pgrst, 'reload schema';
