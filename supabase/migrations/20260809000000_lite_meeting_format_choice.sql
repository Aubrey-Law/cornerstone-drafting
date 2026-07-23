-- Clients choose the meeting format at booking time, from a per-type allowed
-- list. location_types is ordered — the first entry is the default, and
-- location_type stays synced to it for back-compat with deployed code.

ALTER TABLE public.appointment_types
  ADD COLUMN IF NOT EXISTS location_types text[] NOT NULL DEFAULT '{phone}'
  CONSTRAINT appointment_types_location_types_check
  CHECK (location_types <@ ARRAY['phone', 'teams', 'in_person'] AND array_length(location_types, 1) >= 1);

-- Backfill from the existing single format, then apply the firm's menu.
UPDATE public.appointment_types SET location_types = ARRAY[location_type];

UPDATE public.appointment_types SET location_types = ARRAY['phone']                      WHERE key = 'discovery_call';
UPDATE public.appointment_types SET location_types = ARRAY['in_person', 'teams', 'phone'] WHERE key = 'pmps';
UPDATE public.appointment_types SET location_types = ARRAY['in_person']                  WHERE key = 'signing_appointment';
UPDATE public.appointment_types SET location_types = ARRAY['teams', 'phone']             WHERE key = 'draft_review';
UPDATE public.appointment_types SET location_types = ARRAY['phone', 'teams']             WHERE key = 'client_call';

UPDATE public.appointment_types SET location_type = location_types[1];

-- The format chosen for a specific booking (null on legacy rows → type default).
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS location_type text
  CONSTRAINT appointments_location_type_check
  CHECK (location_type IS NULL OR location_type IN ('phone', 'teams', 'in_person'));

NOTIFY pgrst, 'reload schema';
