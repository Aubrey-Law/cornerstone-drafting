-- Seed automatic client-facing notification categories in the email kill-switch.
-- Defaults stay off so new sends are logged/suppressed until enabled in admin settings.

INSERT INTO public.email_settings (category, mode, provider) VALUES
  ('stage_change_notice', 'off', 'resend'),
  ('portal_message_notice', 'off', 'resend')
ON CONFLICT (category) DO UPDATE
SET provider = EXCLUDED.provider;
