-- Generalize the Cal.com booking mirror for a second provider (Calendly).
-- Parallel run: Cal.com keeps writing with provider='calcom' while Calendly
-- webhooks land with provider='calendly'. Cal.com removal is a later migration.

ALTER TABLE public.calcom_bookings RENAME TO external_bookings;

ALTER TABLE public.external_bookings
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'calcom';

ALTER TABLE public.external_bookings
  ADD CONSTRAINT external_bookings_provider_check
  CHECK (provider IN ('calcom', 'calendly'));

-- Booking uids are namespaced per provider now.
ALTER TABLE public.external_bookings
  DROP CONSTRAINT IF EXISTS calcom_bookings_booking_uid_key;
ALTER TABLE public.external_bookings
  ADD CONSTRAINT external_bookings_provider_booking_uid_key
  UNIQUE (provider, booking_uid);

-- 'superseded': a Calendly reschedule cancels the old invitee and creates a new
-- one; the old row keeps history without reading as a client cancellation.
ALTER TABLE public.external_bookings
  DROP CONSTRAINT IF EXISTS calcom_bookings_status_check;
ALTER TABLE public.external_bookings
  ADD CONSTRAINT external_bookings_status_check
  CHECK (status IN ('scheduled', 'rescheduled', 'cancelled', 'superseded'));

-- Indexes, trigger, and policy survive the table rename under their old names.
ALTER INDEX idx_calcom_bookings_start_time     RENAME TO idx_external_bookings_start_time;
ALTER INDEX idx_calcom_bookings_attendee_email RENAME TO idx_external_bookings_attendee_email;
ALTER INDEX idx_calcom_bookings_linked_lead    RENAME TO idx_external_bookings_linked_lead;
ALTER INDEX idx_calcom_bookings_linked_matter  RENAME TO idx_external_bookings_linked_matter;
ALTER INDEX idx_calcom_bookings_unresolved     RENAME TO idx_external_bookings_unresolved;

ALTER TRIGGER calcom_bookings_updated_at_trg ON public.external_bookings
  RENAME TO external_bookings_updated_at_trg;

ALTER POLICY "Staff can view calcom bookings" ON public.external_bookings
  RENAME TO "Staff can view external bookings";

COMMENT ON TABLE public.external_bookings IS
  'Provider-agnostic mirror of scheduling webhooks (Cal.com, Calendly). The provider remains the booking source of truth.';

COMMENT ON COLUMN public.external_bookings.raw_payload IS
  'Raw provider webhook body retained for troubleshooting and future reconciliation.';

-- Dedupe ledger must accept the new provider or every Calendly
-- claim_webhook_event insert fails its CHECK and the route 500-loops.
ALTER TABLE public.telephony_webhook_events
  DROP CONSTRAINT IF EXISTS telephony_webhook_events_provider_check;
ALTER TABLE public.telephony_webhook_events
  ADD CONSTRAINT telephony_webhook_events_provider_check
  CHECK (provider = ANY (ARRAY['twilio', 'telnyx', 'retell', 'calcom', 'calendly']));

COMMENT ON COLUMN public.matter_notes.calcom_booking_uid IS
  'Provider booking uid tag (Cal.com booking uid or Calendly invitee uuid). Rename deferred to the Cal.com removal migration.';

NOTIFY pgrst, 'reload schema';
