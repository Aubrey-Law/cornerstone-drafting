-- Briefing track — Step 3
--
-- Adds the 'draft_saved' value to the email_log.status check constraint so
-- that the new saveReplyAsDraft() path (Outlook drafts created from the
-- briefing inbox triage) can write an audit row even though no send occurred.

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
  CHECK (status IN ('sent','error','suppressed','redirected','draft_saved'));
