-- Unified communications: one firm-wide thread list over portal messages,
-- SMS, calls and outbound email, plus per-thread triage state for the inbox.

-- ── communication_thread_state ──────────────────────────────────────────────
-- Triage state keyed by thread ("matter:<uuid>" / "lead:<uuid>"). Read markers
-- stay on the source tables (messages.read_at, sms_messages.read_by_staff_at);
-- this table only holds what those tables cannot express.

CREATE TABLE IF NOT EXISTS public.communication_thread_state (
  thread_key        text PRIMARY KEY
                      CHECK (thread_key ~ '^(matter|lead):[0-9a-f-]{36}$'),
  snoozed_until     timestamptz,
  archived_at       timestamptz,
  -- Staff can flag a thread back to unread even when every row is read.
  marked_unread_at  timestamptz,
  assigned_to       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS communication_thread_state_updated_at_trg ON public.communication_thread_state;
CREATE TRIGGER communication_thread_state_updated_at_trg
BEFORE UPDATE ON public.communication_thread_state
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.communication_thread_state ENABLE ROW LEVEL SECURITY;

-- Staff-only, matching sms_messages / calls. Clients never see triage state.
DROP POLICY IF EXISTS communication_thread_state_staff_select ON public.communication_thread_state;
CREATE POLICY communication_thread_state_staff_select ON public.communication_thread_state
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney', 'va', 'staff')
  )
);

DROP POLICY IF EXISTS communication_thread_state_staff_modify ON public.communication_thread_state;
CREATE POLICY communication_thread_state_staff_modify ON public.communication_thread_state
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney', 'va', 'staff')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney', 'va', 'staff')
  )
);

-- ── v_communication_threads ─────────────────────────────────────────────────
-- One row per contact record (matter or lead) that has any communication.
-- security_invoker: the view runs under the caller's RLS, so the staff-only
-- policies on sms_messages / calls / email_log / communication_thread_state
-- keep clients out of the firm-wide picture (a client can at most see the
-- aggregate of their own portal thread, which they can already read row by
-- row).

CREATE OR REPLACE VIEW public.v_communication_threads
WITH (security_invoker = true) AS
WITH items AS (
  SELECT
    m.matter_id                     AS matter_id,
    NULL::uuid                      AS lead_id,
    'portal'::text                  AS channel,
    CASE WHEN m.sender_role = 'client' THEN 'inbound' ELSE 'outbound' END AS direction,
    m.body                          AS preview,
    m.created_at                    AS occurred_at,
    (m.sender_role = 'client' AND m.read_at IS NULL) AS unread
  FROM public.messages m
  UNION ALL
  SELECT
    s.matter_id, s.lead_id, 'sms', s.direction, s.body, s.created_at,
    (s.direction = 'inbound' AND s.read_by_staff_at IS NULL)
  FROM public.sms_messages s
  UNION ALL
  SELECT
    c.matter_id, c.lead_id, 'call', c.direction,
    coalesce(nullif(trim(c.summary), ''), initcap(c.direction) || ' call'),
    c.started_at, false
  FROM public.calls c
  UNION ALL
  -- email_log is outbound-only today; inbound email arrives with a sync.
  SELECT
    e.matter_id, NULL::uuid, 'email', 'outbound', e.subject, e.created_at, false
  FROM public.email_log e
  WHERE e.status <> 'error'
),
keyed AS (
  SELECT
    CASE WHEN matter_id IS NOT NULL
      THEN 'matter:' || matter_id
      ELSE 'lead:' || lead_id::text
    END AS thread_key,
    CASE WHEN matter_id IS NOT NULL THEN 'matter' ELSE 'lead' END AS record_type,
    matter_id, lead_id, channel, direction, preview, occurred_at, unread
  FROM items
  WHERE matter_id IS NOT NULL OR lead_id IS NOT NULL
),
agg AS (
  SELECT
    thread_key,
    min(record_type)                                    AS record_type,
    min(matter_id)                                      AS matter_id,
    min(lead_id::text)::uuid                            AS lead_id,
    max(occurred_at)                                    AS last_message_at,
    count(*) FILTER (WHERE unread)                      AS unread_count,
    -- Newest client message; only portal/SMS demand a typed reply.
    max(occurred_at) FILTER (
      WHERE direction = 'inbound' AND channel IN ('portal', 'sms')
    )                                                   AS last_inbound_at,
    -- Any outbound touch (message, email or call back) answers the thread.
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
  CASE WHEN a.record_type = 'matter'
    THEN coalesce(nullif(trim(mm.name), ''), 'Matter')
    ELSE coalesce(
      nullif(trim(ci.full_name), ''),
      nullif(trim(concat_ws(' ', ci.first_name, ci.last_name)), ''),
      ci.email,
      'Lead'
    )
  END                       AS display_name,
  coalesce(ci.phone, mci.phone) AS contact_phone,
  coalesce(ci.email, mci.email) AS contact_email,
  mm.matter_number,
  mm.stage,
  l.last_channel,
  l.last_direction,
  l.last_preview,
  a.last_message_at,
  a.unread_count,
  CASE WHEN a.last_inbound_at > coalesce(a.last_outbound_at, '-infinity'::timestamptz)
    THEN a.last_inbound_at
  END                       AS waiting_since,
  st.snoozed_until,
  st.archived_at,
  st.marked_unread_at,
  st.assigned_to
FROM agg a
LEFT JOIN public.matters mm ON mm.id::text = a.matter_id
LEFT JOIN public.client_intake mci ON mci.id = mm.client_intake_id
LEFT JOIN public.client_intake ci ON ci.id = a.lead_id
LEFT JOIN public.communication_thread_state st ON st.thread_key = a.thread_key
LEFT JOIN latest l ON l.thread_key = a.thread_key;

GRANT SELECT ON public.v_communication_threads TO authenticated;
GRANT SELECT ON public.v_communication_threads TO service_role;
