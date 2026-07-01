-- Probate intake details (pb_* fields) collected by the admin "Fill Intake"
-- sheet had no storage. Add a jsonb column, mirroring the existing
-- family_details / financial_details pattern on client_intake.
ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS probate_details jsonb;

COMMENT ON COLUMN public.client_intake.probate_details IS
  'Probate matter details from the admin intake sheet: decedent_name, date_of_death, domicile, estate_value, known_assets, known_debts, petitioner_relationship, goals_timeline.';
