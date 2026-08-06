-- Local development grants applied after the canonical migrations.
-- Auto-runs after migrations on `supabase db reset` (and on the first
-- `supabase start`). Safe/idempotent to re-run. NOT used by the hosted firm DB.
--
-- The local Supabase stack's default privileges omit
--     SELECT/INSERT/UPDATE for anon/authenticated on `public` tables. The
--     drafting migrations rely on those grants (RLS controls the rows), so
--     without them the users-role lookup in proxy.ts returns null and login
--     ends in an /auth/login <-> /admin/drafting redirect loop.
-- Schema belongs in timestamped migrations, not in this seed file.

-- ── Grants (match hosted Supabase platform defaults) ─────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
-- Function privileges are intentionally defined by migrations. A blanket
-- grant here would undo explicit RPC hardening and expose service-only calls.

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
