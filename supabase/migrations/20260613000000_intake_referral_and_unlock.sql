-- The "Getting Started" intake step collected referral_source / referral_name
-- and legal-insurance fields, but the /api/intake save route never mapped them
-- to columns, so they were silently dropped on save. That left the step unable
-- to ever read back as complete. Add the missing columns so the data persists.
--
-- Also add an unlock-request flag: a submitted (locked) intake shows a
-- "Request Unlock" button in the portal; clicking it stamps unlock_requested_at
-- (and an optional note) and emails the firm. The attorney's existing
-- unlockIntake() flow clears it when they reopen the questionnaire.
ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS referral_source text,
  ADD COLUMN IF NOT EXISTS referral_name text,
  ADD COLUMN IF NOT EXISTS legal_insurance_plan text,
  ADD COLUMN IF NOT EXISTS legal_insurance_member_id text,
  ADD COLUMN IF NOT EXISTS unlock_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS unlock_request_note text;

COMMENT ON COLUMN public.client_intake.referral_source IS
  'Getting Started: how the client found the firm (drives step completion).';
COMMENT ON COLUMN public.client_intake.referral_name IS
  'Getting Started: name of the person/source who referred the client, when applicable.';
COMMENT ON COLUMN public.client_intake.legal_insurance_plan IS
  'Getting Started: legal-insurance plan name, when the referral source is a legal plan.';
COMMENT ON COLUMN public.client_intake.legal_insurance_member_id IS
  'Getting Started: legal-insurance member ID, when the referral source is a legal plan.';
COMMENT ON COLUMN public.client_intake.unlock_requested_at IS
  'Set when a client requests changes to a submitted/locked intake; cleared on attorney unlock.';
COMMENT ON COLUMN public.client_intake.unlock_request_note IS
  'Optional note the client included with their unlock request.';
