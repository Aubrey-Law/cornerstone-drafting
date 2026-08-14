-- Step 1 of docs/matter-contacts-migration.md: one person, many matters.
--
-- A contact is pinned to one household today (contacts.client_intake_id), and a
-- household is one matter, so a returning client or a child's College Prep plan
-- mints a duplicate person. This adds the join that lets one person hold many
-- matters, and backfills it from the 1:1 edges already in the data.
--
-- ADDITIVE ONLY. `contacts.client_intake_id` stays populated and authoritative;
-- nothing reads `matter_contacts` yet. Step 2 dual-writes, step 3 flips the
-- readers. Reversible by dropping what this creates.
--
-- The one thing that is not purely additive is the self promotion: the client
-- themself has no `contacts` row today (their person fields live on
-- `client_intake`, and getHousehold synthesizes them with contact_id null), and
-- the join cannot express "parent is self on matter A, child on matter B" until
-- they do. Those new rows are kept invisible to every existing reader — see
-- "Keeping the self rows invisible" below.

-- ── matter_contacts ─────────────────────────────────────────────────────────
--
-- Column split: `contacts` keeps facts intrinsic to a person (name, DOB,
-- address, contact details). Facts stated *relative to a matter's primary
-- client* live here, because the same human is `self` on their own College Prep
-- matter and `child` on their parents' estate matter. Leaving them on `contacts`
-- would rebuild the one-household assumption inside a table that no longer has a
-- household column.
--
-- During steps 1-2 these columns duplicate their `contacts` counterparts. That
-- redundancy is deliberate and ends when step 3 flips the readers and the
-- `contacts` copies are dropped.

create table if not exists public.matter_contacts (
  id                     uuid primary key default gen_random_uuid(),
  matter_id              uuid not null references public.matters(id) on delete cascade,
  contact_id             uuid not null references public.contacts(id) on delete cascade,
  relationship_type      text not null,
  relationship_label     text,
  for_party              text,
  child_relationship     text,
  parentage              text,
  from_prior_relationship boolean,
  is_minor               boolean,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (matter_id, contact_id)
);

comment on table public.matter_contacts is
  'Join between a matter and every person on it. One row per person per matter; '
  'carries the facts that are relative to the matter rather than intrinsic to the person.';
