-- Cal.com booking mirror for webhook sync (Lite).

ALTER TABLE public.matter_notes
  ADD COLUMN IF NOT EXISTS calcom_booking_uid text;

CREATE INDEX IF NOT EXISTS idx_matter_notes_calcom_booking_uid
  ON public.matter_notes (calcom_booking_uid)
  WHERE calcom_booking_uid IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.calcom_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_uid text NOT NULL UNIQUE,
  booking_id text,
  trigger_event text NOT NULL,
  event_key text,
  event_slug text,
  event_label text,
  status text NOT NULL CHECK (status IN ('scheduled', 'rescheduled', 'cancelled')),
  start_time timestamptz,
  end_time timestamptz,
  attendee_email text,
  attendee_name text,
  linked_lead_id uuid REFERENCES public.client_intake(id) ON DELETE SET NULL,
  linked_matter_id uuid REFERENCES public.matters(id) ON DELETE SET NULL,
  unresolved_reason text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.calcom_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view calcom bookings" ON public.calcom_bookings;
CREATE POLICY "Staff can view calcom bookings"
  ON public.calcom_bookings
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('attorney', 'admin', 'va', 'staff')
  ));

CREATE INDEX IF NOT EXISTS idx_calcom_bookings_start_time
  ON public.calcom_bookings (start_time)
  WHERE start_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calcom_bookings_attendee_email
  ON public.calcom_bookings (lower(attendee_email))
  WHERE attendee_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calcom_bookings_linked_lead
  ON public.calcom_bookings (linked_lead_id)
  WHERE linked_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calcom_bookings_linked_matter
  ON public.calcom_bookings (linked_matter_id)
  WHERE linked_matter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calcom_bookings_unresolved
  ON public.calcom_bookings (unresolved_reason, updated_at DESC)
  WHERE unresolved_reason IS NOT NULL;

DROP TRIGGER IF EXISTS calcom_bookings_updated_at_trg ON public.calcom_bookings;
CREATE TRIGGER calcom_bookings_updated_at_trg
BEFORE UPDATE ON public.calcom_bookings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.calcom_bookings IS
  'Server-side mirror of Cal.com booking webhooks. Cal.com remains the booking source of truth.';

COMMENT ON COLUMN public.calcom_bookings.raw_payload IS
  'Raw Cal.com webhook body retained for troubleshooting and future reconciliation.';

-- Resolve calendar attendee emails to matter links in one database round trip.

CREATE OR REPLACE FUNCTION public.get_matter_links_by_emails(p_emails text[])
RETURNS TABLE (
  email text,
  matter_id uuid,
  matter_name text,
  stage text,
  doc_counts jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH input_emails AS (
    SELECT DISTINCT lower(trim(email)) AS email
    FROM unnest(COALESCE(p_emails, ARRAY[]::text[])) AS email
    WHERE nullif(trim(email), '') IS NOT NULL
  ),
  matched_intakes AS (
    SELECT DISTINCT ON (lower(ci.email))
      lower(ci.email) AS email,
      ci.id AS intake_id,
      ci.first_name,
      ci.last_name
    FROM public.client_intake ci
    JOIN input_emails ie ON ie.email = lower(ci.email)
    ORDER BY lower(ci.email), ci.updated_at DESC NULLS LAST, ci.created_at DESC
  ),
  matched_matters AS (
    SELECT DISTINCT ON (mi.email)
      mi.email,
      m.id AS matter_id,
      COALESCE(
        NULLIF(m.name, ''),
        NULLIF(trim(concat_ws(' ', mi.first_name, mi.last_name)), ''),
        mi.email
      ) AS matter_name,
      COALESCE(m.stage::text, 'intake') AS stage
    FROM matched_intakes mi
    JOIN public.matters m ON m.client_intake_id = mi.intake_id
    WHERE COALESCE(m.status, '') <> 'archived'
    ORDER BY mi.email, m.created_at DESC
  ),
  doc_counts AS (
    SELECT
      md.matter_id::uuid AS matter_id,
      count(*) FILTER (WHERE md.folder = 'draft') AS drafts,
      count(*) FILTER (WHERE md.folder = 'review') AS review,
      count(*) FILTER (WHERE md.folder = 'signed') AS signed,
      count(*) FILTER (WHERE md.folder = 'final') AS final
    FROM public.matter_documents md
    JOIN matched_matters mm ON mm.matter_id::text = md.matter_id
    GROUP BY md.matter_id
  )
  SELECT
    mm.email,
    mm.matter_id,
    mm.matter_name,
    mm.stage,
    jsonb_build_object(
      'drafts', COALESCE(dc.drafts, 0),
      'review', COALESCE(dc.review, 0),
      'signed', COALESCE(dc.signed, 0),
      'final', COALESCE(dc.final, 0)
    ) AS doc_counts
  FROM matched_matters mm
  LEFT JOIN doc_counts dc ON dc.matter_id = mm.matter_id;
$$;

REVOKE ALL ON FUNCTION public.get_matter_links_by_emails(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_matter_links_by_emails(text[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_matter_links_by_emails(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_matter_links_by_emails(text[]) TO service_role;

NOTIFY pgrst, 'reload schema';
