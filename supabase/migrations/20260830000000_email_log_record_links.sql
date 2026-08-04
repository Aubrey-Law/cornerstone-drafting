-- Sent emails land in a timeline.
--
-- `email_log` only ever had `matter_id`, and `sendEmail()` was never handed
-- one from the manual composer — so an email sent from the rail, the inbox or
-- a lead page was recorded in `email_log` and then appeared in no thread at
-- all, for matters and leads alike. Adding lead_id and contact_id (and
-- actually threading the ids through the send path) closes that.

ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.client_intake(id) ON DELETE SET NULL;

ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS email_log_lead_id_created_at_idx
  ON public.email_log (lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_log_contact_id_created_at_idx
  ON public.email_log (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

-- Same shape as 20260829000000, with email_log now carrying lead and contact
-- links too. See that migration for why contact_id wins the thread key.
DROP VIEW IF EXISTS public.v_communication_threads;

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
    (m.sender_role = 'client' AND m.read_at IS NULL) AS unread
  FROM public.messages m
  UNION ALL
  SELECT
    s.matter_id, s.lead_id, s.contact_id, 'sms', s.direction, s.body, s.created_at,
    (s.direction = 'inbound' AND s.read_by_staff_at IS NULL)
  FROM public.sms_messages s
  UNION ALL
  SELECT
    c.matter_id, c.lead_id, c.contact_id, 'call', c.direction,
    coalesce(nullif(trim(c.summary), ''), initcap(c.direction) || ' call'),
    c.started_at, false
  FROM public.calls c
  UNION ALL
  -- email_log is outbound-only today; inbound email arrives with a sync.
  SELECT
    e.matter_id, e.lead_id, e.contact_id, 'email', 'outbound', e.subject, e.created_at, false
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
    contact_id, channel, direction, preview, occurred_at, unread
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
    count(*) FILTER (WHERE unread)                      AS unread_count,
    max(occurred_at) FILTER (
      WHERE direction = 'inbound' AND channel IN ('portal', 'sms')
    )                                                   AS last_inbound_at,
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
LEFT JOIN public.contacts cc ON cc.id = a.contact_id
LEFT JOIN public.communication_thread_state st ON st.thread_key = a.thread_key
LEFT JOIN latest l ON l.thread_key = a.thread_key;

GRANT SELECT ON public.v_communication_threads TO authenticated;
GRANT SELECT ON public.v_communication_threads TO service_role;

notify pgrst, 'reload schema';
