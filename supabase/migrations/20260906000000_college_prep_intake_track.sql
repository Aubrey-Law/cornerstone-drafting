-- College Preparation Plan intake track.
--
-- The guided interview now serves two question sets off the same
-- `client_intake` row: the existing estate-planning questionnaire and a
-- College Preparation Plan questionnaire for a student turning 18 (DPOA,
-- health care proxy, HIPAA authorization, living will).
--
-- `intake_track` selects the question set. Existing rows are estate-planning
-- intakes, so the default backfills them without a data migration.
--
-- Track-specific answers live in one JSONB blob rather than ~30 columns —
-- same pattern as `financial_details` / `family_details`. Only the student's
-- own identity (name, DOB, address, contact) reuses the core columns, because
-- the student *is* the client on this track.

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS intake_track text NOT NULL DEFAULT 'estate',
  ADD COLUMN IF NOT EXISTS college_prep_details jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_intake_intake_track_check'
  ) THEN
    ALTER TABLE public.client_intake
      ADD CONSTRAINT client_intake_intake_track_check
      CHECK (intake_track IN ('estate', 'college_prep'));
  END IF;
END
$$;

COMMENT ON COLUMN public.client_intake.intake_track IS
  'Which guided-interview question set this intake uses: estate | college_prep.';
COMMENT ON COLUMN public.client_intake.college_prep_details IS
  'College Preparation Plan answers (school, parents, DPOA scope, HIPAA, living will). Keys are the wizard field ids minus the college_ prefix.';

NOTIFY pgrst, 'reload schema';
