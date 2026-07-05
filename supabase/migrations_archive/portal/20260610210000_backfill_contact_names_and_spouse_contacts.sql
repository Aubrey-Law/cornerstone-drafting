-- One-time, idempotent data backfills paired with the spouse-sync + name
-- standardization work. Safe to re-run: every statement no-ops on already-fixed
-- rows. Demo-data-only fixes that were applied ad hoc (a single-record last_name
-- typo and recovering one orphaned spouse_name into its parts) are intentionally
-- NOT included here, since they target specific seed-record ids and don't belong
-- in a migration that runs against every environment.

-- 1. Materialize a spouse contacts row for every intake that has spouse name
--    data but no spouse contact yet (depends on uq_contacts_one_spouse from
--    20260610191549_spouse_contact_sync).
INSERT INTO public.contacts (
  client_intake_id, relationship_type, first_name, middle_name, last_name, suffix,
  preferred_name, prior_names, preferred_pronoun, date_of_birth, is_us_citizen,
  phone, email, source
)
SELECT
  ci.id, 'spouse',
  coalesce(ci.spouse_first_name,''), ci.spouse_middle_name,
  coalesce(ci.spouse_last_name,''), ci.spouse_suffix,
  ci.spouse_preferred_name, ci.spouse_prior_names, ci.spouse_preferred_pronoun,
  ci.spouse_date_of_birth, coalesce(ci.spouse_is_us_citizen, true),
  ci.spouse_phone, ci.spouse_email, 'intake_sync'
FROM public.client_intake ci
WHERE coalesce(ci.spouse_first_name,'') <> '' OR coalesce(ci.spouse_last_name,'') <> ''
ON CONFLICT (client_intake_id) WHERE relationship_type = 'spouse' DO NOTHING;

-- 2. Fill client_intake.full_name where it is blank but name parts exist.
--    Rows with an intentionally-entered (shorter) full_name are left untouched.
UPDATE public.client_intake
SET full_name = NULLIF(trim(regexp_replace(
      concat_ws(' ', NULLIF(first_name,''), NULLIF(middle_name,''), NULLIF(last_name,'')),
      '\s+',' ','g')),'')
WHERE coalesce(full_name,'') = ''
  AND coalesce(first_name,'') <> '' AND coalesce(last_name,'') <> '';

-- 3. Same for spouse_name.
UPDATE public.client_intake
SET spouse_name = NULLIF(trim(regexp_replace(
      concat_ws(' ', NULLIF(spouse_first_name,''), NULLIF(spouse_middle_name,''), NULLIF(spouse_last_name,'')),
      '\s+',' ','g')),'')
WHERE coalesce(spouse_name,'') = ''
  AND coalesce(spouse_first_name,'') <> '' AND coalesce(spouse_last_name,'') <> '';
