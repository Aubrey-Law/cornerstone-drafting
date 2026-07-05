-- Expose Supabase's built-in auth.audit_log_entries to admins via a
-- SECURITY DEFINER function. The auth schema is otherwise opaque to
-- PostgREST callers; without this function admins have to SSH into the DB
-- to investigate failed logins or suspicious activity.
--
-- Returns the most recent N events, optionally filtered by event type
-- ('login', 'logout', 'token_refreshed', etc. — see Supabase docs for the
-- full list). Decodes the JSON payload into useful columns. Service-role
-- and attorney/admin only.

CREATE OR REPLACE FUNCTION public.get_recent_auth_events(
  p_limit       int  DEFAULT 100,
  p_event_type  text DEFAULT NULL
)
RETURNS TABLE(
  id            uuid,
  created_at    timestamptz,
  ip_address    text,
  event_type    text,
  user_id       text,
  user_email    text,
  payload       json
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
  SELECT
    e.id,
    e.created_at,
    e.ip_address::text,
    (e.payload->>'action')          AS event_type,
    (e.payload->>'actor_id')        AS user_id,
    (e.payload->>'actor_username')  AS user_email,
    e.payload
  FROM auth.audit_log_entries e
  WHERE
    is_attorney_or_staff()
    AND (p_event_type IS NULL OR (e.payload->>'action') = p_event_type)
  ORDER BY e.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
$$;

REVOKE ALL ON FUNCTION public.get_recent_auth_events(int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_recent_auth_events(int, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_recent_auth_events(int, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_recent_auth_events(int, text) TO service_role;

COMMENT ON FUNCTION public.get_recent_auth_events(int, text) IS
  'Admin-only wrapper around auth.audit_log_entries. Self-gates via is_attorney_or_staff(); non-admins receive empty result set.';
