-- Hybrid email routing: per-category provider (Resend vs Microsoft Graph).
--
-- Adds:
--   * email_settings.provider              — which transport to use ('resend' | 'graph')
--   * email_log.provider                   — which transport actually attempted the send
--   * email_log.provider_message_id        — graph internetMessageId (when available);
--                                            resend_id stays as-is for backward compat
--
-- Defaults every category to 'resend' (existing behaviour). The 'manual'
-- category is flipped to 'graph' so attorney compose-box sends route through
-- Scott's M365 mailbox and land in his Sent Items / thread back to his Inbox.

ALTER TABLE email_settings
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'resend';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'email_settings' AND constraint_name = 'email_settings_provider_check'
  ) THEN
    ALTER TABLE email_settings
      ADD CONSTRAINT email_settings_provider_check
      CHECK (provider IN ('resend','graph'));
  END IF;
END$$;

UPDATE email_settings SET provider = 'graph' WHERE category = 'manual';

ALTER TABLE email_log
  ADD COLUMN IF NOT EXISTS provider             text,
  ADD COLUMN IF NOT EXISTS provider_message_id  text;

CREATE INDEX IF NOT EXISTS email_log_provider_idx
  ON email_log (provider, sent_at DESC);
