/*
  # Drop client_intake.spouse_* — contacts is the sole source of spouse data

  All readers were repointed to the contacts table (relationship_type='spouse')
  and every writer of client_intake.spouse_* was removed:
    - the saveHouseholdContact mirror (mirrorSpouseToIntake) — removed
    - app/api/intake/route.ts spouse_name write — removed
    - the lead→intake seed inserts in send-intake and send-post-discovery-followup
      now seed a spouse CONTACT instead of client_intake.spouse_*

  The v_matter_pipeline view was repointed to contacts in
  20260614120000_pipeline_view_spouse_from_contacts.sql — APPLY THAT FIRST, or
  this DROP fails on the view dependency.

  KEEP leads.spouse_* — the lead stage still uses it; this migration touches only
  client_intake.

  Guarded with IF EXISTS so it is idempotent against this repo's diverged
  migration history. Apply manually / repair-mark — do NOT blind `db push`.
*/

ALTER TABLE public.client_intake
  DROP COLUMN IF EXISTS spouse_first_name,
  DROP COLUMN IF EXISTS spouse_middle_name,
  DROP COLUMN IF EXISTS spouse_last_name,
  DROP COLUMN IF EXISTS spouse_suffix,
  DROP COLUMN IF EXISTS spouse_preferred_name,
  DROP COLUMN IF EXISTS spouse_prior_names,
  DROP COLUMN IF EXISTS spouse_preferred_pronoun,
  DROP COLUMN IF EXISTS spouse_date_of_birth,
  DROP COLUMN IF EXISTS spouse_is_us_citizen,
  DROP COLUMN IF EXISTS spouse_phone,
  DROP COLUMN IF EXISTS spouse_email,
  DROP COLUMN IF EXISTS spouse_name;
