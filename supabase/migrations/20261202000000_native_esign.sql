-- Native in-house e-signature.
--
-- Cornerstone can now sign engagement agreements itself instead of handing the
-- document to a vendor. The provider seam and the shared completion path
-- landed in 20261201000000; this adds the state the native provider needs.
--
-- Additive and replay-safe, and dark by default: nothing selects the native
-- provider until `firm_settings.esign_native_enabled` is turned on, so this
-- release changes no behavior on its own.
--
-- Scope is engagement letters and fee agreements. Wills, trusts, powers of
-- attorney and advance directives are deliberately out: most of an estate plan
-- cannot be signed electronically in Massachusetts, and the execution-ceremony
-- module in apps/workbench owns that (see 20261026000000_signing_ceremonies).

-- ---------------------------------------------------------------------------
-- The cutover flag
-- ---------------------------------------------------------------------------

-- Mirrors billing_milestones_enabled and durable_workflow_jobs_enabled: ships
-- dark, read through a small helper, flipped per firm once verified.
alter table public.firm_settings
  add column if not exists esign_native_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- One signing session per recipient
-- ---------------------------------------------------------------------------

-- token_hash, never the token. A signing link grants the power to execute a
-- fee agreement, so the database stores only what is needed to *verify* one —
-- the same shape as appointments.manage_token_hash and intake invite tokens.
-- A leaked backup then yields no usable link.
create table if not exists public.esign_signing_sessions (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.engagement_agreements(id) on delete cascade,
  recipient_key text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  status text not null default 'sent'
    check (status in ('sent', 'viewed', 'signed', 'declined', 'expired')),
  viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One live session per recipient per agreement. A re-send supersedes rather
  -- than accumulating links that all still work.
  unique (agreement_id, recipient_key)
);

create index if not exists esign_signing_sessions_agreement_idx
  on public.esign_signing_sessions (agreement_id);

-- ---------------------------------------------------------------------------
-- The evidentiary record
-- ---------------------------------------------------------------------------

-- Append-only by grant: this is what the firm would be asked to produce if an
-- engagement were ever disputed, and a record that can be edited after the
-- fact is not evidence. No update or delete is granted to any role below
-- service_role, and nothing in the application issues one.
create table if not exists public.esign_audit_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.esign_signing_sessions(id) on delete set null,
  agreement_id uuid not null references public.engagement_agreements(id) on delete cascade,
  event_type text not null check (event_type in (
    'sent', 'opened', 'consented', 'signed', 'declined', 'sealed', 'emailed'
  )),
  occurred_at timestamptz not null default now(),
  ip inet,
  user_agent text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists esign_audit_events_agreement_idx
  on public.esign_audit_events (agreement_id, occurred_at);
create index if not exists esign_audit_events_session_idx
  on public.esign_audit_events (session_id, occurred_at);

-- ---------------------------------------------------------------------------
-- What the signer actually adopted
-- ---------------------------------------------------------------------------

-- consent_text_sha256 pins the exact ESIGN/UETA disclosure shown at signing.
-- Storing only "consented: true" would leave the firm unable to say *what* was
-- consented to once the wording is revised, which is the question that matters.
create table if not exists public.esign_signature_artifacts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.esign_signing_sessions(id) on delete cascade,
  signature_png_r2_key text,
  typed_name text,
  adoption_method text not null check (adoption_method in ('typed', 'drawn')),
  consent_text_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (session_id),
  -- A drawn signature needs its image; a typed one needs the name. Neither is
  -- optional for its method, or the artifact cannot be re-rendered.
  check (
    (adoption_method = 'drawn' and signature_png_r2_key is not null)
    or (adoption_method = 'typed' and nullif(btrim(typed_name), '') is not null)
  )
);

-- ---------------------------------------------------------------------------
-- RLS — staff read/manage, same shape as the other engagement tables
-- ---------------------------------------------------------------------------

-- No policy grants anon anything. The signing page is public but reaches these
-- rows through the service-role client behind a token-hash check, which is how
-- every other public surface in this repo works (intake invites, booking manage
-- links, engagement approval tokens). The security boundary is the hash
-- comparison in the route, not a database policy.
alter table public.esign_signing_sessions enable row level security;
alter table public.esign_audit_events enable row level security;
alter table public.esign_signature_artifacts enable row level security;

drop policy if exists "Staff manage esign signing sessions" on public.esign_signing_sessions;
create policy "Staff manage esign signing sessions" on public.esign_signing_sessions for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')));

-- Read-only for staff. The audit trail is written by the service role during
-- signing and by nobody else, ever.
drop policy if exists "Staff read esign audit events" on public.esign_audit_events;
create policy "Staff read esign audit events" on public.esign_audit_events for select
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')));

drop policy if exists "Staff read esign signature artifacts" on public.esign_signature_artifacts;
create policy "Staff read esign signature artifacts" on public.esign_signature_artifacts for select
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')));

-- Belt and braces alongside the policies above: even a future policy mistake
-- cannot let a signed-in role rewrite history through PostgREST.
revoke update, delete on public.esign_audit_events from anon, authenticated;
revoke update, delete on public.esign_signature_artifacts from anon, authenticated;

notify pgrst, 'reload schema';
