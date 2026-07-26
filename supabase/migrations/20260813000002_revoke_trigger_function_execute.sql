-- Take trigger functions out of the exposed REST API surface.
--
-- Supabase exposes every function in `public` at /rest/v1/rpc/<name>. Functions
-- that return `trigger` are never meant to be called directly, but the default
-- grants left them EXECUTE-able by PUBLIC/anon/authenticated. The database
-- surfaced this as: `public.bump_message_unread()` is callable by the `anon`
-- role as a SECURITY DEFINER function.
--
-- Postgres refuses to invoke a trigger function through a normal call, and
-- triggers themselves run regardless of EXECUTE grants (they execute as part of
-- the table's DML, not as a called routine), so revoking is both safe and a
-- no-op for legitimate use. This just removes needless attack surface.

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_type t ON t.oid = p.prorettype
    WHERE n.nspname = 'public'
      AND t.typname = 'trigger'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
  END LOOP;
END $$;
