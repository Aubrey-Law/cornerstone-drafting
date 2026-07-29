-- Firm-wide manual-email signature and durable per-user compose drafts.

ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS email_signature_html text,
  ADD COLUMN IF NOT EXISTS email_signature_default boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  context_type text NOT NULL CHECK (context_type IN ('matter', 'lead', 'general')),
  context_id uuid,
  to_email text NOT NULL DEFAULT '',
  cc text[] NOT NULL DEFAULT '{}',
  bcc text[] NOT NULL DEFAULT '{}',
  template_id uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
  subject text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  document_ids uuid[] NOT NULL DEFAULT '{}',
  include_signature boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_drafts_context_id_check CHECK (
    (context_type = 'general' AND context_id IS NULL)
    OR (context_type IN ('matter', 'lead') AND context_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS email_drafts_user_context_idx
  ON public.email_drafts (user_id, context_type, COALESCE(context_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.email_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_drafts_owner_all ON public.email_drafts;
CREATE POLICY email_drafts_owner_all ON public.email_drafts
FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin', 'attorney')
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_drafts TO authenticated;
GRANT ALL ON public.email_drafts TO service_role;
