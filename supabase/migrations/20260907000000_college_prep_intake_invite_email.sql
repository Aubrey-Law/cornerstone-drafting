-- College Preparation Plan intake invitation email.
--
-- The invitation for this track is written to the parent, explains what
-- changes when the student turns 18, and links a different questionnaire. It
-- is its own category rather than a variant of `intake_invite` so the firm can
-- edit the two independently in the templates UI and switch either off on its
-- own.

ALTER TABLE public.email_templates
  DROP CONSTRAINT IF EXISTS email_templates_category_check;

ALTER TABLE public.email_templates
  ADD CONSTRAINT email_templates_category_check CHECK (
    category IN (
      'message_alert',
      'portal_message_notice',
      'intake_complete_alert',
      'intake_invite',
      'intake_invite_college_prep',
      'retell_call_alert',
      'manual'
    )
  );

INSERT INTO public.email_settings (category, mode)
VALUES ('intake_invite_college_prep', 'on')
ON CONFLICT (category) DO NOTHING;
