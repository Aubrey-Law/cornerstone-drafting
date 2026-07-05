-- Removes the Briefing email triage feature.
--
-- Drops:
--   * email_triage_log table (added in 20260512000000)
--   * 'draft_saved' from email_log.status check (added in 20260513000000)
--   * email_settings row for the 'outlook_reply' category
--
-- The triage UI/API/library code was removed from the application; this
-- migration removes the matching schema. The Outlook Mail.Read OAuth scope
-- on the Microsoft connection is left in place — it has no effect once the
-- triage code is gone, and removing it would require users to reconnect.

DROP TABLE IF EXISTS public.email_triage_log;

DELETE FROM public.email_settings WHERE category = 'outlook_reply';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'email_log' AND constraint_name = 'email_log_status_check'
  ) THEN
    ALTER TABLE email_log DROP CONSTRAINT email_log_status_check;
  END IF;
END$$;

ALTER TABLE email_log
  ADD CONSTRAINT email_log_status_check
  CHECK (status IN ('sent','error','suppressed','redirected'));
