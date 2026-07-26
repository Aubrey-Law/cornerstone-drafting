-- Make "create matter" a single atomic, idempotent operation.
--
-- POST /api/admin/matters/create performed five sequential writes with no
-- transaction and no idempotency key:
--   1. insert client_intake        2. insert matters
--   3. update client_intake.matter_id (error ignored)
--   4. upsert matter_details       5. insert matter_activity
-- A double-click, or a retry after a request that actually succeeded server-side,
-- produced duplicate clients AND duplicate matters with distinct matter numbers.
-- A failure at step 4 left a matter with no matter_details row, which renders
-- broken until repaired by hand.
--
-- Idempotency is keyed on a caller-supplied request id rather than the client's
-- email, because a firm legitimately opens a second matter for an existing
-- client (second engagement); email-based dedupe would block that.

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS creation_request_id uuid;

COMMENT ON COLUMN public.matters.creation_request_id IS
  'Caller-supplied idempotency key for matter creation. One matter per key.';

CREATE UNIQUE INDEX IF NOT EXISTS matters_creation_request_id_key
  ON public.matters (creation_request_id)
  WHERE creation_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_matter_with_client(
  p_client_name text,
  p_client_email text,
  p_first_name text,
  p_last_name text,
  p_client_phone text,
  p_practice_area text,
  p_matter_name text,
  p_matter_number text,
  p_client_user_id uuid DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS TABLE (matter_id uuid, matter_number text, client_intake_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_intake_id uuid;
  v_matter    public.matters;
BEGIN
  IF coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;

  IF p_client_name IS NULL OR btrim(p_client_name) = ''
     OR p_client_email IS NULL OR btrim(p_client_email) = '' THEN
    RAISE EXCEPTION 'Client name and email are required' USING errcode = '22023';
  END IF;

  -- Fast path: this request already produced a matter (retry or double-click).
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_matter
    FROM public.matters m
    WHERE m.creation_request_id = p_request_id;

    IF FOUND THEN
      RETURN QUERY SELECT v_matter.id, v_matter.matter_number, v_matter.client_intake_id, false;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.client_intake (
    email, first_name, last_name, full_name, phone,
    practice_area, status, user_id, client_user_id
  ) VALUES (
    p_client_email, p_first_name, p_last_name, p_client_name, p_client_phone,
    p_practice_area, 'in_progress', p_client_user_id, p_client_user_id
  )
  RETURNING id INTO v_intake_id;

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
    -- Concurrent request with the same key won the race. Roll back to before the
    -- insert, discard our intake row, and return the winner's matter. Any other
    -- unique violation (notably matter_number) is re-raised so the caller can
    -- allocate a new number and retry.
    IF p_request_id IS NOT NULL THEN
      SELECT * INTO v_matter
      FROM public.matters m
      WHERE m.creation_request_id = p_request_id;

      IF FOUND THEN
        DELETE FROM public.client_intake WHERE id = v_intake_id;
        RETURN QUERY SELECT v_matter.id, v_matter.matter_number, v_matter.client_intake_id, false;
        RETURN;
      END IF;
    END IF;
    RAISE;
  END;

  UPDATE public.client_intake
     SET matter_id = v_matter.id
   WHERE id = v_intake_id;

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
    v_matter.id::text, 'matter_created', 'Matter created',
    p_client_name || ' (' || p_client_email || ')', p_actor_id
  );

  RETURN QUERY SELECT v_matter.id, v_matter.matter_number, v_matter.client_intake_id, true;
END;
$$;

REVOKE ALL ON FUNCTION public.create_matter_with_client(
  text, text, text, text, text, text, text, text, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_matter_with_client(
  text, text, text, text, text, text, text, text, uuid, uuid, uuid
) TO service_role;
