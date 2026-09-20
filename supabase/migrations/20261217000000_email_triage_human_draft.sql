-- Record that the attorney is already answering a triaged thread by hand.
--
-- The needs-reply rule used to treat a half-written Gmail draft as a reason to
-- stop tracking a thread altogether. For a thread that already had a row that
-- only froze it: the row stayed on the page with stale contents and was never
-- rescanned. For a thread with no row yet it was worse — no row was ever
-- created, so the thread was invisible to the page, and once it slid out of
-- the scan's listing window nothing ever looked at it again. Two clients'
-- mail sat unanswered for days that way in September 2026.
--
-- The draft is a fact about the row, not a reason to drop it. It suppresses
-- the model draft — nobody wants a second answer written over the one they are
-- typing — and shows on the page, while the thread stays in the queue, because
-- the client is waiting for the send and not for the typing.
--
-- Nullable and unset for every existing row: an absent timestamp means "no
-- draft in progress", which is what every row meant before this column.
ALTER TABLE public.email_triage_threads
  ADD COLUMN IF NOT EXISTS human_draft_at timestamptz;

COMMENT ON COLUMN public.email_triage_threads.human_draft_at IS
  'When a scan last saw an unsent Gmail draft by the attorney on this thread. '
  'Suppresses model drafting and shows on the triage page; NULL means none.';
