-- `human_draft_at` now records when the attorney's unsent reply was last
-- saved, not when a scan noticed it.
--
-- As first shipped the column was set to the scan's own clock, which made
-- every draft look like it had been written a moment ago. That was enough to
-- suppress the model draft and no use at all for deciding whether it should
-- be: the first scan to read the whole fourteen-day window turned up
-- seventeen unsent replies, several more than a week old. Deferring to
-- someone mid-sentence is right; deferring to a reply they started and forgot
-- withholds help from precisely the threads most overdue one.
--
-- Nothing is backfilled. Existing values are scan clocks, all of them recent,
-- so they read as fresh until the next scan overwrites each row with the
-- draft's real timestamp — which is the safe direction to be wrong in, and
-- self-correcting within one run.
COMMENT ON COLUMN public.email_triage_threads.human_draft_at IS
  'When the attorney''s own unsent Gmail draft on this thread was last saved '
  '(the newest, if several). Suppresses model drafting while it is recent — '
  'see STALE_HUMAN_DRAFT_MS — and shows with its age on the triage page. '
  'NULL means there is no draft.';
