-- Add is_unlocked flag to client_intake, set by the admin "Unlock & edit intake"
-- action. NOTE: the effective unlock today is the accompanying status='draft'
-- change (that is what clears the CLIENT_LOCKED_INTAKE_STATUSES guard). This flag
-- is currently written but not yet read; it is reserved to later distinguish an
-- attorney-initiated unlock from a client-requested one (e.g. admin-only editing
-- that keeps the client-facing lock).
ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS is_unlocked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.client_intake.is_unlocked IS
  'Set true by the admin "Unlock & edit intake" action. Currently written, not yet
   read (the active unlock is status=draft). Reserved for attorney-only unlock.';
