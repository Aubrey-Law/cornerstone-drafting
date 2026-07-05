-- Email kill-switch + per-category modes
--
-- Adds:
--   * email_settings(category, mode, ...)         — one row per category, mode = on|off|redirect
--   * email_log new columns: category, intended_to, actual_to, html, cc, reply_to_addr, redirected
--   * email_log status now includes 'suppressed' and 'redirected'
--
-- Defaults every category to 'off' so the system ships in safe mode. Scott
-- explicitly turns categories on after walking through each flow.

-- ── email_settings ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_settings (
  category    text PRIMARY KEY,
  mode        text NOT NULL DEFAULT 'off' CHECK (mode IN ('on','off','redirect')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;

-- Admins/attorneys read; writes go through service role only.
DROP POLICY IF EXISTS "Admins read email_settings" ON email_settings;
CREATE POLICY "Admins read email_settings"
  ON email_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin','attorney')
    )
  );

INSERT INTO email_settings (category, mode) VALUES
  ('lead_notification',     'off'),
  ('intake_complete_alert', 'off'),
  ('intake_invite',         'off'),
  ('engagement_agreement',  'off'),
  ('message_alert',         'off'),
  ('plan_review_invite',    'off'),
  ('plan_review_unlocked',  'off'),
  ('manual',                'off')
ON CONFLICT (category) DO NOTHING;

-- ── email_log additions ──────────────────────────────────────────────────────

-- Bring forward the legacy table if a fresh DB doesn't have it yet.
CREATE TABLE IF NOT EXISTS email_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email    text NOT NULL,
  subject     text NOT NULL,
  reply_to    text,
  resend_id   text,
  status      text NOT NULL DEFAULT 'sent',
  error       text,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_log ADD COLUMN IF NOT EXISTS category    text;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS intended_to text;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS actual_to   text;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS cc          text;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS html        text;  -- payload, purged after 90d

-- Drop and re-add the status check to allow the new states.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'email_log' AND constraint_name = 'email_log_status_check'
  ) THEN
    ALTER TABLE email_log DROP CONSTRAINT email_log_status_check;
  END IF;
END$$;

ALTER TABLE email_log
  ADD CONSTRAINT email_log_status_check
  CHECK (status IN ('sent','error','suppressed','redirected'));

CREATE INDEX IF NOT EXISTS email_log_category_sent_at_idx
  ON email_log (category, sent_at DESC);

CREATE INDEX IF NOT EXISTS email_log_status_sent_at_idx
  ON email_log (status, sent_at DESC);

-- Reset the legacy single-admin policy so role-based access works for staff too.
DROP POLICY IF EXISTS "Admin can read email log" ON email_log;
CREATE POLICY "Admins read email_log"
  ON email_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin','attorney')
    )
  );

-- ── 90-day payload retention via pg_cron (best-effort; skipped if extension absent) ───
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'email_log_purge_payload',
      '0 3 * * *',
      $cron$
        UPDATE email_log
           SET html = NULL, cc = NULL
         WHERE sent_at < now() - interval '90 days'
           AND html IS NOT NULL;
      $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron not available in this environment; manual purge or app-level cron required.
  NULL;
END$$;
