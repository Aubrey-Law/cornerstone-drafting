-- Allow Retell post-call alert emails in templates + settings.

ALTER TABLE public.email_templates
  DROP CONSTRAINT IF EXISTS email_templates_category_check;

ALTER TABLE public.email_templates
  ADD CONSTRAINT email_templates_category_check CHECK (
    category IN (
      'message_alert',
      'portal_message_notice',
      'intake_complete_alert',
      'intake_invite',
      'retell_call_alert',
      'manual'
    )
  );

INSERT INTO public.email_settings (category, mode)
VALUES ('retell_call_alert', 'on')
ON CONFLICT (category) DO NOTHING;
