-- Appointment reminder emails (Lite).
-- reminder_sent_at: claim/ledger for the reminder cron (null = not yet sent).
-- online_meeting_url: Teams join link persisted at booking so reminders can
-- include it (previously only available transiently from the Graph response).
-- scheduling_settings.reminder_hours_before: lead time; 0 disables reminders.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS online_meeting_url text;

ALTER TABLE public.scheduling_settings
  ADD COLUMN IF NOT EXISTS reminder_hours_before integer NOT NULL DEFAULT 24;

-- The reminder cron scans for unsent reminders on upcoming appointments.
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_due
  ON public.appointments (start_time)
  WHERE status = 'scheduled' AND reminder_sent_at IS NULL;

NOTIFY pgrst, 'reload schema';
