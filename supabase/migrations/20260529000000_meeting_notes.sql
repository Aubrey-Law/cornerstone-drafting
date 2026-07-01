-- Meeting notes support: a dedicated 'meeting-notes' folder on matter_documents
-- (hidden from clients via RLS, like 'drafts') and a `kind` column on
-- lead_documents so pre-conversion notes can be tagged and carried through.

-- 1. lead_documents.kind ------------------------------------------------------
ALTER TABLE public.lead_documents
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'general';

-- 2. Hide 'meeting-notes' from clients on matter_documents --------------------
DROP POLICY IF EXISTS "client_read_visible_matter_documents" ON public.matter_documents;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'v_matter_pipeline' AND n.nspname = 'public'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "client_read_visible_matter_documents"
        ON matter_documents
        FOR SELECT
        TO authenticated
        USING (
          lower(coalesce(folder, '')) NOT IN ('draft', 'drafts', 'meeting-notes', 'meeting_notes')
          AND (
            folder_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM folders f
              WHERE f.id = matter_documents.folder_id
                AND lower(f.name) IN ('draft', 'drafts', 'meeting-notes', 'meeting notes')
            )
          )
          AND (
            EXISTS (
              SELECT 1 FROM matters m
              WHERE m.id::text = matter_documents.matter_id
                AND m.client_id = auth.uid()
            )
            OR EXISTS (
              SELECT 1 FROM v_matter_pipeline v
              WHERE v.matter_id::text = matter_documents.matter_id
                AND v.client_email = (
                  SELECT email FROM auth.users WHERE id = auth.uid()
                )
            )
          )
        )
    $policy$;
  END IF;
END $$;

-- 3. Hide 'meeting-notes' named folders too -----------------------------------
DROP POLICY IF EXISTS "clients_select_visible_own_folders" ON public.folders;

CREATE POLICY "clients_select_visible_own_folders"
  ON public.folders
  FOR SELECT
  TO authenticated
  USING (
    lower(name) NOT IN ('draft', 'drafts', 'meeting-notes', 'meeting notes')
    AND EXISTS (
      SELECT 1 FROM matters m
      WHERE m.id = folders.matter_id
        AND m.client_id = auth.uid()
    )
  );

-- 4. Carry meeting-notes through lead → matter conversion --------------------
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

  INSERT INTO public.matter_documents (
    matter_id, r2_key, name, size, content_type, folder, uploaded_by, created_at
  )
  SELECT
    v_matter_id::text,
    ld.r2_key,
    ld.name,
    ld.size,
    ld.content_type,
    CASE WHEN ld.kind = 'meeting-notes' THEN 'meeting-notes' ELSE 'draft' END,
    ld.uploaded_by,
    ld.created_at
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

REVOKE ALL ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) TO service_role;
