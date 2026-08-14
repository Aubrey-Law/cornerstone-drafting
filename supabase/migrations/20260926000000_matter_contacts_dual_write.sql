-- Step 2 of docs/matter-contacts-migration.md: dual-write.
--
-- Step 1 backfilled `matter_contacts` from the 1:1 edges that existed at the
-- time. From here every new contact, and every new matter, has to land in both
-- representations or the join drifts out of date before step 3 can read it.
--
-- The spec called for "every contact write populates both". There are 24 such
-- writes across 13 TypeScript files, plus six SECURITY DEFINER functions that
-- write `contacts` from SQL and never go through the app at all
-- (update_lead_opportunity_field, update_lead_opportunity_details, and the
-- matter/lead creation RPCs). Patching each is fragile in the way that matters
-- most here: a missed one diverges silently, and the check in step 3 is a
-- reader that has already flipped. So the dual-write lives in the database
-- instead — one mechanism, covering TypeScript and SQL alike, that no writer
-- can bypass.
--
-- Deletes need no trigger: matter_contacts cascades on both foreign keys.

-- ── Finding a matter's primary client ───────────────────────────────────────
--
-- Resolved through the join first and the source key only as a fallback, so
-- nothing downstream depends on the 'backfill_self:' string step 1 stamped.

create or replace function public.self_contact_for_intake(p_intake_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select mc.contact_id
      from public.matter_contacts mc
      join public.matters m on m.id = mc.matter_id
      where m.client_intake_id = p_intake_id
        and mc.relationship_type = 'self'
      limit 1
    ),
    (
      select c.id
      from public.contacts c
      where c.source = 'backfill_self:' || p_intake_id::text
      limit 1
    )
  );
$$;

comment on function public.self_contact_for_intake(uuid) is
  'The contacts row standing for the client of this intake, or null if none exists yet.';

-- ── A new matter joins its household ────────────────────────────────────────
--
-- Matter creation is the moment a self contact becomes necessary: the intake
-- exists before it (create_matter_with_client inserts one, ensure_lead_matter
-- fires off one), but nothing needs a person row until there is a matter to
-- attach it to.

create or replace function public.sync_matter_contacts_from_matter()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_self_id uuid;
begin
  if new.client_intake_id is null then
    return new;
  end if;

  v_self_id := public.self_contact_for_intake(new.client_intake_id);

  if v_self_id is null then
    insert into public.contacts (
      client_intake_id, relationship_type, first_name, middle_name, last_name,
      suffix, preferred_name, preferred_pronoun, prior_names, date_of_birth,
      is_us_citizen, citizenship_status, email, phone, address_line1,
      address_line2, city, state, zip, county, additional_emails,
      additional_phones, source
    )
    select
      null, 'self', ci.first_name, ci.middle_name, ci.last_name, ci.suffix,
      ci.preferred_name, ci.preferred_pronoun, ci.prior_names, ci.date_of_birth,
      ci.is_us_citizen, ci.citizenship_status, ci.email, ci.phone,
      ci.address_line1, ci.address_line2, ci.city, ci.state, ci.zip, ci.county,
      coalesce(ci.additional_emails, '[]'::jsonb),
      coalesce(ci.additional_phones, '[]'::jsonb),
      'backfill_self:' || ci.id::text
    from public.client_intake ci
    where ci.id = new.client_intake_id
    returning id into v_self_id;
  end if;

  if v_self_id is not null then
    insert into public.matter_contacts (matter_id, contact_id, relationship_type)
    values (new.id, v_self_id, 'self')
    on conflict (matter_id, contact_id) do nothing;
  end if;

  -- Everyone already in the household. A matter opened for an existing client
  -- inherits their spouse, children and fiduciaries rather than re-collecting
  -- them — the whole point of the join.
  insert into public.matter_contacts (
    matter_id, contact_id, relationship_type, relationship_label,
    child_relationship, parentage, from_prior_relationship, is_minor
  )
  select
    new.id, c.id, c.relationship_type, c.relationship_label,
    c.child_relationship, c.parentage, c.from_prior_relationship, c.is_minor
  from public.contacts c
  where c.client_intake_id = new.client_intake_id
    -- Guard the partial unique indexes, which ON CONFLICT cannot reach.
    and not exists (
      select 1 from public.matter_contacts existing
      where existing.matter_id = new.id
        and existing.relationship_type = c.relationship_type
        and c.relationship_type in ('self', 'spouse')
    )
  on conflict (matter_id, contact_id) do nothing;

  return new;
