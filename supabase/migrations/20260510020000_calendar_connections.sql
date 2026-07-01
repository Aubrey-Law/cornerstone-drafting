-- Multi-provider calendar OAuth tokens (Google + Microsoft Graph).
-- Supersedes the single-provider google_tokens table. Existing google_tokens
-- row is migrated forward; the legacy table is left in place for one release
-- so a rollback can re-read it.

CREATE TABLE IF NOT EXISTS calendar_connections (
  id             text PRIMARY KEY,                    -- provider name (singleton per provider for now)
  provider       text NOT NULL,                       -- 'google' | 'microsoft'
  access_token   text NOT NULL,
  refresh_token  text,
  expires_at     timestamptz NOT NULL,
  account_email  text,
  scope          text,
  raw_metadata   jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_connections_provider_chk CHECK (provider IN ('google','microsoft'))
);

ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;

-- Tokens are read/written exclusively via the service role key from the
-- server-side admin client. No anon or authenticated access.
DROP POLICY IF EXISTS "service role manages calendar connections" ON calendar_connections;
CREATE POLICY "service role manages calendar connections"
  ON calendar_connections
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Backfill from legacy google_tokens (singleton row, id='singleton').
INSERT INTO calendar_connections (id, provider, access_token, refresh_token, expires_at, updated_at)
SELECT 'google', 'google', access_token, refresh_token, expires_at, updated_at
FROM google_tokens
WHERE id = 'singleton'
ON CONFLICT (id) DO NOTHING;
