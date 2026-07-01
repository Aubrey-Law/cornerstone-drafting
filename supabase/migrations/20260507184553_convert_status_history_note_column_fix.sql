-- Fix convert_lead_to_matter(): the status_history table's column is `notes`
-- (plural), but earlier revisions of this RPC referenced `note`. The error
-- surfaced as "column note of relation status_history does not exist" on the
-- /admin/leads/[id] convert action. Rebuild the function with the correct
-- column name; everything else is identical to the previous revision
-- (20260507100000_convert_attaches_engagement.sql).

CREATE OR REPLACE FUNCTION public.convert_lead_to_matter(
  p_lead_id           uuid,
  p_attorney_id       uuid,
  p_practice_area     text,
  p_practice_area_lbl text
)
RETURNS TABLE(matter_id uuid, already_converted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead              record;
  v_intake_id         uuid;
  v_intake_status     text;
  v_intake_completed  timestamptz;
  v_practice_area     text;
  v_matter_id         uuid;
  v_client_user_id    uuid;
  v_matter_count      bigint;
  v_seq               bigint;
  v_year              int := extract(year from now())::int;
  v_last_name_upper   text;
  v_matter_number     text;
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
      lead_id, email, first_name, last_name, phone, practice_area, status
    ) VALUES (
      p_lead_id, v_lead.email, v_lead.first_name, v_lead.last_name,
      v_lead.phone, v_practice_area, 'draft'
    )
    RETURNING id, status, intake_completed_at INTO v_intake_id, v_intake_status, v_intake_completed;
  END IF;

  IF v_lead.email IS NOT NULL THEN
    SELECT id INTO v_client_user_id FROM public.users WHERE email = v_lead.email LIMIT 1;
  END IF;

  SELECT count(*) INTO v_matter_count FROM public.matters;
  v_seq := v_matter_count + 1;
  v_last_name_upper := COALESCE(upper(v_lead.last_name), 'CLIENT');
  v_matter_number := v_year || '-' || v_seq || '-' || v_last_name_upper;

  v_matter_name := trim(both ' ' from COALESCE(v_lead.first_name, '') || ' ' || COALESCE(v_lead.last_name, '')) || ' ' || p_practice_area_lbl;

  v_already_submitted := v_intake_status IN ('submitted', 'approved');
  v_starting_stage := CASE WHEN v_already_submitted THEN 'drafting' ELSE 'intake' END;

  INSERT INTO public.matters (
    client_intake_id, lead_id, client_id, attorney_id, name, matter_number,
    stage, status, intake_submitted_at
  ) VALUES (
    v_intake_id, p_lead_id, v_client_user_id, p_attorney_id, v_matter_name,
    v_matter_number, v_starting_stage, 'active',
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
    jurisdiction_state, lead_stage, open_date, matter_number, first_contact_date
  ) VALUES (
    v_matter_id, v_practice_area, 'TBD', 'Active',
    'MA', 'engaged', v_today, v_matter_number, v_today
  )
  ON CONFLICT (client_id) DO UPDATE SET
    practice_area     = EXCLUDED.practice_area,
    matter_number     = EXCLUDED.matter_number,
    first_contact_date= EXCLUDED.first_contact_date;

  INSERT INTO public.folders (matter_id, name) VALUES (v_matter_id, 'Shared');

  IF NULLIF(trim(v_lead.spouse_first_name), '') IS NOT NULL
     AND NULLIF(trim(v_lead.spouse_last_name), '') IS NOT NULL THEN
    INSERT INTO public.contacts (
      client_intake_id, first_name, last_name, email, phone,
      relationship_type, relationship_label, source
    ) VALUES (
      v_intake_id,
      trim(v_lead.spouse_first_name),
      trim(v_lead.spouse_last_name),
      NULLIF(trim(v_lead.spouse_email), ''),
      NULLIF(trim(v_lead.spouse_phone), ''),
      'spouse',
      'Spouse',
      'attorney_intake'
    );
  END IF;

  UPDATE public.engagement_agreements
     SET matter_id = v_matter_id
   WHERE lead_id = p_lead_id
     AND matter_id IS NULL;

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
$$;

REVOKE ALL ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) TO service_role;
