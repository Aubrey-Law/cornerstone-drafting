-- Staff can book appointments from the admin calendar (source = 'admin').

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_source_check;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_source_check
  CHECK (source IN ('public', 'portal', 'admin'));

NOTIFY pgrst, 'reload schema';
