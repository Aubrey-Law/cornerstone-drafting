-- Calls are no longer associated with a matter, lead or contact. The
-- auto-assign matching, the record columns it wrote, and every read path over
-- them are removed; call rows survive as a provider-level log only.
--
-- participant_digits normalization stays: the softphone looks calls up by it.

-- ---------------------------------------------------------------------------
-- Trigger: keep digit normalization, drop the record matching
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calls_autoassign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.participant_digits := public.normalize_us_phone(NEW.participant_number);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.calls_autoassign() IS
  'Normalizes participant_number into participant_digits. Calls are not linked to records.';

-- ---------------------------------------------------------------------------
-- The thread view reads calls.matter_id/lead_id/contact_id, so it has to go
-- before the columns can be dropped. Recreated below without the call branch.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.v_communication_threads;

-- ---------------------------------------------------------------------------
-- upsert_retell_call returned the linking columns; narrow its result. The
-- return type changes, so the old signature must be dropped outright.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.upsert_retell_call(jsonb);

CREATE FUNCTION public.upsert_retell_call(p_call jsonb)
RETURNS TABLE (previous_summary text, conflict boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev_summary text;
  v_external_id  text;
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
  RETURNING calls.external_call_id
  INTO v_external_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_prev_summary, true;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_prev_summary, false;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_retell_call(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_retell_call(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Drop the linking columns and everything defined over them
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS public.calls_unassigned_idx;
DROP INDEX IF EXISTS public.calls_matter_id_idx;
DROP INDEX IF EXISTS public.calls_lead_id_idx;
DROP INDEX IF EXISTS public.calls_contact_id_idx;

ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_single_record_link;

ALTER TABLE public.calls
  DROP COLUMN IF EXISTS matter_id,
  DROP COLUMN IF EXISTS lead_id,
  DROP COLUMN IF EXISTS contact_id;

-- ---------------------------------------------------------------------------
-- Thread view without calls. Portal, SMS and email still thread by record.
-- ---------------------------------------------------------------------------

CREATE VIEW public.v_communication_threads
WITH (security_invoker = true) AS
WITH items AS (
  SELECT
    m.matter_id                     AS matter_id,
    NULL::uuid                      AS lead_id,
    NULL::uuid                      AS contact_id,
    'portal'::text                  AS channel,
    CASE WHEN m.sender_role = 'client' THEN 'inbound' ELSE 'outbound' END AS direction,
    m.body                          AS preview,
    m.created_at                    AS occurred_at,
    (m.sender_role = 'client' AND m.read_at IS NULL) AS unread,
    (m.sender_role = 'client')      AS needs_response
  FROM public.messages m
  UNION ALL
  SELECT
    s.matter_id, s.lead_id, s.contact_id, 'sms', s.direction, s.body, s.created_at,
    (s.direction = 'inbound' AND s.read_by_staff_at IS NULL),
    (s.direction = 'inbound')
  FROM public.sms_messages s
  UNION ALL
  SELECT
    e.matter_id, e.lead_id, e.contact_id, 'email', 'outbound', e.subject, e.created_at,
    false, false
  FROM public.email_log e
  WHERE e.status <> 'error'
),
keyed AS (
  SELECT
    CASE
      WHEN contact_id IS NOT NULL THEN 'contact:' || contact_id::text
      WHEN matter_id IS NOT NULL THEN 'matter:' || matter_id
      ELSE 'lead:' || lead_id::text
    END AS thread_key,
    CASE
      WHEN contact_id IS NOT NULL THEN 'contact'
      WHEN matter_id IS NOT NULL THEN 'matter'
      ELSE 'lead'
    END AS record_type,
    CASE WHEN contact_id IS NULL THEN matter_id END AS matter_id,
    CASE WHEN contact_id IS NULL THEN lead_id END   AS lead_id,
    contact_id, channel, direction, preview, occurred_at, unread, needs_response
  FROM items
  WHERE matter_id IS NOT NULL OR lead_id IS NOT NULL OR contact_id IS NOT NULL
),
agg AS (
  SELECT
    thread_key,
    min(record_type)                                    AS record_type,
    min(matter_id)                                      AS matter_id,
    min(lead_id::text)::uuid                            AS lead_id,
    min(contact_id::text)::uuid                         AS contact_id,
    max(occurred_at)                                    AS last_message_at,
    array_agg(DISTINCT channel ORDER BY channel)        AS channels,
    count(*) FILTER (WHERE unread)                      AS unread_count,
    max(occurred_at) FILTER (WHERE needs_response)      AS last_attention_at,
    max(occurred_at) FILTER (WHERE direction = 'outbound') AS last_outbound_at
  FROM keyed
  GROUP BY thread_key
),
latest AS (
  SELECT DISTINCT ON (thread_key)
    thread_key,
    channel   AS last_channel,
    direction AS last_direction,
    preview   AS last_preview
  FROM keyed
  ORDER BY thread_key, occurred_at DESC, channel
)
SELECT
  a.thread_key,
  a.record_type,
  a.matter_id,
  a.lead_id,
  a.contact_id,
  CASE
    WHEN a.record_type = 'contact'
      THEN coalesce(
        nullif(trim(concat_ws(' ', cc.first_name, cc.last_name)), ''),
        nullif(trim(cc.preferred_name), ''),
        cc.email,
        'Contact'
      )
    WHEN a.record_type = 'matter'
      THEN coalesce(nullif(trim(mm.name), ''), 'Matter')
    ELSE coalesce(
      nullif(trim(ci.full_name), ''),
      nullif(trim(concat_ws(' ', ci.first_name, ci.last_name)), ''),
      ci.email,
      'Lead'
    )
  END                       AS display_name,
  coalesce(cc.phone, ci.phone, mci.phone) AS contact_phone,
  coalesce(cc.email, ci.email, mci.email) AS contact_email,
  mm.matter_number,
  mm.stage,
  l.last_channel,
  l.last_direction,
  l.last_preview,
  a.last_message_at,
  a.channels,
  a.unread_count,
  CASE WHEN a.last_attention_at > coalesce(a.last_outbound_at, '-infinity'::timestamptz)
    THEN a.last_attention_at
  END                       AS waiting_since,
  st.snoozed_until,
  st.archived_at,
  st.marked_unread_at,
  st.assigned_to
FROM agg a
LEFT JOIN public.matters mm ON mm.id::text = a.matter_id
LEFT JOIN public.client_intake mci ON mci.id = mm.client_intake_id
LEFT JOIN public.client_intake ci ON ci.id = a.lead_id
LEFT JOIN public.contacts cc ON cc.id = a.contact_id
LEFT JOIN public.communication_thread_state st ON st.thread_key = a.thread_key
LEFT JOIN latest l ON l.thread_key = a.thread_key;

GRANT SELECT ON public.v_communication_threads TO authenticated;
GRANT SELECT ON public.v_communication_threads TO service_role;

NOTIFY pgrst, 'reload schema';