end
$$;

drop trigger if exists sync_matter_contacts_from_matter on public.matters;
create trigger sync_matter_contacts_from_matter
  after insert on public.matters
  for each row execute function public.sync_matter_contacts_from_matter();

-- ── A new or changed contact joins its household's matters ──────────────────

create or replace function public.sync_matter_contacts_from_contact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Self contacts carry no intake FK and are maintained by the matter trigger.
  if new.relationship_type = 'self' then
    return new;
  end if;

  -- Detached from a household, or moved to another one: the join rows for the
  -- old household's matters no longer describe anything.
  if tg_op = 'UPDATE' and old.client_intake_id is distinct from new.client_intake_id then
    delete from public.matter_contacts mc
    using public.matters m
    where mc.matter_id = m.id
      and mc.contact_id = new.id
      and m.client_intake_id is not distinct from old.client_intake_id;
  end if;

  if new.client_intake_id is null then
    return new;
  end if;

  insert into public.matter_contacts (
    matter_id, contact_id, relationship_type, relationship_label,
    child_relationship, parentage, from_prior_relationship, is_minor
  )
  select
    m.id, new.id, new.relationship_type, new.relationship_label,
    new.child_relationship, new.parentage, new.from_prior_relationship, new.is_minor
  from public.matters m
  where m.client_intake_id = new.client_intake_id
    and not exists (
      select 1 from public.matter_contacts existing
      where existing.matter_id = m.id
        and existing.relationship_type = new.relationship_type
        and existing.contact_id <> new.id
        and new.relationship_type in ('self', 'spouse')
    )
  on conflict (matter_id, contact_id) do update set
    relationship_type       = excluded.relationship_type,
    relationship_label      = excluded.relationship_label,
    child_relationship      = excluded.child_relationship,
    parentage               = excluded.parentage,
    from_prior_relationship = excluded.from_prior_relationship,
    is_minor                = excluded.is_minor;

  return new;
end
$$;

drop trigger if exists sync_matter_contacts_from_contact on public.contacts;
create trigger sync_matter_contacts_from_contact
  after insert or update of client_intake_id, relationship_type, relationship_label,
    child_relationship, parentage, from_prior_relationship, is_minor
  on public.contacts
  for each row execute function public.sync_matter_contacts_from_contact();

-- ── Keeping the self contact and its intake in step ─────────────────────────
--
-- Step 1 installed the write-through from the self contact to client_intake,
-- against the day `contacts` becomes authoritative. Until step 3 flips the
-- readers the app still writes client_intake, so the reverse direction has to
-- exist too — otherwise the self contacts go stale the first time anyone edits
-- a client's name.
--
-- Two triggers writing to each other recurse. Both directions are therefore
-- guarded to write only when a value actually differs: the answering write
-- matches zero rows, fires no trigger, and the cycle stops after one hop.

create or replace function public.sync_self_contact_from_intake()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_self_id uuid;
begin
  v_self_id := public.self_contact_for_intake(new.id);
  if v_self_id is null then
    return new;
  end if;

  update public.contacts c
  set first_name         = new.first_name,
      middle_name        = new.middle_name,
      last_name          = new.last_name,
      suffix             = new.suffix,
      preferred_name     = new.preferred_name,
      preferred_pronoun  = new.preferred_pronoun,
      prior_names        = new.prior_names,
      date_of_birth      = new.date_of_birth,
      is_us_citizen      = new.is_us_citizen,
      citizenship_status = new.citizenship_status,
      email              = new.email,
      phone              = new.phone,
      address_line1      = new.address_line1,
      address_line2      = new.address_line2,
      city               = new.city,
      state              = new.state,
      zip                = new.zip,
      county             = new.county,
      updated_at         = now()
  where c.id = v_self_id
    and (
      c.first_name         is distinct from new.first_name
      or c.middle_name     is distinct from new.middle_name
      or c.last_name       is distinct from new.last_name
      or c.suffix          is distinct from new.suffix
      or c.preferred_name  is distinct from new.preferred_name
      or c.preferred_pronoun is distinct from new.preferred_pronoun
      or c.prior_names     is distinct from new.prior_names
      or c.date_of_birth   is distinct from new.date_of_birth
      or c.is_us_citizen   is distinct from new.is_us_citizen
      or c.citizenship_status is distinct from new.citizenship_status
      or c.email           is distinct from new.email
      or c.phone           is distinct from new.phone
      or c.address_line1   is distinct from new.address_line1
      or c.address_line2   is distinct from new.address_line2
      or c.city            is distinct from new.city
      or c.state           is distinct from new.state
      or c.zip             is distinct from new.zip
      or c.county          is distinct from new.county
    );

  return new;
