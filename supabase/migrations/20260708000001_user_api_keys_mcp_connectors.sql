-- Cornerstone Drafting — staff BYOK API keys + MCP connector storage
-- Incremental / idempotent for the shared firm database.
-- Auth material is encrypted by the Next.js API (AES-256-GCM) before write.
-- RLS on with no authenticated grants — service role only.

-- ── user_api_keys ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_api_keys (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider       text NOT NULL CHECK (provider = ANY (ARRAY[
                   'anthropic', 'openai', 'gemini'
                 ])),
  encrypted_key  text NOT NULL,
  iv             text NOT NULL,
  auth_tag       text NOT NULL,
  key_hint       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user
  ON public.user_api_keys(user_id);

ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_api_keys FROM anon, authenticated;

-- ── user_mcp_connectors (schema + CRUD; runtime phased) ─────────────────────

CREATE TABLE IF NOT EXISTS public.user_mcp_connectors (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  transport             text NOT NULL DEFAULT 'streamable_http'
                        CHECK (transport = ANY (ARRAY['streamable_http', 'sse'])),
  server_url            text NOT NULL,
  enabled               boolean NOT NULL DEFAULT true,
  auth_mode             text NOT NULL DEFAULT 'bearer'
                        CHECK (auth_mode = ANY (ARRAY['none', 'bearer', 'oauth'])),
  encrypted_auth_config text,
  auth_config_iv        text,
  auth_config_tag       text,
  tool_policy           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_mcp_connectors_user
  ON public.user_mcp_connectors(user_id);

ALTER TABLE public.user_mcp_connectors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_mcp_connectors FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.user_mcp_oauth_tokens (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id              uuid NOT NULL REFERENCES public.user_mcp_connectors(id) ON DELETE CASCADE,
  encrypted_access_token    text,
  access_token_iv           text,
  access_token_tag          text,
  encrypted_refresh_token   text,
  refresh_token_iv          text,
  refresh_token_tag         text,
  token_type                text,
  scope                     text,
  expires_at                timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_id)
);

ALTER TABLE public.user_mcp_oauth_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_mcp_oauth_tokens FROM anon, authenticated;

COMMENT ON TABLE public.user_api_keys IS
  'Staff BYOK provider keys; ciphertext only. Decrypted server-side with USER_API_KEYS_ENCRYPTION_SECRET.';
COMMENT ON TABLE public.user_mcp_connectors IS
  'Staff MCP connector configs; auth blobs encrypted. Runtime tool wiring is phased.';
