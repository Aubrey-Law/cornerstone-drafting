-- Outbound mail moves from Microsoft Graph to Gmail.
--
-- The firm no longer uses Microsoft 365, so 'graph' is not a provider the app
-- can honour any more: a category left on it would fall through to Resend and
-- send client mail from the wrong address. Rewrite the stored value and narrow
-- the constraint in the same step, so there is no window where a row names a
-- provider the code cannot route.

ALTER TABLE public.email_settings
  DROP CONSTRAINT IF EXISTS email_settings_provider_check;

UPDATE public.email_settings SET provider = 'gmail' WHERE provider = 'graph';

ALTER TABLE public.email_settings
  ADD CONSTRAINT email_settings_provider_check
  CHECK (provider IN ('resend', 'gmail'));

-- email_log.provider is history, not configuration: rows saying 'graph' record
-- sends that really did go through Microsoft and are left exactly as they are.