end
$$;

drop trigger if exists sync_self_contact_from_intake on public.client_intake;
create trigger sync_self_contact_from_intake
  after update of first_name, middle_name, last_name, suffix, preferred_name,
    preferred_pronoun, prior_names, date_of_birth, is_us_citizen,
    citizenship_status, email, phone, address_line1, address_line2, city,
    state, zip, county
  on public.client_intake
  for each row execute function public.sync_self_contact_from_intake();

-- The other half of the cycle. Identical to
-- 20260925000000_matter_contacts_join.sql apart from the same-value guard,
-- which is what stops the two triggers recursing.

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
  set first_name         = new.first_name,
      middle_name        = new.middle_name,
      last_name          = new.last_name,
      suffix             = new.suffix,
      preferred_name     = new.preferred_name,
      preferred_pronoun  = new.preferred_pronoun,
      prior_names        = new.prior_names,
      date_of_birth      = new.date_of_birth,
      is_us_citizen      = new.is_us_citizen,
      citizenship_status = new.citizenship_status,
      email              = new.email,
      phone              = new.phone,
      address_line1      = new.address_line1,
      address_line2      = new.address_line2,
      city               = new.city,
      state              = new.state,
      zip                = new.zip,
      county             = new.county,
      updated_at         = now()
  where ci.id in (
    select m.client_intake_id
    from public.matter_contacts mc
    join public.matters m on m.id = mc.matter_id
    where mc.contact_id = new.id
      and mc.relationship_type = 'self'
      and m.client_intake_id is not null
  )
    and (
      ci.first_name        is distinct from new.first_name
      or ci.middle_name    is distinct from new.middle_name
      or ci.last_name      is distinct from new.last_name
      or ci.suffix         is distinct from new.suffix
      or ci.preferred_name is distinct from new.preferred_name
      or ci.preferred_pronoun is distinct from new.preferred_pronoun
      or ci.prior_names    is distinct from new.prior_names
      or ci.date_of_birth  is distinct from new.date_of_birth
      or ci.is_us_citizen  is distinct from new.is_us_citizen
      or ci.citizenship_status is distinct from new.citizenship_status
      or ci.email          is distinct from new.email
      or ci.phone          is distinct from new.phone
      or ci.address_line1  is distinct from new.address_line1
      or ci.address_line2  is distinct from new.address_line2
      or ci.city           is distinct from new.city
      or ci.state          is distinct from new.state
      or ci.zip            is distinct from new.zip
      or ci.county         is distinct from new.county
    );

  return new;
end
$$;

-- ── contact_roles get their matter without the writers changing ─────────────
--
-- persistFiduciaryRoles and persistAdminFiduciaries both write contact_roles
-- keyed on the intake. Filling matter_id here keeps step 3's re-key from
-- inheriting a column that is only populated for rows that predate it.

create or replace function public.sync_contact_role_matter()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.matter_id is not null or new.client_intake_id is null then
    return new;
  end if;

  -- Deliberately unset when the intake carries more than one matter: guessing
  -- would silently attach an appointment to the wrong engagement, and the
  -- consistency check reports it instead.
  select m.id into new.matter_id
  from public.matters m
  where m.client_intake_id = new.client_intake_id
  limit 2;

  if (select count(*) from public.matters m where m.client_intake_id = new.client_intake_id) > 1 then
    new.matter_id := null;
  end if;

  return new;
end
$$;

drop trigger if exists sync_contact_role_matter on public.contact_roles;
create trigger sync_contact_role_matter
  before insert on public.contact_roles
  for each row execute function public.sync_contact_role_matter();

notify pgrst, 'reload schema';
