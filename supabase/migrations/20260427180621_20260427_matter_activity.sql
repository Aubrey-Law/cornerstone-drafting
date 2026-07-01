/*
  # Matter Activity Log

  ## Purpose
  A unified, append-only timeline of all significant events on a matter.
  Powers the Activity tab on the matter detail page.

  ## New Tables
  - `matter_activity`
    - `id` (uuid, pk)
    - `matter_id` (text, fk → matters.id cast as text — matches existing schema convention)
    - `event_type` (text) — categorizes the event
    - `actor_id` (uuid, nullable) — auth.uid() of who triggered it; null = system
    - `actor_email` (text, nullable) — denormalized for display
    - `actor_name` (text, nullable) — denormalized display name
    - `title` (text) — short human-readable summary
    - `detail` (text, nullable) — optional longer description
    - `metadata` (jsonb, nullable) — structured data (old/new stage, doc id, etc.)
    - `created_at` (timestamptz)

  ## Event Types (enforced via check constraint)
  stage_changed | note_added | document_uploaded | document_viewed |
  document_downloaded | task_completed | flag_added | flag_removed |
  alert_created | alert_resolved | intake_sent | intake_completed |
  email_sent | draft_generated | matter_created | matter_archived | status_changed

  ## Security
  - RLS enabled
  - SELECT: any authenticated user
  - INSERT: any authenticated user (server-side actions insert on behalf of actor)
  - No UPDATE or DELETE — activity log is immutable
*/

CREATE TABLE IF NOT EXISTS matter_activity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   text NOT NULL,
  event_type  text NOT NULL,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  actor_name  text,
  title       text NOT NULL,
  detail      text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT matter_activity_event_type_check CHECK (
    event_type IN (
      'stage_changed', 'note_added', 'document_uploaded', 'document_viewed',
      'document_downloaded', 'task_completed', 'flag_added', 'flag_removed',
      'alert_created', 'alert_resolved', 'intake_sent', 'intake_completed',
      'email_sent', 'draft_generated', 'matter_created', 'matter_archived',
      'status_changed'
    )
  )
);

CREATE INDEX IF NOT EXISTS matter_activity_matter_id_idx ON matter_activity(matter_id);
CREATE INDEX IF NOT EXISTS matter_activity_created_at_idx ON matter_activity(matter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS matter_activity_event_type_idx ON matter_activity(event_type);

ALTER TABLE matter_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view matter activity"
  ON matter_activity FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert matter activity"
  ON matter_activity FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
