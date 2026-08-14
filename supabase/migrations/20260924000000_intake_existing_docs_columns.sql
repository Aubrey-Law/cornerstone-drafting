-- The admin intake sheet renders "Existing documents" (has_will/has_trust/
-- has_poa/has_hcp) and "Special circumstances" checkboxes, but the columns
-- never existed — buildPayload omitted them and the loader hardcoded them
-- empty, so attorney edits to those controls were silently discarded.

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS has_will boolean,
  ADD COLUMN IF NOT EXISTS has_trust boolean,
  ADD COLUMN IF NOT EXISTS has_poa boolean,
  ADD COLUMN IF NOT EXISTS has_hcp boolean,
  ADD COLUMN IF NOT EXISTS special_circumstances text[];

NOTIFY pgrst, 'reload schema';
