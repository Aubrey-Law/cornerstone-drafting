-- Step 5 of docs/matter-contacts-migration.md: open a matter for someone the
-- firm already knows, without duplicating them.
--
-- Decision §12.3 settled that each engagement gets its own `client_intake` row,
-- so this creates one — but the *person* is an existing `contacts` row, and the
-- new matter joins to it rather than minting a second copy.
--
-- The ordering trap (§17): `sync_matter_contacts_from_matter` fires on the
-- matter insert, calls `self_contact_for_intake`, finds nothing for a brand-new
-- intake, and mints a fresh self contact. Correct for a genuinely new client;
-- a duplicate person for a returning one. Repairing afterwards would leave a
-- window where the duplicate exists and would fire the CRM sync on it, so the
-- caller declares the client up front instead and the trigger honours it.

-- ── The declaration ─────────────────────────────────────────────────────────
--
-- Transaction-local, so it cannot leak into another statement on a pooled
-- connection and cannot outlive a rollback.

create or replace function public.sync_matter_contacts_from_matter()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_self_id uuid;
  v_declared text;
begin
  if new.client_intake_id is null then
    return new;
  end if;

  -- open_matter_for_person names the client before inserting the matter. Honour
  -- it rather than minting: this is the whole difference between a returning
  -- client and a duplicate of them.
  v_declared := nullif(current_setting('app.open_matter_self_contact_id', true), '');
  if v_declared is not null then
    v_self_id := v_declared::uuid;
  else
    v_self_id := public.self_contact_for_intake(new.client_intake_id);
  end if;

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

  insert into public.matter_contacts (
    matter_id, contact_id, relationship_type, relationship_label,
    child_relationship, parentage, from_prior_relationship, is_minor
  )
  select
    new.id, c.id, c.relationship_type, c.relationship_label,
    c.child_relationship, c.parentage, c.from_prior_relationship, c.is_minor
  from public.contacts c
  where c.client_intake_id = new.client_intake_id
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

-- ── Open a matter for a known person ────────────────────────────────────────

