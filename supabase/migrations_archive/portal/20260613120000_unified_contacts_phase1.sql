-- 20260613120000_unified_contacts_phase1.sql
-- Unified contacts, phase 1 (additive). Spouse becomes single-source in `contacts`.

BEGIN;

-- 1. Backfill: ensure every household with spouse data has exactly one spouse contact.
--    client_intake.spouse_* is the richest existing source; the unique index
--    uq_contacts_one_spouse (already present) guarantees no duplicate is created.
INSERT INTO public.contacts (
  client_intake_id, relationship_type, relationship_label,
  first_name, middle_name, last_name, suffix, preferred_name, prior_names,
  preferred_pronoun, date_of_birth, is_us_citizen, phone, email, source
)
SELECT
  ci.id, 'spouse', 'Spouse',
  coalesce(ci.spouse_first_name, ''), ci.spouse_middle_name,
  coalesce(ci.spouse_last_name, ''), ci.spouse_suffix, ci.spouse_preferred_name,
  ci.spouse_prior_names, ci.spouse_preferred_pronoun, ci.spouse_date_of_birth,
  coalesce(ci.spouse_is_us_citizen, true), ci.spouse_phone, ci.spouse_email,
  'intake_sync'
FROM public.client_intake ci
WHERE (coalesce(ci.spouse_first_name, '') <> '' OR coalesce(ci.spouse_last_name, '') <> '')
  AND NOT EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.client_intake_id = ci.id AND c.relationship_type = 'spouse'
  );

-- 2. Drop the trigger + function that kept client_intake.spouse_* and contacts in
--    sync. The application (saveHouseholdContact) is now the single writer; the
--    trigger would otherwise race it.
DROP TRIGGER IF EXISTS trg_sync_spouse_contact ON public.client_intake;
DROP FUNCTION IF EXISTS public.sync_spouse_contact();

-- 3. Redefine convert_lead_to_matter WITHOUT the spouse-contact insert.
--    (Spouse contacts are created at lead capture / intake by the app.)
--    Body identical to 20260529010000 except the spouse INSERT block is removed.
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

  -- NOTE: spouse-contact insert intentionally REMOVED — the app owns spouse creation.

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
$$;

COMMIT;
