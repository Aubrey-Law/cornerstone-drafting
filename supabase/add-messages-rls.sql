-- Migration: RLS policies for messages table
-- Run this in the Supabase SQL editor.

-- Create table if it doesn't already exist
CREATE TABLE IF NOT EXISTS messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  client_user_id uuid NOT NULL,
  sender         text NOT NULL CHECK (sender IN ('admin', 'client')),
  body           text NOT NULL,
  read           boolean NOT NULL DEFAULT false
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Clients can read their own messages
CREATE POLICY "Clients can read own messages"
  ON messages FOR SELECT
  USING (auth.uid() = client_user_id);

-- Clients can insert their own messages (sender must be 'client')
CREATE POLICY "Clients can insert own messages"
  ON messages FOR INSERT
  WITH CHECK (auth.uid() = client_user_id AND sender = 'client');

-- Clients can mark messages as read
CREATE POLICY "Clients can mark messages read"
  ON messages FOR UPDATE
  USING (auth.uid() = client_user_id)
  WITH CHECK (auth.uid() = client_user_id);

-- Admin (service role) bypasses RLS automatically — no extra policies needed.
-- If you need the admin user session to read all rows directly, add:
-- CREATE POLICY "Admin can manage all messages"
--   ON messages FOR ALL
--   USING (auth.email() = 'scott@aubreylegal.com')
--   WITH CHECK (auth.email() = 'scott@aubreylegal.com');
