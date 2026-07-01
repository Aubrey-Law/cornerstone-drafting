CREATE OR REPLACE FUNCTION public.merge_contacts(p_winner_id uuid, p_loser_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  winner public.contacts%ROWTYPE;
  loser public.contacts%ROWTYPE;
  dropped_roles integer := 0;
  moved_roles integer := 0;
  filled_fields text[] := ARRAY[]::text[];
BEGIN
  IF p_winner_id IS NULL OR p_loser_id IS NULL THEN
    RAISE EXCEPTION 'Both winner and loser contact ids are required.';
  END IF;

  IF p_winner_id = p_loser_id THEN
    RAISE EXCEPTION 'Winner and loser must be different contacts.';
  END IF;

  SELECT * INTO winner
  FROM public.contacts
  WHERE id = p_winner_id
  FOR UPDATE;

  IF winner.id IS NULL THEN
    RAISE EXCEPTION 'Winner contact not found.';
  END IF;

  SELECT * INTO loser
  FROM public.contacts
  WHERE id = p_loser_id
  FOR UPDATE;

  IF loser.id IS NULL THEN
    RAISE EXCEPTION 'Loser contact not found.';
  END IF;

  IF loser.relationship_type = 'spouse' AND loser.client_intake_id IS NOT NULL THEN
    RAISE EXCEPTION 'This spouse record is synced from the client intake and cannot be merged into another contact.';
  END IF;

  IF nullif(btrim(winner.first_name), '') IS NULL AND nullif(btrim(loser.first_name), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'first_name'); END IF;
  IF nullif(btrim(winner.middle_name), '') IS NULL AND nullif(btrim(loser.middle_name), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'middle_name'); END IF;
  IF nullif(btrim(winner.last_name), '') IS NULL AND nullif(btrim(loser.last_name), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'last_name'); END IF;
  IF nullif(btrim(winner.email), '') IS NULL AND nullif(btrim(loser.email), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'email'); END IF;
  IF nullif(btrim(winner.phone), '') IS NULL AND nullif(btrim(loser.phone), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'phone'); END IF;
  IF nullif(btrim(winner.address_line1), '') IS NULL AND nullif(btrim(loser.address_line1), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'address_line1'); END IF;
  IF nullif(btrim(winner.address_line2), '') IS NULL AND nullif(btrim(loser.address_line2), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'address_line2'); END IF;
  IF nullif(btrim(winner.city), '') IS NULL AND nullif(btrim(loser.city), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'city'); END IF;
  IF nullif(btrim(winner.state), '') IS NULL AND nullif(btrim(loser.state), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'state'); END IF;
  IF nullif(btrim(winner.zip), '') IS NULL AND nullif(btrim(loser.zip), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'zip'); END IF;
  IF nullif(btrim(winner.county), '') IS NULL AND nullif(btrim(loser.county), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'county'); END IF;
  IF nullif(btrim(winner.suffix), '') IS NULL AND nullif(btrim(loser.suffix), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'suffix'); END IF;
  IF nullif(btrim(winner.preferred_name), '') IS NULL AND nullif(btrim(loser.preferred_name), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'preferred_name'); END IF;
  IF nullif(btrim(winner.preferred_pronoun), '') IS NULL AND nullif(btrim(loser.preferred_pronoun), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'preferred_pronoun'); END IF;
  IF winner.date_of_birth IS NULL AND loser.date_of_birth IS NOT NULL THEN filled_fields := array_append(filled_fields, 'date_of_birth'); END IF;
  IF nullif(btrim(winner.relationship_type), '') IS NULL AND nullif(btrim(loser.relationship_type), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'relationship_type'); END IF;
  IF nullif(btrim(winner.relationship_label), '') IS NULL AND nullif(btrim(loser.relationship_label), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'relationship_label'); END IF;
  IF nullif(btrim(winner.lawmatics_contact_id), '') IS NULL AND nullif(btrim(loser.lawmatics_contact_id), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'lawmatics_contact_id'); END IF;
  IF winner.portal_user_id IS NULL AND loser.portal_user_id IS NOT NULL THEN filled_fields := array_append(filled_fields, 'portal_user_id'); END IF;

  DELETE FROM public.contact_roles loser_role
  WHERE loser_role.contact_id = p_loser_id
    AND EXISTS (
      SELECT 1
      FROM public.contact_roles winner_role
      WHERE winner_role.contact_id = p_winner_id
        AND CASE WHEN winner_role.role = 'executor' THEN 'personal_rep' ELSE winner_role.role END =
            CASE WHEN loser_role.role = 'executor' THEN 'personal_rep' ELSE loser_role.role END
        AND winner_role.for_party = loser_role.for_party
        AND winner_role.priority = loser_role.priority
        AND coalesce(winner_role.is_coagent, false) = coalesce(loser_role.is_coagent, false)
    );
  GET DIAGNOSTICS dropped_roles = ROW_COUNT;

  UPDATE public.contact_roles
  SET contact_id = p_winner_id
  WHERE contact_id = p_loser_id;
  GET DIAGNOSTICS moved_roles = ROW_COUNT;

  UPDATE public.contacts
  SET lawmatics_contact_id = NULL,
      portal_user_id = NULL
  WHERE id = p_loser_id;

  UPDATE public.contacts
  SET first_name = coalesce(nullif(btrim(winner.first_name), ''), loser.first_name),
      middle_name = coalesce(nullif(btrim(winner.middle_name), ''), loser.middle_name),
      last_name = coalesce(nullif(btrim(winner.last_name), ''), loser.last_name),
      email = coalesce(nullif(btrim(winner.email), ''), loser.email),
      phone = coalesce(nullif(btrim(winner.phone), ''), loser.phone),
      address_line1 = coalesce(nullif(btrim(winner.address_line1), ''), loser.address_line1),
      address_line2 = coalesce(nullif(btrim(winner.address_line2), ''), loser.address_line2),
      city = coalesce(nullif(btrim(winner.city), ''), loser.city),
      state = coalesce(nullif(btrim(winner.state), ''), loser.state),
      zip = coalesce(nullif(btrim(winner.zip), ''), loser.zip),
      county = coalesce(nullif(btrim(winner.county), ''), loser.county),
      suffix = coalesce(nullif(btrim(winner.suffix), ''), loser.suffix),
      preferred_name = coalesce(nullif(btrim(winner.preferred_name), ''), loser.preferred_name),
      preferred_pronoun = coalesce(nullif(btrim(winner.preferred_pronoun), ''), loser.preferred_pronoun),
      date_of_birth = coalesce(winner.date_of_birth, loser.date_of_birth),
      relationship_type = coalesce(nullif(btrim(winner.relationship_type), ''), loser.relationship_type),
      relationship_label = coalesce(nullif(btrim(winner.relationship_label), ''), loser.relationship_label),
      lawmatics_contact_id = coalesce(nullif(btrim(winner.lawmatics_contact_id), ''), loser.lawmatics_contact_id),
      portal_user_id = coalesce(winner.portal_user_id, loser.portal_user_id),
      updated_at = now()
  WHERE id = p_winner_id;

  DELETE FROM public.contacts
  WHERE id = p_loser_id;

  RETURN jsonb_build_object(
    'winner_id', p_winner_id,
    'loser_id', p_loser_id,
    'moved_roles', moved_roles,
    'dropped_roles', dropped_roles,
    'filled_fields', filled_fields
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid) TO service_role;
