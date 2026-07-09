-- Cornerstone Lite — email settings, templates, and firm branding for outbound mail.

-- ── email_settings extensions ───────────────────────────────────────────────

ALTER TABLE public.email_settings
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'resend',
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'email_settings'
      AND constraint_name = 'email_settings_provider_check'
  ) THEN
    ALTER TABLE public.email_settings
      ADD CONSTRAINT email_settings_provider_check
      CHECK (provider IN ('resend', 'graph'));
  END IF;
END $$;

UPDATE public.email_settings SET provider = 'graph' WHERE category = 'manual';

-- ── email_log extensions ────────────────────────────────────────────────────

ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS to_email text,
  ADD COLUMN IF NOT EXISTS html text,
  ADD COLUMN IF NOT EXISTS cc text,
  ADD COLUMN IF NOT EXISTS reply_to text,
  ADD COLUMN IF NOT EXISTS resend_id text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS email_log_category_sent_at_idx
  ON public.email_log (category, sent_at DESC NULLS LAST);

-- ── firm_settings (singleton) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.firm_settings (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  firm_name           text,
  attorney_name       text,
  attorney_short_name text,
  city                text,
  email               text,
  phone               text,
  street              text,
  state               text,
  zip                 text,
  website             text,
  bar_number          text,
  admitted            text,
  specialization      text,
  email_logo_header   boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.firm_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firm_settings_staff_select ON public.firm_settings;
CREATE POLICY firm_settings_staff_select ON public.firm_settings
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney')
  )
);

INSERT INTO public.firm_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── email_templates ─────────────────────────────────────────────────────────

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
      'message_alert',
      'portal_message_notice',
      'intake_complete_alert',
      'intake_invite',
      'manual'
    )
  )
);

CREATE INDEX IF NOT EXISTS email_templates_category_idx
  ON public.email_templates (category, is_active, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS email_templates_one_default_per_category_idx
  ON public.email_templates (category)
  WHERE is_default;

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_templates_staff_select ON public.email_templates;
CREATE POLICY email_templates_staff_select ON public.email_templates
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney')
  )
);
