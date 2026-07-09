-- Intake invite tokens (hashed) for client account creation via /intake/auth

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS intake_token_hash text,
  ADD COLUMN IF NOT EXISTS intake_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS intake_token_last_used_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS client_intake_intake_token_hash_idx
  ON public.client_intake (intake_token_hash)
  WHERE intake_token_hash IS NOT NULL;

NOTIFY pgrst, 'reload schema';
