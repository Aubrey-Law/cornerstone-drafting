-- Custom questions an appointment type asks at booking time, and each
-- booking's answers. Questions are an ordered jsonb array of
-- {id, label, kind, required, options} (validated in
-- lib/appointments/bookingQuestions.ts). Answers snapshot the question label
-- alongside the answer so later edits never change an existing booking.
-- Both columns default to an empty array, so deployed code that doesn't know
-- about them keeps working.

ALTER TABLE public.appointment_types
  ADD COLUMN IF NOT EXISTS booking_questions jsonb NOT NULL DEFAULT '[]'::jsonb
  CONSTRAINT appointment_types_booking_questions_array_check
  CHECK (jsonb_typeof(booking_questions) = 'array');

COMMENT ON COLUMN public.appointment_types.booking_questions IS
  'Ordered custom booking questions: [{id, label, kind: short_text|long_text|choice|yes_no, required, options}].';

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS booking_answers jsonb NOT NULL DEFAULT '[]'::jsonb
  CONSTRAINT appointments_booking_answers_array_check
  CHECK (jsonb_typeof(booking_answers) = 'array');

COMMENT ON COLUMN public.appointments.booking_answers IS
  'Client answers to the type''s booking questions, snapshotted: [{questionId, label, answer}].';

NOTIFY pgrst, 'reload schema';
