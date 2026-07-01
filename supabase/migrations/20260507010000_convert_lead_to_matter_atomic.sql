-- Atomic lead -> matter conversion.
--
-- Replaces the sequential Supabase calls in
--   app/api/admin/leads/[id]/convert/route.ts
-- with a single PL/pgSQL transaction. The previous flow could leave a lead
-- stamped status='hired' with converted_matter_id set even if a later step
-- (matter_details upsert, folder seed, lead_activity insert) failed,
-- requiring manual DB cleanup.
--
-- Behaviour preserved from the route handler:
--   * Idempotent: re-running with an already-converted lead returns the
--     existing matter id.
--   * Reuses an existing client_intake row if one is linked to the lead;
--     otherwise creates a 'draft' intake.
--   * Starts the matter at 'drafting' if intake is already submitted/approved
--     (and seeds design_sheets + status_history); otherwise 'intake'.
--   * Generates matter_number "YYYY-N-LASTNAME" using the current matters
--     row count + 1.
--
-- Security: SECURITY DEFINER so the function can write across tables under
-- the owner's grants; EXECUTE is granted only to service_role (the Next.js
-- admin client). Callers from the API layer must already have passed
-- requireAdmin().

CREATE OR REPLACE FUNCTION public.convert_lead_to_matter(
  p_lead_id           uuid,
  p_attorney_id       uuid,
  p_practice_area     text,   -- normalised slug, e.g. 'estate-planning'
  p_practice_area_lbl text    -- display label, e.g. 'Estate Planning'
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
  -- Lock the lead row to serialise concurrent conversion attempts on the
  -- same lead. Without FOR UPDATE two parallel POSTs could each pass the
  -- "already converted" check and create duplicate matters.
  SELECT * INTO v_lead
    FROM public.leads
    WHERE id = p_lead_id
    FOR UPDATE;

  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_lead.status = 'lost' THEN
    RAISE EXCEPTION 'Lost leads cannot be converted'
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency: short-circuit if this lead was already converted.
  IF v_lead.converted_matter_id IS NOT NULL THEN
    matter_id := v_lead.converted_matter_id;
    already_converted := true;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Reuse an existing intake or seed a draft.
  SELECT id, status, intake_completed_at
    INTO v_intake_id, v_intake_status, v_intake_completed
    FROM public.client_intake
    WHERE lead_id = p_lead_id
    LIMIT 1;

  v_practice_area := p_practice_area;

  IF v_intake_id IS NULL THEN
    INSERT INTO public.client_intake (
      lead_id, email, first_name, last_name, phone, practice_area, status
    ) VALUES (
      p_lead_id,
      v_lead.email,
      v_lead.first_name,
      v_lead.last_name,
      v_lead.phone,
      v_practice_area,
      'draft'
    )
    RETURNING id, status, intake_completed_at
      INTO v_intake_id, v_intake_status, v_intake_completed;
  END IF;

  -- Resolve the linked client auth user, if any.
  IF v_lead.email IS NOT NULL THEN
    SELECT id INTO v_client_user_id
      FROM public.users
      WHERE email = v_lead.email
      LIMIT 1;
  END IF;

  -- Compute matter_number. Locking the leads row above doesn't serialise
  -- matter inserts, but the unique index on matter_number will reject a
  -- collision; callers retry. (Matters table is small enough that count is
  -- cheap.)
  SELECT count(*) INTO v_matter_count FROM public.matters;
  v_seq := v_matter_count + 1;
  v_last_name_upper := COALESCE(upper(v_lead.last_name), 'CLIENT');
  v_matter_number := v_year || '-' || v_seq || '-' || v_last_name_upper;

  v_matter_name := trim(both ' ' from
    COALESCE(v_lead.first_name, '') || ' ' ||
    COALESCE(v_lead.last_name, '')
  ) || ' ' || p_practice_area_lbl;

  v_already_submitted := v_intake_status IN ('submitted', 'approved');
  v_starting_stage := CASE WHEN v_already_submitted THEN 'drafting' ELSE 'intake' END;

  INSERT INTO public.matters (
    client_intake_id,
    lead_id,
    client_id,
    attorney_id,
    name,
    matter_number,
    stage,
    status,
    intake_submitted_at
  ) VALUES (
    v_intake_id,
    p_lead_id,
    v_client_user_id,
    p_attorney_id,
    v_matter_name,
    v_matter_number,
    v_starting_stage,
    'active',
    CASE WHEN v_already_submitted THEN v_intake_completed ELSE NULL END
  )
  RETURNING id INTO v_matter_id;

  IF v_already_submitted THEN
    INSERT INTO public.design_sheets (
      matter_id, client_intake_id, version, status, updated_at
    ) VALUES (
      v_matter_id, v_intake_id, 1, 'draft', now()
    );

    INSERT INTO public.status_history (
      matter_id, from_stage, to_stage, note
    ) VALUES (
      v_matter_id, NULL, 'drafting',
      'Matter converted with intake already submitted'
    );
  END IF;

  INSERT INTO public.matter_details (
    client_id, practice_area, plan_type, matter_status, client_status,
    jurisdiction_state, lead_stage, open_date, matter_number, first_contact_date
  ) VALUES (
    v_matter_id, v_practice_area, 'TBD', 'Active', 'hired',
    'MA', 'engaged', v_today, v_matter_number, v_today
  )
  ON CONFLICT (client_id) DO UPDATE SET
    practice_area     = EXCLUDED.practice_area,
    matter_number     = EXCLUDED.matter_number,
    first_contact_date= EXCLUDED.first_contact_date;

  INSERT INTO public.folders (matter_id, name)
  VALUES (v_matter_id, 'Shared');

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

-- Supabase grants EXECUTE to anon/authenticated by default on new public
-- functions; revoke explicitly so this RPC is service-role only.
REVOKE ALL ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.convert_lead_to_matter(uuid, uuid, text, text) IS
  'Atomically converts a lead into a matter, seeding client_intake (if absent), matter_details, folders, status_history, design_sheets (if intake submitted), and lead_activity. Idempotent — re-running with an already-converted lead returns the existing matter id. Service-role only.';
