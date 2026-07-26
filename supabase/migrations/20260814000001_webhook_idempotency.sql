-- Webhook idempotency and atomic call merging.
--
-- 1. The Retell handler read the existing `calls` row, merged in JS, then upserted
--    the whole row. Two events for one call (call_ended + call_analyzed, or a
--    provider retry racing itself) both read the same pre-write state, so the
--    later write reinstated the earlier one's fields as null. A `call_ended`
--    carrying recording_url losing to a `call_analyzed` carrying transcript meant
--    the recording of a client intake call was silently dropped. Merging inside
--    ON CONFLICT evaluates against the current row under the conflict's row lock,
--    so no read can go stale.
--
-- 2. Cal.com had no event-level dedupe, so a retry (any non-2xx or timeout)
--    duplicated matter notes and lead activity. Telnyx and Firma already claim
--    events; this exposes the same ledger as a reusable RPC.

-- The ledger's shape — (provider, provider_event_id) unique, payload, timestamps —
-- is exactly a webhook dedupe table, so widen it rather than duplicate it. Its
-- provider CHECK was telephony-only; add the calendar provider.
ALTER TABLE public.telephony_webhook_events
  DROP CONSTRAINT IF EXISTS telephony_webhook_events_provider_check;

ALTER TABLE public.telephony_webhook_events
  ADD CONSTRAINT telephony_webhook_events_provider_check
  CHECK (provider = ANY (ARRAY['twilio'::text, 'telnyx'::text, 'retell'::text, 'calcom'::text]));

COMMENT ON TABLE public.telephony_webhook_events IS
  'Webhook dedupe ledger keyed on (provider, provider_event_id). Despite the name it is not telephony-only — Cal.com claims here too.';

-- Returns true when this caller won the claim and should process the event.
-- A losing caller (duplicate delivery) gets false and must no-op.
CREATE OR REPLACE FUNCTION public.claim_webhook_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_occurred_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claimed boolean := false;
BEGIN
  IF coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;

  IF p_provider IS NULL OR btrim(p_provider) = '' OR p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'provider and event id are required' USING errcode = '22023';
  END IF;

  INSERT INTO public.telephony_webhook_events (provider, provider_event_id, event_type, payload, occurred_at)
  VALUES (p_provider, p_event_id, coalesce(p_event_type, ''), coalesce(p_payload, '{}'::jsonb), p_occurred_at)
  ON CONFLICT (provider, provider_event_id) DO NOTHING;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed;
END;
$$;

-- Release a claim so a provider retry can reprocess after a failure. Mirrors the
-- Telnyx handler's behaviour: a claim that never completed must not permanently
-- suppress the event.
CREATE OR REPLACE FUNCTION public.release_webhook_event(
  p_provider text,
  p_event_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;

  DELETE FROM public.telephony_webhook_events
  WHERE provider = p_provider AND provider_event_id = p_event_id;
END;
$$;

-- Atomic Retell call merge. Column-wise COALESCE against the *current* row.
-- matter_id / lead_id / assigned_* are intentionally never written here: those
-- are staff assignments, not webhook state.
CREATE OR REPLACE FUNCTION public.upsert_retell_call(p_call jsonb)
RETURNS TABLE (matter_id text, lead_id uuid, previous_summary text, conflict boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev_summary text;
  v_matter_id    text;
  v_lead_id      uuid;
BEGIN
  IF coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;

  IF coalesce(btrim(p_call->>'external_call_id'), '') = '' THEN
    RAISE EXCEPTION 'external_call_id is required' USING errcode = '22023';
  END IF;

  SELECT c.summary INTO v_prev_summary
  FROM public.calls c
  WHERE c.external_call_id = p_call->>'external_call_id';

  INSERT INTO public.calls (
    external_call_id, provider, direction, status,
    from_number, to_number, participant_number,
    firm_user_id, firm_user_email,
    started_at, answered_at, ended_at, duration_seconds,
    recording_url, voicemail_url, transcript, summary, raw_payload
  ) VALUES (
    p_call->>'external_call_id',
    coalesce(p_call->>'provider', 'retell'),
    p_call->>'direction',
    p_call->>'status',
    p_call->>'from_number',
    p_call->>'to_number',
    p_call->>'participant_number',
    nullif(p_call->>'firm_user_id', '')::uuid,
    p_call->>'firm_user_email',
    coalesce(nullif(p_call->>'started_at', '')::timestamptz, now()),
    nullif(p_call->>'answered_at', '')::timestamptz,
    nullif(p_call->>'ended_at', '')::timestamptz,
    nullif(p_call->>'duration_seconds', '')::int,
    p_call->>'recording_url',
    p_call->>'voicemail_url',
    p_call->>'transcript',
    p_call->>'summary',
    coalesce(p_call->'raw_payload', '{}'::jsonb)
  )
  ON CONFLICT (external_call_id) DO UPDATE SET
    direction          = excluded.direction,
    status             = excluded.status,
    from_number        = coalesce(excluded.from_number, calls.from_number),
    to_number          = coalesce(excluded.to_number, calls.to_number),
    participant_number = coalesce(excluded.participant_number, calls.participant_number),
    firm_user_id       = coalesce(excluded.firm_user_id, calls.firm_user_id),
    firm_user_email    = coalesce(excluded.firm_user_email, calls.firm_user_email),
    answered_at        = coalesce(excluded.answered_at, calls.answered_at),
    ended_at           = coalesce(excluded.ended_at, calls.ended_at),
    duration_seconds   = coalesce(excluded.duration_seconds, calls.duration_seconds),
    recording_url      = coalesce(excluded.recording_url, calls.recording_url),
    voicemail_url      = coalesce(excluded.voicemail_url, calls.voicemail_url),
    transcript         = coalesce(excluded.transcript, calls.transcript),
    summary            = coalesce(excluded.summary, calls.summary),
    raw_payload        = calls.raw_payload || excluded.raw_payload,
    updated_at         = now()
  -- Refuse to overwrite a row another provider owns; no row is updated and the
  -- caller reports a conflict.
  WHERE calls.provider = coalesce(p_call->>'provider', 'retell')
  RETURNING calls.matter_id, calls.lead_id
  INTO v_matter_id, v_lead_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, v_prev_summary, true;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_matter_id, v_lead_id, v_prev_summary, false;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_webhook_event(text, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_webhook_event(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_retell_call(jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_webhook_event(text, text, text, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_webhook_event(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_retell_call(jsonb) TO service_role;
