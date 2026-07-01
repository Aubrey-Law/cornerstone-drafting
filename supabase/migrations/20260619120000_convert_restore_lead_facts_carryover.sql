/*
  # convert_lead_to_matter: restore lead-fact carryover into client_intake

  The 20260614231511 migration dropped the lead-fact copy that 20260509100000
  added (marital status, estate value, address, etc.). This restores that
  behaviour on fresh intake INSERT and backfills empty fields (plus practice_area)
  when an intake row already exists for the lead.
*/

CREATE OR REPLACE FUNCTION public.convert_lead_to_matter(
  p_lead_id uuid,
  p_attorney_id uuid,
  p_practice_area text,
  p_practice_area_lbl text
)
 RETURNS TABLE(matter_id uuid, already_converted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead              record;
  v_intake_id         uuid;
  v_intake_status     text;
  v_intake_completed  timestamptz;
  v_practice_area     text;
  v_matter_id         uuid;
  v_client_user_id    uuid;
  v_matter_name       text;
  v_today             date := (now() at time zone 'UTC')::date;
  v_already_submitted boolean;
  v_starting_stage    text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;

  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id USING ERRCODE = 'P0002';
  END IF;
  IF v_lead.status = 'lost' THEN
    RAISE EXCEPTION 'Lost leads cannot be converted' USING ERRCODE = 'P0001';
  END IF;
  IF v_lead.converted_matter_id IS NOT NULL THEN
    matter_id := v_lead.converted_matter_id;
    already_converted := true;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT id, status, intake_completed_at INTO v_intake_id, v_intake_status, v_intake_completed
    FROM public.client_intake WHERE lead_id = p_lead_id LIMIT 1;

  v_practice_area := p_practice_area;

  IF v_intake_id IS NULL THEN
    INSERT INTO public.client_intake (
      lead_id, email, first_name, last_name, phone, practice_area, status,
      marital_status, has_minor_children, estate_value,
      address_line1, city, state, zip
    ) VALUES (
      p_lead_id, v_lead.email, v_lead.first_name, v_lead.last_name,
      v_lead.phone, v_practice_area, 'draft',
      NULLIF(trim(v_lead.marital_status), ''),
      v_lead.has_minor_children,
      v_lead.estimated_estate_value,
      NULLIF(trim(v_lead.street), ''),
      NULLIF(trim(v_lead.city), ''),
      NULLIF(trim(v_lead.state), ''),
      NULLIF(trim(v_lead.zip), '')
    )
    RETURNING id, status, intake_completed_at INTO v_intake_id, v_intake_status, v_intake_completed;
  ELSE
    UPDATE public.client_intake SET
      practice_area     = v_practice_area,
      first_name        = COALESCE(NULLIF(trim(first_name), ''), NULLIF(trim(v_lead.first_name), '')),
      last_name         = COALESCE(NULLIF(trim(last_name), ''), NULLIF(trim(v_lead.last_name), '')),
      email             = COALESCE(NULLIF(trim(email), ''), NULLIF(trim(v_lead.email), '')),
      phone             = COALESCE(NULLIF(trim(phone), ''), NULLIF(trim(v_lead.phone), '')),
      marital_status    = COALESCE(NULLIF(trim(marital_status), ''), NULLIF(trim(v_lead.marital_status), '')),
      has_minor_children= COALESCE(has_minor_children, v_lead.has_minor_children),
      estate_value      = COALESCE(estate_value, v_lead.estimated_estate_value),
      address_line1     = COALESCE(NULLIF(trim(address_line1), ''), NULLIF(trim(v_lead.street), '')),
      city              = COALESCE(NULLIF(trim(city), ''), NULLIF(trim(v_lead.city), '')),
      state             = COALESCE(NULLIF(trim(state), ''), NULLIF(trim(v_lead.state), '')),
      zip               = COALESCE(NULLIF(trim(zip), ''), NULLIF(trim(v_lead.zip), ''))
    WHERE id = v_intake_id;
  END IF;

  IF v_lead.email IS NOT NULL THEN
    SELECT id INTO v_client_user_id FROM public.users WHERE email = v_lead.email LIMIT 1;
  END IF;

  v_matter_name := trim(both ' ' from COALESCE(v_lead.first_name, '') || ' ' || COALESCE(v_lead.last_name, '')) || ' ' || p_practice_area_lbl;

  v_already_submitted := v_intake_status IN ('submitted', 'approved');
  v_starting_stage := CASE WHEN v_already_submitted THEN 'drafting' ELSE 'intake' END;

  INSERT INTO public.matters (
    client_intake_id, lead_id, client_id, attorney_id, name, matter_number,
    stage, status, intake_submitted_at
  ) VALUES (
    v_intake_id, p_lead_id, v_client_user_id, p_attorney_id, v_matter_name,
    NULL, v_starting_stage, 'active',
    CASE WHEN v_already_submitted THEN v_intake_completed ELSE NULL END
  )
  RETURNING id INTO v_matter_id;

  IF v_already_submitted THEN
    INSERT INTO public.design_sheets (matter_id, client_intake_id, version, status, updated_at)
    VALUES (v_matter_id, v_intake_id, 1, 'draft', now());
    INSERT INTO public.status_history (matter_id, from_stage, to_stage, notes)
    VALUES (v_matter_id, NULL, 'drafting', 'Matter converted with intake already submitted');
  END IF;

  INSERT INTO public.matter_details (
    client_id, practice_area, plan_type, matter_status,
    jurisdiction_state, lead_stage, open_date, first_contact_date
  ) VALUES (
    v_matter_id, v_practice_area, 'TBD', 'Active',
    'MA', 'engaged', v_today, v_today
  )
  ON CONFLICT (client_id) DO UPDATE SET
    practice_area     = EXCLUDED.practice_area,
    first_contact_date= EXCLUDED.first_contact_date;

  INSERT INTO public.folders (matter_id, name) VALUES (v_matter_id, 'Shared');

  INSERT INTO public.matter_documents (
    matter_id, r2_key, name, size, content_type, folder, uploaded_by, created_at
  )
  SELECT
    v_matter_id::text, ld.r2_key, ld.name, ld.size, ld.content_type,
    CASE WHEN ld.kind = 'meeting-notes' THEN 'meeting-notes' ELSE 'draft' END,
    ld.uploaded_by, ld.created_at
  FROM public.lead_documents ld
  WHERE ld.lead_id = p_lead_id
  ON CONFLICT (r2_key) DO NOTHING;

  UPDATE public.engagement_agreements
     SET matter_id = v_matter_id
   WHERE lead_id = p_lead_id
     AND public.engagement_agreements.matter_id IS NULL;

  UPDATE public.leads SET
    status              = 'hired',
    converted_matter_id = v_matter_id,
    converted_at        = now(),
    status_changed_at   = now()
  WHERE id = p_lead_id;

  INSERT INTO public.lead_activity (lead_id, type, payload)
  VALUES (p_lead_id, 'converted', jsonb_build_object('matter_id', v_matter_id));

  matter_id := v_matter_id;
  already_converted := false;
  RETURN NEXT;
END;
$function$;
