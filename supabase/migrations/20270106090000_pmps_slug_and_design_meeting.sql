-- Booking URLs: the Peace of Mind Planning Session moves to /book/pmps, and a
-- new Design Meeting appointment type takes /book/design-meeting.
--
-- The PMPS still carried the `design-meeting` slug from the v1 era, when the
-- planning session *was* the design meeting (see 20260909000000). The PMPS
-- slug moves first so the new type can claim the freed slug in the same
-- transaction. Only the URL changes for the PMPS: its key (`pmps`), which the
-- SLA anchors, automation and Lawmatics mapping read, is untouched.
--
-- The Design Meeting starts with conservative defaults that staff can change
-- in Settings → Scheduling: 60 minutes, the same three formats as the PMPS
-- (in person first), public so the link works for a client who is not signed
-- in, and no booking questions.

UPDATE public.appointment_types
SET slug = 'pmps'
WHERE key = 'pmps' AND slug <> 'pmps';

INSERT INTO public.appointment_types
  (key, slug, label, description, duration_minutes, location_type, location_types, active, public, sort)
VALUES
  ('design_meeting', 'design-meeting', 'Design Meeting',
   'Work through the design of your estate plan with your attorney.',
   60, 'in_person', ARRAY['in_person', 'teams', 'phone'], true, true, 3)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
