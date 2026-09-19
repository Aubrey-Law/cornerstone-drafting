-- ── email_log: one message-id column, not two ───────────────────────────────
--
-- email_log has carried both resend_id and provider_message_id since
-- 20260719000000. sendEmail wrote the Resend id to resend_id and left
-- provider_message_id for Gmail's id, so the "provider's message id" lived in
-- whichever column the provider happened to use.
--
-- Two reasons to collapse them onto provider_message_id:
--   1. The Resend delivery webhook (app/api/webhooks/resend/route.ts) matches
--      rows on the id Resend returned at send time. That lookup has to work
--      the same way whoever sent the mail.
--   2. resend_id bakes a vendor name into the schema. lib/email/send.ts is the
--      only writer, so this is the cheapest it will ever be to undo.
--
-- The backfill runs BEFORE the drop: the historical Resend ids exist only in
-- resend_id, and losing them would make every past send unmatchable by webhook.

-- Historical Resend rows: move the id across. Gmail rows already populated
-- provider_message_id, and COALESCE order here never overwrites one of those.
UPDATE public.email_log
SET provider_message_id = resend_id
WHERE provider_message_id IS NULL
  AND resend_id IS NOT NULL;

-- The webhook's only lookup path. Partial: most rows predate id capture, and
-- a NULL id is never searched for.
CREATE INDEX IF NOT EXISTS email_log_provider_message_id_idx
  ON public.email_log (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Verify the backfill left nothing behind before destroying the column. A
-- surviving row means the UPDATE above did not cover some case, and dropping
-- would lose it.
DO $$
DECLARE
  orphaned bigint;
BEGIN
  SELECT count(*) INTO orphaned
  FROM public.email_log
  WHERE resend_id IS NOT NULL
    AND provider_message_id IS DISTINCT FROM resend_id;

  IF orphaned > 0 THEN
    RAISE EXCEPTION
      'email_log: % row(s) still hold a resend_id not copied to provider_message_id; refusing to drop the column',
      orphaned;
  END IF;
END $$;

ALTER TABLE public.email_log
  DROP COLUMN IF EXISTS resend_id;
