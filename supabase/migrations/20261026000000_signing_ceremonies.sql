-- What actually happened at the signing.
--
-- The execution engine says what each document needs. This records what it
-- got: who witnessed, whether a notary was there, when a deed reached the
-- Registry. That record is the firm's answer years later when someone asks
-- whether a will was properly executed, and the people who could remember have
-- moved on.
--
-- Deliberately not e-signature. Most of an estate plan cannot be signed
-- electronically in Massachusetts — a will needs wet signatures and two
-- witnesses in the room, a deed needs an acknowledgment — so this describes a
-- meeting rather than replacing one.

create table if not exists public.signing_ceremonies (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,

  scheduled_for timestamptz,
  location text,

  -- Named rather than referenced. A witness is usually a paralegal or a
  -- neighbour who exists in no table here, and inventing contact rows for them
  -- would make the record harder to complete and no more true.
  notary_name text,
  witness_one_name text,
  witness_two_name text,

  -- Recorded so the disqualification can be checked: the person appointed as
  -- health care agent may not witness the proxy appointing them
  -- (G.L. c. 201D, § 2). Asking the question is most of the check.
  health_care_agent_name text,

  status text not null default 'scheduled'
    check (status = any (array['scheduled', 'completed', 'cancelled'])),
  completed_at timestamptz,
  note text,

  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A ceremony marked complete without a time is a record of nothing.
  constraint signing_ceremonies_completed_needs_time
    check (status <> 'completed' or completed_at is not null)
);

create index if not exists signing_ceremonies_matter_idx
  on public.signing_ceremonies (matter_id);

comment on table public.signing_ceremonies is
  'One signing appointment for a matter: when, where, and who filled the witness and notary roles.';

-- One row per document actually put in front of the client.
create table if not exists public.ceremony_documents (
  id uuid primary key default gen_random_uuid(),
  ceremony_id uuid not null references public.signing_ceremonies(id) on delete cascade,

  document_kind text not null
    check (document_kind = any (array[
      'will', 'trust', 'dpoa', 'health_care_proxy', 'hipaa_authorization',
      'advance_directive', 'deed', 'homestead_declaration', 'certificate_of_trust',
      'assignment_of_personal_property', 'personal_property_memorandum',
      'parental_guardian_appointment'
    ])),

  executed boolean not null default false,
  signed_on date,

  -- The count rather than the names: what makes a will valid is that two people
  -- witnessed it, and the names are on the instrument itself.
  witness_count integer not null default 0 check (witness_count between 0 and 4),
  notarized boolean not null default false,

  -- Only deeds and homestead declarations reach a Registry, and only after the
  -- appointment — so this is filled in later, not at the table.
  recorded_on date,
  recording_reference text,

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (ceremony_id, document_kind),

  -- Executed without a date is the same failure as a confirmed funding row
  -- without one: a claim about the world with nothing behind it.
  constraint ceremony_documents_executed_needs_date
    check (executed = false or signed_on is not null)
);

create index if not exists ceremony_documents_ceremony_idx
  on public.ceremony_documents (ceremony_id);

comment on column public.ceremony_documents.witness_count is
  'How many people actually witnessed. Compared against the requirement for the kind; a will with one is not a will.';

-- Staff read; writes go through the service-role admin client, matching every
-- other matter-adjacent table here.
alter table public.signing_ceremonies enable row level security;
alter table public.ceremony_documents enable row level security;

drop policy if exists "Staff read signing ceremonies" on public.signing_ceremonies;
create policy "Staff read signing ceremonies" on public.signing_ceremonies
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );

drop policy if exists "Staff read ceremony documents" on public.ceremony_documents;
create policy "Staff read ceremony documents" on public.ceremony_documents
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );
