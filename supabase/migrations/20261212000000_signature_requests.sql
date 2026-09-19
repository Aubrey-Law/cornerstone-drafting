-- Signing something other than an engagement agreement.
--
-- The native engine already knows how to sign a PDF: mint a token, seal the
-- marks onto the bytes, keep an audit trail, print a certificate. None of that
-- is specific to engagement agreements. The *persistence* was:
-- esign_signing_sessions.agreement_id and esign_audit_events.agreement_id are
-- both NOT NULL foreign keys into engagement_agreements, so an uploaded PDF
-- could not get a signing session at all.
--
-- This gives those two tables a second possible owner rather than building a
-- parallel set of tables beside them. One signing route, one token scheme, one
-- audit trail — an executed document's evidence should not depend on which
-- table its parent happened to live in.
--
-- SCOPE. Wills, trusts, powers of attorney and advance directives still cannot
-- be signed this way: Massachusetts requires a witnessed or notarised ceremony
-- (G.L. c. 190B; apps/workbench/lib/execution/requirements.ts holds the
-- detail, and 20261026000000_signing_ceremonies.sql describes the meeting that
-- replaces it). Until now that boundary held by accident, because the only
-- signable thing was an engagement agreement. It cannot hold by accident any
-- more, so signature_requests records an explicit attestation from the
-- attorney who sent it. That is a record of a judgement, not a check — the app
-- cannot read a PDF and know whether it is a will.

-- ---------------------------------------------------------------------------
-- The new owner.
-- ---------------------------------------------------------------------------

create table if not exists public.signature_requests (
  id uuid primary key default gen_random_uuid(),
  -- Always matter-owned. matter_documents.matter_id is text and cannot be
  -- referenced, so the matter is named directly and the source document is
  -- linked by its own uuid.
  matter_id uuid not null references public.matters(id) on delete cascade,
  source_document_id uuid references public.matter_documents(id) on delete set null,
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'viewed', 'partially_signed',
                      'completed', 'cancelled', 'expired', 'failed')),

  -- source_r2_key is the file the attorney uploaded, untouched.
  -- prepared_r2_key is that file with the signature page appended; it is what
  -- recipients actually see and what gets sealed.
  source_r2_key text not null,
  prepared_r2_key text,
  completed_r2_key text,

  -- The G.L. c. 190B attestation: who confirmed this document needs no signing
  -- ceremony, when, and the exact words they were shown. The wording is stored
  -- rather than referenced so that changing the form later cannot alter what a
  -- past sender is recorded as having agreed to. Never backfill it.
  ceremony_attested_by uuid references auth.users(id),
  ceremony_attested_at timestamptz,
  ceremony_attestation_text text,

  provider text not null default 'native',
  external_request_id text,
  send_lease_id uuid,
  send_lease_expires_at timestamptz,
  provider_sync_error text,
  provider_sync_error_at timestamptz,
  sent_by uuid references auth.users(id),
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Attested or not attested, never half of it.
  constraint signature_requests_attestation_complete
    check (num_nonnulls(ceremony_attested_by, ceremony_attested_at, ceremony_attestation_text) in (0, 3)),
  -- Nothing leaves draft without the attestation and the prepared document.
  constraint signature_requests_sendable
    check (
      status = 'draft'
      or (ceremony_attested_by is not null and prepared_r2_key is not null)
    )
);

create index if not exists signature_requests_matter_idx
  on public.signature_requests (matter_id, created_at desc);

create unique index if not exists signature_requests_provider_request_key
  on public.signature_requests (provider, external_request_id)
  where external_request_id is not null;

create table if not exists public.signature_request_recipients (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.signature_requests(id) on delete cascade,
  recipient_order integer not null check (recipient_order > 0),
  -- Joins to esign_signing_sessions.recipient_key. Positional rather than
  -- role-named, because an uploaded document has no notion of "primary" or
  -- "spouse" — the same reason anchor markers are numbered by position.
  recipient_key text not null,
  name text not null check (length(btrim(name)) > 0),
  email text not null check (length(btrim(email)) > 0),
  external_recipient_id text,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'viewed', 'signed', 'declined', 'failed')),
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  last_reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, recipient_order),
  unique (request_id, recipient_key),
  unique (request_id, email)
);

create index if not exists signature_request_recipients_request_idx
  on public.signature_request_recipients (request_id, recipient_order);

-- ---------------------------------------------------------------------------
-- Give the existing tables a second owner.
-- ---------------------------------------------------------------------------

alter table public.esign_signing_sessions
  alter column agreement_id drop not null,
  add column if not exists signature_request_id uuid
    references public.signature_requests(id) on delete cascade;

alter table public.esign_signing_sessions
  drop constraint if exists esign_signing_sessions_owner_check,
  add constraint esign_signing_sessions_owner_check
    check (num_nonnulls(agreement_id, signature_request_id) = 1);

-- The table's existing `unique (agreement_id, recipient_key)` keeps its
-- guarantee for agreements: Postgres treats NULLs as distinct, so document
-- sessions simply do not collide there. They need their own.
create unique index if not exists esign_signing_sessions_request_recipient_key
  on public.esign_signing_sessions (signature_request_id, recipient_key)
  where signature_request_id is not null;

create index if not exists esign_signing_sessions_request_idx
  on public.esign_signing_sessions (signature_request_id)
  where signature_request_id is not null;

alter table public.esign_audit_events
  alter column agreement_id drop not null,
  add column if not exists signature_request_id uuid
    references public.signature_requests(id) on delete cascade;

alter table public.esign_audit_events
  drop constraint if exists esign_audit_events_owner_check,
  add constraint esign_audit_events_owner_check
    check (num_nonnulls(agreement_id, signature_request_id) = 1);

create index if not exists esign_audit_events_request_idx
  on public.esign_audit_events (signature_request_id, occurred_at)
  where signature_request_id is not null;

-- esign_signature_artifacts needs nothing: it hangs off session_id alone and
-- was already owner-agnostic.

-- ---------------------------------------------------------------------------
-- Access. Same four-role staff predicate the e-sign tables already use; the
-- public signing route reaches rows through the service-role client after a
-- token-hash comparison, so there is no anon policy here either.
-- ---------------------------------------------------------------------------

alter table public.signature_requests enable row level security;
alter table public.signature_request_recipients enable row level security;

drop policy if exists "Staff manage signature requests" on public.signature_requests;
create policy "Staff manage signature requests" on public.signature_requests for all
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')
    )
  );

drop policy if exists "Staff manage signature request recipients" on public.signature_request_recipients;
create policy "Staff manage signature request recipients" on public.signature_request_recipients for all
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')
    )
  );

-- The attestation is evidence about who authorised a send. Staff may write it
-- once through the send path; nobody edits it afterwards.
revoke update, delete on public.signature_requests from anon;
revoke update, delete on public.signature_request_recipients from anon;

-- ---------------------------------------------------------------------------
-- The flag, following the firm_settings pattern already used by
-- esign_native_enabled, billing_milestones_enabled and the rest.
-- ---------------------------------------------------------------------------

alter table public.firm_settings
  add column if not exists esign_documents_enabled boolean not null default false;
