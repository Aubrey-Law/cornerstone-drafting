-- Seed the stage-engine nudge category in the email kill-switch table.
-- Defaults to off; uses Microsoft 365 when enabled (same transport as the nudge cron).

INSERT INTO public.email_settings (category, mode, provider) VALUES
  ('stage_nudge', 'off', 'graph')
ON CONFLICT (category) DO UPDATE
SET provider = EXCLUDED.provider;
