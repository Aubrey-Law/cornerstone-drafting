-- Seed the post-discovery follow-up category in the email kill-switch table.
-- Defaults to off, but uses Microsoft 365 when enabled so replies land in the mailbox.

INSERT INTO public.email_settings (category, mode, provider) VALUES
  ('post_discovery_followup', 'off', 'graph')
ON CONFLICT (category) DO UPDATE
SET provider = EXCLUDED.provider;
