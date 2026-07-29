-- Bcc recipients on manual sends.
--
-- email_log already records `cc` (20260719000000); blind recipients need the
-- same audit trail — a firm has to be able to answer "who received this?"
-- months later, and bcc is precisely the case where the message headers don't.
--
-- lib/email/send.ts retries the log insert without `bcc` if this hasn't run
-- yet, so an un-migrated database loses the bcc column's value rather than the
-- whole log row.

ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS bcc text;
