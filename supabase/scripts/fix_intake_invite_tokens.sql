-- Run in Supabase SQL Editor if Send Intake fails with missing client_intake columns
-- (e.g. intake_token_expires_at, intake_token_hash). Safe to re-run.

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS intake_token_hash text,
  ADD COLUMN IF NOT EXISTS intake_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS intake_token_last_used_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS client_intake_intake_token_hash_idx
  ON public.client_intake (intake_token_hash)
  WHERE intake_token_hash IS NOT NULL;

NOTIFY pgrst, 'reload schema';

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('20260714000000')
ON CONFLICT DO NOTHING;
