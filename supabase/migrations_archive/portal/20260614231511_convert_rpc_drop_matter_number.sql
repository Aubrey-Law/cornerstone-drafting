/*
  # convert_lead_to_matter: stop generating matter_number in the RPC

  The RPC generated matter_number itself as `YYYY-(count(*)+1)-LASTNAME` — a
  format that diverges from the canonical lib/matterNumber.ts scheme
  (`YYYY-<PRACTICE_CODE>-Lastname`, collision-safe) AND a fragile count()-based
  sequence that can collide against the partial unique index
  `matters_matter_number_unique_idx` (e.g. after a deletion, or vs a
  lib-assigned/manually-set number), which would ERROR the whole conversion.

  Fix (approach a): the RPC now inserts matter_number = NULL (the column is
  nullable and the unique index is partial — `WHERE matter_number IS NOT NULL` —
  so NULL never collides). The convert route assigns the number AFTER the RPC via
  lib/matterNumber.ts (generateUniqueMatterNumber + setMatterNumber), the same
  canonical, collision-safe path every other creation flow uses.

  Only the numbering changes — every other side effect (intake, design sheet,
  status history, matter_details, folders, lead documents, engagement, lead
  status, activity) is byte-for-byte the live definition.

  Apply via `apply_migration` (records cleanly) — do NOT blind `db push`.
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

  -- matter_number is intentionally NOT generated here. The convert route assigns
  -- it after this RPC via lib/matterNumber.ts (canonical, collision-safe).

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
$function$;
