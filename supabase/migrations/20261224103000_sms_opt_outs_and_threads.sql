-- Manual staff texting is back (Telnyx only). Two things the old send path
-- lacked:
--
-- 1. A real opt-out list checked before every send. Until now an opt-out was
--    only an inbound sms_messages row with status 'opt_out', and nothing read
--    it before texting that number again.
-- 2. Conversations keyed by phone number. v_communication_threads groups by
--    matter/lead/contact, so a text from a number that matches no record
--    never surfaced anywhere staff would see it.
--
-- Additive only: a new table, a new view and a publication entry. The view
-- scans sms_messages once per read; at a small firm's volume that is cheaper
-- than keeping an expression index current on every insert.

-- ── Opt-outs ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sms_opt_outs (
  -- 10-digit US number, as returned by public.normalize_us_phone().
  phone text PRIMARY KEY,
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the person later texts START/UNSTOP; cleared on the next STOP.
  opted_in_at timestamptz,
  source_message_id uuid REFERENCES public.sms_messages(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sms_opt_outs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sms_opt_outs_staff_select ON public.sms_opt_outs;
CREATE POLICY sms_opt_outs_staff_select ON public.sms_opt_outs
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney', 'va', 'staff')
  )
);
-- Writes come only from the webhook through the service role.

-- Backfill from the STOP messages already on file, latest one per number.
INSERT INTO public.sms_opt_outs (phone, opted_out_at, source_message_id)
SELECT DISTINCT ON (public.normalize_us_phone(sm.from_number))
  public.normalize_us_phone(sm.from_number),
  sm.created_at,
  sm.id
FROM public.sms_messages sm
WHERE sm.direction = 'inbound'
  AND sm.status = 'opt_out'
  AND public.normalize_us_phone(sm.from_number) IS NOT NULL
ORDER BY public.normalize_us_phone(sm.from_number), sm.created_at DESC
ON CONFLICT (phone) DO NOTHING;

-- ── Phone-keyed conversations ───────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_sms_threads;
CREATE VIEW public.v_sms_threads
WITH (security_invoker = true)
AS
WITH msgs AS (
  SELECT
    public.normalize_us_phone(
      CASE WHEN sm.direction = 'inbound' THEN sm.from_number ELSE sm.to_number END
    ) AS phone,
    sm.*
  FROM public.sms_messages sm
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
    -- Latest non-null link of each kind; one conversation can carry all three.
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

REVOKE ALL ON public.v_sms_threads FROM anon;
GRANT SELECT ON public.v_sms_threads TO authenticated, service_role;

-- ── Realtime for the Texts page ─────────────────────────────────────────────
-- Staff-only RLS on sms_messages limits who receives these events.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'sms_messages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_messages;
  END IF;
END $$;
