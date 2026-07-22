-- Per-appointment-type availability hours (Lite).
-- NULL = the type uses the general scheduling_settings.weekly_hours;
-- non-null jsonb = this type is only bookable inside its own windows.

ALTER TABLE public.appointment_types
  ADD COLUMN IF NOT EXISTS custom_weekly_hours jsonb;

COMMENT ON COLUMN public.appointment_types.custom_weekly_hours IS
  'Optional per-type weekly hours ({mon: [{start,end}], ...}, firm timezone). NULL falls back to scheduling_settings.weekly_hours.';

NOTIFY pgrst, 'reload schema';
