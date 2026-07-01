/*
  # Matter Activity — add task_created event type

  Extends the matter_activity event_type check constraint to include
  'task_created' so the Activity tab can record task creation alongside
  task completion.
*/

ALTER TABLE matter_activity DROP CONSTRAINT IF EXISTS matter_activity_event_type_check;

ALTER TABLE matter_activity ADD CONSTRAINT matter_activity_event_type_check CHECK (
  event_type IN (
    'stage_changed', 'note_added', 'document_uploaded', 'document_viewed',
    'document_downloaded', 'task_created', 'task_completed', 'flag_added', 'flag_removed',
    'alert_created', 'alert_resolved', 'intake_sent', 'intake_completed',
    'email_sent', 'draft_generated', 'matter_created', 'matter_archived',
    'status_changed'
  )
);
