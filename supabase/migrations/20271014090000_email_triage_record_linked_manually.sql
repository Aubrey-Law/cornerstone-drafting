-- Mail Desk: durable manual link to a lead or matter.
--
-- Scans re-classify every open thread from the sender address. Without a flag,
-- an attorney who links a possible-lead / noise-adjacent thread to a CRM record
-- loses that link on the next Refresh. When this is true, scan keeps the
-- stored classification and foreign keys instead of overwriting them.

ALTER TABLE public.email_triage_threads
  ADD COLUMN IF NOT EXISTS record_linked_manually boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.email_triage_threads.record_linked_manually IS
  'Attorney linked this thread to a lead/matter in Mail Desk; scan must not '
  'overwrite classification or CRM foreign keys.';

NOTIFY pgrst, 'reload schema';
