-- Durable manual-email scheduling queue.

CREATE TABLE IF NOT EXISTS public.scheduled_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  context_type text NOT NULL CHECK (context_type IN ('matter', 'lead', 'general')),
  context_id uuid,
  to_email text NOT NULL,
  cc text[] NOT NULL DEFAULT '{}',
  bcc text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text NOT NULL,
  document_ids uuid[] NOT NULL DEFAULT '{}',
  include_signature boolean NOT NULL DEFAULT true,
  scheduled_for timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'suppressed', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  provider_status text,
  email_log_id uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_emails_context_check CHECK (
    (context_type = 'general' AND context_id IS NULL)
    OR (context_type IN ('matter', 'lead') AND context_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS scheduled_emails_due_idx
  ON public.scheduled_emails (next_attempt_at, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS scheduled_emails_user_context_idx
  ON public.scheduled_emails (user_id, context_type, context_id, scheduled_for DESC);

ALTER TABLE public.scheduled_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduled_emails_owner_select ON public.scheduled_emails;
CREATE POLICY scheduled_emails_owner_select ON public.scheduled_emails
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS scheduled_emails_owner_insert ON public.scheduled_emails;
CREATE POLICY scheduled_emails_owner_insert ON public.scheduled_emails
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin', 'attorney')
  )
);

DROP POLICY IF EXISTS scheduled_emails_owner_cancel ON public.scheduled_emails;
CREATE POLICY scheduled_emails_owner_cancel ON public.scheduled_emails
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.scheduled_emails TO authenticated;
GRANT ALL ON public.scheduled_emails TO service_role;