comment on column public.matter_contacts.relationship_type is
  'This person''s relationship to the matter''s primary client: self | spouse | child | other. '
  'Deliberately un-CHECKed — contacts.relationship_type carries free-text and legacy '
  '''client'' values that the backfill copies across verbatim rather than flattening.';
comment on column public.matter_contacts.for_party is
  'Which side of a joint matter this person belongs to (client | spouse), where it matters.';

-- One primary client and one spouse per matter. Replaces uq_contacts_one_spouse,
-- which is keyed on the intake and cannot survive a client with two matters.
create unique index if not exists matter_contacts_one_self
  on public.matter_contacts (matter_id) where relationship_type = 'self';
create unique index if not exists matter_contacts_one_spouse
  on public.matter_contacts (matter_id) where relationship_type = 'spouse';

-- "Every matter this person is on" — the query the whole feature exists for.
create index if not exists matter_contacts_contact_idx
  on public.matter_contacts (contact_id);

drop trigger if exists set_updated_at_matter_contacts on public.matter_contacts;
create trigger set_updated_at_matter_contacts
  before update on public.matter_contacts
  for each row execute function public.set_updated_at();

-- ── contact_roles gets a matter ─────────────────────────────────────────────
--
-- Fiduciary appointments are per matter, not per person: a trustee named in a
-- 2024 trust is not automatically the trustee of a 2026 second engagement.
-- `client_intake_id` stays until step 3 so persistFiduciaryRoles keeps working.

alter table public.contact_roles
  add column if not exists matter_id uuid references public.matters(id) on delete cascade;

create index if not exists contact_roles_matter_idx
  on public.contact_roles (matter_id);

comment on column public.contact_roles.matter_id is
  'The matter this appointment belongs to. Backfilled from client_intake_id, which '
  'is retired in step 3 of docs/matter-contacts-migration.md.';

-- ── Keeping the self rows invisible ─────────────────────────────────────────
--
-- Self contacts are inserted with client_intake_id NULL, so every intake-scoped
-- reader (getHousehold, persistFiduciaryRoles' name matching, the leads spouse
-- reads, buildDraftPayload) cannot see them. Two readers query `contacts`
-- without an intake filter and would surface them as standalone people — those
-- are excluded in lib/queries/contactsDirectory.ts and lib/queries/firmDirectory.ts.
--
-- The third is this trigger: it mints a cornerstone_crm_people row per contact,
-- which would duplicate the CRM person that sync_crm_person_from_intake already
-- maintains for the same human. Redefined here to skip self contacts. Identical
-- to 20260902000000_unify_crm_hub.sql:761 apart from that early return.

create or replace function public.sync_crm_person_from_contact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_stage_id uuid;
begin
  -- A self contact IS the client, who already has a CRM person from their
  -- intake (sync_crm_person_from_intake). Mirroring it here would show the
  -- same human twice in the CRM hub.
  if new.relationship_type = 'self' then
    return new;
  end if;

  if trim(concat_ws(' ', new.first_name, new.last_name)) = ''
     or lower(trim(concat_ws(' ', new.first_name, new.last_name))) in ('tbd', 'to be determined') then
    delete from public.cornerstone_crm_people where contact_id = new.id;
    return new;
  end if;

  select id into v_stage_id from public.cornerstone_crm_stages where slug = 'new_inquiry';
  insert into public.cornerstone_crm_people (
    source_system, contact_id, person_kind, record_status, first_name, last_name,
    email, phone, city, state, lifecycle_status, stage_id, sync_state
  ) values (
    'contact', new.id,
    case when new.client_intake_id is null then 'standalone' else 'related' end,
    case when coalesce(new.deceased, false) then 'deceased' else 'active' end,
    new.first_name, new.last_name, nullif(trim(new.email), ''), nullif(trim(new.phone), ''),
    new.city, new.state, 'new', v_stage_id, 'pending'
  )
  on conflict (contact_id) where contact_id is not null do update set
    person_kind = excluded.person_kind,
    record_status = excluded.record_status,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    email = excluded.email,
    phone = excluded.phone,
    city = excluded.city,
    state = excluded.state,
    updated_at = now();
  return new;
end
$$;

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Idempotent: re-running produces the same rows. Deliberately does NOT
-- deduplicate people — two contacts rows for the same human stay two rows.
-- Merging is destructive and attorney-reviewed (step 6), and a migration that
-- merged on matching email would merge a couple who share an inbox.

-- 1. One self contact per intake that has at least one matter, copied from the
--    intake's person columns. Keyed per intake rather than per matter so an
--    intake carrying two matters yields one person on both, not two people.
insert into public.contacts (
  client_intake_id, relationship_type, first_name, middle_name, last_name, suffix,
  preferred_name, preferred_pronoun, prior_names, date_of_birth, is_us_citizen,
  citizenship_status, email, phone, address_line1, address_line2, city, state,
  zip, county, additional_emails, additional_phones, source
)
select
  null, 'self', ci.first_name, ci.middle_name, ci.last_name, ci.suffix,
  ci.preferred_name, ci.preferred_pronoun, ci.prior_names, ci.date_of_birth,
  ci.is_us_citizen, ci.citizenship_status, ci.email, ci.phone, ci.address_line1,
  ci.address_line2, ci.city, ci.state, ci.zip, ci.county,
  coalesce(ci.additional_emails, '[]'::jsonb), coalesce(ci.additional_phones, '[]'::jsonb),
  'backfill_self:' || ci.id::text
from public.client_intake ci
where exists (select 1 from public.matters m where m.client_intake_id = ci.id)
  and not exists (
    select 1 from public.contacts c
    where c.source = 'backfill_self:' || ci.id::text
  )
  -- A matter that already names its primary client needs no synthesized one.
  -- On a first run nothing does; this is what keeps a re-run after step 5 from
  -- minting an orphan person beside a real self contact.
  and not exists (
    select 1
    from public.matters m
    join public.matter_contacts mc on mc.matter_id = m.id and mc.relationship_type = 'self'
    where m.client_intake_id = ci.id
  );

-- 2. Join the self contacts to every matter of their intake.
insert into public.matter_contacts (matter_id, contact_id, relationship_type)
select m.id, c.id, 'self'
from public.matters m
join public.contacts c on c.source = 'backfill_self:' || m.client_intake_id::text
-- `on conflict (matter_id, contact_id)` does not cover matter_contacts_one_self,
-- so a matter that already names a different person as its client would raise
-- rather than skip. Guard the partial index explicitly.
where not exists (
  select 1 from public.matter_contacts existing
  where existing.matter_id = m.id and existing.relationship_type = 'self'
)
on conflict (matter_id, contact_id) do nothing;

-- 3. Join every existing contact to its household's matters, carrying the
--    matter-relative facts across.
insert into public.matter_contacts (
  matter_id, contact_id, relationship_type, relationship_label,
  child_relationship, parentage, from_prior_relationship, is_minor
)
select
  m.id, c.id, c.relationship_type, c.relationship_label,
  c.child_relationship, c.parentage, c.from_prior_relationship, c.is_minor
from public.contacts c
join public.matters m on m.client_intake_id = c.client_intake_id
where c.client_intake_id is not null
  -- Same partial-index guard as above. uq_contacts_one_spouse already caps this
  -- at one spouse per intake, so on a first run the subquery never matches.
  and not exists (
    select 1 from public.matter_contacts existing
    where existing.matter_id = m.id
      and existing.relationship_type = c.relationship_type
      and c.relationship_type in ('self', 'spouse')
  )
on conflict (matter_id, contact_id) do nothing;

-- 4. Point every role at the matter its intake resolves to. An intake with two
--    matters would make this ambiguous; the pre-flight audit in
--    docs/matter-contacts-migration.md §3 confirms there are none, and the
--    assertion below fails the migration rather than guessing if that changes.
do $$
declare
  v_ambiguous integer;
begin
  select count(*) into v_ambiguous
  from (
    select cr.id
    from public.contact_roles cr
    join public.matters m on m.client_intake_id = cr.client_intake_id
    where cr.client_intake_id is not null
      -- Only roles still awaiting a matter. A role backfilled on an earlier run
      -- is settled history, not an ambiguity to re-litigate on every re-run.
      and cr.matter_id is null
    group by cr.id
    having count(m.id) > 1
  ) ambiguous;

  if v_ambiguous > 0 then
    raise exception
      'Cannot backfill contact_roles.matter_id: % role(s) belong to an intake with more '
      'than one matter, so the target matter is ambiguous. Resolve by hand, then re-run. '
      'Inspect with: select cr.id, cr.client_intake_id, array_agg(m.id) from public.contact_roles cr '
      'join public.matters m on m.client_intake_id = cr.client_intake_id group by cr.id, '
      'cr.client_intake_id having count(m.id) > 1;',
      v_ambiguous;
  end if;
end
$$;

update public.contact_roles cr
set matter_id = m.id
from public.matters m
where m.client_intake_id = cr.client_intake_id
  and cr.matter_id is null;

-- ── Write-through: contacts(self) → client_intake ───────────────────────────
--
-- `contacts` becomes authoritative for the self person, but client_intake's
-- person columns are read across the leads UI, engagement rendering and email
-- templates. Rather than repoint all of them now, keep them as a projection —
-- the same pattern sync_crm_person_from_contact/_from_intake already use for
-- cornerstone_crm_people.
--
-- UPDATE only, not INSERT: the backfill above copies *from* client_intake, so
-- firing on insert would write identical values back and bump
-- client_intake.updated_at on every row — which lead aging and list ordering
-- read. Nothing writes self contacts until step 2, so this trigger is inert
-- until the dual-write lands.
--
-- Fans out over matter_contacts because a self contact may reach more than one
-- intake once a client has two matters.

create or replace function public.sync_intake_from_self_contact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.relationship_type <> 'self' then
    return new;
  end if;

  update public.client_intake ci
  set first_name        = new.first_name,
      middle_name       = new.middle_name,
      last_name         = new.last_name,
      suffix            = new.suffix,
      preferred_name    = new.preferred_name,
      preferred_pronoun = new.preferred_pronoun,
      prior_names       = new.prior_names,
      date_of_birth     = new.date_of_birth,
      is_us_citizen     = new.is_us_citizen,
      citizenship_status = new.citizenship_status,
      email             = new.email,
      phone             = new.phone,
      address_line1     = new.address_line1,
      address_line2     = new.address_line2,
      city              = new.city,
      state             = new.state,
      zip               = new.zip,
      county            = new.county,
      updated_at        = now()
  where ci.id in (
    select m.client_intake_id
    from public.matter_contacts mc
    join public.matters m on m.id = mc.matter_id
    where mc.contact_id = new.id
      and mc.relationship_type = 'self'
      and m.client_intake_id is not null
  );

  return new;
end
$$;

drop trigger if exists sync_intake_from_self_contact on public.contacts;
create trigger sync_intake_from_self_contact
  after update of first_name, middle_name, last_name, suffix, preferred_name,
    preferred_pronoun, prior_names, date_of_birth, is_us_citizen,
    citizenship_status, email, phone, address_line1, address_line2, city,
    state, zip, county
  on public.contacts
  for each row execute function public.sync_intake_from_self_contact();

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- Mirrors the existing contacts policies: staff see everything, a portal client
-- sees the join rows for matters their intake owns. The contacts policies
-- themselves are rewritten in step 4, when the readers actually traverse this
-- table.

alter table public.matter_contacts enable row level security;

drop policy if exists "clients_read_own_matter_contacts" on public.matter_contacts;
create policy "clients_read_own_matter_contacts"
  on public.matter_contacts for select to authenticated
  using (
    exists (
      select 1
      from public.matters m
      join public.client_intake ci on ci.id = m.client_intake_id
      where m.id = matter_contacts.matter_id
        and (ci.user_id = auth.uid() or ci.client_user_id = auth.uid())
    )
  );

drop policy if exists "attorneys_all_matter_contacts" on public.matter_contacts;
create policy "attorneys_all_matter_contacts"
  on public.matter_contacts for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin')));

notify pgrst, 'reload schema';
