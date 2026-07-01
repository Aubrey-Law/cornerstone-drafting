-- Unified Cal.com scheduling mirror and webhook sync support.

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
  linked_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  linked_matter_id uuid REFERENCES public.matters(id) ON DELETE SET NULL,
  unresolved_reason text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.calcom_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view calcom bookings" ON public.calcom_bookings;
CREATE POLICY "Admins can view calcom bookings"
  ON public.calcom_bookings
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('attorney', 'admin')
  ));

DROP POLICY IF EXISTS "Admins can manage calcom bookings" ON public.calcom_bookings;
CREATE POLICY "Admins can manage calcom bookings"
  ON public.calcom_bookings
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('attorney', 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('attorney', 'admin')
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

COMMENT ON TABLE public.calcom_bookings IS
  'Server-side mirror of Cal.com booking webhooks. Cal.com remains the booking source of truth; this table provides idempotent app sync and unresolved booking auditability.';

COMMENT ON COLUMN public.calcom_bookings.raw_payload IS
  'Raw Cal.com webhook body retained for troubleshooting and future reconciliation.';
