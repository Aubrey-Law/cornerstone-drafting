-- Migration: add google_tokens table for Google Calendar OAuth
-- Run this in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS google_tokens (
  id            text PRIMARY KEY,
  access_token  text NOT NULL,
  refresh_token text,
  expires_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE google_tokens ENABLE ROW LEVEL SECURITY;

-- Only the authenticated admin user can read or write tokens
CREATE POLICY "Admin can manage google tokens"
  ON google_tokens
  FOR ALL
  USING (auth.email() = 'scott@aubreylegal.com')
  WITH CHECK (auth.email() = 'scott@aubreylegal.com');
