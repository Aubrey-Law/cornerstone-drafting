-- Attorney Mail Desk: Gmail auto-sort, snooze, follow-ups, task-from-email.
--
-- Gmail stays the mailbox. Cornerstone stores workflow state (snooze / follow-up)
-- and optional links from tasks back to triage threads. Full message bodies are
-- still never persisted — see 20261126000000_email_triage.sql.

-- ── firm_settings: archive non-client mail out of the Gmail Inbox ──────────
ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS email_triage_archive_non_client boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.firm_settings.email_triage_archive_non_client IS
  'When true (default), Mail Desk archives noise/ignored/handled/internal mail '
  'out of the Gmail Inbox after labelling. Set false to label only during rollout.';

-- ── email_triage_threads: snooze, follow-up, sort audit ────────────────────
ALTER TABLE public.email_triage_threads
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_note text,
  ADD COLUMN IF NOT EXISTS claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thread_note text,
  ADD COLUMN IF NOT EXISTS gmail_sorted_at timestamptz,
  ADD COLUMN IF NOT EXISTS gmail_sort_label text;

COMMENT ON COLUMN public.email_triage_threads.snoozed_until IS
  'Hide from the active Mail Desk queue and Command Center until this time.';
COMMENT ON COLUMN public.email_triage_threads.follow_up_at IS
  'Remind the firm if no client reply has arrived by this time (after we replied).';
COMMENT ON COLUMN public.email_triage_threads.gmail_sort_label IS
  'Last Cornerstone/* Gmail label applied by auto-sort (audit / UI trust line).';

CREATE INDEX IF NOT EXISTS email_triage_threads_snoozed_idx
  ON public.email_triage_threads (snoozed_until)
  WHERE snoozed_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_triage_threads_follow_up_idx
  ON public.email_triage_threads (follow_up_at)
  WHERE follow_up_at IS NOT NULL;

-- Open-queue filtering of snoozed rows is done in application queries
-- (snoozed_until > now()); the partial index stays status-only because
-- `now()` is not IMMUTABLE and cannot appear in an index predicate.

-- ── tasks: link back to the email thread ───────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS email_triage_thread_id uuid
    REFERENCES public.email_triage_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gmail_thread_id text;

CREATE INDEX IF NOT EXISTS tasks_email_triage_thread_idx
  ON public.tasks (email_triage_thread_id)
  WHERE email_triage_thread_id IS NOT NULL;

COMMENT ON COLUMN public.tasks.email_triage_thread_id IS
  'Mail Desk triage row this task was created from, when any.';
COMMENT ON COLUMN public.tasks.gmail_thread_id IS
  'Gmail thread id for deep-linking when the triage row is gone.';

NOTIFY pgrst, 'reload schema';
