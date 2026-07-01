-- Migration: add email_log table for outbound email tracking
-- Run this in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS email_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email    text NOT NULL,
  subject     text NOT NULL,
  reply_to    text,
  resend_id   text,
  status      text NOT NULL DEFAULT 'sent',   -- 'sent' | 'error'
  error       text,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

-- Only the admin user can read the log
CREATE POLICY "Admin can read email log"
  ON email_log
  FOR SELECT
  USING (auth.email() = 'scott@aubreylegal.com');

-- Inserts come from the service-role key (server-side), so no INSERT policy needed for anon/user roles
