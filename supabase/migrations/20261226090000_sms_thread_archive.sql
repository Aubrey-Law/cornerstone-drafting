-- Archive a text conversation: it leaves the Texts page list and the badge,
-- but every message stays on the linked lead, matter or contact record.
-- Unlike delete, nothing about the messages changes; the state belongs to
-- the conversation (the outside phone number), so it lives in its own table.
--
-- A new incoming text brings the conversation back, the way archived email
-- does: `archived` is true only while the archive is newer than the latest
-- inbound message.
--
-- Additive only: a new table, and v_sms_threads gains columns at the end.

CREATE TABLE IF NOT EXISTS public.sms_thread_state (
  -- 10-digit US number, as returned by public.normalize_us_phone().
  phone text PRIMARY KEY,
  archived_at timestamptz,
  archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sms_thread_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sms_thread_state_staff_select ON public.sms_thread_state;
CREATE POLICY sms_thread_state_staff_select ON public.sms_thread_state
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney', 'va', 'staff')
  )
);
-- Writes come only from the Texts API through the service role.

CREATE OR REPLACE VIEW public.v_sms_threads
WITH (security_invoker = true)
AS
WITH msgs AS (
  SELECT
    public.normalize_us_phone(
      CASE WHEN sm.direction = 'inbound' THEN sm.from_number ELSE sm.to_number END
    ) AS phone,
    sm.*
  FROM public.sms_messages sm
  WHERE sm.deleted_at IS NULL
),
latest AS (
  SELECT DISTINCT ON (phone)
    phone,
    id         AS last_message_id,
    body       AS last_body,
    direction  AS last_direction,
    status     AS last_status,
    created_at AS last_message_at
  FROM msgs
  WHERE phone IS NOT NULL
  ORDER BY phone, created_at DESC
),
agg AS (
  SELECT
    phone,
    count(*) FILTER (WHERE direction = 'inbound' AND read_by_staff_at IS NULL) AS unread_count,
    count(*) AS message_count,
    (array_agg(lead_id    ORDER BY created_at DESC) FILTER (WHERE lead_id    IS NOT NULL))[1] AS lead_id,
    (array_agg(matter_id  ORDER BY created_at DESC) FILTER (WHERE matter_id  IS NOT NULL))[1] AS matter_id,
    (array_agg(contact_id ORDER BY created_at DESC) FILTER (WHERE contact_id IS NOT NULL))[1] AS contact_id,
    (array_agg(recipient_name ORDER BY created_at DESC)
      FILTER (WHERE nullif(trim(recipient_name), '') IS NOT NULL))[1] AS recipient_name,
    max(created_at) FILTER (WHERE direction = 'inbound') AS last_inbound_at
  FROM msgs
  WHERE phone IS NOT NULL
  GROUP BY phone
)
SELECT
  l.phone,
  '+1' || l.phone AS phone_e164,
  l.last_message_id,
  l.last_body,
  l.last_direction,
  l.last_status,
  l.last_message_at,
  a.unread_count,
  a.message_count,
  a.lead_id,
  a.matter_id,
  a.contact_id,
  a.recipient_name,
  (oo.phone IS NOT NULL AND oo.opted_in_at IS NULL) AS opted_out,
  st.archived_at,
  (st.archived_at IS NOT NULL
    AND st.archived_at > coalesce(a.last_inbound_at, '-infinity'::timestamptz)) AS archived
FROM latest l
JOIN agg a USING (phone)
LEFT JOIN public.sms_opt_outs oo ON oo.phone = l.phone
LEFT JOIN public.sms_thread_state st ON st.phone = l.phone;
