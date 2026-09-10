-- `matter_corrected` joins the activity types.
--
-- `correct_matter` (20261118000000) writes its audit row with this event type,
-- and `matter_activity_event_type_check` did not list it — so every correction
-- failed on the audit insert, and because that insert shares the function's
-- transaction, the whole correction rolled back. The function was completely
-- non-functional on its happy path.
--
-- Nothing caught this. The migration's own tests assert on its SQL text, which
-- was correct; the reviews read the same text. It surfaced on the first attempt
-- to actually call the function against the database.
--
-- Widening a CHECK is additive: every row that satisfied the old constraint
-- satisfies this one. The constraint is dropped and recreated because Postgres
-- has no `alter constraint` for a check expression.
alter table public.matter_activity
  drop constraint if exists matter_activity_event_type_check;

alter table public.matter_activity
  add constraint matter_activity_event_type_check check (
    event_type = any (array[
      'stage_changed', 'note_added', 'document_uploaded', 'document_viewed',
      'document_downloaded', 'task_created', 'task_completed', 'flag_added',
      'flag_removed', 'alert_created', 'alert_resolved', 'intake_sent',
      'intake_completed', 'email_sent', 'sms_sent', 'sms_received',
      'draft_generated', 'draft_promoted_to_review', 'matter_created',
      'matter_archived', 'status_changed', 'sla_anchor_set', 'invoice_issued',
      'invoice_paid',
      -- New: a field on the matter was corrected through public.correct_matter.
      -- Distinct from status_changed and from note_added on purpose — the audit
      -- trail should say what kind of thing happened, and a correction is
      -- neither of those.
      'matter_corrected'
    ])
  );

notify pgrst, 'reload schema';
