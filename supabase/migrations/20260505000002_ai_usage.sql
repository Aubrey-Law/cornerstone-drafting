-- AI usage log: one row per Anthropic API call from the admin chat routes.
-- Drives the "AI Usage" panel on /admin/settings.

CREATE TABLE IF NOT EXISTS ai_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  route         text NOT NULL,                 -- e.g. 'admin/chat', 'admin/matters/chat'
  context_type  text,                          -- 'matter' | 'lead' | 'general'
  matter_id     uuid REFERENCES matters(id) ON DELETE SET NULL,
  model         text NOT NULL,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_input_tokens     integer NOT NULL DEFAULT 0,
  cache_creation_input_tokens integer NOT NULL DEFAULT 0,
  duration_ms   integer,
  success       boolean NOT NULL DEFAULT true,
  error_message text
);

CREATE INDEX IF NOT EXISTS ai_usage_created_at_idx ON ai_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_matter_id_idx ON ai_usage (matter_id);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

-- Only admins/attorneys read this table; writes happen via service role from server actions.
DROP POLICY IF EXISTS ai_usage_admin_read ON ai_usage;
CREATE POLICY ai_usage_admin_read ON ai_usage
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('attorney', 'admin')
    )
  );

COMMENT ON TABLE ai_usage IS
  'Per-call Anthropic API usage log. Populated by /api/admin/chat and /api/admin/matters/chat after each completion.';
