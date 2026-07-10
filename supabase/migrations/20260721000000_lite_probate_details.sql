-- Admin Fill Intake probate fields (pb_*) stored as jsonb on client_intake.

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS probate_details jsonb;

COMMENT ON COLUMN public.client_intake.probate_details IS
  'Probate matter details from the admin intake sheet: decedent_name, date_of_death, domicile, estate_value, known_assets, known_debts, petitioner_relationship, goals_timeline.';

NOTIFY pgrst, 'reload schema';
