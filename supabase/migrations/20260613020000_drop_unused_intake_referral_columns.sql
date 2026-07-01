-- Cleanup: drop the unused referral_* columns added by 20260613000000.
--
-- Referral answers ("Getting Started") are stored in
-- client_intake.family_details.referral (see packReferralDetailsIntoFamilyDetails
-- / unpackReferralDetailsFromFamilyDetails). The flat columns below were never
-- populated — useAutoSave deliberately skips them — and nothing reads them as
-- columns (the completion check reads the unpacked in-memory value, not the DB
-- column), so they are safe to remove.
--
-- The unlock_requested_at / unlock_request_note columns from the same original
-- migration are kept; they are in active use.
ALTER TABLE public.client_intake
  DROP COLUMN IF EXISTS referral_source,
  DROP COLUMN IF EXISTS referral_name,
  DROP COLUMN IF EXISTS legal_insurance_plan,
  DROP COLUMN IF EXISTS legal_insurance_member_id;
