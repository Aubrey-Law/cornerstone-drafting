-- Admin-managed email templates for manual and automated email categories.
-- Rows are edited through service-role-backed admin routes; RLS still protects
-- the public schema from direct client access.

CREATE TABLE IF NOT EXISTS public.email_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  category    text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  is_default  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_templates_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT email_templates_subject_not_blank CHECK (length(btrim(subject)) > 0),
  CONSTRAINT email_templates_body_not_blank CHECK (length(btrim(body)) > 0),
  CONSTRAINT email_templates_category_check CHECK (
    category IN (
      'lead_notification',
      'intake_complete_alert',
      'intake_invite',
      'engagement_agreement',
      'message_alert',
      'plan_review_invite',
      'plan_review_unlocked',
      'post_discovery_followup',
      'stage_change_notice',
      'portal_message_notice',
      'manual',
      'outlook_reply'
    )
  )
);

CREATE INDEX IF NOT EXISTS email_templates_category_idx
  ON public.email_templates (category, is_active, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS email_templates_one_default_per_category_idx
  ON public.email_templates (category)
  WHERE is_default;

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read email_templates" ON public.email_templates;
CREATE POLICY "Admins read email_templates"
  ON public.email_templates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'attorney')
    )
  );
