-- Conflict-of-interest checks at lead creation.
--
-- A new lead was never searched against the people the firm already knows:
-- clients and former clients, their spouses, the beneficiaries and fiduciaries
-- named on their plans, and other leads. matter_details carried three unused
-- columns for it (conflict_check_completed, conflict_check_date,
-- conflict_cleared) and nothing wrote them. Now every new lead is searched by
-- email, phone and name across intakes, matters and contacts as soon as it is
-- created, the result is kept here, a possible match becomes a task through
-- the delegation dial, and the attorney records the decision on the lead.
--
-- One row per run. The newest row for a lead is its current check; older rows
-- are the history of what was searched and decided, which is what a bar
-- complaint asks for.

create table if not exists public.conflict_checks (
  id               uuid primary key default gen_random_uuid(),
  client_intake_id uuid not null references public.client_intake(id) on delete cascade,
  matter_id        uuid references public.matters(id) on delete set null,

  -- What the search found: nothing, or something a person must look at.
  result           text not null check (result in ('clear', 'possible')),
  -- What the attorney decided about it. 'pending' until someone looks; a
  -- clear result needs no decision and is stored as 'no_conflict'.
  decision         text not null default 'pending'
    check (decision in ('pending', 'no_conflict', 'conflict')),

  -- The names, emails and phones searched, and every record they matched with
  -- how (email, phone, name) and how strongly.
  query            jsonb not null default '{}'::jsonb,
  hits             jsonb not null default '[]'::jsonb,

  checked_at       timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       uuid references auth.users(id) on delete set null,
  note             text,
  created_at       timestamptz not null default now()
);

create index if not exists conflict_checks_lead_checked_idx
  on public.conflict_checks (client_intake_id, checked_at desc);

alter table public.conflict_checks enable row level security;

-- Staff only. Nothing here is the client's to see.
drop policy if exists conflict_checks_staff_all on public.conflict_checks;
create policy conflict_checks_staff_all
  on public.conflict_checks for all to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.role in ('attorney', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.role in ('attorney', 'admin')
    )
  );

grant select, insert, update, delete on public.conflict_checks to authenticated;

comment on table public.conflict_checks is
  'Conflict-of-interest searches run on a lead (newest row is current): what was '
  'searched, what it matched across intakes, matters and contacts, and the '
  'attorney''s decision. See lib/conflicts/match.ts.';

notify pgrst, 'reload schema';