create or replace function public.open_matter_for_person(
  p_contact_id uuid,
  p_practice_area text,
  p_matter_name text,
  p_matter_number text,
  p_carry_household boolean default true,
  p_extra_contact_ids uuid[] default '{}',
  p_client_user_id uuid default null,
  p_actor_id uuid default null,
  p_request_id uuid default null
)
RETURNS TABLE (matter_id uuid, matter_number text, client_intake_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
-- The RETURNS TABLE columns (matter_id, matter_number, client_intake_id) shadow
-- real column names, which makes `ON CONFLICT (matter_id, contact_id)` ambiguous
-- and the function fail at runtime rather than at create time. Every bare
-- reference below is meant as a column; the OUT values are only ever read
-- through v_matter.
#variable_conflict use_column
DECLARE
  v_person   public.contacts;
  v_intake_id uuid;
  v_matter   public.matters;
  v_source_matter uuid;
  v_full_name text;
BEGIN
  IF coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;

  -- Same idempotency key as create_matter_with_client: a double-click or a
  -- retry after a lost response resolves to one matter.
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_matter FROM public.matters m WHERE m.creation_request_id = p_request_id;
    IF FOUND THEN
      RETURN QUERY SELECT v_matter.id, v_matter.matter_number, v_matter.client_intake_id, false;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_person FROM public.contacts c WHERE c.id = p_contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such person: %', p_contact_id USING errcode = '22023';
  END IF;

  v_full_name := btrim(concat_ws(' ', v_person.first_name, v_person.last_name));

  -- The engagement's own intake, seeded from the person so the leads UI,
  -- engagement rendering and email templates (which still read these columns)
  -- have something to show. The step 2 write-through keeps them in step from
  -- here on.
  INSERT INTO public.client_intake (
    first_name, middle_name, last_name, suffix, preferred_name, preferred_pronoun,
    prior_names, date_of_birth, is_us_citizen, citizenship_status, email, phone,
    address_line1, address_line2, city, state, zip, county, full_name,
    practice_area, status, user_id, client_user_id
  ) VALUES (
    v_person.first_name, v_person.middle_name, v_person.last_name, v_person.suffix,
    v_person.preferred_name, v_person.preferred_pronoun, v_person.prior_names,
    v_person.date_of_birth, v_person.is_us_citizen, v_person.citizenship_status,
    v_person.email, v_person.phone, v_person.address_line1, v_person.address_line2,
    v_person.city, v_person.state, v_person.zip, v_person.county,
    nullif(v_full_name, ''), p_practice_area, 'in_progress', p_client_user_id, p_client_user_id
  )
  RETURNING id INTO v_intake_id;

  -- Declare the client before the insert, so the trigger joins them instead of
  -- minting a second copy. Cleared immediately after.
  PERFORM set_config('app.open_matter_self_contact_id', p_contact_id::text, true);

  BEGIN
    INSERT INTO public.matters (
      client_intake_id, client_id, name, matter_number, stage, status,
      stage_entered_at, track, relationship_status, hired_at, creation_request_id
    ) VALUES (
      v_intake_id, p_client_user_id, p_matter_name, p_matter_number, 'intake', 'active',
      now(), 'DEFAULT', 'hired', now(), p_request_id
    )
    RETURNING * INTO v_matter;
  EXCEPTION WHEN unique_violation THEN
    PERFORM set_config('app.open_matter_self_contact_id', '', true);
    IF p_request_id IS NOT NULL THEN
      SELECT * INTO v_matter FROM public.matters m WHERE m.creation_request_id = p_request_id;
      IF FOUND THEN
        DELETE FROM public.client_intake WHERE id = v_intake_id;
        RETURN QUERY SELECT v_matter.id, v_matter.matter_number, v_matter.client_intake_id, false;
        RETURN;
      END IF;
    END IF;
    RAISE;
  END;

  PERFORM set_config('app.open_matter_self_contact_id', '', true);

  UPDATE public.client_intake SET matter_id = v_matter.id WHERE id = v_intake_id;

  -- Belt and braces: the join row the trigger should already have written.
  INSERT INTO public.matter_contacts (matter_id, contact_id, relationship_type)
  VALUES (v_matter.id, p_contact_id, 'self')
  ON CONFLICT (matter_id, contact_id) DO NOTHING;

  -- Carry the household across from the person's most recent other matter.
  -- Spouse and children only: fiduciary appointments belong to the engagement
  -- that made them, and the new one nominates its own.
  IF p_carry_household THEN
    SELECT mc.matter_id INTO v_source_matter
    FROM public.matter_contacts mc
    JOIN public.matters m ON m.id = mc.matter_id
    WHERE mc.contact_id = p_contact_id
      AND mc.relationship_type = 'self'
      AND mc.matter_id <> v_matter.id
    ORDER BY m.created_at DESC
    LIMIT 1;

    IF v_source_matter IS NOT NULL THEN
      INSERT INTO public.matter_contacts (
        matter_id, contact_id, relationship_type, relationship_label,
        child_relationship, parentage, from_prior_relationship, is_minor
      )
      SELECT
        v_matter.id, mc.contact_id, mc.relationship_type, mc.relationship_label,
        mc.child_relationship, mc.parentage, mc.from_prior_relationship, mc.is_minor
      FROM public.matter_contacts mc
      WHERE mc.matter_id = v_source_matter
        AND mc.relationship_type IN ('spouse', 'child')
      ON CONFLICT (matter_id, contact_id) DO NOTHING;
    END IF;
  END IF;

  IF array_length(p_extra_contact_ids, 1) IS NOT NULL THEN
    INSERT INTO public.matter_contacts (matter_id, contact_id, relationship_type)
    SELECT v_matter.id, extra_id, 'other'
    FROM unnest(p_extra_contact_ids) AS extra_id
    WHERE extra_id <> p_contact_id
    ON CONFLICT (matter_id, contact_id) DO NOTHING;
  END IF;

  INSERT INTO public.matter_details (
    client_id, practice_area, plan_type, matter_status,
    client_status, jurisdiction_state, matter_number
  ) VALUES (
    v_matter.id, p_practice_area, 'TBD', 'Active',
    'active', 'MA', p_matter_number
  )
  ON CONFLICT (client_id) DO UPDATE SET
    practice_area = excluded.practice_area,
    matter_number = excluded.matter_number;

  -- matter_activity.matter_id is text, not uuid — no implicit cast exists.
  INSERT INTO public.matter_activity (matter_id, event_type, title, detail, actor_id)
  VALUES (
    v_matter.id::text, 'matter_created', 'Matter opened for an existing client',
    coalesce(nullif(v_full_name, ''), 'Client') ||
      case when v_source_matter is not null then ' — household carried over' else '' end,
    p_actor_id
  );

  RETURN QUERY SELECT v_matter.id, v_matter.matter_number, v_matter.client_intake_id, true;
END;
$$;

REVOKE ALL ON FUNCTION public.open_matter_for_person(uuid, text, text, text, boolean, uuid[], uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_matter_for_person(uuid, text, text, text, boolean, uuid[], uuid, uuid, uuid)
  TO service_role;

comment on function public.open_matter_for_person(uuid, text, text, text, boolean, uuid[], uuid, uuid, uuid) is
  'Open a matter for a person the firm already knows. Creates the engagement''s own '
  'client_intake row, joins the existing contacts row as the client rather than '
  'minting a duplicate, and optionally carries the spouse and children across from '
  'their most recent matter. Fiduciary appointments are deliberately not copied.';

notify pgrst, 'reload schema';
