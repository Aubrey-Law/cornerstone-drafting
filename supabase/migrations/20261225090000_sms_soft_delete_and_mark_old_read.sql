-- Staff can delete texts from the Texts page, one message or a whole
-- conversation. The text is already on the other person's phone, so this only
-- hides the firm's copy. It is a soft delete: the row stays, with who deleted
-- it and when, so the record of client communications survives and a delete
-- can be undone by hand.
--
-- Also a one-time cleanup: texts that arrived while texting was retired
-- (before 2026-09-23) are marked read, so the Texts badge starts at zero
-- instead of counting a backlog nobody needs to act on.
--
-- Additive only: two nullable columns, a replaced view (same columns), and a
-- data update.

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Same view as 20261224103000, minus deleted messages. A conversation whose
-- messages are all deleted drops out of the list and the badge. Opt-outs live
-- in sms_opt_outs, so deleting a STOP message never lets the number be
-- texted again.
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
      FILTER (WHERE nullif(trim(recipient_name), '') IS NOT NULL))[1] AS recipient_name
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
  (oo.phone IS NOT NULL AND oo.opted_in_at IS NULL) AS opted_out
FROM latest l
JOIN agg a USING (phone)
LEFT JOIN public.sms_opt_outs oo ON oo.phone = l.phone;

-- One-time: the backlog from the retirement period is not new mail. A fixed
-- cutoff rather than now(), so a text that arrives after texting is switched
-- back on but before this runs still shows as unread.
UPDATE public.sms_messages
SET read_by_staff_at = now()
WHERE direction = 'inbound'
  AND read_by_staff_at IS NULL
  AND created_at < '2026-09-23 00:00:00-04';
