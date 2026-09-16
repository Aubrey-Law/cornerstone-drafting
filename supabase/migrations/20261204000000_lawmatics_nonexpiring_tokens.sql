-- Lawmatics access tokens do not expire. Keep legacy columns and existing data
-- for compatibility; new OAuth connections store null expiry and refresh token.
ALTER TABLE public.lawmatics_tokens
  ALTER COLUMN expires_at DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
