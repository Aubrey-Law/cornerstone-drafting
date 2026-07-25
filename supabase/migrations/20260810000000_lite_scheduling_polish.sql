-- Scheduling polish (Lite): staff cancel/reschedule/no-show, spouse attendee,
-- SMS reminders, post-booking automation toggles, pause + date overrides.

-- Second attendee (spouse/partner) — invited to the Outlook event and cc'd
-- on confirmation/reminder emails.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS second_attendee_name text,
  ADD COLUMN IF NOT EXISTS second_attendee_email text;

-- 'no_show' status for appointments the client missed. The overlap exclusion
-- constraint only ranges over 'scheduled' rows, so this needs no change there.
ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('scheduled', 'cancelled', 'rescheduled', 'no_show'));

ALTER TABLE public.scheduling_settings
  -- One-click pause for client-facing booking (staff bookings unaffected).
  ADD COLUMN IF NOT EXISTS booking_paused boolean NOT NULL DEFAULT false,
  -- Also text the reminder when the attendee left a phone number.
  ADD COLUMN IF NOT EXISTS sms_reminders_enabled boolean NOT NULL DEFAULT false,
  -- Auto-send the intake invite when a discovery call is booked by a lead.
  ADD COLUMN IF NOT EXISTS auto_intake_invite boolean NOT NULL DEFAULT true,
  -- Per-date hour overrides: {"YYYY-MM-DD": [{start,end}, ...]}; [] = closed.
  ADD COLUMN IF NOT EXISTS date_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
